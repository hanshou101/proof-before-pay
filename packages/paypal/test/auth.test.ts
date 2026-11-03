// SPEC §6.5.1 — OAuth2 client credentials: one token reused until 60 seconds before it
// expires, a fresh one when a request comes back 401, and never a secret in a message.
// The Basic header is built here; nothing in this file is allowed to print it.

import { describe, expect, it } from 'vitest';
import type { PayPalRailError } from '../src/index.js';
import { PRIYA, fixture, harness, json, withToken } from './helpers.js';

const CREATED = fixture('payout-created-201');
const AUTH_ERROR = fixture('error-401');
const TOKEN = fixture<Record<string, any>>('token-response');
/** The batch id the recording returned; a test never hard-codes a sandbox id. */
const CREATED_BATCH_ID = (CREATED as any).batch_header.payout_batch_id as string;

function tokenResponse(token: string): Response {
  return json({ ...TOKEN, access_token: token });
}

function created(): Response {
  return json(CREATED, 201);
}

function tokenCalls(fetch: { calls: Array<{ url: string }> }): number {
  return fetch.calls.filter((call) => call.url.endsWith('/v1/oauth2/token')).length;
}

describe('OAuth2 token', () => {
  it('asks once and reuses the token across submits', async () => {
    const { rail, fetch } = harness(withToken(() => created()));

    await rail.submit(PRIYA);
    await rail.submit({ ...PRIYA, intentId: 'int_second', idempotencyKey: 'pbp-second-key-000000000000000000' });

    expect(tokenCalls(fetch)).toBe(1);
  });

  it('refreshes 60 seconds before expiry, not after', async () => {
    const { rail, fetch, setNow } = harness(withToken(() => created()));

    await rail.submit(PRIYA);
    const expiresInMs = Number(TOKEN.expires_in) * 1000;

    setNow(Date.parse('2026-11-06T17:00:00Z') + expiresInMs - 60_001);
    await rail.submit(PRIYA);
    expect(tokenCalls(fetch)).toBe(1);

    setNow(Date.parse('2026-11-06T17:00:00Z') + expiresInMs - 60_000);
    await rail.submit(PRIYA);
    expect(tokenCalls(fetch)).toBe(2);
  });

  it('shares one in-flight token request between concurrent submits', async () => {
    const { rail, fetch } = harness(
      withToken(async () => {
        await Promise.resolve();
        return created();
      }),
    );

    await Promise.all([
      rail.submit(PRIYA),
      rail.submit({ ...PRIYA, intentId: 'int_second', idempotencyKey: 'pbp-second-key-000000000000000000' }),
    ]);

    expect(tokenCalls(fetch)).toBe(1);
  });

  it('renews once on a 401 and retries the same payout request', async () => {
    let issued = 0;
    const { rail, fetch } = harness((request) => {
      if (request.url.endsWith('/v1/oauth2/token')) {
        return tokenResponse(issued++ === 0 ? 'TOKEN-ONE' : 'TOKEN-TWO');
      }
      if (request.method === 'POST' && request.url.endsWith('/v1/payments/payouts')) {
        if (request.headers['authorization'] === 'Bearer TOKEN-ONE') return json(AUTH_ERROR, 401);
        return created();
      }
      return json({}, 404);
    });

    const result = await rail.submit(PRIYA);

    expect(result.payoutBatchId).toBe(CREATED_BATCH_ID);
    const posts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(posts).toHaveLength(2);
    // Same key, same body: a 401 means PayPal did not take it.
    expect(posts[1]!.headers['paypal-request-id']).toBe(posts[0]!.headers['paypal-request-id']);
    expect(posts[1]!.body).toBe(posts[0]!.body);
    expect(tokenCalls(fetch)).toBe(2);
  });

  it('turns a rejected token into a human sentence that carries no secret', async () => {
    const { rail, fetch } = harness(() => json(AUTH_ERROR, 401));

    const error = (await rail.submit(PRIYA).catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'unauthorized' });
    expect(error.message).toMatch(/credentials/i);
    const surface = `${error.message}\n${error.detail ?? ''}\n${error.stack ?? ''}`;
    expect(surface).not.toContain('test-client-secret');
    expect(surface).not.toContain('test-client-id');
    // base64("test-client-id:test-client-secret") — the Basic header must never be echoed.
    expect(surface).not.toContain(Buffer.from('test-client-id:test-client-secret').toString('base64'));
    expect(surface).not.toMatch(/Bearer [A-Za-z0-9._-]{8,}/);
    expect(fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'))).toHaveLength(0);
  });

  it('says the network died without echoing the Authorization header', async () => {
    const { rail } = harness(() => {
      throw new TypeError('fetch failed: ECONNRESET Authorization: Bearer TOKEN-ABC123456');
    });

    const error = (await rail.submit(PRIYA).catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'network', retryable: true });
    expect(error.message).toMatch(/did not answer/i);
    expect(`${error.message}\n${error.detail ?? ''}`).not.toMatch(/Bearer [A-Za-z0-9._-]{4,}/);
    expect(`${error.message}\n${error.detail ?? ''}`).not.toContain('test-client-secret');
  });
});
