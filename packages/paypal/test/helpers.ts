// Test-only plumbing: fixtures, an env builder and a fake `fetch` that records what the rail
// actually put on the wire. Nothing here ever opens a socket — SPEC §6.5 / the T5 ticket forbid
// tests from talking to PayPal at all.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RailIntent } from '@pbp/core';
import { createPayPalRail, type PayPalRail, type PayPalRailOptions } from '../src/index.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface Fixture<T> {
  _source: { kind: string; url: string; section: string; note: string; captured: string };
  response: T;
}

/** Loads `test/fixtures/<name>.json` (the body lives under `.response`; provenance under `._source`). */
export function fixture<T = unknown>(name: string): T {
  const raw = readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8');
  const parsed = JSON.parse(raw) as Fixture<T>;
  return parsed.response;
}

export function fixtureSource(name: string): Fixture<unknown>['_source'] {
  return (JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8')) as Fixture<unknown>)._source;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type FakeFetch = typeof fetch & { calls: RecordedRequest[] };

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** A `fetch` stand-in: every call is recorded, the handler decides the response. */
export function fakeFetch(handler: (request: RecordedRequest, index: number) => Response | Promise<Response>): FakeFetch {
  const calls: RecordedRequest[] = [];
  const impl = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const request: RecordedRequest = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: normaliseHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(request);
    return handler(request, calls.length - 1);
  };
  Object.defineProperty(impl, 'calls', { value: calls, enumerable: true });
  return impl as unknown as FakeFetch;
}

function normaliseHeaders(headers: NonNullable<FetchInit>['headers']): Record<string, string> {
  if (headers === undefined || headers === null) return {};
  const lower = (entries: Iterable<[string, unknown]>): Record<string, string> =>
    Object.fromEntries([...entries].map(([key, value]) => [key.toLowerCase(), String(value)]));

  if (Array.isArray(headers)) return lower(headers as Array<[string, string]>);
  const candidate = headers as { forEach?: (callback: (value: string, key: string) => void) => void };
  if (typeof candidate.forEach === 'function') {
    const pairs: Array<[string, string]> = [];
    candidate.forEach((value, key) => pairs.push([key, value]));
    return lower(pairs);
  }
  // `fetch` treats header names case-insensitively; the recorder mirrors that so tests can ask
  // for 'paypal-request-id' regardless of how the rail capitalised it.
  return lower(Object.entries(headers as Record<string, string>));
}

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const TEST_CLOCK = Date.parse('2026-11-06T17:00:00Z');

export const TEST_ENV: Record<string, string> = {
  PAYPAL_CLIENT_ID: 'test-client-id',
  PAYPAL_CLIENT_SECRET: 'test-client-secret',
  PAYPAL_ENV: 'sandbox',
};

export function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...TEST_ENV, ...extra };
}

export interface RailHarness {
  rail: PayPalRail;
  fetch: FakeFetch;
  sleeps: number[];
  setNow: (value: number) => void;
}

/** Builds a rail against the fake fetch. `now` starts at a fixed instant and can be advanced. */
export function harness(
  handler: (request: RecordedRequest, index: number) => Response | Promise<Response>,
  options: { env?: Record<string, string | undefined>; now?: number; overrides?: PayPalRailOptions } = {},
): RailHarness {
  const fake = fakeFetch(handler);
  const sleeps: number[] = [];
  let now = options.now ?? TEST_CLOCK;
  const rail = createPayPalRail(options.env ?? env(), {
    fetch: fake,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...options.overrides,
  });
  return { rail, fetch: fake, sleeps, setNow: (value: number) => (now = value) };
}

export const PRIYA: RailIntent = {
  intentId: 'int_priya_inv_2026_118',
  idempotencyKey: 'pbp-3f9c1a7d2e5b4c6a8d0e1f2a3b4c',
  amount: 120000,
  currency: 'USD',
  receiver: 'priya@nairwords.example',
  memo: 'Lumen & Lark · INV-2026-118 · PO-1184',
};

/** Routes `/v1/oauth2/token` to the recorded token fixture, everything else to the given handler. */
export function withToken(
  handler: (request: RecordedRequest, index: number) => Response | Promise<Response>,
): (request: RecordedRequest, index: number) => Response | Promise<Response> {
  return (request, index) => {
    if (request.url.endsWith('/v1/oauth2/token')) return json(fixture('token-response'));
    return handler(request, index);
  };
}
