// Configuration and credential checks (SPEC §6.9, AC-17).
//
// Every env var is read through `readEnv`, which treats the empty string as "not set" — the
// repo's AGENTS friction note A1: a `.env` line like `PAYPAL_CLIENT_ID=` must behave like a
// missing key, not like a credential that is present but blank.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock } from './clock.js';

export interface ServerEnv {
  readonly [key: string]: string | undefined;
}

export interface PollConfig {
  /** 3 s per SPEC §6.7. */
  intervalMs: number;
  /** 120 s of foreground polling per SPEC §6.7. */
  windowMs: number;
  /** Then every 30 s in the background until a terminal receipt. */
  backgroundMs: number;
  /** Same-key submits before we hand the payment to a human (SPEC §6.5.2: at most 3 retries). */
  submitAttempts: number;
  submitBackoffMs: readonly number[];
  /**
   * How long the comparison run keeps polling its batches after the model is done (AC-14). A
   * sandbox payout can sit UNCLAIMED indefinitely; the screen shows what PayPal said at the cap.
   */
  comparisonSettleMs: number;
}

export interface ServerConfig {
  env: ServerEnv;
  dataDir: string;
  demoDir: string;
  port: number;
  allowComparison: boolean;
  operator: string;
  clock?: Clock;
  poll: PollConfig;
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const DEFAULT_POLL: PollConfig = {
  intervalMs: 3000,
  windowMs: 120_000,
  backgroundMs: 30_000,
  submitAttempts: 4,
  submitBackoffMs: [2000, 4000, 8000],
  comparisonSettleMs: 90_000,
};

/** Keys a run cannot start without (AC-17). Empty string counts as missing. */
export const REQUIRED_CREDENTIAL_KEYS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'LLM_API_BASE',
  'LLM_API_KEY',
  'LLM_MODEL',
] as const;

export function readEnv(env: ServerEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function readFlag(env: ServerEnv, key: string): boolean {
  const value = readEnv(env, key);
  return value === '1' || value?.toLowerCase() === 'true';
}

export function missingCredentials(env: ServerEnv): string[] {
  return REQUIRED_CREDENTIAL_KEYS.filter((key) => readEnv(env, key) === null);
}

/**
 * AC-17's human message: "Add PAYPAL_CLIENT_ID to .env — nothing was sent."
 * With several missing keys the message names the first and lists the rest.
 */
export function credentialMessage(missing: readonly string[]): string {
  const [first, ...rest] = missing;
  if (!first) return 'Credentials are configured.';
  const extra = rest.length > 0 ? ` Also missing: ${rest.join(', ')}.` : '';
  return `Add ${first} to .env — nothing was sent.${extra}`;
}

/** `PAYPAL_ENV` is sandbox-only (SPEC §6.9). Anything else is refused before a run starts. */
export function environmentProblem(env: ServerEnv): string | null {
  const value = readEnv(env, 'PAYPAL_ENV');
  if (value === null) return null;
  if (value.toLowerCase() === 'sandbox') return null;
  return 'Only the PayPal sandbox is supported — set PAYPAL_ENV=sandbox. Nothing was sent.';
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = overrides.env ?? process.env;
  const dataDir = overrides.dataDir ?? resolve(REPO_ROOT, readEnv(env, 'PBP_DATA_DIR') ?? 'data');
  const portRaw = readEnv(env, 'PORT');
  const port = overrides.port ?? (portRaw === null ? 8787 : Number.parseInt(portRaw, 10));

  return {
    env,
    dataDir,
    demoDir: overrides.demoDir ?? resolve(REPO_ROOT, 'demo'),
    port: Number.isFinite(port) ? port : 8787,
    allowComparison: overrides.allowComparison ?? readFlag(env, 'PBP_ALLOW_COMPARISON'),
    operator: overrides.operator ?? 'Maya',
    ...(overrides.clock ? { clock: overrides.clock } : {}),
    poll: overrides.poll ?? DEFAULT_POLL,
  };
}

/**
 * Minimal `.env` reader for `scripts/reset.mjs` and (T8) `src/main.ts`.
 * `KEY=value`, `#` comments, an optional `export ` prefix, and quoted values. An empty value is
 * dropped — SPEC §6.9 / AGENTS friction A1: blank means unset.
 */
export function readDotEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (value === '') continue;
    out[key] = value;
  }
  return out;
}
