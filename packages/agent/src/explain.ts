// Step 6 in code: an explanation that can be checked.
//
// AC-10 (SPEC v1.4) does not ask "does the sentence sound right"; it asks whether the sentence
// carries the decisive fact:
//   DUPLICATE     → the invoice number AND the original payment's transaction id or payment date.
//                   The original invoice's issue date is NOT a substitute (v1.4): the demo has to
//                   point at the payment that already left the account, not at the paperwork.
//   PAYEE_MISMATCH→ both email addresses AND "not verified" / "unverified" — attached to the
//                   requested address, never to the payee on file, which was verified.
//   OVER_CAP      → "40" and "32"
//   NOT_ACCEPTED  → "not accepted" / "in review"
// and, since v1.4, the sentence may not name internal record ids (`cr_…`, `del_…`, `hist_…`,
// `agr_…`, `ven_…`, `int_…`, `in_…`): those strings would appear verbatim on the screen.
//
// The model is welcome to phrase it better; if it drops one of those facts (or breaks one of the
// rules), the answer is rejected, the error goes back once, and after a second failure the
// deterministic template is used with `source: "template"` so the UI does not badge it as
// AI-written (SPEC §6.6.2 step 6).
//
// The templates below are built from the same `CheckResult.facts` and are asserted against the
// same `checkFacts()` in the unit tests — a fallback that does not satisfy AC-10 would be worse
// than no fallback at all.

import type { CheckResult } from '@pbp/core';
import { formatUSD } from '@pbp/core';
import { internalIdsIn } from './ids.js';
import { formatMoney } from './money.js';
import { EXPLAIN_SYSTEM, explainUser } from './prompts/explain.js';
import { explanationSchema } from './schema.js';
import { sentenceCount } from './sentences.js';
import type { AgentContext, ExplainInput, Explanation } from './types.js';
import { ValidationError, askJson, parseJsonObject } from './validate.js';

// The internal-id rules live in `ids.ts` because the prompt assembly needs the same definition;
// re-exported here so callers of the explanation API have one import site.
export { INTERNAL_ID_SOURCE, isInternalId, internalIdsIn } from './ids.js';

