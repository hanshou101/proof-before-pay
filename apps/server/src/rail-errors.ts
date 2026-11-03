// Turning a rail failure into the one sentence a human reads.
//
// Two failures used to share a shrug: "PayPal rejected this payout — the details are in the
// developer log." That sentence sent the reader to a log to discover that the sandbox Business
// account had simply run out of money — and it read the same as a network problem, which has a
// completely different fix (retry vs. top up the account).
//
// The rail keeps PayPal's `name` / `message` in `detail` (redacted), so the distinction can be
// made without changing the rail: `INSUFFICIENT_FUNDS` is a funds problem, everything else keeps
// whatever sentence the rail already wrote.

const FUNDS_NAME = 'INSUFFICIENT_FUNDS';
const FUNDS_TEXT = /not have sufficient funds/i;

/** Shown in the run banner, the row notice and `demo:reset` (SPEC §6.5, AC-17). */
export const OUT_OF_FUNDS_MESSAGE =
  "The PayPal sandbox Business account has run out of payout funds — nothing was sent. Raise the account's PayPal balance in the PayPal developer dashboard, then retry.";

export function outOfFunds(error: unknown): boolean {
  const record = error as { detail?: unknown; message?: unknown } | null;
  const detail = typeof record?.detail === 'string' ? record.detail : '';
  const message = typeof record?.message === 'string' ? record.message : '';
  return detail.includes(FUNDS_NAME) || FUNDS_TEXT.test(detail) || message.includes(FUNDS_NAME) || FUNDS_TEXT.test(message);
}

/**
 * The sentence to record. `fallback` is used when the error is not an `Error` at all.
 * A sandbox that cannot pay says so in its own words; anything else keeps the rail's sentence
 * (which already distinguishes "did not answer" from "refused").
 */
export function humanRailMessage(error: unknown, fallback: string): string {
  if (outOfFunds(error)) return OUT_OF_FUNDS_MESSAGE;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

/** The sentence 07-UI §4.5 prints when the sandbox cannot be reached at all. */
export const PAYPAL_UNREACHABLE_MESSAGE =
  "Couldn't reach the PayPal sandbox. Nothing was sent. Check PAYPAL_CLIENT_ID in .env, then retry.";

/**
 * True when PayPal refused *us* — bad credentials, a bad app, a bad `.env` — rather than this one
 * payment. One such failure is enough: every later row would fail the same way, so the run stops
 * and the screen says why (T8 round 3, item 1). A refusal of one payout (funds, amount, receiver)
 * stays on its own row and the run goes on.
 */
export function credentialFailure(error: unknown): boolean {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return kind === 'unauthorized' || kind === 'missing_credentials' || kind === 'config';
}

