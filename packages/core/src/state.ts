// Intent state machine. SPEC §6.3.3 (v1.1).
//
// Only the transitions in the SPEC table are allowed; everything else throws
// `IllegalTransitionError`. Three rows of the table move nothing — they are legal operations
// that leave the state as it is (`transition()` returns the same state, the caller still
// records the event):
//   - verify_payee with result `not_confirmed`: only on held
//   - cancel_payout: only on awaiting (the receipt that confirms the cancel moves the state)
//   - refresh_receipt: only on submitted / awaiting / proven / failed / cancelled
//
// `cancelled` is terminal. A cancel is not done until the rail says so: `cancel_payout` records
// the intent and keeps it awaiting, and only `receipt.updated` with proof = cancelled moves
// awaiting → cancelled.

import type { Decision } from './types.js';
import type { IntentState } from './context.js';

export type ProofState = 'proven' | 'pending' | 'failed' | 'cancelled';

export type HumanAction =
  | 'verify_payee'
  | 'mark_fraud'
  | 'reject'
  | 'accept_delivery'
  | 'approve'
  | 'cancel_payout'
  | 'refresh_receipt';

export type TransitionTrigger =
  | { kind: 'intent.proposed' }
  | { kind: 'intent.checked'; decision: Decision }
  | { kind: 'payment.submitted' }
  | { kind: 'receipt.updated'; proof: ProofState }
  | { kind: 'human.action'; action: HumanAction; result?: string | null };

export class IllegalTransitionError extends Error {
  readonly from: IntentState | null;
  readonly trigger: TransitionTrigger;

