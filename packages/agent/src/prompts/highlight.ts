// Step 7 — the run highlight (SPEC §6.6.2 step 7).
//
// The totals line is code-generated (never the model): numbers that a judge can check against
// the KPI strip must not pass through a language model. The model only writes the one sentence
// the header shows after a run, and it may only talk about what needs a human — a run that
// ended with two held and one stopped must not be summarised as "all paid".

import { formatMoney } from '../money.js';
import type { SummarizableIntent, Totals } from '../types.js';

export const HIGHLIGHT_SYSTEM = `You write one sentence under the totals of a finished payout run.

Rules:
- Exactly one sentence, at most 160 characters. Plain English, no markdown.
- Talk only about payments that need a human: held or stopped. Never say or imply that everything was paid, and never summarise the proven payments.
- Use only the invoice numbers, names, amounts and check codes in the data. Do not invent anything.
- Never write an internal record id (cr_…, del_…, hist_…, agr_…, ven_…, int_…, in_…). Name a record in human words instead.
- Prefer naming the specific invoice a reviewer should open first.

Reply with JSON only: {"highlight":"..."}`;

export function highlightUser(input: { totals: Totals; intents: SummarizableIntent[] }): string {
  const needsHuman = input.intents
    .filter((intent) => intent.decision !== 'approved')
    .map((intent) => ({
      invoiceNumber: intent.invoiceNumber,
      vendor: intent.vendorName,
      amount: formatMoney(intent.amount),
      decision: intent.decision,
      checks: intent.checks
        .filter((check) => check.status === 'hold' || check.status === 'fail')
        .map((check) => `${check.id}:${check.code}`),
    }));

  const totals = {
    proven: `${input.totals.proven.count} (${formatMoney(input.totals.proven.amount)})`,
    awaitingProof: `${input.totals.awaitingProof.count} (${formatMoney(input.totals.awaitingProof.amount)})`,
    held: `${input.totals.held.count} (${formatMoney(input.totals.held.amount)})`,
    stopped: `${input.totals.stopped.count} (${formatMoney(input.totals.stopped.amount)})`,
  };

  return `Run totals: ${JSON.stringify(totals)}.
Payments that need a human:
${JSON.stringify(needsHuman, null, 2)}

Write the one-sentence highlight and return {"highlight":"..."}.`;
}
