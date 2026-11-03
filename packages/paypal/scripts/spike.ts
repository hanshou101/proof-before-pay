#!/usr/bin/env node
/**
 * T5 沙箱實測（AC-7 (a)–(f)）— SPEC §6.5。
 *
 * This script is the only thing in this package that talks to PayPal. It writes a sanitised
 * report (credentials, tokens and Authorization headers removed) to
 * `docs/research/paypal-sandbox-spike.md` unless another `--out` is given.
 *
 * Segment 1 of ticket AME-901 did not run it: there were no sandbox credentials. Segment 2 runs
 * it once the credentials are in `.env` (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
 * PAYPAL_ENV=sandbox).
 *
 *   npm run spike                    full AC-7 (a)–(f) + the six questions, writes the report
 *   npm run spike -- --quick         (b) one SUCCESS + (e) the same key pays once — used by
 *                                    `scripts/verify.d/20-paypal.sh` under need_local
 *
 * Options:
 *   --amount <usd>        amount per payout, default 1.00
 *   --receiver <email>    sandbox personal account; default PBP_RECEIVER_MAP.ven_priya, then the
 *                         scenario address priya@nairwords.example
 *   --unclaimed <email>   address with no sandbox account, default pbp-spike-unclaimed-<nonce>@example.com
 *   --poll <seconds>      how long to wait for a status, default 120
 *   --out <path>          report path (default docs/research/paypal-sandbox-spike.md)
 *   --no-request-id-probe skip the same-PayPal-Request-Id / new sender_batch_id probe
 *   --probe-limits        also send one 257-character sender_batch_id to observe the limit
 *
 * Money: the sandbox balance only. Nothing here can reach the live API — the rail refuses any
 * PAYPAL_ENV other than sandbox and hard-codes the sandbox base URL.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPayoutPayload,
  createPayPalRail,
  formatCents,
  PayPalRailError,
  redact,
  SANDBOX_BASE_URL,
  MAX_REQUEST_ID,
  MAX_SENDER_BATCH_ID,
} from '../src/index.js';
import type { PayPalIntent, PayPalRail, PayPalReceipt } from '../src/index.js';
import type { RailRef } from '@pbp/core';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_OUT = resolve(REPO_ROOT, 'docs/research/paypal-sandbox-spike.md');

interface Options {
  quick: boolean;
  out: string | null;
  amountCents: number;
  receiver: string | null;
  unclaimed: string | null;
  pollSeconds: number;
  probeRequestId: boolean;
  probeLimits: boolean;
}

interface Exchange {
  method: string;
  url: string;
  status: number;
  body: unknown;
}

interface Step {
  id: string;
  title: string;
  request: string;
  http: string;
  fields: Array<[string, string]>;
  conclusion: string;
  ok: boolean;
}

interface RawResult {
  status: number;
  body: unknown;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    quick: false,
    out: DEFAULT_OUT,
    amountCents: 100,
    receiver: null,
    unclaimed: null,
    pollSeconds: 120,
    probeRequestId: true,
    probeLimits: false,
  };
  let outExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case '--quick':
        options.quick = true;
        break;
      case '--out':
        options.out = resolve(process.cwd(), next());
        outExplicit = true;
        break;
      case '--amount':
        options.amountCents = parseAmount(next());
        break;
      case '--receiver':
        options.receiver = next();
        break;
      case '--unclaimed':
        options.unclaimed = next();
        break;
      case '--poll':
        options.pollSeconds = Number.parseInt(next(), 10);
        if (!Number.isFinite(options.pollSeconds) || options.pollSeconds <= 0) throw new Error('--poll must be a positive number of seconds');
        break;
      case '--no-request-id-probe':
        options.probeRequestId = false;
        break;
      case '--probe-limits':
        options.probeLimits = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  if (options.quick && !outExplicit) options.out = null;
  return options;
}

/** "1", "1.5", "0.99" → integer cents, with no float ever touching the amount. */
function parseAmount(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) throw new Error(`--amount must look like 1 or 1.25, got "${text}"`);
  return Number.parseInt(match[1]!, 10) * 100 + Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
}

