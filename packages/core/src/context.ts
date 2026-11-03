// Gate context — the read-only world the gate is allowed to look at.
//
// SPEC §6.2.1 only freezes the domain types in `types.ts`; the context shape is the
// signature requirement of `evaluate(proposal, context)` in the T2 ticket:
//   { vendors, agreements, deliveries, changeRequests, intents, history, policy, now, epoch }
//
// `history` holds intents seeded before this environment (SPEC §6.2.2 O4: "歷史紀錄算 proven").
// `intents` holds the live intents. Both are keyed by `fingerprint` for duplicate detection.

import type {
  Agreement,
  Cents,
  CheckResult,
  Currency,
  Delivery,
  Payee,
  PayeeChangeRequest,
  Proposal,
  Vendor,
} from './types.js';

/** Every state an intent can be in. SPEC §6.3.3. */
export type IntentState =
  | 'proposed'
  | 'approved'
  | 'held'
  | 'blocked'
  | 'submitted'
  | 'awaiting'
  | 'proven'
  | 'failed'
  | 'cancelled'
  | 'rejected';

/** Policy knobs the L-checks read. Values come from `demo/scenario/scenario.json` `policy`. */
export interface Policy {
  currency: Currency;
  perPaymentAutoLimit: Cents;
  dailyLimit: Cents;
  newVendorAutoLimit: Cents;
  changeRequestWindowDays: number;
}

/**
 * One intent as the gate needs to see it. The gate never mutates it; the server owns
 * the real projection (see `ledger.ts` `replay`).
 */
export interface IntentRecord {
  id: string;
  itemId: string;
  vendorId: string | null;
  agreementId: string | null;
  amount: Cents;
  currency: Currency;
  payee: Payee | null;
  fingerprint: string;
  idempotencyKey: string;
  state: IntentState;
  /** ISO timestamp of the last state change. Used by L2 to bucket "today". */
  at: string;
  transactionId?: string | null;
  /**
   * What a human approved, when lower than `amount` (SPEC §6.2.2 last bullet, v1.1).
   * L1–L3 judge the money that will actually leave the account: `approvedAmount ?? amount`.
   */
  approvedAmount?: Cents | null;
}

/**
 * A seeded historical payment (`demo/scenario/scenario.json` `history`). SPEC §6.2.2 O4:
 * history always counts as proven whatever the record carries — the scenario has no `state`
 * field at all, so `state` is optional here and ignored by the checks.
 */
export type HistoryRecord = Omit<IntentRecord, 'state'> & { state?: IntentState | null };

export interface GateContext {
  vendors: Vendor[];
  agreements: Agreement[];
  deliveries: Delivery[];
  changeRequests: PayeeChangeRequest[];
  intents: IntentRecord[];
  history: HistoryRecord[];
  policy: Policy;
  /** ISO timestamp the gate treats as "now" (scenario `testClock` in tests). */
  now: string;
  epoch: string;
  /**
   * Human override (SPEC §6.2.2 O2): when a human approved a lower amount, O2 is judged
   * against it instead of the billed total. Absent for an untouched proposal.
   */
  approvedAmount?: Cents | null;
  approvedBy?: string | null;
}

/** What each check function receives. `vendor`/`agreement` are resolved once by the gate. */
export interface CheckDeps {
  proposal: Proposal;
  context: GateContext;
  vendor: Vendor | null;
  /** How O1 recognised the vendor: sender email, PO or name. */
  vendorMatchedBy: 'sender' | 'po' | 'name' | null;
  agreement: Agreement | null;
  /** Checks already computed, in check order. O2 reads O1's outcome; L3 reads L1's amount. */
  results: CheckResult[];
}
