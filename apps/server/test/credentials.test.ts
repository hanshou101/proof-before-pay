// AC-17: without PayPal and LLM credentials a run is refused with one human sentence and no
// external call at all. SPEC §6.9: an empty value counts as unset.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { credentialMessage, missingCredentials, readDotEnvFile } from '../src/config.js';
import { makeHarness } from './harness.js';

const harnesses: ReturnType<typeof makeHarness>[] = [];
const scratch: string[] = [];

afterAll(() => {
  for (const harness of harnesses) harness.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('missing credentials', () => {
  it('refuses the run with a human message and sends nothing', async () => {
    const harness = makeHarness({ withoutCredentials: true });
    harnesses.push(harness);

    const response = await harness.post('/api/runs', { mode: 'proof' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Add PAYPAL_CLIENT_ID to .env — nothing was sent.');
    expect(response.body.missing).toContain('LLM_API_KEY');

    expect(harness.rail.submitCalls).toBe(0);
    expect(harness.agent.processCalls).toBe(0);

    const ledger = readFileSync(join(harness.dataDir, 'ledger.jsonl'), 'utf8');
    expect(ledger).not.toContain('"run.started"');
    expect(ledger).toContain('"ledger.opened"');
  });

  it('treats a blank value as unset', () => {
    const missing = missingCredentials({
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '  ',
      LLM_API_KEY: 'x',
    });
    expect(missing).toEqual(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'LLM_API_BASE', 'LLM_MODEL']);
    expect(credentialMessage(['LLM_API_KEY'])).toBe('Add LLM_API_KEY to .env — nothing was sent.');
  });

  it('refuses a non-sandbox PAYPAL_ENV before anything is sent', async () => {
    const harness = makeHarness({ env: { PAYPAL_ENV: 'live' } });
    harnesses.push(harness);

    const response = await harness.post('/api/runs', { mode: 'proof' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Only the PayPal sandbox is supported');
    expect(harness.rail.submitCalls).toBe(0);
  });

  it('refuses demo:reset before it wipes the ledger (T8 round 3)', async () => {
    // The reset used to open a new epoch first and only then discover the credentials were
    // missing, so a failed reset destroyed the ledger and took ~134 s to say so.
    const harness = makeHarness({ withoutCredentials: true });
    harnesses.push(harness);

    const before = await harness.get('/api/state');
    const epochBefore = before.body.epoch;
    const headBefore = before.body.head;

    const started = Date.now();
    const response = await harness.post('/api/demo/reset');
    const elapsed = Date.now() - started;

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Add PAYPAL_CLIENT_ID to .env — nothing was sent.');
    expect(elapsed).toBeLessThan(2000);
    expect(harness.rail.submitCalls).toBe(0);

    const after = await harness.get('/api/state');
    expect(after.body.epoch).toBe(epochBefore);
    expect(after.body.head).toBe(headBefore);
  });

  it('reads .env like the rest of the repo expects (blank line = unset)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbp-env-'));
    scratch.push(dir);
    const path = join(dir, '.env.sample');
    writeFileSync(
      path,
      [
        '# comment',
        'PAYPAL_CLIENT_ID=abc',
        'PAYPAL_CLIENT_SECRET=',
        'export LLM_MODEL="deepseek-chat"',
        'PAYPAL_ENV=sandbox',
        'LLM_API_KEY= "  " ',
      ].join('\n'),
      'utf8',
    );

    expect(readDotEnvFile(path)).toEqual({
      PAYPAL_CLIENT_ID: 'abc',
      LLM_MODEL: 'deepseek-chat',
      PAYPAL_ENV: 'sandbox',
    });
  });
});