function loadEnv(): Record<string, string | undefined> {
  const path = resolve(REPO_ROOT, '.env');
  const fromFile: Record<string, string> = {};
  if (existsSync(path)) {
    for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eq = withoutExport.indexOf('=');
      if (eq <= 0) continue;
      const key = withoutExport.slice(0, eq).trim();
      let value = withoutExport.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value !== '') fromFile[key] = value;
    }
  }
  return { ...fromFile, ...process.env };
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') throw new Error(`Add ${key} to .env — nothing was sent.`);
  return value;
}

function readReceiverMap(env: Record<string, string | undefined>): Record<string, string> {
  const raw = env.PBP_RECEIVER_MAP?.trim();
  if (raw === undefined || raw === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
        .map(([key, value]) => [key, (value as string).trim()]),
    );
  } catch {
    return {};
  }
}

/** 32 characters, [a-z0-9-] — the shape SPEC §6.2.4 gives every real key. */
function keyFor(nonce: string, label: string): string {
  return `pbp-${createHash('sha256').update(`${nonce}:${label}`).digest('hex').slice(0, 28)}`;
}

function countingFetch(): { fetchImpl: typeof fetch; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    counts.set(url, (counts.get(url) ?? 0) + 1);
    return fetch(input, init);
  };
  return { fetchImpl, counts };
}

function tokenRequests(counts: Map<string, number>): number {
  let total = 0;
  for (const [url, count] of counts) if (url.endsWith('/v1/oauth2/token')) total += count;
  return total;
}

