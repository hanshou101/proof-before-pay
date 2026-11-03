// Hash-chained, append-only ledger. SPEC §6.3.
//
// Every line is `hash = sha256(canonical(event without hash))` and `prevHash` points at the
// previous line, so editing, inserting, deleting or reordering a line breaks the chain at a
// known `seq`. `replay` folds the events into the projection the UI reads — the projection
// is never stored, it is always derived, so a restart cannot disagree with the ledger.

import { sha256Hex } from './fingerprint.js';
import type { CheckResult, Cents, Currency, Decision, Payee } from './types.js';
import type { IntentState } from './context.js';
import type { HumanAction, ProofState } from './state.js';
import { transition } from './state.js';

export const GENESIS_PREV = '0'.repeat(64);

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

export interface LedgerEvent<T = unknown> { seq: number; at: string; type: EventType; data: T; prevHash: string; hash: string }

export interface LedgerOpenedData { epoch: string; scenario: string; version: string }
export interface HistorySeededData { historyId: string; intentId: string; fingerprint: string }
export interface IntentProposedData {
  intentId: string;
  itemId: string;
  vendorId: string | null;
  agreementId: string | null;
  agreementMatchedBy: 'po' | 'ai' | null;
  amount: Cents;
  payee: Payee | null;
  fingerprint: string;
  idempotencyKey: string;
  currency?: Currency;
}
export interface IntentCheckedData { intentId: string; checks: CheckResult[]; decision: Decision }
export interface IntentExplainedData { intentId: string; text: string; source: 'model' | 'template' }
export interface PaymentSubmittedData {
  intentId: string;
  rail: string;
  senderBatchId: string;
  payoutBatchId: string | null;
  attempt: number;
}
export interface ReceiptUpdatedData {
  intentId: string;
  railStatus: string;
  proof: ProofState;
  payoutItemId: string | null;
  transactionId: string | null;
  source: string;
  fetchedAt: string;
}
export interface HumanActionData {
  intentId: string;
  action: HumanAction;
  by: string | null;
  input?: { result?: string | null; amount?: Cents; reason?: string | null; deliveryId?: string | null } | null;
}
export interface ErrorData { scope: string; message: string; detail?: string | null }

/** Recursive key sort, no whitespace. The only JSON form the hash is ever computed over. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

export function hashEvent(event: Omit<LedgerEvent, 'hash'>): string {
  return sha256Hex(
    canonical({ seq: event.seq, at: event.at, type: event.type, data: event.data, prevHash: event.prevHash }),
  );
}

export interface AppendInput {
  type: EventType;
  data?: unknown;
  /** ISO timestamp. Required so the ledger stays deterministic — core has no clock. */
  at: string;
}

/** Append one event after `prev` (or to an empty ledger when `prev` is null). */
export function appendEvent(prev: LedgerEvent | null, input: AppendInput): LedgerEvent {
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS_PREV;
  const body = {
    seq,
    at: input.at,
    type: input.type,
    data: input.data ?? null,
    prevHash,
  };
  return { ...body, hash: hashEvent(body) };
}

export type ChainCheck = { ok: true } | { ok: false; seq: number };

/**
 * Verify a ledger. Accepts the parsed events or the raw JSONL text.
 * Returns the first `seq` that fails (a gap, a broken `prevHash`, or a recomputed hash that
 * does not match). A malformed line reports its 1-based line number.
 *
 * Truncating the *tail* is not detectable from the chain alone — keep the head hash out of
 * band if that matters.
 */
export function verifyChain(input: string | readonly LedgerEvent[]): ChainCheck {
  const parsed = typeof input === 'string' ? parseJsonl(input) : { ok: true as const, events: input };
  if (!parsed.ok) return { ok: false, seq: parsed.errorAt };

  let prevHash = GENESIS_PREV;
  let expectedSeq = 1;

  for (const event of parsed.events) {
    if (event.seq !== expectedSeq) return { ok: false, seq: event.seq };
    if (event.prevHash !== prevHash) return { ok: false, seq: event.seq };
    const { hash, ...rest } = event;
    if (hashEvent(rest) !== hash) return { ok: false, seq: event.seq };
    prevHash = event.hash;
    expectedSeq += 1;
  }

  return { ok: true };
}

function parseJsonl(text: string): { ok: true; events: readonly LedgerEvent[] } | { ok: false; errorAt: number } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const events: LedgerEvent[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line) as LedgerEvent);
    } catch {
      return { ok: false, errorAt: index + 1 };
    }
  }
  return { ok: true, events };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface Totals { count: number; amount: Cents }

export interface IntentProjection {
  id: string;
  itemId: string;
  vendorId: string | null;
  agreementId: string | null;
  amount: Cents;
  /** Amount a human approved, when lower than `amount` (SPEC §6.2.2). */
  approvedAmount: Cents | null;
  currency: Currency;
  payee: Payee | null;
  fingerprint: string;
  idempotencyKey: string;
  state: IntentState | null;
  checks: CheckResult[] | null;
  decision: Decision | null;
  explanation: { text: string; source: string } | null;
  submission: { senderBatchId: string; payoutBatchId: string | null; attempt: number; at: string } | null;
  receipt: {
    railStatus: string;
    proof: ProofState;
    payoutItemId: string | null;
    transactionId: string | null;
    fetchedAt: string;
  } | null;
  humanActions: { action: HumanAction; by: string | null; at: string }[];
}

export interface Projection {
  epoch: string | null;
  scenario: string | null;
  version: string | null;
  intents: Record<string, IntentProjection>;
  /** itemId → intentId, so the inbox rows can find their intent. */
  byItem: Record<string, string>;
  totals: { proven: Totals; awaitingProof: Totals; held: Totals; stopped: Totals };
  errors: ErrorData[];
  /** Highest seq seen. */
  head: number;
}

