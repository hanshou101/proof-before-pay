// Step 3 — match an agreement when the invoice carries no PO (SPEC §6.6.2 step 3).
//
// The deterministic path (PO → agreement) never reaches the model. This prompt only runs for
// the no-PO case, and it may pick **only from the vendor's own agreements**: the candidate list
// is built by the caller, and the parser rejects any id outside it. The model explains the pick
// so the proof bundle can show *why* (in_06 must be agr_sofia_05, the brand-guidelines job, not
// agr_sofia_04, the packaging job).

import type { Agreement } from '@pbp/core';
import { formatMoney } from '../money.js';

export const MATCH_SYSTEM = `You match one invoice to one existing agreement for a design studio.

You are given the invoice as it was extracted (JSON) and the vendor's open agreements (JSON). Choose the single agreement that covers the work described on the invoice. Use the scope wording and the billing shape (fixed fee vs hourly vs per word, and the rate) to decide. If two agreements are close, prefer the one whose scope matches the invoice description most closely.

Never invent an agreement. Never choose an id that is not in the list.

Reply with JSON only:
{"agreementId":"<id from the list>","reason":"<one short sentence naming the scope and why it fits>"}`;

export function candidateLine(agreement: Agreement): string {
  const money =
    agreement.kind === 'fixed'
      ? `fixed fee ${formatMoney(agreement.fee ?? 0)}`
      : `${formatMoney(agreement.rate ?? 0)} per ${agreement.kind === 'hourly' ? 'hour' : 'word'}${
          agreement.capUnits ? `, cap ${agreement.capUnits} ${agreement.kind === 'hourly' ? 'hours' : 'words'}` : ''
        }`;
  return `- ${agreement.id} | PO ${agreement.po ?? '(none)'} | ${agreement.scope} | ${agreement.kind} · ${money}`;
}

export function matchUser(input: {
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDescription: string;
  totalLabel: string;
  candidates: Agreement[];
}): string {
  const lines = input.candidates.map(candidateLine).join('\n');
  return `Invoice ${input.invoiceNumber} from ${input.vendorName} (${input.vendorId}) has no purchase order.
Invoice line(s): ${input.invoiceDescription}
Invoice total: ${input.totalLabel}

The vendor's agreements:
${lines}

Return the JSON object with the agreementId and the reason.`;
}