/** Raw calls used only for measurements the rail deliberately hides (exact duplicate body). */
class RawProbe {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async auth(): Promise<{ expiresIn: number | null; tokenType: string | null }> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, 'utf8').toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 200) {
      throw new Error(`PayPal would not issue an access token (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const token = typeof body.access_token === 'string' ? body.access_token.trim() : '';
    if (token === '') throw new Error('PayPal returned no access_token.');
    this.token = token;
    return {
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
      tokenType: typeof body.token_type === 'string' ? body.token_type : null,
    };
  }

  async post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<RawResult> {
    return this.call('POST', path, body, headers);
  }

  async get(pathOrUrl: string): Promise<RawResult> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    return this.call('GET', url);
  }

  private async call(method: string, pathOrUrl: string, body?: unknown, headers: Record<string, string> = {}): Promise<RawResult> {
    let token = this.token;
    if (token === null) {
      await this.auth();
      token = this.token;
    }
    if (token === null) throw new Error('No access token.');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, body: parsed };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function pollUntil(
  rail: PayPalRail,
  ref: RailRef,
  accept: (receipt: PayPalReceipt) => boolean,
  seconds: number,
): Promise<{ receipt: PayPalReceipt; elapsedMs: number; tries: number }> {
  const started = Date.now();
  let tries = 0;
  let last: PayPalReceipt | null = null;
  while (Date.now() - started < seconds * 1000) {
    tries += 1;
    last = await rail.fetchReceipt(ref);
    if (accept(last)) return { receipt: last, elapsedMs: Date.now() - started, tries };
    await sleep(3000);
  }
  throw new Error(
    `PayPal did not reach the expected state within ${seconds}s (last status: ${last?.railStatus ?? 'none'}).`,
  );
}

function sanitize(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|secret|authorization/i.test(key) ? '[redacted]' : sanitize(inner, secrets);
    }
    return out;
  }
  return value;
}

function pretty(value: unknown, secrets: readonly string[]): string {
  return JSON.stringify(sanitize(value, secrets), null, 2);
}

function quote(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

function describeError(error: unknown): string {
  if (error instanceof PayPalRailError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const clientId = requireEnv(env, 'PAYPAL_CLIENT_ID');
  const clientSecret = requireEnv(env, 'PAYPAL_CLIENT_SECRET');
  const secrets = [clientId, clientSecret];

  const exchanges: Exchange[] = [];
  const { fetchImpl, counts } = countingFetch();
  const rail = createPayPalRail(env, {
    fetch: fetchImpl,
    onResponse: (exchange) => exchanges.push(exchange),
  });

  const receiverMap = readReceiverMap(env);
  const receiver =
    options.receiver ??
    receiverMap['ven_priya'] ??
    receiverMap['priya@nairwords.example'] ??
    'priya@nairwords.example';
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const memo = 'Lumen & Lark · INV-SPIKE · no PO';
  const amount = options.amountCents;

  const intentB: PayPalIntent = {
    intentId: 'int_spike_b',
    idempotencyKey: keyFor(nonce, 'b'),
    amount,
    currency: 'USD',
    receiver,
    memo,
    vendorId: 'ven_priya',
  };

  if (options.quick) {
    await runQuick(rail, intentB, options, secrets);
    return;
  }

  const steps: Step[] = [];
  const probe = new RawProbe(SANDBOX_BASE_URL, clientId, clientSecret);

  // (a) token: one token for two calls; record its lifetime (never the token itself).
  let ttl: number | null = null;
  try {
    const auth = await probe.auth();
    ttl = auth.expiresIn;
    const before = tokenRequests(counts);
    const bogus: RailRef = {
      intentId: 'int_spike_probe',
      idempotencyKey: keyFor(nonce, 'probe'),
      senderBatchId: keyFor(nonce, 'probe'),
      payoutBatchId: null,
      payoutItemId: 'NO-SUCH-ITEM',
    };
    await rail.fetchReceipt(bogus).catch(() => null);
    await rail.fetchReceipt(bogus).catch(() => null);
    const after = tokenRequests(counts);
    steps.push({
      id: 'a',
      title: 'OAuth2 token is reused (AC-7 a)',
      request: 'POST /v1/oauth2/token once, then two GET /v1/payments/payouts-item/<unknown>',
      http: '200 for the token; 404 for both GETs (the item does not exist, by design)',
      fields: [
        ['expires_in (seconds)', String(ttl ?? 'unknown')],
        ['token requests made by the rail for two calls', String(after - before)],
        ['token value', 'not recorded'],
      ],
      conclusion: after - before === 1 ? 'One token served both calls; the cache works.' : `The rail asked for ${after - before} tokens for two calls.`,
      ok: after - before === 1,
    });
  } catch (error) {
    steps.push({ id: 'a', title: 'OAuth2 token is reused (AC-7 a)', request: 'POST /v1/oauth2/token', http: 'error', fields: [], conclusion: describeError(error), ok: false });
  }

  // (b) one payout to a real sandbox personal account.
  let submitted: { payoutBatchId: string | null } = { payoutBatchId: null };
  let proven = false;
  let provenElapsed = 0;
  let proofError: string | null = null;
  try {
    submitted = await rail.submit(intentB);
    const ref = refFor(intentB, submitted.payoutBatchId);
    const result = await pollUntil(rail, ref, (receipt) => receipt.proof === 'proven' || receipt.proof === 'failed', options.pollSeconds);
    proven = result.receipt.proof === 'proven';
    provenElapsed = result.elapsedMs;
    steps.push({
      id: 'b',
      title: 'One payout to a sandbox personal account (AC-7 b)',
      request: `POST /v1/payments/payouts · receiver ${receiver} · amount $${formatCents(amount)}`,
      http: '201 (POST is not a receipt)',
      fields: [
        ['payout_batch_id', submitted.payoutBatchId ?? '(none)'],
        ['receipt railStatus', result.receipt.railStatus],
        ['receipt proof', result.receipt.proof],
        ['transaction_id', result.receipt.transactionId ?? '(none)'],
        ['time to settle', `${Math.round(provenElapsed / 1000)} s (${result.tries} reads)`],
      ],
      conclusion: proven ? 'SUCCESS with a transaction id — proven.' : 'No proof: see the receipt fields above.',
      ok: proven,
    });
  } catch (error) {
    proofError = describeError(error);
    steps.push({
      id: 'b',
      title: 'One payout to a sandbox personal account (AC-7 b)',
      request: `POST /v1/payments/payouts · receiver ${receiver}`,
      http: 'error',
      fields: [],
      conclusion: proofError,
      ok: false,
    });
  }

  const intentC: PayPalIntent = {
    intentId: 'int_spike_c',
    idempotencyKey: keyFor(nonce, 'c'),
    amount,
    currency: 'USD',
    receiver: options.unclaimed ?? `pbp-spike-unclaimed-${nonce}@example.com`,
    memo: 'Lumen & Lark · INV-SPIKE-UNCLAIMED · no PO',
  };

  // (c) an address with no sandbox account.
  let unclaimedItemId: string | null = null;
  let unclaimedElapsed = 0;
  try {
    const submittedC = await rail.submit(intentC);
    const refC = refFor(intentC, submittedC.payoutBatchId);
    const result = await pollUntil(rail, refC, (receipt) => receipt.railStatus === 'UNCLAIMED' || receipt.proof === 'failed', options.pollSeconds);
    unclaimedItemId = result.receipt.payoutItemId;
    unclaimedElapsed = result.elapsedMs;
    steps.push({
      id: 'c',
      title: 'A payout to an email with no sandbox account (AC-7 c)',
      request: `POST /v1/payments/payouts · receiver ${intentC.receiver}`,
      http: '201 (POST is not a receipt)',
      fields: [
        ['payout_batch_id', submittedC.payoutBatchId ?? '(none)'],
        ['receipt railStatus', result.receipt.railStatus],
        ['receipt proof', result.receipt.proof],
        ['time to UNCLAIMED', `${Math.round(unclaimedElapsed / 1000)} s (${result.tries} reads)`],
      ],
      conclusion: result.receipt.railStatus === 'UNCLAIMED' ? 'UNCLAIMED, mapped to awaiting — not paid.' : `Status was ${result.receipt.railStatus}, not UNCLAIMED.`,
      ok: result.receipt.railStatus === 'UNCLAIMED',
    });
  } catch (error) {
    steps.push({ id: 'c', title: 'A payout to an email with no sandbox account (AC-7 c)', request: `POST /v1/payments/payouts · receiver ${intentC.receiver}`, http: 'error', fields: [], conclusion: describeError(error), ok: false });
  }

  // (d) cancel that unclaimed item and read RETURNED.
  try {
    if (unclaimedItemId === null) throw new Error('No unclaimed item from (c) to cancel.');
    const refC = { ...refFor(intentC, null), payoutItemId: unclaimedItemId };
    await rail.cancel(refC);
    const result = await pollUntil(rail, refC, (receipt) => receipt.railStatus === 'RETURNED' || receipt.proof === 'proven', options.pollSeconds);
    steps.push({
      id: 'd',
      title: 'Cancel the unclaimed payout (AC-7 d)',
      request: `POST /v1/payments/payouts-item/${unclaimedItemId}/cancel`,
      http: '200',
      fields: [
        ['receipt railStatus after cancel', result.receipt.railStatus],
        ['receipt proof', result.receipt.proof],
        ['transaction_id', result.receipt.transactionId ?? '(none)'],
      ],
      conclusion:
        result.receipt.proof === 'cancelled'
          ? 'RETURNED after our own cancel — cancelled.'
          : result.receipt.proof === 'proven'
            ? 'The payee claimed it first; the receipt is SUCCESS and the payment is proven.'
            : `proof was ${result.receipt.proof}.`,
      ok: result.receipt.proof === 'cancelled' || result.receipt.proof === 'proven',
    });
  } catch (error) {
    steps.push({ id: 'd', title: 'Cancel the unclaimed payout (AC-7 d)', request: 'POST /v1/payments/payouts-item/<id>/cancel', http: 'error', fields: [], conclusion: describeError(error), ok: false });
  }

  // (e) the same sender_batch_id again: record the exact rejection, then let the rail recover.
  try {
    if (submitted.payoutBatchId === null) throw new Error('No batch from (b) to duplicate.');
    const duplicate = await probe.post('/v1/payments/payouts', buildPayoutPayload(intentB, receiver), {
      'PayPal-Request-Id': intentB.idempotencyKey,
    });
    const recovered = await rail.submit(intentB);
    const sameBatch = recovered.payoutBatchId === submitted.payoutBatchId;
    steps.push({
      id: 'e',
      title: 'The same sender_batch_id is sent again (AC-7 e)',
      request: `POST /v1/payments/payouts with sender_batch_id=${intentB.idempotencyKey} (the same as (b))`,
      http: `HTTP ${duplicate.status}`,
      fields: [
        ['response name', quote((duplicate.body as any)?.name ?? '(none)')],
        ['response message', quote((duplicate.body as any)?.message ?? '(none)')],
        ['details[].issue', quote((duplicate.body as any)?.details?.[0]?.issue ?? '(none)')],
        ['original batch the rail recovered', recovered.payoutBatchId ?? '(none)'],
        ['same batch as (b)', sameBatch ? 'yes' : 'no'],
      ],
      conclusion: sameBatch
        ? `PayPal refused a second payout and the rail recovered the original batch (HTTP ${duplicate.status}).`
        : 'The retry did not land on the original batch — stop and hand this to the controller (SPEC §6.5.2).',
      ok: sameBatch,
    });
  } catch (error) {
    steps.push({ id: 'e', title: 'The same sender_batch_id is sent again (AC-7 e)', request: 'POST /v1/payments/payouts (duplicate)', http: 'error', fields: [], conclusion: describeError(error), ok: false });
  }

  // (f) drop the answer after PayPal took it, then retry with the same key.
  try {
    const faultRail = createPayPalRail({ ...env, PBP_FAULT: 'drop_after_submit' }, { fetch: fetchImpl });
    const intentF: PayPalIntent = {
      intentId: 'int_spike_f',
      idempotencyKey: keyFor(nonce, 'f'),
      amount,
      currency: 'USD',
      receiver,
      memo: 'Lumen & Lark · INV-SPIKE-FAULT · no PO',
    };
    let dropped = false;
    try {
      await faultRail.submit(intentF);
    } catch (error) {
      dropped = error instanceof PayPalRailError && error.kind === 'lost_response';
    }
    const recovered = await faultRail.submit(intentF);
    const batch = recovered.payoutBatchId === null ? null : await probe.get(`/v1/payments/payouts/${recovered.payoutBatchId}`);
    const items = Array.isArray((batch?.body as any)?.items) ? ((batch?.body as any).items as unknown[]) : [];
    steps.push({
      id: 'f',
      title: 'The answer is dropped after PayPal took it (AC-7 f)',
      request: 'POST /v1/payments/payouts with PBP_FAULT=drop_after_submit, then the same key again',
      http: dropped ? 'the first answer was dropped by design' : 'no drop observed',
      fields: [
        ['first attempt', dropped ? 'lost_response (batch was created)' : 'did not drop'],
        ['recovered payout_batch_id', recovered.payoutBatchId ?? '(none)'],
        ['items in the batch (GET)', String(items.length)],
      ],
      conclusion: dropped && items.length === 1 ? 'One payment in PayPal after a lost answer and a retry.' : 'Expected exactly one item — inspect the fields above.',
      ok: dropped && items.length === 1,
    });
  } catch (error) {
    steps.push({ id: 'f', title: 'The answer is dropped after PayPal took it (AC-7 f)', request: 'PBP_FAULT=drop_after_submit', http: 'error', fields: [], conclusion: describeError(error), ok: false });
  }

  // The six questions this ticket must answer.
  const duplicateStep = steps.find((step) => step.id === 'e');
  const requestIdProbe = options.probeRequestId
    ? await runRequestIdProbe(probe, intentB, receiver, keyFor(nonce, 'ri'), nonce)
    : null;
  const limitProbe = options.probeLimits ? await runLimitProbe(probe, intentB, receiver) : null;

  const report = renderReport({
    options,
    receiver,
    nonce,
    steps,
    requestIdProbe,
    limitProbe,
    ttl,
    duplicateStep,
    unclaimedElapsed,
    proven,
    provenElapsed,
    intentB,
    intentC,
    proofError,
    exchanges,
    secrets,
  });

  const out = options.out ?? DEFAULT_OUT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report, 'utf8');
  console.log(`Report written to ${out}`);

  const failed = steps.filter((step) => !step.ok);
  if (failed.length > 0) {
    console.error(`Not verified: ${failed.map((step) => `(${step.id})`).join(', ')}`);
    process.exit(1);
  }
}

async function runRequestIdProbe(
  probe: RawProbe,
  intent: PayPalIntent,
  receiver: string,
  freshKey: string,
  nonce: string,
): Promise<{ status: number; body: unknown; newBatchId: string | null }> {
  // Same PayPal-Request-Id, a different sender_batch_id: does the request id alone replay?
  const body = buildPayoutPayload({ ...intent, idempotencyKey: freshKey, intentId: `int_spike_ri_${nonce}` }, receiver);
  const result = await probe.post('/v1/payments/payouts', body, { 'PayPal-Request-Id': intent.idempotencyKey });
  const newBatchId = typeof (result.body as any)?.batch_header?.payout_batch_id === 'string' ? (result.body as any).batch_header.payout_batch_id : null;
  return { status: result.status, body: result.body, newBatchId };
}

async function runLimitProbe(
  probe: RawProbe,
  intent: PayPalIntent,
  receiver: string,
): Promise<{ status: number; body: unknown; batchId: string | null }> {
  const longKey = 'k'.repeat(MAX_SENDER_BATCH_ID + 1);
  const body = buildPayoutPayload({ ...intent, idempotencyKey: longKey, intentId: 'int_spike_limit' }, receiver);
  const result = await probe.post('/v1/payments/payouts', body, { 'PayPal-Request-Id': longKey });
  const batchId = typeof (result.body as any)?.batch_header?.payout_batch_id === 'string' ? (result.body as any).batch_header.payout_batch_id : null;
  return { status: result.status, body: result.body, batchId };
}

async function runQuick(rail: PayPalRail, intent: PayPalIntent, options: Options, secrets: readonly string[]): Promise<void> {
  const first = await rail.submit(intent);
  const ref = refFor(intent, first.payoutBatchId);
  const settled = await pollUntil(rail, ref, (receipt) => receipt.proof === 'proven' || receipt.proof === 'failed', options.pollSeconds);
  const second = await rail.submit(intent);
  const same = second.payoutBatchId === first.payoutBatchId;

  console.log(`(b) ${intent.receiver} $${formatCents(intent.amount)} → ${first.payoutBatchId ?? '(no batch)'} · ${settled.receipt.railStatus} · ${settled.receipt.proof} · ${settled.receipt.transactionId ?? '(no transaction id)'}`);
  console.log(`(e) same sender_batch_id again → ${second.payoutBatchId ?? '(no batch)'} · same batch as (b): ${same ? 'yes' : 'no'}`);

  if (options.out !== null) {
    const lines = [
      '# PayPal sandbox quick check',
      '',
      `> Generated by \`packages/paypal/scripts/spike.ts --quick\`. Credentials redacted. ${new Date().toISOString()}`,
      '',
      `- (b) receiver ${intent.receiver}, $${formatCents(intent.amount)} → batch ${first.payoutBatchId ?? '(none)'} · ${settled.receipt.railStatus} · proof ${settled.receipt.proof} · transaction ${settled.receipt.transactionId ?? '(none)'}`,
      `- (e) the same sender_batch_id again → batch ${second.payoutBatchId ?? '(none)'} · same batch: ${same ? 'yes' : 'no'}`,
      '',
    ];
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, redact(lines.join('\n'), secrets), 'utf8');
  }

  if (settled.receipt.proof !== 'proven' || !same) process.exit(1);
}