export interface FactRequirement {
  /** What the sentence must carry, in words a rejection message can quote. */
  label: string;
  test: (text: string) => boolean;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `INV-0142` matches "INV-0142", "INV 0142", "INV0142" — but nothing longer. */
export function invoicePattern(invoiceNumber: string): RegExp {
  const flexible = escapeRegExp(invoiceNumber).replace(/[-\s]/g, '[-\\s]?');
  return new RegExp(flexible, 'i');
}

/** Every way a person writes 2026-10-28 in an English sentence (an ISO timestamp also works). */
export function dateForms(iso: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return [iso];
  const [, year, month, day] = match;
  const dateOnly = `${year}-${month}-${day}`;
  const monthName = MONTHS[Number(month) - 1] ?? '';
  const short = monthName.slice(0, 3);
  const dayNumber = Number(day);
  return [
    dateOnly,
    iso,
    `${dayNumber} ${monthName} ${year}`,
    `${dayNumber} ${short} ${year}`,
    `${short} ${dayNumber}, ${year}`,
    `${monthName} ${dayNumber}, ${year}`,
    `${monthName} ${dayNumber}`,
    `${short} ${dayNumber}`,
    `${dayNumber} ${monthName}`,
    `${dayNumber} ${short}`,
  ];
}

function mentions(text: string, needle: string): boolean {
  if (needle.trim() === '') return false;
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(needle)}([^A-Za-z0-9]|$)`, 'i');
  return pattern.test(text);
}

function mentionsEmail(text: string, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  const found: string[] = text.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  return found.includes(wanted);
}

function mentionsNumber(text: string, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return new RegExp(`(^|[^0-9])${Math.trunc(value)}([^0-9]|$)`).test(text);
}

function mentionsAnyDate(text: string, iso: string | null | undefined): boolean {
  if (!iso) return false;
  return dateForms(iso).some((form) => mentions(text, form));
}

const NOT_ACCEPTED = /\bnot (yet )?(been )?accepted\b|\bin review\b|\bawaiting (acceptance|review)\b|\bstill under review\b/i;
const UNVERIFIED = /\bnot verified\b|\bunverified\b/i;

/**
 * Does the sentence hang "unverified" on the payee that is already on file?
 *
 * A proximity window is not enough: round 1's run 1 wrote "... does not match the unverified
 * email ana@studionorth.example on file" (the word sits right in front of the address), while
 * "... the verified payee on file is ana@studionorth.example, and the change is unverified" puts
 * the word 19 characters later and is perfectly correct. So the check follows the grammar: the
 * negation has to be an adjective phrase directly in front of the address ("the unverified email
 * ana@…") or a predicate directly after it ("ana@… is unverified"). Anything further away
 * belongs to some other noun.
 */
export function callsPayeeOnFileUnverified(text: string, onFile: string): boolean {
  const email = onFile.trim();
  if (email === '') return false;
  const escaped = escapeRegExp(email);
  const negative = '(?:unverified|not\\s+(?:yet\\s+)?verified)';
  const noun = '(?:payee|email|address|account|recipient)';
  const adjective = new RegExp(`${negative}\\s+(?:${noun}\\s+){0,2}${escaped}`, 'i');
  const predicate = new RegExp(`${escaped}\\s+(?:is|was|remains)\\s+(?:still\\s+)?${negative}`, 'i');
  return adjective.test(text) || predicate.test(text);
}

export interface FactCheck {
  ok: boolean;
  /** Facts AC-10 requires and the sentence does not carry. */
  missing: string[];
  /** Rules the sentence breaks (wrong attribution, internal ids) rather than facts it lacks. */
  problems: string[];
}

function failingChecks(input: ExplainInput): CheckResult[] {
  return input.checks.filter((check) => check.status === 'hold' || check.status === 'fail');
}

function transactionIdOf(check: CheckResult, input: ExplainInput): string | null {
  const fromFacts = typeof check.facts.transactionId === 'string' ? check.facts.transactionId : null;
  return fromFacts ?? input.original?.transactionId ?? null;
}

/**
 * The AC-10 contract, as code.
 */
export function checkFacts(text: string, input: ExplainInput): FactCheck {
  const missing: string[] = [];
  const problems: string[] = [];

  const ids = internalIdsIn(text);
  if (ids.length > 0) {
    problems.push(`it names internal record ids (${ids.join(', ')}); refer to records in human words`);
  }

  for (const check of failingChecks(input)) {
    if (check.id === 'O4' && check.code === 'DUPLICATE') {
      if (!invoicePattern(input.claim.invoiceNumber).test(text)) {
        missing.push(`the invoice number ${input.claim.invoiceNumber}`);
      }
      const transactionId = transactionIdOf(check, input);
      const hasId = transactionId !== null && mentions(text, transactionId);
      const hasPaymentDate = input.original?.paidAt ? mentionsAnyDate(text, input.original.paidAt) : false;
      // SPEC v1.4: the original invoice's issue date is not evidence that the payment happened.
      if (!hasId && !hasPaymentDate) {
        missing.push('the original payment’s transaction id or payment date');
      }
    }

    if (check.id === 'P1' && check.code === 'PAYEE_MISMATCH') {
      const onFile = typeof check.facts.onFile === 'string' ? check.facts.onFile : '';
      const requested = typeof check.facts.requested === 'string' ? check.facts.requested : '';
      if (!mentionsEmail(text, onFile)) missing.push(`the payee on file ${onFile}`);
      if (!mentionsEmail(text, requested)) missing.push(`the requested payee ${requested}`);
      if (!UNVERIFIED.test(text)) missing.push('"not verified" or "unverified"');
      else if (callsPayeeOnFileUnverified(text, onFile)) {
        problems.push(
          `it calls the payee on file ${onFile} unverified; the requested address ${requested} is the unverified one`,
        );
      }
    }

    if (check.id === 'O2' && check.code === 'OVER_CAP') {
      if (!mentionsNumber(text, check.facts.billedUnits)) missing.push(`the billed units ${String(check.facts.billedUnits)}`);
      if (!mentionsNumber(text, check.facts.capUnits)) missing.push(`the cap ${String(check.facts.capUnits)}`);
    }

    if (check.id === 'O3' && check.code === 'NOT_ACCEPTED') {
      if (!NOT_ACCEPTED.test(text)) missing.push('"not accepted" or "in review"');
    }
  }

  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}

/** `2026-11-06T17:30:00Z` → `2026-11-06`, so a template reads like a person wrote it. */
function dateOnly(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match?.[1] ?? iso;
}

/** The deterministic explanation. Must satisfy `checkFacts` for every check combination. */
export function templateExplanation(input: ExplainInput): string {
  const failing = failingChecks(input);
  const byId = (id: string): CheckResult | undefined => failing.find((check) => check.id === id);

  const duplicate = byId('O4');
  if (duplicate && duplicate.code === 'DUPLICATE') {
    const transactionId = transactionIdOf(duplicate, input);
    const paidAt = input.original?.paidAt ?? null;
    const when = transactionId
      ? ` under PayPal transaction ${transactionId}`
      : paidAt
        ? ` on ${dateOnly(paidAt)}`
        : '';
    return `${input.claim.invoiceNumber} was already paid${when}. Paying it again would be a second payment for the same invoice.`;
  }

  const payee = byId('P1');
  if (payee && payee.code === 'PAYEE_MISMATCH') {
    const onFile = String(payee.facts.onFile ?? '');
    const requested = String(payee.facts.requested ?? '');
    return `The change request to pay ${requested} is unverified; the verified payee on file is ${onFile}. Confirm the change with the vendor before paying.`;
  }

  const overCap = byId('O2');
  const notAccepted = byId('O3');
  if (overCap && overCap.code === 'OVER_CAP') {
    const billed = String(overCap.facts.billedUnits ?? '');
    const cap = String(overCap.facts.capUnits ?? '');
    const tail = notAccepted ? ', and the work is still in review' : '';
    return `The invoice bills ${billed} hours against a contract cap of ${cap}${tail}. A human has to decide what to pay.`;
  }

  if (notAccepted) {
    return 'The work has not been accepted yet. Payment stays held until the delivery is accepted.';
  }

  const noAgreement = byId('O2');
  if (noAgreement && noAgreement.code === 'NO_AGREEMENT') {
    return `No agreement matches invoice ${input.claim.invoiceNumber}, so the amount cannot be checked. A human has to review it.`;
  }

  const codes = failing.map((check) => `${check.id} ${check.code}`).join(', ');
  const verdict = input.decision === 'blocked' ? 'blocked' : 'held';
  return codes === ''
    ? `The gate ${verdict} this payment (${formatMoney(input.claim.total)}). A human has to review it.`
    : `The gate ${verdict} this payment: ${codes}. A human has to review it.`;
}

export interface ExplainOptions {
  /** Injected for tests; defaults to the model in the context. */
  model?: AgentContext['model'];
}

export async function explainIntent(
  input: ExplainInput,
  ctx: Pick<AgentContext, 'model'>,
): Promise<Explanation> {
  const failing = failingChecks(input);
  if (failing.length === 0) {
    return {
      text: `All nine checks passed; nothing is holding this ${formatUSD(input.claim.total)} payment.`,
      source: 'template',
      attempts: 0,
      model: null,
      rejectedFor: null,
    };
  }

  const result = await askJson<string>({
    model: ctx.model,
    step: 'explain',
    itemId: input.itemId,
    system: EXPLAIN_SYSTEM,
    user: explainUser({
      invoiceNumber: input.claim.invoiceNumber,
      vendorName: input.claim.vendorName,
      amountCents: input.claim.total,
      decision: input.decision,
      failing,
      original: input.original ?? null,
      claim: input.claim,
    }),
    parse: (content) => {
      const parsed = explanationSchema.safeParse(parseJsonObject(content));
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      const text = parsed.data.text.trim().replace(/\s+/g, ' ');
      const sentences = sentenceCount(text);
      if (sentences > 2) throw new ValidationError(`the explanation has ${sentences} sentences; the limit is two`);
      const facts = checkFacts(text, input);
      if (!facts.ok) {
        const defects = [...facts.missing.map((item) => `missing ${item}`), ...facts.problems];
        throw new ValidationError(`the explanation did not pass validation: ${defects.join('; ')}`);
      }
      return text;
    },
  });

  if (result.ok && result.value !== null) {
    return { text: result.value, source: 'model', attempts: result.attempts, model: result.model, rejectedFor: null };
  }

  return {
    text: templateExplanation(input),
    source: 'template',
    attempts: result.attempts,
    model: result.model,
    rejectedFor: result.error,
  };
}
