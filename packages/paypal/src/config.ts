// SPEC §6.9 — everything the rail reads from the environment, checked before a single request.
//
// The base URL is not configurable through the environment: this package only ever talks to the
// PayPal sandbox. A test may override it to point at a fake, but a real run cannot be aimed at
// the live API by a typo in `.env` (PAYPAL_ENV is sandbox-only).

import { PayPalRailError } from './errors.js';

export interface Env {
  readonly [key: string]: string | undefined;
}

export type FaultSpec =
  | { mode: 'drop_after_submit'; scope: 'all' }
  | { mode: 'drop_after_submit'; scope: 'first' }
  | { mode: 'drop_after_submit'; scope: 'intent'; intentId: string };

export interface PayPalRailConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
  /** vendorId or scenario email → the sandbox account that can actually receive money. */
  readonly receivers: Readonly<Record<string, string>>;
  readonly fault: FaultSpec | null;
  readonly timeoutMs: number;
}

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

/** SPEC §6.5.1: renew the access token 60 seconds before it expires. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

/** PayPal's documented field limits (Payouts schema: sender_batch_id 256, PayPal-Request-Id 1000, sender_item_id 63). */
export const MAX_SENDER_BATCH_ID = 256;
export const MAX_REQUEST_ID = 1000;
export const MAX_SENDER_ITEM_ID = 63;
export const MAX_NOTE_LENGTH = 4000;

const DEFAULT_TIMEOUT_MS = 20_000;

/** Empty and whitespace-only values count as unset (AGENTS friction A1). */
export function readEnv(env: Env, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function readPayPalConfig(env: Env): PayPalRailConfig {
  const environment = readEnv(env, 'PAYPAL_ENV');
  if (environment !== null && environment.toLowerCase() !== 'sandbox') {
    throw new PayPalRailError(
      'config',
      'Only the PayPal sandbox is supported — set PAYPAL_ENV=sandbox. Nothing was sent.',
    );
  }

  const clientId = readEnv(env, 'PAYPAL_CLIENT_ID');
  const clientSecret = readEnv(env, 'PAYPAL_CLIENT_SECRET');
  const missing: string[] = [];
  if (clientId === null) missing.push('PAYPAL_CLIENT_ID');
  if (clientSecret === null) missing.push('PAYPAL_CLIENT_SECRET');
  if (clientId === null || clientSecret === null) {
    const [first, ...rest] = missing;
    const also = rest.length > 0 ? ` Also missing: ${rest.join(', ')}.` : '';
    throw new PayPalRailError('missing_credentials', `Add ${first} to .env — nothing was sent.${also}`);
  }

  return {
    clientId,
    clientSecret,
    baseUrl: SANDBOX_BASE_URL,
    receivers: parseReceiverMap(readEnv(env, 'PBP_RECEIVER_MAP')),
    fault: parseFault(readEnv(env, 'PBP_FAULT')),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function parseReceiverMap(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PayPalRailError('config', 'PBP_RECEIVER_MAP is not valid JSON — nothing was sent.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PayPalRailError('config', 'PBP_RECEIVER_MAP must be a JSON object of vendorId → sandbox email — nothing was sent.');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayPalRailError('config', `PBP_RECEIVER_MAP has no usable email for "${key}" — nothing was sent.`);
    }
    out[key.trim()] = value.trim();
  }
  return out;
}

function parseFault(raw: string | null): FaultSpec | null {
  if (raw === null) return null;
  if (raw === 'drop_after_submit') return { mode: 'drop_after_submit', scope: 'all' };
  if (raw === 'drop_after_submit:first') return { mode: 'drop_after_submit', scope: 'first' };
  if (raw.startsWith('drop_after_submit:')) {
    const intentId = raw.slice('drop_after_submit:'.length).trim();
    if (intentId !== '') return { mode: 'drop_after_submit', scope: 'intent', intentId };
  }
  throw new PayPalRailError(
    'config',
    `PBP_FAULT is not a recognised fault ("${raw}") — use drop_after_submit, drop_after_submit:first or drop_after_submit:<intentId>. Nothing was sent.`,
  );
}