  constructor(from: IntentState | null, trigger: TransitionTrigger, detail: string) {
    super(`Illegal intent transition from ${from ?? '(none)'} on ${describe(trigger)}: ${detail}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.trigger = trigger;
  }
}

export const TERMINAL_STATES: ReadonlySet<IntentState> = new Set<IntentState>([
  'blocked',
  'rejected',
  'proven',
  'failed',
  'cancelled',
]);

/** The SPEC §6.3.3 table as data, so tests and docs can enumerate it instead of sampling. */
export interface TransitionRule {
  from: IntentState | null;
  /** Same as `from` for the three rows that record an event without moving the state. */
  to: IntentState;
  on: string;
}

export const INTENT_TRANSITIONS: readonly TransitionRule[] = [
  { from: null, to: 'proposed', on: 'intent.proposed' },
  { from: 'proposed', to: 'approved', on: 'intent.checked approved' },
  { from: 'proposed', to: 'held', on: 'intent.checked held' },
  { from: 'proposed', to: 'blocked', on: 'intent.checked blocked' },
  { from: 'held', to: 'proposed', on: 'human.action verify_payee confirmed' },
  { from: 'held', to: 'held', on: 'human.action verify_payee not_confirmed' },
  { from: 'held', to: 'proposed', on: 'human.action accept_delivery' },
  { from: 'held', to: 'proposed', on: 'human.action approve' },
  { from: 'held', to: 'rejected', on: 'human.action reject' },
  { from: 'held', to: 'rejected', on: 'human.action mark_fraud' },
  { from: 'approved', to: 'submitted', on: 'payment.submitted' },
  { from: 'submitted', to: 'submitted', on: 'payment.submitted retry' },
  { from: 'submitted', to: 'proven', on: 'receipt.updated proven' },
  { from: 'awaiting', to: 'proven', on: 'receipt.updated proven' },
  { from: 'submitted', to: 'awaiting', on: 'receipt.updated pending' },
  { from: 'submitted', to: 'failed', on: 'receipt.updated failed' },
  { from: 'awaiting', to: 'failed', on: 'receipt.updated failed' },
  { from: 'awaiting', to: 'awaiting', on: 'human.action cancel_payout' },
  { from: 'awaiting', to: 'cancelled', on: 'receipt.updated cancelled' },
  { from: 'submitted', to: 'submitted', on: 'human.action refresh_receipt' },
  { from: 'awaiting', to: 'awaiting', on: 'human.action refresh_receipt' },
  { from: 'proven', to: 'proven', on: 'human.action refresh_receipt' },
  { from: 'failed', to: 'failed', on: 'human.action refresh_receipt' },
  { from: 'cancelled', to: 'cancelled', on: 'human.action refresh_receipt' },
];

/** States where `refresh_receipt` is a legal read (SPEC §6.3.3 last row). */
const REFRESHABLE_STATES: ReadonlySet<IntentState> = new Set<IntentState>([
  'submitted',
  'awaiting',
  'proven',
  'failed',
  'cancelled',
]);

export function transition(current: IntentState | null, trigger: TransitionTrigger): IntentState {
  switch (trigger.kind) {
    case 'intent.proposed':
      if (current === null) return 'proposed';
      throw illegal(current, trigger, 'an intent is proposed exactly once');

    case 'intent.checked':
      if (current !== 'proposed') throw illegal(current, trigger, 'only a proposed intent can be checked');
      return checkedTo(trigger.decision);

    case 'payment.submitted':
      if (current === 'approved' || current === 'submitted') return 'submitted';
      throw illegal(current, trigger, 'only an approved or already-submitted intent can be sent');

    case 'receipt.updated':
      return receiptTo(current, trigger);

    case 'human.action':
      return humanTo(current, trigger);
  }
}

function checkedTo(decision: Decision): IntentState {
  if (decision === 'approved') return 'approved';
  if (decision === 'held') return 'held';
  return 'blocked';
}

function receiptTo(current: IntentState | null, trigger: Extract<TransitionTrigger, { kind: 'receipt.updated' }>): IntentState {
  switch (trigger.proof) {
    case 'proven':
      if (current === 'submitted' || current === 'awaiting') return 'proven';
      throw illegal(current, trigger, 'only a sent intent can become proven');
    case 'pending':
      if (current === 'submitted') return 'awaiting';
      throw illegal(current, trigger, 'only a freshly sent intent can become awaiting');
    case 'failed':
      if (current === 'submitted' || current === 'awaiting') return 'failed';
      throw illegal(current, trigger, 'only a sent intent can fail');
    case 'cancelled':
      if (current === 'awaiting') return 'cancelled';
      throw illegal(current, trigger, 'only an awaiting intent can be cancelled');
  }
}

function humanTo(current: IntentState | null, trigger: Extract<TransitionTrigger, { kind: 'human.action' }>): IntentState {
  const result = (trigger.result ?? '').trim().toLowerCase();

  switch (trigger.action) {
    case 'verify_payee':
      if (current !== 'held') throw illegal(current, trigger, 'only a held intent can be re-verified');
      if (result === 'confirmed') return 'proposed';
      // SPEC §6.3.3 row 6: legal on held, records the event, state unchanged.
      if (result === 'not_confirmed') return 'held';
      throw illegal(current, trigger, 'verify_payee needs result "confirmed" or "not_confirmed"');

    case 'accept_delivery':
    case 'approve':
      if (current === 'held') return 'proposed';
      throw illegal(current, trigger, `only a held intent can be ${trigger.action}d`);

    case 'reject':
    case 'mark_fraud':
      if (current === 'held') return 'rejected';
      throw illegal(current, trigger, `only a held intent can be ${trigger.action}`);

    case 'cancel_payout':
      // SPEC §6.3.3 (v1.1): recording the cancel does not cancel anything. The intent stays
      // awaiting until the rail's own receipt (proof = cancelled) says the cancel took effect.
      if (current === 'awaiting') return 'awaiting';
      throw illegal(current, trigger, 'only an awaiting intent can be cancelled');

    case 'refresh_receipt':
      // SPEC §6.3.3 last row: a read, legal (and state-preserving) only where a receipt can exist.
      if (current !== null && REFRESHABLE_STATES.has(current)) return current;
      throw illegal(current, trigger, 'refresh_receipt only applies to a sent intent');
  }
}

function illegal(current: IntentState | null, trigger: TransitionTrigger, detail: string): IllegalTransitionError {
  return new IllegalTransitionError(current, trigger, detail);
}

function describe(trigger: TransitionTrigger): string {
  switch (trigger.kind) {
    case 'receipt.updated':
      return `receipt.updated(${trigger.proof})`;
    case 'human.action':
      return `human.action(${trigger.action}${trigger.result ? `=${trigger.result}` : ''})`;
    case 'intent.checked':
      return `intent.checked(${trigger.decision})`;
    default:
      return trigger.kind;
  }
}
