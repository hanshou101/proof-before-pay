// SPEC §6.9 / AC-17 — a rail with no usable configuration must refuse to start and must not
// put a single request on the wire. The messages are the ones the UI shows; they are asserted
// verbatim because "nothing was sent" is a promise, not a tone of voice.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPayPalRail, type PayPalRailError } from '../src/index.js';
import { TEST_ENV, env, fakeFetch } from './helpers.js';

function refuse(vars: Record<string, string | undefined>): PayPalRailError {
  const fetch = fakeFetch(() => {
    throw new Error('no request may be sent while the configuration is invalid');
  });
  try {
    createPayPalRail(vars, { fetch, now: () => 0, sleep: async () => {} });
  } catch (error) {
    expect(fetch.calls).toHaveLength(0);
    return error as PayPalRailError;
  }
  throw new Error('the rail started with an invalid configuration');
}

describe('configuration is checked before anything is sent', () => {
  it('names the missing client id with the exact AC-17 sentence', () => {
    const error = refuse({ ...TEST_ENV, PAYPAL_CLIENT_ID: undefined });
    expect(error.message).toBe('Add PAYPAL_CLIENT_ID to .env — nothing was sent.');
    expect(error.kind).toBe('missing_credentials');
  });

  it('names the missing secret', () => {
    const error = refuse({ ...TEST_ENV, PAYPAL_CLIENT_SECRET: undefined });
    expect(error.message).toBe('Add PAYPAL_CLIENT_SECRET to .env — nothing was sent.');
  });

  it('lists the other missing key when both are gone', () => {
    const error = refuse({ PAYPAL_ENV: 'sandbox' });
    expect(error.message).toBe(
      'Add PAYPAL_CLIENT_ID to .env — nothing was sent. Also missing: PAYPAL_CLIENT_SECRET.',
    );
  });

  it('treats an empty string as unset (AGENTS friction A1)', () => {
    const error = refuse({ ...TEST_ENV, PAYPAL_CLIENT_ID: '   ' });
    expect(error.message).toBe('Add PAYPAL_CLIENT_ID to .env — nothing was sent.');
  });

  it('only runs against the sandbox', () => {
    expect(refuse({ ...TEST_ENV, PAYPAL_ENV: 'live' }).message).toBe(
      'Only the PayPal sandbox is supported — set PAYPAL_ENV=sandbox. Nothing was sent.',
    );
    expect(refuse({ ...TEST_ENV, PAYPAL_ENV: 'production' }).kind).toBe('config');
  });

  it('accepts PAYPAL_ENV=sandbox in any case and defaults to sandbox when unset', () => {
    expect(() => createPayPalRail(env({ PAYPAL_ENV: 'SANDBOX' }), { fetch: fakeFetch(() => new Response('{}')) })).not.toThrow();
    expect(() => createPayPalRail({ ...TEST_ENV, PAYPAL_ENV: undefined }, { fetch: fakeFetch(() => new Response('{}')) })).not.toThrow();
  });

  it('refuses an unreadable receiver map', () => {
    const error = refuse({ ...TEST_ENV, PBP_RECEIVER_MAP: 'ven_priya=priya@example.com' });
    expect(error.message).toMatch(/PBP_RECEIVER_MAP is not valid JSON/i);
    expect(error.message).toMatch(/nothing was sent/i);
  });

  it('refuses an unknown fault value instead of silently not injecting it', () => {
    const error = refuse({ ...TEST_ENV, PBP_FAULT: 'drop_after_everything' });
    expect(error.message).toMatch(/PBP_FAULT/i);
    expect(error.kind).toBe('config');
  });
});

describe('dependency hygiene (SPEC §6.0 / the ticket)', () => {
  it('depends on @pbp/core and nothing else — HTTP is Node built-in fetch', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      engines?: Record<string, string>;
      type?: string;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@pbp/core']);
    expect(pkg.dependencies?.['@pbp/core']).toBe('file:../core');
    expect(pkg.type).toBe('module');
    expect(pkg.engines?.node).toBe('>=20.19');
  });
});
