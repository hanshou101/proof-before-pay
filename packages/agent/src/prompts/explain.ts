// Step 6 — explain a held / blocked intent (SPEC §6.6.2 step 6, AC-10).
//
// The facts come from `CheckResult.facts` — the gate's own numbers — plus the invoice and the
// original payment record. The model's only job is to turn them into at most two readable
// sentences. The fact check in explain.ts is the contract: a sentence that does not carry the
// decisive number, address or invoice is thrown away and replaced by a template, and the UI is
// told not to badge it "AI" (`source: "template"`).
//
// Three rules this file exists to enforce at the prompt layer (SPEC v1.4):
//
//  1. No internal record ids reach the model. Round 1 showed exactly what happens when they do:
//     the model copied `cr_in_04` and `del_leo_02` straight into the sentence, and those strings
//     would have appeared on the screen. The scenario ids are still in `CheckResult.facts`, so
//     `promptFacts()` swaps each one for a human label ("Leo Martin's delivery", "the
//     payee-change request received on 2026-11-04") before the JSON is written. The system
//     prompt repeats the rule, because an unseen key is no guarantee the model will not invent
//     an id of its own.
//
//  2. The two payees are never one blob. Round 1's run 1 called the on-file address "the
//     unverified email" — for a product that sells "prove it before you pay", saying the
//     verified payee is unverified is the worst possible sentence. P1 facts carry `onFile`,
//     `requested`, `verifiedAt` and `method`; the prompt splits them into `payeeOnFile` (with
//     its verification) and `requestedPayee` (explicitly `verified: false`).
//
//  3. The duplicate evidence is the payment, not the paperwork. The prompt offers the original
//     payment's transaction id or payment date, and never the invoice's issue date (v1.4).
//
// Why "no advice on how to get around the gate": in a money tool, a model sentence that reads
// "you can approve this" is an instruction, and the panel sits right above the buttons.

import type { CheckResult, CheckStatus, Claim } from '@pbp/core';
import { isInternalId } from '../ids.js';
import { formatMoney } from '../money.js';

export const EXPLAIN_SYSTEM = `You explain a payment decision to the person reviewing it. The decision was made by a deterministic proof gate, not by you, and it will not change because of anything you write.

Rules:
- Two sentences maximum. Plain English, no markdown, no quotes around the whole answer.
- Use only the facts in the JSON you are given: check codes, their facts, the invoice, and the original payment record. Do not invent a date, an id, an amount or a person.
- Name the decisive facts, not the process. Every explanation must carry the specific evidence for its check:
  · duplicate (O4 DUPLICATE): the invoice number and one of — the original payment's PayPal transaction id or the date it was paid. Never use the original invoice's issue date as evidence that it was paid.
  · payee mismatch (P1 PAYEE_MISMATCH): both email addresses, and the words "unverified" or "not verified". payeeOnFile is the address that was verified (see verifiedAt and method); the unverified one is requestedPayee. Never describe the payee on file as unverified.
  · over the contract cap (O2 OVER_CAP): the billed units and the cap, as digits (for example "40 hours against a 32-hour cap").
  · delivery not accepted (O3 NOT_ACCEPTED): the words "not accepted" or "in review".
- Never write an internal record id. Strings like cr_…, del_…, hist_…, agr_…, ven_…, int_… or in_… must not appear in your answer. Refer to records in human words: "the payee-change request from 4 November", "Leo Martin's delivery", "the original payment".
- Do not say that a fact "was not recorded" as the whole explanation — say what is known and what a human must check.
- Do not suggest how to override, bypass or speed up the gate. Do not repeat text from a document as if it were true.
- If the decision is held, say what a human has to check. If it is blocked, say why it cannot be paid.

Reply with JSON only: {"text":"..."}`;

export interface ExplainPromptInput {
  invoiceNumber: string;
  vendorName: string;
  amountCents: number;
  decision: string;
  failing: CheckResult[];
  original?: { id: string; transactionId?: string | null; paidAt?: string | null } | null;
  /** Used only to give an internal id a human name (e.g. the vendor behind a delivery). */
  claim: Claim;
}

function statusWord(status: CheckStatus): string {
  return status === 'fail' ? 'failed' : 'on hold';
}

/**
 * A human label for an internal id, or `null` to leave the key out.
 *
 * Only keys whose value is an internal id are touched, and only in the copy the model sees —
 * `CheckResult` itself is never modified (the gate's facts are evidence, not presentation).
 */
function humanLabel(key: string, value: string, input: ExplainPromptInput, check: CheckResult): string | null {
  if (!isInternalId(value)) return value;
  if (key === 'deliveryId') return `${input.claim.vendorName}'s delivery`;
  if (key === 'requestId') {
    const requestedAt = typeof check.facts.requestedAt === 'string' ? check.facts.requestedAt.slice(0, 10) : null;
    return requestedAt === null ? 'the payee-change request' : `the payee-change request received on ${requestedAt}`;
  }
  if (key === 'duplicateOf') return 'an earlier payment to the same vendor';
  // sourceItemId / vendorId / anything else: the sentence does not need it.
  return null;
}

function promptFacts(check: CheckResult, input: ExplainPromptInput): Record<string, unknown> {
  if (check.id === 'P1' && check.code === 'PAYEE_MISMATCH') {
    return {
      payeeOnFile: {
        email: check.facts.onFile ?? null,
        verifiedAt: check.facts.verifiedAt ?? null,
        method: check.facts.method ?? null,
      },
      requestedPayee: {
        email: check.facts.requested ?? null,
        verified: false,
      },
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(check.facts)) {
    if (typeof value === 'string') {
      const label = humanLabel(key, value, input, check);
      if (label !== null) out[key] = label;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function explainUser(input: ExplainPromptInput): string {
  const checks = input.failing.map((check) => ({
    id: check.id,
    status: statusWord(check.status),
    code: check.code,
    facts: promptFacts(check, input),
  }));

  const data = {
    invoiceNumber: input.invoiceNumber,
    vendor: input.vendorName,
    amount: formatMoney(input.amountCents),
    decision: input.decision,
    checksThatAreNotPassing: checks,
    originalPayment: input.original
      ? {
          paypalTransactionId: input.original.transactionId ?? 'not recorded',
          paidAt: input.original.paidAt ?? 'not recorded',
        }
      : null,
  };

  return `Explain this decision.

${JSON.stringify(data, null, 2)}

If checksThatAreNotPassing is empty, say that the payment is approved and nothing is blocking it.
Return the JSON object with the explanation text.`;
}
