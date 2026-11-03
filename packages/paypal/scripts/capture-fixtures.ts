#!/usr/bin/env node
/**
 * T5 第 2 段：把沙箱真實回應錄成單元測試的夾具（AME-901）。
 *
 * 這個腳本會**在 PayPal 沙箱付錢**（每筆 $1.00，沙箱餘額，不是真錢），只在需要重錄夾具時
 * 由人手動執行；`scripts/verify.sh` 不會呼叫它。憑證只從倉庫根 `.env` 讀。
 *
 *   cd packages/paypal && npm run capture-fixtures
 *
 * 它做的事（依序）：
 *   1. POST /v1/oauth2/token                      → token-response.json（access_token 換成佔位值）
 *   2. GET  /v1/payments/payouts/{unknown} 帶假 token → error-401.json
 *   3. POST /v1/payments/payouts（缺 receiver）    → validation-error-400.json
 *   4. POST /v1/payments/payouts 付 $1 給真的沙箱個人帳號 → payout-created-201.json
 *   5. GET  /v1/payments/payouts/{batch}          → payout-batch-get.json
 *   6. GET  /v1/payments/payouts-item/{item} 輪詢到 SUCCESS → payout-item-success.json
 *   7. POST 同一個 sender_batch_id 再一次           → duplicate-sender-batch-id-400.json
 *   8. 付 $1 給沒有沙箱帳號的電郵，輪詢到 UNCLAIMED  → payout-item-unclaimed.json
 *   9. 立刻 cancel（批次還沒完成）                 → cancel-batch-not-completed-400.json
 *  10. 等批次完成後再 cancel 一次                  → cancel-internal-service-error-500.json
 *
 * 去敏：access_token 一律換成 `A21AA-NOT-A-CREDENTIAL`；client id / secret / Authorization
 * 標頭從不寫進檔案。批次、項目、交易號是沙箱物件，照原樣保留。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayoutPayload } from '../src/index.js';
import type { PayPalIntent } from '../src/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = resolve(REPO_ROOT, 'packages/paypal/test/fixtures');
const BASE = 'https://api-m.sandbox.paypal.com';
const TOKEN_PLACEHOLDER = 'A21AA-NOT-A-CREDENTIAL';
const CAPTURED = new Date().toISOString().slice(0, 10);

interface Env {
  [key: string]: string | undefined;
}

function loadEnv(): Env {
  const fromFile: Record<string, string> = {};
  for (const raw of readFileSync(resolve(REPO_ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    fromFile[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return { ...fromFile, ...process.env };
}

const env = loadEnv();
const clientId = env.PAYPAL_CLIENT_ID?.trim();
const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) throw new Error('Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env — nothing was sent.');

const secrets = [clientId, clientSecret];
let token: string | null = null;

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const secret of secrets) out = out.split(secret).join('[redacted]');
    if (token !== null) out = out.split(token).join(TOKEN_PLACEHOLDER);
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /^(authorization|access_token|client_secret|client_id)$/i.test(key) ? TOKEN_PLACEHOLDER : redact(inner);
    }
    return out;
  }
  return value;
}

async function http(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; bearer?: string | null } = {}): Promise<{ status: number; body: unknown }> {
  const bearer = options.bearer === undefined ? token : options.bearer;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

function write(file: string, path: string, section: string, note: string, status: number, body: unknown): void {
  const record = {
    _source: {
      kind: 'sandbox-recording',
      url: `${BASE}${path}`,
      section,
      note: `Recorded from the PayPal sandbox on ${CAPTURED} (HTTP ${status}) by packages/paypal/scripts/capture-fixtures.ts. access_token is replaced with a placeholder; client id, client secret and Authorization headers are never written. Batch, item and transaction ids are sandbox objects.`,
      captured: CAPTURED,
    },
    response: redact(body),
  };
  writeFileSync(resolve(FIXTURES, `${file}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}.json (HTTP ${status})`);
}

async function tokenCapture(): Promise<void> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const response = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.access_token !== 'string') throw new Error('PayPal returned no access token.');
  token = body.access_token;
  write(
    'token-response',
    '/v1/oauth2/token',
    'POST /v1/oauth2/token',
    'The real client-credentials answer: scope, token_type, app_id and expires_in as issued; access_token replaced with a placeholder. Tests only require a non-empty string.',
    response.status,
    body,
  );
}

async function captureFixtureBodies(): Promise<void> {
  // 2. A real 401 from the payouts API (a token PayPal does not know).
  const unauthorised = await http('GET', '/v1/payments/payouts/NOT-A-REAL-BATCH', { bearer: 'A21AA-NOT-A-CREDENTIAL' });
  write('error-401', '/v1/payments/payouts/NOT-A-REAL-BATCH', 'GET /v1/payments/payouts/{id} with a bogus bearer token', 'The error shape PayPal uses for a bad token: {"error","error_description"}; it has no name/message/details, which the rail tolerates.', unauthorised.status, unauthorised.body);

  // 3. A real validation error: an item with no receiver.
  const invalidKey = keyFor('validation');
  const invalidBody = {
    sender_batch_header: { sender_batch_id: invalidKey, email_subject: 'capture', email_message: 'capture' },
    items: [{ recipient_type: 'EMAIL', amount: { value: '1.00', currency: 'USD' }, receiver: '', note: 'capture', sender_item_id: 'int_capture_invalid' }],
  };
  const invalid = await http('POST', '/v1/payments/payouts', { body: invalidBody, headers: { 'PayPal-Request-Id': invalidKey } });
  write('validation-error-400', '/v1/payments/payouts', 'POST /v1/payments/payouts with items[0].receiver empty', 'A real 400 VALIDATION_ERROR. The sandbox accepted a zero amount and a non-USD currency (both 201), so a 422 could not be produced; this is the real 4xx the rail maps to "PayPal rejected this payout — nothing was sent".', invalid.status, invalid.body);

  // 4-5. One payout to a real sandbox personal account, then the batch it created.
  const paidIntent = makeIntent('capture_success', receiverFromMap('ven_priya') ?? 'priya@nairwords.example', 'Lumen & Lark · INV-CAPTURE · no PO');
  const created = await http('POST', '/v1/payments/payouts', {
    body: buildPayoutPayload(paidIntent, paidIntent.receiver),
    headers: { 'PayPal-Request-Id': paidIntent.idempotencyKey },
  });
  write('payout-created-201', '/v1/payments/payouts', 'POST /v1/payments/payouts', 'A real 201: batch_header plus the self link. This is not a receipt — the batch starts PENDING.', created.status, created.body);
  const batchId = read(created.body, ['batch_header', 'payout_batch_id']);
  if (typeof batchId !== 'string') throw new Error('No payout_batch_id in the 201.');

  const batch = await waitForBatchItems(batchId);
  write('payout-batch-get', `/v1/payments/payouts/${batchId}`, `GET /v1/payments/payouts/${batchId}`, 'A real batch read with exactly one item — the shape one intent produces. batch_status is reported alongside the item; the rail never treats it as proof.', batch.status, batch.body);
  const itemId = readFirstItem(batch.body, 'payout_item_id');
  if (typeof itemId !== 'string') throw new Error('No payout_item_id in the batch.');

  const success = await waitForItem(itemId, 'SUCCESS');
  write('payout-item-success', `/v1/payments/payouts-item/${itemId}`, `GET /v1/payments/payouts-item/${itemId}`, 'A real SUCCESS item with a transaction id — the only shape that may become proven.', success.status, success.body);

  // 7. The same sender_batch_id again.
  const duplicate = await http('POST', '/v1/payments/payouts', {
    body: buildPayoutPayload(paidIntent, paidIntent.receiver),
    headers: { 'PayPal-Request-Id': paidIntent.idempotencyKey },
  });
  write('duplicate-sender-batch-id-400', '/v1/payments/payouts', 'POST /v1/payments/payouts with a sender_batch_id that already exists', 'The real duplicate rejection: 400 USER_BUSINESS_ERROR, message "User business error.", issue "Batch with given sender_batch_id already exists", and the original batch under details[0].link[].href with an empty top-level links[].', duplicate.status, duplicate.body);

  // 8-10. One payout to an address with no sandbox account, then cancel twice.
  const unclaimedIntent = makeIntent('capture_unclaimed', `pbp-capture-unclaimed-${randomUUID().slice(0, 8)}@example.com`, 'Lumen & Lark · INV-CAPTURE-UNCLAIMED · no PO');
  const createdUnclaimed = await http('POST', '/v1/payments/payouts', {
    body: buildPayoutPayload(unclaimedIntent, unclaimedIntent.receiver),
    headers: { 'PayPal-Request-Id': unclaimedIntent.idempotencyKey },
  });
  const unclaimedBatchId = read(createdUnclaimed.body, ['batch_header', 'payout_batch_id']);
  if (typeof unclaimedBatchId !== 'string') throw new Error('No payout_batch_id for the unclaimed payout.');
  const unclaimedBatch = await waitForBatchItems(unclaimedBatchId);
  const unclaimedItemId = readFirstItem(unclaimedBatch.body, 'payout_item_id');
  if (typeof unclaimedItemId !== 'string') throw new Error('No payout_item_id for the unclaimed payout.');

  const unclaimed = await waitForItem(unclaimedItemId, 'UNCLAIMED');
  write('payout-item-unclaimed', `/v1/payments/payouts-item/${unclaimedItemId}`, `GET /v1/payments/payouts-item/${unclaimedItemId}`, 'A real UNCLAIMED item: the receiver has no PayPal account (errors.RECEIVER_UNREGISTERED), yet PayPal still issues a transaction id — which is why UNCLAIMED must never be proven.', unclaimed.status, unclaimed.body);

  const tooEarly = await http('POST', `/v1/payments/payouts-item/${unclaimedItemId}/cancel`, { body: {} });
  write('cancel-batch-not-completed-400', `/v1/payments/payouts-item/${unclaimedItemId}/cancel`, `POST /v1/payments/payouts-item/${unclaimedItemId}/cancel while the batch is still processing`, 'A real 400 the documentation does not list: BATCH_NOT_COMPLETED — "Only item belonging to a batch in Processed status can be cancelled." An item can already read UNCLAIMED while its batch has not finished.', tooEarly.status, tooEarly.body);

  const completed = await waitForBatchCompleted(unclaimedBatchId);
  const late = await http('POST', `/v1/payments/payouts-item/${unclaimedItemId}/cancel`, { body: {} });
  write('cancel-internal-service-error-500', `/v1/payments/payouts-item/${unclaimedItemId}/cancel`, `POST /v1/payments/payouts-item/${unclaimedItemId}/cancel after the batch completed`, `A real 500 INTERNAL_SERVICE_ERROR for an UNCLAIMED item in a batch whose batch_status is ${read(completed, ['batch_header', 'batch_status']) ?? 'unknown'}. This is the answer the sandbox gave on 2026-10-29; see docs/research/paypal-sandbox-spike.md §(d).`, late.status, late.body);
}

function receiverFromMap(key: string): string | null {
  const raw = env.PBP_RECEIVER_MAP?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

function keyFor(label: string): string {
  return `pbp-${createHash('sha256').update(`${label}:${randomUUID()}`).digest('hex').slice(0, 28)}`;
}

function makeIntent(intentId: string, receiver: string, memo: string): PayPalIntent {
  return { intentId, idempotencyKey: keyFor(intentId), amount: 100, currency: 'USD', receiver, memo, vendorId: 'ven_priya' };
}

function read(body: unknown, path: string[]): unknown {
  let current: unknown = body;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

function readFirstItem(body: unknown, field: string): unknown {
  const items = read(body, ['items']);
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0];
  return first !== null && typeof first === 'object' ? (first as Record<string, unknown>)[field] ?? null : null;
}

async function waitForBatchItems(batchId: string): Promise<{ status: number; body: unknown }> {
  let last: { status: number; body: unknown } = { status: 0, body: null };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = await http('GET', `/v1/payments/payouts/${batchId}`);
    const items = read(last.body, ['items']);
    if (Array.isArray(items) && items.length > 0) return last;
    await sleep(2000);
  }
  return last;
}

async function waitForBatchCompleted(batchId: string): Promise<unknown> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await http('GET', `/v1/payments/payouts/${batchId}`);
    const status = read(current.body, ['batch_header', 'batch_status']);
    const completed = read(current.body, ['batch_header', 'time_completed']);
    if (status === 'SUCCESS' && typeof completed === 'string') return current.body;
    await sleep(2000);
  }
  return null;
}

async function waitForItem(itemId: string, wanted: string): Promise<{ status: number; body: unknown }> {
  let last: { status: number; body: unknown } = { status: 0, body: null };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last = await http('GET', `/v1/payments/payouts-item/${itemId}`);
    const status = read(last.body, ['transaction_status']);
    if (status === wanted) return last;
    if (status === 'FAILED' || status === 'BLOCKED' || status === 'REVERSED') return last;
    await sleep(3000);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

await tokenCapture();
await captureFixtureBodies();
console.log('done');
