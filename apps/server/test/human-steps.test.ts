// AC-12: the four human steps from `golden.humanSteps`, in order, over HTTP — each step has to
// produce what the golden file says, and the totals at the end have to match
// `golden.totalsAfterHumanSteps`.

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { bucketsOf, makeHarness, type Harness } from './harness.js';

let harness: Harness;
let golden: any;

beforeAll(async () => {
  harness = makeHarness();
  golden = harness.built.demo.scenario.golden;
  expect((await harness.post('/api/demo/reset')).status).toBe(200);
  expect((await harness.run('proof')).status).toBe(200);
});

afterAll(() => harness.close());

const act = (itemId: string, action: string, input: Record<string, unknown> = {}) =>
  harness.post(`/api/intents/int_${itemId}/actions`, { action, input });

describe('the four human steps', () => {
  it('step 1 — verify_payee not_confirmed keeps the intent held and approve disabled', async () => {
    const step = golden.humanSteps[0];
    expect(step.action).toBe('verify_payee');

    const response = await act('in_04', 'verify_payee', step.input);
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('held');

    const check = (id: string) => response.body.intent.checks.find((entry: { id: string }) => entry.id === id);
    expect(check('P1').status).toBe('hold');
    expect(check('P1').code).toBe('PAYEE_MISMATCH');
    expect(check('P2').status).toBe('hold');
    expect(check('P2').code).toBe('CHANGE_REQUEST_PENDING');

    const approve = await act('in_04', 'approve', {});
    expect(approve.status).toBe(409);
    expect(approve.body.error).toContain('Verify the payee first');
    expect(approve.body.error).toContain('approval is disabled while payment details are unverified');
  });

  it('step 2 — mark_fraud rejects the intent and leaves the on-file payee alone', async () => {
    const step = golden.humanSteps[1];
    expect(step.action).toBe('mark_fraud');

    const response = await act('in_04', 'mark_fraud', { reason: 'Called Ana on the number on file.' });
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('rejected');

    // SPEC §6.3.3: mark_fraud marks the change request fraudulent; the vendor keeps its payee.
    expect(harness.built.runtime.overlay.changeRequests.get('cr_in_04')?.status).toBe('fraudulent');
    expect(harness.built.runtime.overlay.vendorPayee.has('ven_ana')).toBe(false);

    const state = await harness.get('/api/state');
    const vendor = state.body.vendors.find((entry: { id: string }) => entry.id === 'ven_ana');
    expect(vendor.payee.receiver).toBe('ana@studionorth.example');

    const p1 = response.body.intent.checks.find((entry: { id: string }) => entry.id === 'P1');
    expect(p1.facts.onFile).toBe('ana@studionorth.example');
    expect(p1.facts.requested).toBe('billing@studi0-north.example');
  });

  it('step 3 — accept_delivery clears O3 but the contract cap still holds O2', async () => {
    const step = golden.humanSteps[2];
    expect(step.action).toBe('accept_delivery');

    const response = await act('in_05', 'accept_delivery', step.input ?? {});
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('held');

    const byId = (id: string) => response.body.intent.checks.find((entry: { id: string }) => entry.id === id);
    expect(byId('O3').status).toBe('pass');
    expect(byId('O3').code).toBe('DELIVERY_ACCEPTED');
    expect(byId('O2').status).toBe('hold');
    expect(byId('O2').code).toBe('OVER_CAP');
    expect(byId('O2').facts.billedUnits).toBe(40);
    expect(byId('O2').facts.capUnits).toBe(32);
  });

  it('step 4 — approving the contract cap pays $1,920.00 and proves it', async () => {
    const step = golden.humanSteps[3];
    expect(step.action).toBe('approve');
    expect((step.input as { amount: number }).amount).toBe(192000);

    const response = await act('in_05', 'approve', step.input ?? {});
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('proven');
    expect(response.body.intent.approvedAmount).toBe(192000);
    expect(response.body.intent.receipt.railStatus).toBe('SUCCESS');
    expect(response.body.intent.receipt.transactionId).toMatch(/^TXN-/);
  });

  it('ends on golden.totalsAfterHumanSteps', async () => {
    const state = await harness.get('/api/state');
    expect(state.body.totals).toEqual(bucketsOf(golden.totalsAfterHumanSteps));
  });

  it('refuses actions that the state machine does not allow', async () => {
    const approveProven = await act('in_05', 'approve', {});
    expect(approveProven.status).toBe(409);
    expect(approveProven.body.error).toContain('already proven');

    const cancel = await act('in_01', 'cancel_payout', {});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toContain('cancel');

    const unknown = await harness.post('/api/intents/int_in_01/actions', { action: 'pay_now' });
    expect(unknown.status).toBe(400);

    const missing = await harness.post('/api/intents/int_nope/actions', { action: 'reject' });
    expect(missing.status).toBe(404);

    const badVerify = await act('in_04', 'verify_payee', { result: 'maybe' });
    expect(badVerify.status).toBe(409);
  });

  it('keeps the ledger consistent after the human steps', async () => {
    const state = await harness.get('/api/state');
    expect(state.body.ledger.verified).toBe(true);
    const events = state.body.intents['int_in_05'].humanActions.map((entry: { action: string }) => entry.action);
    expect(events).toEqual(['accept_delivery', 'approve']);
  });
});
