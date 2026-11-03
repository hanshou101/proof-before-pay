// AC-12 / AC-15 / AC-4 (server side): one full run against the recorded golden data.
//
// Every assertion here is about the product's own numbers, not about the test double: totals come
// from `replay`, states from the state machine, receipts from the rail's GET.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyChain, type LedgerEvent } from '@pbp/core';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildBundle, bundleSchema } from '../src/bundle.js';
import { validateSchema } from '../src/json-schema.js';
import { bucketsOf, makeHarness, stateOfFinal, type Harness } from './harness.js';

let harness: Harness;
let golden: any;

beforeAll(async () => {
  harness = makeHarness();
  golden = harness.built.demo.scenario.golden;

  const reset = await harness.post('/api/demo/reset');
  expect(reset.status).toBe(200);
  const run = await harness.run('proof');
  expect(run.status).toBe(200);
});

afterAll(() => {
  harness.close();
});

function ledgerEvents(): LedgerEvent[] {
  const text = readFileSync(join(harness.dataDir, 'ledger.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LedgerEvent);
}

describe('a full Friday run', () => {
  it('matches golden.totalsAfterRun exactly', async () => {
    const state = await harness.get('/api/state');
    expect(state.status).toBe(200);
    expect(state.body.totals).toEqual(bucketsOf(golden.totalsAfterRun));
    expect(state.body.ignored.count).toBe(golden.totalsAfterRun.ignored.count);
  });

  it('leaves every item in the state the golden file says', async () => {
    const state = await harness.get('/api/state');
    for (const item of golden.items) {
      const intentId = state.body.byItem[item.itemId];
      if (item.final === 'ignored') {
        expect(intentId, `${item.itemId} should have no intent`).toBeUndefined();
        continue;
      }
      expect(intentId, `${item.itemId} has no intent`).toBeTruthy();
      const intent = state.body.intents[intentId];
      expect(intent.state, `${item.itemId} final state`).toBe(stateOfFinal(item.final));
      expect(intent.decision).toBe(item.decision);
      if (item.claim) expect(intent.amount).toBe(item.claim.total);
    }
  });

  it('checks every item exactly as the golden file records them', async () => {
    const state = await harness.get('/api/state');
    for (const item of golden.items) {
      if (!item.checks) continue;
      const intentId = state.body.byItem[item.itemId];
      const checks = state.body.intents[intentId].checks as { id: string; status: string; code: string }[];
      for (const [id, expected] of Object.entries(item.checks as Record<string, string>)) {
        const check = checks.find((entry) => entry.id === id);
        expect(check, `${item.itemId} ${id}`).toBeTruthy();
        const [status, code] = expected.includes(':') ? expected.split(':') : [expected, null];
        expect(check?.status, `${item.itemId} ${id} status`).toBe(status);
        if (code) expect(check?.code, `${item.itemId} ${id} code`).toBe(code);
      }
    }
  });

  it('links the duplicate block to the seeded history and its PayPal transaction id', async () => {
    const state = await harness.get('/api/state');
    const intent = state.body.intents[state.body.byItem['in_03']];
    const o4 = intent.checks.find((check: { id: string }) => check.id === 'O4');
    expect(o4.status).toBe('fail');
    expect(o4.code).toBe('DUPLICATE');
    expect(o4.facts.duplicateOf).toBe('hist_kenji_0142');
    expect(o4.facts.originalState).toBe('proven');
    expect(String(o4.facts.transactionId)).toMatch(/^TXN-/);
  });

  it('keeps the ledger hash chain intact', async () => {
    const events = ledgerEvents();
    expect(verifyChain(events)).toEqual({ ok: true });
    expect(events[0]?.type).toBe('ledger.opened');

    const state = await harness.get('/api/state');
    expect(state.body.ledger.verified).toBe(true);

    // seq is contiguous from 1: SSE consumers rely on it (AC-15 / SPEC §6.7).
    events.forEach((event, index) => expect(event.seq).toBe(index + 1));
  });

  it('records one payment.submitted before each rail call, and only one payout per key', async () => {
    const events = ledgerEvents();
    const submits = events.filter((event) => event.type === 'payment.submitted');
    const approved = golden.items.filter((item: any) => item.decision === 'approved');

    // Two rows per attempt: the intent (batch id unknown) and, once PayPal answers, the id.
    expect(submits.length).toBe(approved.length * 2);

    const rail = harness.rail.state();
    for (const batch of Object.values(rail.batches)) {
      expect(batch.payouts, `${batch.receiver} paid more than once`).toBe(1);
    }
    expect(Object.keys(rail.batches).length).toBe(approved.length + 1); // + the seeded history payout
  });

  it('serves a proof bundle for every proven intent that passes the schema', async () => {
    const state = await harness.get('/api/state');
    const proven = Object.values(state.body.intents as Record<string, any>).filter(
      (intent) => intent.state === 'proven',
    );
    expect(proven.length).toBe(golden.totalsAfterRun.proven.count);

    const schema = bundleSchema();
    for (const intent of proven) {
      const response = await harness.get(`/api/intents/${intent.id}/bundle`);
      expect(response.status).toBe(200);

      const errors = validateSchema(response.body, schema);
      expect(errors, `${intent.id}: ${JSON.stringify(errors)}`).toEqual([]);

      const bundle = response.body;
      expect(bundle.payment.transactionId).toMatch(/^TXN-/);
      expect(bundle.payment.railStatus).toBe('SUCCESS');
      expect(bundle.checks).toHaveLength(9);
      expect(bundle.ledger.seq).toBeGreaterThan(0);
      expect(bundle.ledger.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(bundle.ledger.verified).toBe(true);
      expect(bundle.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(bundle.extraction.model).toBe('test-golden');
      expect(bundle.agreement.id).toBeTruthy();
      expect(bundle.amountRule.length).toBeGreaterThan(10);
      expect(bundle.delivery.id).toBeTruthy();

      // The transaction id in the bundle is PayPal's, not ours: cross-check the rail's record.
      const rail = harness.rail.state();
      const batch = Object.values(rail.batches).find(
        (entry) => entry.payoutBatchId === bundle.payment.payoutBatchId,
      );
      expect(batch?.transactionId).toBe(bundle.payment.transactionId);
    }
  });

  it('refuses a bundle for an intent that does not exist', async () => {
    const response = await harness.get('/api/intents/int_nope/bundle');
    expect(response.status).toBe(404);
  });

  it('explains the held and blocked intents', async () => {
    const state = await harness.get('/api/state');
    for (const item of golden.items as any[]) {
      if (item.decision !== 'held' && item.decision !== 'blocked') continue;
      const intent = state.body.intents[state.body.byItem[item.itemId]];
      expect(intent.explanation, `${item.itemId} has no explanation`).toBeTruthy();
      expect(intent.explanation.text.length).toBeGreaterThan(10);
      expect(intent.explanation.source).toBe('model');
    }
  });

  it('builds the same bundle through the exported function as through HTTP', async () => {
    const direct = buildBundle(harness.built.runtime, 'int_in_02');
    const response = await harness.get('/api/intents/int_in_02/bundle');
    expect(direct.claim).toEqual(response.body.claim);
    expect(direct.payment).toEqual(response.body.payment);
  });

  it('serves the original PDF and refuses anything outside the inbox', async () => {
    const file = await harness.built.app.request('/api/inbox/in_02/files/kenji-INV-0153.pdf');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %

    const notMine = await harness.built.app.request('/api/inbox/in_02/files/Nair-Words-INV-2026-118.pdf');
    expect(notMine.status).toBe(404);

    const traversal = await harness.built.app.request('/api/inbox/in_02/files/..%2F..%2Fpackage.json');
    expect([403, 404]).toContain(traversal.status);
  });

  it('answers / and /api/health (AC-17 one-command start)', async () => {
    const root = await harness.get('/');
    // SPEC §6.7: `GET /` is the web app once `apps/web` has been built, and the API's own
    // description when it has not. Both are a 200 — AC-17 only requires that the URL answers.
    expect(root.status).toBe(200);
    const looksLikeWeb = typeof root.body === 'string' && root.body.includes('<div id="root">');
    const looksLikeInfo = typeof root.body === 'object' && root.body?.ok === true;
    expect(looksLikeWeb || looksLikeInfo).toBe(true);

    const health = await harness.get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
  });

  it('allows one run at a time', async () => {
    const slow = makeHarness({ railSubmitDelayMs: 150 });
    try {
      expect((await slow.post('/api/demo/reset')).status).toBe(200);
      const first = await slow.post('/api/runs', { mode: 'proof' });
      const second = await slow.post('/api/runs', { mode: 'proof' });
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body.error).toContain('already in progress');
      await slow.built.runner.waitForIdle();
    } finally {
      slow.close();
    }
  });
});
