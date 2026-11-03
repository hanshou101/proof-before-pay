// SPEC §6.5 — the PayPal Payouts rail.
//
// Three promises live in this file:
//   1. One intent = one batch = one item, and `sender_batch_id` plus `PayPal-Request-Id` are the
//      intent's idempotency key. The key is never regenerated, so a resend cannot pay twice.
//   2. Only a GET is a receipt. A 201 (or a duplicate rejection that points at the original
//      batch) tells us an id to ask about — never that money arrived.
//   3. Cancel is only for UNCLAIMED, and a RETURNED receipt is "cancelled" only when our own
//      cancel caused it; if the payee claimed first, the same GET returns SUCCESS and that is
//      proven.

import { resolveProof } from '@pbp/core';
import type { ProofState, RailAdapter, RailIntent, RailRef, ReceiptResult, SubmitResult } from '@pbp/core';
import { PayPalClient } from './client.js';
import {
  MAX_NOTE_LENGTH,
  MAX_SENDER_BATCH_ID,
  MAX_SENDER_ITEM_ID,
  readPayPalConfig,
  type Env,
  type PayPalRailConfig,
} from './config.js';
import { PayPalRailError } from './errors.js';
import { isKnownRailStatus, mapStatus, normaliseStatus } from './status.js';

/** SPEC §6.5.2: retry a 5xx with the same key after 2 s, 4 s and 8 s — at most three times. */
export const SUBMIT_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000];

/**
 * The core contract plus one optional field: the vendor id lets `PBP_RECEIVER_MAP` be keyed the
 * way SPEC §6.5.5 describes (vendorId → sandbox email). A caller that only has the email can
 * still pass a map keyed by email.
 */
export interface PayPalIntent extends RailIntent {
  vendorId?: string;
}

export interface PayPalSubmitResult extends SubmitResult {
  /** The address the money was actually sent to (after `PBP_RECEIVER_MAP`). */
  receiver: string;
  /** The address the invoice asked for; both go into the proof bundle. */
  requestedReceiver: string;
}

export interface PayPalReceipt extends ReceiptResult {
  /** The server records this as the receipt's `source`. */
  source: 'rail_get';
  /** False when PayPal returned a status outside SPEC §6.5.3 — the caller records an `error`. */
  statusKnown: boolean;
  /** The receiver PayPal reports on the item, when it sends one. */
  receiver: string | null;
}

export interface PayPalRailOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Read-only telemetry (the sandbox spike records raw responses); never sees the token call. */
  onResponse?: (exchange: { method: string; url: string; status: number; body: unknown }) => void;
  /** Tests only; production always uses the sandbox base URL from config. */
  baseUrl?: string;
  timeoutMs?: number;
}

type ItemRecord = Record<string, any>;

interface RailDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onResponse?: (exchange: { method: string; url: string; status: number; body: unknown }) => void;
}

export class PayPalRail implements RailAdapter {
  private readonly client: PayPalClient;
  private readonly receiverIndex: Map<string, string>;
  /** Item ids we asked PayPal to cancel in this process: RETURNED then means "cancelled". */
  private readonly cancelling = new Set<string>();
  private faultFired = false;

  constructor(
    private readonly config: PayPalRailConfig,
    private readonly deps: RailDeps,
  ) {
    this.client = new PayPalClient(config, {
      fetchImpl: deps.fetch,
      now: deps.now,
      ...(deps.onResponse === undefined ? {} : { onResponse: deps.onResponse }),
    });
    this.receiverIndex = new Map();
    for (const [key, value] of Object.entries(config.receivers)) {
      this.receiverIndex.set(key, value);
      this.receiverIndex.set(key.toLowerCase(), value);
    }
  }

