// Rail adapter contract. SPEC §6.5 / AC-5.
//
// `@pbp/core` knows nothing about PayPal. A rail is anything that can submit a payout,
// hand back a receipt, cancel an unclaimed payout and map its own status vocabulary onto
// our four proof states. `packages/paypal` is the first implementation; Airwallex and
// Alipay are the next ones (see README's comparison checklists).
//
// The receipt is the only source of truth for "paid". A POST response is never a receipt.

import type { Cents, Currency } from './types.js';
import type { ProofState } from './state.js';

export interface RailIntent {
  intentId: string;
  /** `idempotencyKey(epoch, fingerprint)` — also the rail's batch key. */
  idempotencyKey: string;
  amount: Cents;
  currency: Currency;
  receiver: string;
  memo: string;
}

export interface SubmitResult {
  senderBatchId: string;
  /** null when the submit response was lost (timeout / injected fault). */
  payoutBatchId: string | null;
}

export interface RailRef {
  intentId: string;
  idempotencyKey: string;
  senderBatchId: string;
  payoutBatchId: string | null;
  payoutItemId: string | null;
}

export interface ReceiptResult {
  /** The rail's own status string, verbatim. */
  railStatus: string;
  /** Already mapped through `mapStatus` (plus the transaction-id rule). */
  proof: ProofState;
  payoutItemId: string | null;
  transactionId: string | null;
  fetchedAt: string;
}

export interface RailAdapter {
  submit(intent: RailIntent): Promise<SubmitResult>;
  fetchReceipt(ref: RailRef): Promise<ReceiptResult>;
  cancel(ref: RailRef): Promise<void>;
  mapStatus(railStatus: string): ProofState;
}

/**
 * SPEC §6.5.3 status mapping.
 * `RETURNED` maps to failed here; the rail turns it into `cancelled` when *we* cancelled.
 * Anything outside the table is `pending` (and the caller records an `error` event).
 */
export function mapStatus(railStatus: string): ProofState {
  switch (railStatus.trim().toUpperCase()) {
    case 'SUCCESS':
      return 'proven';
    case 'PENDING':
    case 'UNCLAIMED':
    case 'ONHOLD':
      return 'pending';
    case 'FAILED':
    case 'BLOCKED':
    case 'REFUNDED':
    case 'REVERSED':
      return 'failed';
    case 'RETURNED':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * AC-3: `proven` needs `SUCCESS` **and** a non-empty transaction id. A SUCCESS without a
 * transaction id is not proof — it stays `pending` and the caller records an `error`.
 */
export function resolveProof(railStatus: string, transactionId: string | null | undefined): ProofState {
  const proof = mapStatus(railStatus);
  if (proof === 'proven' && !(transactionId ?? '').trim()) return 'pending';
  return proof;
}

export const KNOWN_RAIL_STATUSES: readonly string[] = [
  'SUCCESS',
  'PENDING',
  'UNCLAIMED',
  'ONHOLD',
  'FAILED',
  'BLOCKED',
  'REFUNDED',
  'REVERSED',
  'RETURNED',
];