function refFor(intent: PayPalIntent, payoutBatchId: string | null): RailRef {
  return {
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    senderBatchId: intent.idempotencyKey,
    payoutBatchId,
    payoutItemId: null,
  };
}

interface ReportInput {
  options: Options;
  receiver: string;
  nonce: string;
  steps: Step[];
  requestIdProbe: { status: number; body: unknown; newBatchId: string | null } | null;
  limitProbe: { status: number; body: unknown; batchId: string | null } | null;
  ttl: number | null;
  duplicateStep: Step | undefined;
  unclaimedElapsed: number;
  proven: boolean;
  provenElapsed: number;
  intentB: PayPalIntent;
  intentC: PayPalIntent;
  proofError: string | null;
  exchanges: Exchange[];
  secrets: readonly string[];
}

function renderReport(input: ReportInput): string {
  const { options, receiver, steps, requestIdProbe, limitProbe, ttl, unclaimedElapsed, proven, provenElapsed, intentB, intentC, proofError, exchanges, secrets } = input;
  const duplicate = input.duplicateStep;
  const duplicateField = (name: string): string => duplicate?.fields.find(([key]) => key === name)?.[1] ?? '(not measured)';

  const q1 = duplicate === undefined
    ? '(not measured — step (e) failed before the duplicate POST)'
    : `HTTP ${duplicate.http.replace(/^HTTP /, '')} · name ${duplicateField('response name')} · message ${duplicateField('response message')} · issue ${duplicateField('details[].issue')}`;
  const q2 = requestIdProbe === null
    ? '(skipped with --no-request-id-probe)'
    : requestIdProbe.status === 201
      ? `HTTP 201 — a new batch ${requestIdProbe.newBatchId ?? '(no id)'} was created. PayPal does not replay from PayPal-Request-Id alone.`
      : `HTTP ${requestIdProbe.status} — no replay; name ${quote((requestIdProbe.body as any)?.name ?? '(none)')}.`;
  const q3 = `Our keys are ${intentB.idempotencyKey.length} characters of [a-z0-9-] and PayPal accepted them (step b). PayPal's schema allows sender_batch_id up to ${MAX_SENDER_BATCH_ID} characters and PayPal-Request-Id up to ${MAX_REQUEST_ID}.` +
    (limitProbe === null
      ? ' The over-length probe was not run (add --probe-limits).'
      : ` A ${MAX_SENDER_BATCH_ID + 1}-character sender_batch_id returned HTTP ${limitProbe.status}${limitProbe.batchId === null ? '' : ` and created batch ${limitProbe.batchId} — PayPal accepted it`}.`);
  const q4 = (() => {
    const step = steps.find((candidate) => candidate.id === 'c');
    if (step === undefined) return '(not measured)';
    const status = step.fields.find(([key]) => key === 'receipt railStatus')?.[1] ?? 'unknown';
    return `${intentC.receiver} → ${status} after ${Math.round(unclaimedElapsed / 1000)} s.`;
  })();
  const q5 = steps.find((step) => step.id === 'd')?.fields.find(([key]) => key === 'receipt railStatus after cancel')?.[1] ?? '(not measured)';
  const q6 = proven
    ? `${receiver} → SUCCESS, proven in ${Math.round(provenElapsed / 1000)} s (transaction ${steps.find((step) => step.id === 'b')?.fields.find(([key]) => key === 'transaction_id')?.[1] ?? '(none)'}).`
    : `${receiver} → not proven. ${proofError ?? ''} If this is a .example address PayPal refused, set PBP_RECEIVER_MAP to a sandbox personal account and run again.`;

  const lines: string[] = [];
  lines.push('# PayPal 沙箱實測（T5 第 2 段）', '');
  lines.push('> 由 `packages/paypal/scripts/spike.ts` 產生；所有憑證、token 與 Authorization 標頭已去敏。');
  lines.push(`> 執行時間 ${new Date().toISOString()} · 端點 ${SANDBOX_BASE_URL} · 每筆 $${formatCents(options.amountCents)} · 收款人 ${receiver}`);
  lines.push('> 第一段（2026-10-27）沒有憑證，本檔的所有數字都必須由這次真實執行產生；沒有跑到的條目寫「not measured」，不補值。', '');
  lines.push('## 本票要回答的六個問題', '', '| # | 問題 | 實測結果 |', '| --- | --- | --- |');
  lines.push(`| 1 | 同一 \`sender_batch_id\` 再 POST 回什麼 | ${q1} |`);
  lines.push(`| 2 | 同一 \`PayPal-Request-Id\` 重放回什麼 | ${q2} |`);
  lines.push(`| 3 | 鍵的長度與字元限制 | ${q3} |`);
  lines.push(`| 4 | 付給沒有沙箱帳號的電郵 | ${q4} |`);
  lines.push(`| 5 | cancel 之後的狀態 | ${q5} |`);
  lines.push(`| 6 | 情境電郵的沙箱帳號能否收款 | ${q6} |`);
  lines.push('');
  lines.push(`Token 壽命（\`expires_in\`）：${ttl === null ? 'unknown' : `${ttl} 秒`}；rail 在到期前 60 秒換新。`, '');

  for (const step of steps) {
    lines.push(`## (${step.id}) ${step.title}`, '');
    lines.push(`**請求**：${step.request}`, '');
    lines.push(`**HTTP**：${step.http}`, '');
    if (step.fields.length > 0) {
      lines.push('| 欄位 | 值 |', '| --- | --- |');
      for (const [key, value] of step.fields) lines.push(`| ${key} | ${value.replace(/\|/g, '\\|')} |`);
      lines.push('');
    }
    lines.push(`**結論**：${step.conclusion}`, '');
  }

  if (requestIdProbe !== null) {
    lines.push('## 附加探針：同一 PayPal-Request-Id、不同 sender_batch_id', '');
    lines.push(`HTTP ${requestIdProbe.status}`, '');
    if (requestIdProbe.status === 201) {
      lines.push('> 這次建立了新批次，也就是沙箱多付了一筆（沙箱餘額，不是真錢）。這證明 PayPal-Request-Id 單獨不會重放。', '');
    }
    lines.push('```json', pretty(requestIdProbe.body, secrets), '```', '');
  }
  if (limitProbe !== null) {
    lines.push('## 附加探針：超長 sender_batch_id', '');
    lines.push(`HTTP ${limitProbe.status}`, '', '```json', pretty(limitProbe.body, secrets), '```', '');
  }

  const duplicateExchange = exchanges.find(
    (exchange) => exchange.method === 'POST' && exchange.url.endsWith('/v1/payments/payouts') && exchange.status === 400,
  );
  if (duplicateExchange !== undefined) {
    lines.push('## 重複鍵的原始回應（去敏，逐字）', '', '```json', pretty(duplicateExchange.body, secrets), '```', '');
  }

  lines.push('## 全部請求摘要（去敏）', '', '| 方法 | URL | HTTP |', '| --- | --- | --- |');
  for (const exchange of exchanges) {
    lines.push(`| ${exchange.method} | ${redact(exchange.url, secrets)} | ${exchange.status} |`);
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
