// Fingerprint and idempotency key. SPEC §6.2.4.
//
//   fingerprint    = sha256(vendorId | normalizeInvoiceNumber | currency | total) hex
//   idempotencyKey = "pbp-" + first 28 hex chars of sha256(epoch | fingerprint)
//
// The key is 32 characters of `[a-z0-9-]`, which is what PayPal's `sender_batch_id`
// and `PayPal-Request-Id` accept (SPEC §6.5.2). Same invoice in the same epoch always
// yields the same key, so a retry can never create a second payout.

import { createHash } from 'node:crypto';
import { normalizeInvoiceNumber } from './normalize.js';
import type { Cents, Currency } from './types.js';

export interface FingerprintInput {
  vendorId: string;
  invoiceNumber: string;
  currency: Currency;
  total: Cents;
}

export function fingerprint(input: FingerprintInput): string {
  const basis = [
    input.vendorId,
    normalizeInvoiceNumber(input.invoiceNumber),
    input.currency,
    String(input.total),
  ].join('|');
  return sha256Hex(basis);
}

export function idempotencyKey(epoch: string, fp: string): string {
  return `pbp-${sha256Hex(`${epoch}|${fp}`).slice(0, 28)}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