const BUCKETS: Record<string, keyof Projection['totals']> = {
  proven: 'proven',
  submitted: 'awaitingProof',
  awaiting: 'awaitingProof',
  held: 'held',
  blocked: 'stopped',
  rejected: 'stopped',
  failed: 'stopped',
  cancelled: 'stopped',
};

export function emptyProjection(): Projection {
  return {
    epoch: null,
    scenario: null,
    version: null,
    intents: {},
    byItem: {},
    totals: {
      proven: { count: 0, amount: 0 },
      awaitingProof: { count: 0, amount: 0 },
      held: { count: 0, amount: 0 },
      stopped: { count: 0, amount: 0 },
    },
    errors: [],
    head: 0,
  };
}

/**
 * Fold events into the projection. Throws `IllegalTransitionError` if the ledger contains a
 * transition the state machine forbids — that is a broken ledger, not a recoverable state.
 * A `proven` receipt that is not `SUCCESS` + transaction id + `source: "rail_get"` is recorded
 * as an `error` and does not move the intent (AC-3).
 */
export function replay(events: readonly LedgerEvent[]): Projection {
  const projection = emptyProjection();

  for (const event of events) {
    projection.head = Math.max(projection.head, event.seq);
    applyEvent(projection, event);
  }

  for (const intent of Object.values(projection.intents)) {
    const bucket = intent.state ? BUCKETS[intent.state] : undefined;
    if (!bucket) continue;
    const totals = projection.totals[bucket];
    totals.count += 1;
    totals.amount += intent.approvedAmount ?? intent.amount;
  }

  return projection;
}

function applyEvent(projection: Projection, event: LedgerEvent): void {
  switch (event.type) {
    case 'ledger.opened': {
      const data = event.data as LedgerOpenedData;
      projection.epoch = data.epoch;
      projection.scenario = data.scenario;
      projection.version = data.version;
      return;
    }

    case 'intent.proposed': {
      const data = event.data as IntentProposedData;
      const intent: IntentProjection = {
        id: data.intentId,
        itemId: data.itemId,
        vendorId: data.vendorId,
        agreementId: data.agreementId,
        amount: data.amount,
        approvedAmount: null,
        currency: data.currency ?? 'USD',
        payee: data.payee,
        fingerprint: data.fingerprint,
        idempotencyKey: data.idempotencyKey,
        state: transition(null, { kind: 'intent.proposed' }),
        checks: null,
        decision: null,
        explanation: null,
        submission: null,
        receipt: null,
        humanActions: [],
      };
      projection.intents[intent.id] = intent;
      projection.byItem[intent.itemId] = intent.id;
      return;
    }

    case 'intent.checked': {
      const data = event.data as IntentCheckedData;
      const intent = projection.intents[data.intentId];
      if (!intent) return;
      intent.state = transition(intent.state, { kind: 'intent.checked', decision: data.decision });
      intent.checks = data.checks;
      intent.decision = data.decision;
      return;
    }

    case 'intent.explained': {
      const data = event.data as IntentExplainedData;
      const intent = projection.intents[data.intentId];
      if (intent) intent.explanation = { text: data.text, source: data.source };
      return;
    }

    case 'payment.submitted': {
      const data = event.data as PaymentSubmittedData;
      const intent = projection.intents[data.intentId];
      if (!intent) return;
      intent.state = transition(intent.state, { kind: 'payment.submitted' });
      intent.submission = {
        senderBatchId: data.senderBatchId,
        payoutBatchId: data.payoutBatchId,
        attempt: data.attempt,
        at: event.at,
      };
      return;
    }

    case 'receipt.updated': {
      const data = event.data as ReceiptUpdatedData;
      const intent = projection.intents[data.intentId];
      if (!intent) return;

      if (data.proof === 'proven' && !isProofOfPayment(data)) {
        projection.errors.push({
          scope: `receipt.updated:${data.intentId}`,
          message: 'Ignored a "proven" receipt without SUCCESS, a transaction id and source rail_get.',
          detail: JSON.stringify({ railStatus: data.railStatus, source: data.source }),
        });
        return;
      }

      intent.state = transition(intent.state, { kind: 'receipt.updated', proof: data.proof });
      intent.receipt = {
        railStatus: data.railStatus,
        proof: data.proof,
        payoutItemId: data.payoutItemId,
        transactionId: data.transactionId,
        fetchedAt: data.fetchedAt,
      };
      return;
    }

    case 'human.action': {
      const data = event.data as HumanActionData;
      const intent = projection.intents[data.intentId];
      if (!intent) return;

      // Every human action goes through the machine — the three state-preserving rows included
      // (SPEC §6.3.3 v1.1). A no-op returns the same state; anything outside the table throws,
      // which is exactly the "this ledger is broken" signal replay is supposed to give.
      const actionResult = data.input?.result ?? null;
      intent.state = transition(intent.state, {
        kind: 'human.action',
        action: data.action,
        result: actionResult,
      });

      if (data.action === 'approve' && typeof data.input?.amount === 'number') {
        intent.approvedAmount = data.input.amount;
      }
      intent.humanActions.push({ action: data.action, by: data.by, at: event.at });
      return;
    }

    case 'error': {
      const data = event.data as ErrorData;
      projection.errors.push({
        scope: data.scope,
        message: data.message,
        ...(data.detail ? { detail: data.detail } : {}),
      });
      return;
    }

    default:
      return;
  }
}

function isProofOfPayment(data: ReceiptUpdatedData): boolean {
  return (
    data.railStatus.trim().toUpperCase() === 'SUCCESS' &&
    typeof data.transactionId === 'string' &&
    data.transactionId.trim() !== '' &&
    data.source === 'rail_get'
  );
}
