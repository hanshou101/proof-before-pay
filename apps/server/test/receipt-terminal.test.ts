// SPEC §6.3.3 last paragraph: a receipt that would move a settled intent is not written — the
// ledger gets one human-readable `error` and the state stays where it is. Without this the UI
// would show a payment that is already proven as pending again, with no trace of the conflict.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

// in_01 (Priya, $1,200) is proven after a run.
const PRIYA = 'int_in_01';

let harness: Harness;

beforeEach(async () => {
  harness = makeHarness();
  expect((await harness.post('/api/demo/reset')).status).toBe(200);
  expect((await harness.run('proof')).status).toBe(200);
  harness.built.runner.close();
});

afterEach(() => harness.close());

it('a proven intent that later reads UNCLAIMED records an error and stays proven', async () => {
  const intent = harness.built.runtime.intent(PRIYA);
  expect(intent?.state).toBe('proven');
  harness.rail.setStatus(intent!.idempotencyKey, 'UNCLAIMED');

  const before = harness.built.runtime.events.length;
  const response = await harness.post(`/api/intents/${PRIYA}/actions`, {
    action: 'refresh_receipt',
    input: {},
  });

  expect(response.status).toBe(200);
  expect(response.body.intent.state).toBe('proven');

  const added = (
    harness.built.runtime.events.slice(before) as unknown as Array<{ type: string; data: any }>
  );
  expect(added.map((event) => event.type)).toEqual(['human.action', 'error']);
  expect(added[1]?.data.scope).toBe(`receipt:${PRIYA}`);
  expect(added[1]?.data.message).toContain('UNCLAIMED');
  expect(added[1]?.data.message).toContain('proven');
  expect(added.some((event) => event.type === 'receipt.updated')).toBe(false);
  expect(harness.built.runtime.intent(PRIYA)?.state).toBe('proven');
});