  async submit(intent: RailIntent): Promise<PayPalSubmitResult> {
    assertSubmittable(intent);
    const requestedReceiver = intent.receiver.trim();
    const receiver = this.resolveReceiver(intent, requestedReceiver);
    const payload = buildPayoutPayload(intent, receiver);

    let retries = 0;
    for (;;) {
      const result = await this.client.send('POST', '/v1/payments/payouts', {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', 'PayPal-Request-Id': intent.idempotencyKey },
      });

      if (result.status === 200 || result.status === 201) {
        const payoutBatchId = readBatchId(result.body);
        if (payoutBatchId === null) {
          throw new PayPalRailError(
            'protocol',
            'PayPal accepted the payout but the answer carried no payout_batch_id. Nothing else was sent — look the batch up by sender_batch_id.',
            { status: result.status, detail: this.describe(result.body) },
          );
        }
        this.maybeDropAnswer(intent);
        return { senderBatchId: intent.idempotencyKey, payoutBatchId, receiver, requestedReceiver };
      }

      if (result.status === 400 && isDuplicateSenderBatch(result.body)) {
        const payoutBatchId = await this.recoverOriginalBatch(result.body);
        return { senderBatchId: intent.idempotencyKey, payoutBatchId, receiver, requestedReceiver };
      }

      if (result.status >= 500) {
        const delay = SUBMIT_RETRY_DELAYS_MS[retries];
        if (delay !== undefined) {
          retries += 1;
          await this.deps.sleep(delay);
          continue;
        }
        throw new PayPalRailError(
          'unavailable',
          'PayPal is not answering right now. We will keep the same key — a retry can never pay twice.',
          { status: result.status, retryable: true, detail: this.describe(result.body) },
        );
      }

      throw this.submitError(result.status, result.body);
    }
  }

  async fetchReceipt(ref: RailRef): Promise<PayPalReceipt> {
    const item = await this.findItem(ref);
    const railStatus = typeof item.transaction_status === 'string' ? item.transaction_status : '';
    const transactionId = trimmedOrNull(item.transaction_id);
    const payoutItemId = trimmedOrNull(item.payout_item_id) ?? ref.payoutItemId;
    const cancelledByUs =
      normaliseStatus(railStatus) === 'RETURNED' && payoutItemId !== null && this.cancelling.has(payoutItemId);

    return {
      railStatus,
      proof: cancelledByUs ? 'cancelled' : resolveProof(railStatus, transactionId),
      payoutItemId,
      transactionId,
      fetchedAt: new Date(this.deps.now()).toISOString(),
      source: 'rail_get',
      statusKnown: isKnownRailStatus(railStatus),
      receiver: typeof item.payout_item?.receiver === 'string' ? item.payout_item.receiver : null,
    };
  }

