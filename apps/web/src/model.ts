/**
 * Domain types — imported from `@pbp/core`, never re-declared.
 *
 * Before T8 this file carried a hand copy of SPEC §6.2.1 so the UI could be built before the
 * core package existed. The copy is now a re-export: if the gate changes a field name, the
 * screen stops compiling instead of quietly rendering a stale shape.
 *
 * The ledger event union stays here because it is a *UI* concern — `@pbp/core` exports
 * `LedgerEvent<T>` generically, and the screen needs the discriminated union to read `data`
 * without a cast.
 */

export type {
  Agreement,
  CheckId,
  CheckResult,
  CheckStatus,
  Claim,
  ClaimLine,
  Cents,
  Currency,
  Decision,
  Delivery,
  Payee,
  PayeeChangeRequest,
  Proposal,
  RiskFlag,
  Vendor,
} from '@pbp/core';

import type { LedgerEvent } from '@pbp/core';

/** `CheckResult.facts` values (SPEC §6.2.1). */
export type CheckFact = string | number | boolean | null;

/** SPEC §6.3.2 `item.classified` — the four values the server can send. */
export type Classification = 'invoice' | 'payee_change_request' | 'invoice+payee_change_request' | 'other';

/* ------------------------------------------------------------------ */
/* Ledger events (§6.3.2)                                             */
/* ------------------------------------------------------------------ */

export type EventType =
  | 'ledger.opened'
  | 'history.seeded'
  | 'run.started'
  | 'item.read'
  | 'item.classified'
  | 'claim.extracted'
  | 'change_request.recorded'
  | 'risk.flagged'
  | 'intent.proposed'
  | 'intent.checked'
  | 'intent.explained'
  | 'payment.submitted'
  | 'receipt.updated'
  | 'human.action'
  | 'run.summarized'
  | 'run.completed'
  | 'error'
  | 'comparison.payout_sent'
  | 'comparison.receipt'
  | 'comparison.summary';

export type { LedgerEvent };

export interface ItemReadData {
  itemId: string;
  from: string;
  subject: string;
  files: { name: string; sha256: string }[];
}
export interface ItemClassifiedData {
  itemId: string;
  classification: Classification;
  model: string;
}
export interface ClaimExtractedData {
  itemId: string;
  claim: import('@pbp/core').Claim;
}
export interface RiskFlaggedData {
  itemId: string;
  flags: import('@pbp/core').RiskFlag[];
  note: string | null;
  noteSource: 'model' | 'template' | 'none';
}
export interface IntentProposedData {
  intentId: string;
  itemId: string;
  vendorId: string;
  agreementId: string | null;
  agreementMatchedBy: 'po' | 'ai' | null;
  amount: number;
  payee: import('@pbp/core').Payee;
  fingerprint: string;
  idempotencyKey: string;
}
export interface IntentCheckedData {
  intentId: string;
  checks: import('@pbp/core').CheckResult[];
  decision: import('@pbp/core').Decision;
}
export interface IntentExplainedData {
  intentId: string;
  text: string;
  source: 'model' | 'template';
}
export interface PaymentSubmittedData {
  intentId: string;
  rail: 'paypal';
  senderBatchId: string;
  payoutBatchId: string | null;
  attempt: number;
}
export interface ReceiptUpdatedData {
  intentId: string;
  railStatus: string;
  proof: 'proven' | 'pending' | 'failed' | 'cancelled';
  payoutItemId: string;
  transactionId: string | null;
  source: 'rail_get';
  fetchedAt: string;
}
export interface HumanActionData {
  intentId: string;
  action:
    | 'verify_payee'
    | 'mark_fraud'
    | 'reject'
    | 'accept_delivery'
    | 'approve'
    | 'cancel_payout'
    | 'refresh_receipt';
  by: string;
  input: Record<string, CheckFact> | null;
}
export interface RunStartedData {
  runId: string;
  mode: 'proof' | 'comparison';
  inboxCount: number;
}
export interface ErrorData {
  scope: string;
  message: string;
  detail?: string;
}
export interface RunCompletedData {
  runId: string;
  totals: Record<string, { count: number; amount?: number }>;
}
export interface LedgerOpenedData {
  epoch: string;
  scenario: string;
  version: string;
}
export interface HistorySeededData {
  historyId: string;
  intentId: string;
  fingerprint: string;
}

export type PbpEvent =
  | (LedgerEvent<LedgerOpenedData> & { type: 'ledger.opened' })
  | (LedgerEvent<HistorySeededData> & { type: 'history.seeded' })
  | (LedgerEvent<RunStartedData> & { type: 'run.started' })
  | (LedgerEvent<ItemReadData> & { type: 'item.read' })
  | (LedgerEvent<ItemClassifiedData> & { type: 'item.classified' })
  | (LedgerEvent<ClaimExtractedData> & { type: 'claim.extracted' })
  | (LedgerEvent<import('@pbp/core').PayeeChangeRequest> & { type: 'change_request.recorded' })
  | (LedgerEvent<RiskFlaggedData> & { type: 'risk.flagged' })
  | (LedgerEvent<IntentProposedData> & { type: 'intent.proposed' })
  | (LedgerEvent<IntentCheckedData> & { type: 'intent.checked' })
  | (LedgerEvent<IntentExplainedData> & { type: 'intent.explained' })
  | (LedgerEvent<PaymentSubmittedData> & { type: 'payment.submitted' })
  | (LedgerEvent<ReceiptUpdatedData> & { type: 'receipt.updated' })
  | (LedgerEvent<HumanActionData> & { type: 'human.action' })
  | (LedgerEvent<RunCompletedData> & { type: 'run.completed' })
  | (LedgerEvent<ErrorData> & { type: 'error' })
  | (LedgerEvent<unknown> & {
      type: 'run.summarized' | 'comparison.payout_sent' | 'comparison.receipt' | 'comparison.summary';
    });
