// Step 1 in code: one call per email, one retry on schema failure, never a guessed value.
//
// What this module owns:
//   - wrapping the email and its attachments as untrusted data (AC-9d);
//   - turning a validated extraction into a `Claim` (SPEC §6.2.1), including the source hash
//     the proof bundle shows (attachment sha256, or the hash of the body for an email-body
//     invoice like in_06);
//   - reporting "needs review" instead of a claim when the model could not produce a valid
//     answer twice (SPEC §6.6.1).
//
// What it deliberately does not own: the vendor. `claim.vendorId` stays null here; index.ts
// fills it from the gate's deterministic resolution (SPEC §6.2.2 O1 never trusts the model).

import { createHash } from 'node:crypto';
import type { Claim } from '@pbp/core';
import { EXTRACT_SYSTEM, extractUser } from './prompts/extract.js';
import { parseExtraction } from './schema.js';
import type { Extraction } from './schema.js';
import type { AgentContext, Classification, InboxItem } from './types.js';
import { emailOf, triedToEscapeDocument } from './untrusted.js';
import { askJson } from './validate.js';

export interface ExtractionResult {
  ok: boolean;
  classification: Classification | null;
  claim: Claim | null;
  changeRequest: { requestedPayee: string } | null;
  notes: string[];
  attempts: number;
  model: string | null;
  at: string | null;
  error: string | null;
  rawFiles: string[];
}

export function sha256OfText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function classifyAndExtract(
  item: InboxItem,
  ctx: Pick<AgentContext, 'model'>,
): Promise<ExtractionResult> {
  const result = await askJson<Extraction>({
    model: ctx.model,
    step: 'extract',
    itemId: item.id,
    system: EXTRACT_SYSTEM,
    user: extractUser(item),
    parse: (content) => parseExtraction(content, item),
  });

  if (!result.ok || result.value === null) {
    return {
      ok: false,
      classification: null,
      claim: null,
      changeRequest: null,
      notes: [],
      attempts: result.attempts,
      model: result.model,
      at: result.at,
      error: result.error,
      rawFiles: result.rawFiles,
    };
  }

  const extraction = result.value;
  const notes = [...extraction.notes];

  const sources = [item.bodyText, ...item.attachments.map((attachment) => attachment.text)];
  if (sources.some((text) => triedToEscapeDocument(text))) {
    notes.push('The document text tried to close the <untrusted_document> block; the delimiter was neutralized.');
  }

  let claim: Claim | null = null;
  if (extraction.claim) {
    const draft = extraction.claim;
    const attachment = draft.source.kind === 'attachment'
      ? item.attachments.find((entry) => entry.name === draft.source.name)
      : undefined;
    const sourceSha256 = attachment ? attachment.sha256 : sha256OfText(item.bodyText);

    claim = {
      itemId: item.id,
      vendorId: null,
      vendorName: draft.vendorName,
      senderEmail: emailOf(item.from),
      invoiceNumber: draft.invoiceNumber,
      issueDate: draft.issueDate,
      currency: 'USD',
      total: draft.total,
      po: draft.po,
      requestedPayee: draft.requestedPayee,
      lines: draft.lines,
      sourceSha256,
      extractedBy: result.model !== null && result.at !== null ? { model: result.model, at: result.at } : null,
    };
  }

  return {
    ok: true,
    classification: extraction.classification,
    claim,
    changeRequest: extraction.changeRequest,
    notes,
    attempts: result.attempts,
    model: result.model,
    at: result.at,
    error: null,
    rawFiles: result.rawFiles,
  };
}