  async cancel(ref: RailRef): Promise<void> {
    const item = await this.findItem(ref);
    const payoutItemId = trimmedOrNull(item.payout_item_id) ?? ref.payoutItemId;
    if (payoutItemId === null) {
      throw new PayPalRailError('protocol', 'PayPal did not say which payout item to cancel. Nothing was cancelled.');
    }

    const status = normaliseStatus(item.transaction_status);
    if (status !== 'UNCLAIMED') {
      throw new PayPalRailError(
        'not_cancelable',
        `PayPal says this payout is ${status === '' ? 'in an unknown state' : status} — only an unclaimed payout can be cancelled. We check the receipt instead.`,
        { detail: 'Only UNCLAIMED payout items can be cancelled (Payouts v1 payouts-item cancel).' },
      );
    }

    const result = await this.client.send('POST', `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}/cancel`, {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    if (result.status === 200) {
      this.cancelling.add(payoutItemId);
      return;
    }

    const issue = issueText(result.body);
    if (result.status === 400 && /ITEM_INCORRECT_STATUS|only cancel items that are unclaimed/i.test(issue)) {
      throw new PayPalRailError(
        'not_cancelable',
        'PayPal says this payout is no longer unclaimed — it cannot be cancelled. We check the receipt instead.',
        { status: result.status, detail: this.describe(result.body) },
      );
    }

    throw new PayPalRailError(
      'rejected',
      'PayPal would not cancel this payout. The payment is unchanged — check the receipt.',
      { status: result.status, detail: this.describe(result.body) },
    );
  }

  mapStatus(railStatus: string): ProofState {
    return mapStatus(railStatus);
  }

  // --- internals -----------------------------------------------------------------------------

  private resolveReceiver(intent: RailIntent, requested: string): string {
    const vendorId = (intent as PayPalIntent).vendorId;
    if (typeof vendorId === 'string') {
      const byVendor = this.receiverIndex.get(vendorId.trim());
      if (byVendor !== undefined) return byVendor;
    }
    return this.receiverIndex.get(requested) ?? this.receiverIndex.get(requested.toLowerCase()) ?? requested;
  }

  private async findItem(ref: RailRef): Promise<ItemRecord> {
    if (ref.payoutItemId !== null && ref.payoutItemId.trim() !== '') {
      return this.getItem(ref.payoutItemId.trim());
    }
    if (ref.payoutBatchId !== null && ref.payoutBatchId.trim() !== '') {
      const batch = await this.getBatch(ref.payoutBatchId.trim());
      const item = Array.isArray(batch.items) ? batch.items[0] : null;
      if (item === null || typeof item !== 'object') {
        throw new PayPalRailError('protocol', 'PayPal has no item in this batch yet — there is nothing to ask about. The payment is not counted as paid.');
      }
      return item as ItemRecord;
    }
    throw new PayPalRailError(
      'no_reference',
      'This payment has no PayPal id yet — there is nothing to ask about. It is not counted as paid.',
    );
  }

  private async getItem(payoutItemId: string): Promise<ItemRecord> {
    const result = await this.client.send('GET', `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`);
    if (result.status === 200 && result.body !== null && typeof result.body === 'object') {
      return result.body as ItemRecord;
    }
    throw this.receiptError(result.status, result.body);
  }

  private async getBatch(payoutBatchId: string): Promise<ItemRecord> {
    const result = await this.client.send('GET', `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
    if (result.status === 200 && result.body !== null && typeof result.body === 'object') {
      return result.body as ItemRecord;
    }
    throw this.receiptError(result.status, result.body);
  }

  /** A duplicate rejection is proof of a previous send: find the batch it points at. */
  private async recoverOriginalBatch(body: unknown): Promise<string> {
    const href = firstBatchHref(body);
    if (href === null) {
      throw new PayPalRailError(
        'duplicate_without_link',
        'PayPal says this batch already exists but did not say which one. Nothing was sent again — check the payout by hand.',
        { status: 400, detail: this.describe(body) },
      );
    }

    const result = await this.client.send('GET', href);
    if (result.status === 200) {
      const id = readBatchId(result.body);
      if (id !== null) return id;
    }
    const fromHref = batchIdFromUrl(href);
    if (fromHref !== null) return fromHref;
    throw new PayPalRailError(
      'duplicate_without_link',
      'PayPal says this batch already exists but its link did not name the batch. Nothing was sent again — check the payout by hand.',
      { status: 400, detail: this.describe(body) },
    );
  }

  private maybeDropAnswer(intent: RailIntent): void {
    const fault = this.config.fault;
    if (fault === null) return;
    if (fault.scope === 'first' && this.faultFired) return;
    if (fault.scope === 'intent' && fault.intentId !== intent.intentId) return;
    this.faultFired = true;
    throw new PayPalRailError(
      'lost_response',
      'PayPal accepted the payout but the answer never reached us. We will ask again with the same key — a retry can never pay twice.',
      { retryable: true },
    );
  }

  private submitError(status: number, body: unknown): PayPalRailError {
    const detail = this.describe(body);
    switch (status) {
      case 401:
        return new PayPalRailError('unauthorized', 'PayPal rejected our credentials — nothing was sent.', { status, detail });
      case 403:
        return new PayPalRailError('rejected', 'This PayPal app is not allowed to send payouts. Nothing was sent.', { status, detail });
      case 400:
      case 422:
        return new PayPalRailError(
          'rejected',
          'PayPal rejected this payout — nothing was sent. The details are in the developer log.',
          { status, detail },
        );
      default:
        return new PayPalRailError('protocol', `PayPal answered ${status} while we tried to send the payout. Nothing was sent.`, { status, detail });
    }
  }

  private receiptError(status: number, body: unknown): PayPalRailError {
    const detail = this.describe(body);
    if (status === 404) {
      return new PayPalRailError('rejected', 'PayPal could not find that payout. It is not counted as paid.', { status, detail });
    }
    if (status === 401 || status === 403) {
      return new PayPalRailError('unauthorized', 'PayPal rejected our credentials — the receipt could not be read.', { status, detail });
    }
    return new PayPalRailError('protocol', `PayPal answered ${status} while we tried to read the receipt. The payment is not counted as paid until it answers.`, { status, detail });
  }

  private describe(body: unknown): string | null {
    return this.client.describe(body);
  }
}

export function createPayPalRail(env: Env = process.env, options: PayPalRailOptions = {}): PayPalRail {
  const base = readPayPalConfig(env);
  const config: PayPalRailConfig = {
    ...base,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  return new PayPalRail(config, {
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    ...(options.onResponse === undefined ? {} : { onResponse: options.onResponse }),
  });
}

// --- field helpers ---------------------------------------------------------------------------

function assertSubmittable(intent: RailIntent): void {
  if (intent.currency !== 'USD') {
    throw new PayPalRailError('rejected', 'Only USD payouts are supported — nothing was sent.');
  }
  if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0) {
    throw new PayPalRailError('rejected', 'This payout amount is not a whole number of cents above zero — nothing was sent.');
  }
  if (typeof intent.idempotencyKey !== 'string' || intent.idempotencyKey.trim() === '') {
    throw new PayPalRailError('rejected', 'This payment has no idempotency key, so PayPal could pay it twice — nothing was sent.');
  }
  if (intent.idempotencyKey.length > MAX_SENDER_BATCH_ID) {
    throw new PayPalRailError('rejected', `The sender_batch_id is longer than PayPal's ${MAX_SENDER_BATCH_ID}-character limit — nothing was sent.`);
  }
  if (typeof intent.intentId !== 'string' || intent.intentId.trim() === '') {
    throw new PayPalRailError('rejected', 'This payment has no intent id, so its sender_item_id would be empty — nothing was sent.');
  }
  if (intent.intentId.length > MAX_SENDER_ITEM_ID) {
    throw new PayPalRailError('rejected', `The sender_item_id is longer than PayPal's ${MAX_SENDER_ITEM_ID}-character limit — nothing was sent.`);
  }
  if (typeof intent.receiver !== 'string' || intent.receiver.trim() === '') {
    throw new PayPalRailError('rejected', 'This payment has no payee address, so nothing was sent.');
  }
  if (intent.memo.length > MAX_NOTE_LENGTH) {
    throw new PayPalRailError('rejected', `The payment note is longer than PayPal's ${MAX_NOTE_LENGTH}-character limit — nothing was sent.`);
  }
}

/**
 * The exact Payouts request body (SPEC §6.5.1). Exported so the sandbox spike measures the
 * payload the rail really sends rather than a copy that can drift from production.
 */
export function buildPayoutPayload(intent: RailIntent, receiver: string): Record<string, unknown> {
  return {
    sender_batch_header: {
      sender_batch_id: intent.idempotencyKey,
      email_subject: 'You have a payout from Lumen & Lark Studio',
      email_message: intent.memo,
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: { value: formatCents(intent.amount), currency: 'USD' },
        receiver,
        note: intent.memo,
        sender_item_id: intent.intentId,
      },
    ],
  };
}

/** Integer cents → exact two-decimal string. No float arithmetic ever touches the amount. */
export function formatCents(cents: number): string {  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new PayPalRailError('rejected', 'This payout amount is not a whole number of cents — nothing was sent.');
  }
  const dollars = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, '0')}`;
}

function readBatchId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const header = (body as Record<string, any>).batch_header;
  return header !== null && typeof header === 'object' ? trimmedOrNull(header.payout_batch_id) : null;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isDuplicateSenderBatch(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const record = body as Record<string, any>;
  const name = typeof record.name === 'string' ? record.name : '';
  const texts: string[] = [];
  if (typeof record.message === 'string') texts.push(record.message);
  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      if (detail !== null && typeof detail === 'object' && typeof detail.issue === 'string') texts.push(detail.issue);
    }
  }
  const duplicate = texts.some((text) => /already exists|already been (used|processed)/i.test(text));
  return duplicate && (name === '' || name === 'USER_BUSINESS_ERROR');
}

function issueText(body: unknown): string {
  if (body === null || typeof body !== 'object') return '';
  const record = body as Record<string, any>;
  const parts: string[] = [];
  if (typeof record.message === 'string') parts.push(record.message);
  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      if (detail !== null && typeof detail === 'object' && typeof detail.issue === 'string') parts.push(detail.issue);
    }
  }
  return parts.join(' · ');
}

/** details[].link[] (the recording), details[].links[] (the schema's plural), then top-level links[]. */
function firstBatchHref(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, any>;
  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      if (detail === null || typeof detail !== 'object') continue;
      const href = hrefOf(detail.link) ?? hrefOf(detail.links);
      if (href !== null) return href;
    }
  }
  return hrefOf(record.links);
}

function hrefOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  for (const link of list) {
    if (link !== null && typeof link === 'object') {
      const href = trimmedOrNull((link as Record<string, unknown>).href);
      if (href !== null && batchIdFromUrl(href) !== null) return href;
    }
  }
  return null;
}

function batchIdFromUrl(href: string): string | null {
  const match = /\/v1\/payments\/payouts\/([^/?#]+)/.exec(href);
  return match === null ? null : decodeURIComponent(match[1]!);
}
