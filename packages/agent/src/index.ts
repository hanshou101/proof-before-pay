// @pbp/agent — the AI half of Proof Before Pay.
//
// What it does (SPEC §6.6.2, steps 1, 3, 4, 6, 7):
//   processItem()    classify + extract, recognise the vendor deterministically, match an
//                    agreement when there is no PO, flag risk and write the risk note, and hand
//                    the caller a `Proposal` for the gate.
//   explainIntent()  at most two sentences for a held / blocked intent, fact-checked.
//   summarize()      the deterministic totals line plus one fact-checked highlight sentence.
//   runComparison()  the ungated "before" agent (SPEC §6.6.4) — separate function, injected rail.
//
// What it never does: decide whether money moves, call the gate, or hold anything that can pay.
// `SAFE_MODE_TOOLS` is empty on purpose and is asserted by the tests (AC-9c).

import {
  detectRisk,
  normalizeEmail,
  resolveVendor,
  type Agreement,
  type Claim,
  type GateContext,
  type Proposal,
  type PayeeChangeRequest,
  type RiskFlag,
  type Vendor,
} from '@pbp/core';
import { classifyAndExtract } from './extract.js';
import { matchAgreement } from './match.js';
import { writeRiskNote } from './risk-note.js';
import type { ToolSpec } from './llm.js';
import type { AgentContext, AgentEvent, Classification, InboxItem, ProcessItemResult } from './types.js';

/**
 * The tools the safe-mode agent is given: none.
 *
 * This is not "we simply don't call the pay tool" — the agent is constructed without any tool
 * list at all, so a hijacked model has nothing to call (AC-9c). The comparison agent in
 * `comparison.ts` is a different code path with an injected sender, and is not reachable from
 * `processItem`.
 */
export const SAFE_MODE_TOOLS: readonly ToolSpec[] = Object.freeze([]);

/**
 * The vendor O1 will recognise, using core's own resolution order (sender → PO → name).
 * `resolveVendor` only reads `vendors` and `agreements`; the rest of `GateContext` is not
 * available to the agent, and must not be.
 */
export function vendorForClaim(
  claim: Claim,
  ctx: Pick<AgentContext, 'vendors' | 'agreements'>,
): Vendor | null {
  const resolution = resolveVendor(claim, {
    vendors: ctx.vendors,
    agreements: ctx.agreements,
  } as GateContext);
  return resolution.vendor;
}

function emptyResult(item: InboxItem, error: string | null, extraction: {
  attempts: number;
  model: string | null;
  classification: Classification | null;
}): ProcessItemResult {
  return {
    itemId: item.id,
    events: [],
    classification: extraction.classification,
    claim: null,
    changeRequest: null,
    risk: { flags: [], note: null, noteSource: 'none' },
    proposal: null,
    notes: [],
    needsReview: true,
    error,
  };
}

export async function processItem(item: InboxItem, ctx: AgentContext): Promise<ProcessItemResult> {
  const extraction = await classifyAndExtract(item, ctx);

  if (!extraction.ok || extraction.classification === null) {
    return emptyResult(item, extraction.error ?? 'the extraction failed', extraction);
  }

  const modelName = extraction.model ?? ctx.model.model;
  const events: AgentEvent[] = [
    {
      type: 'item.classified',
      data: { itemId: item.id, classification: extraction.classification, model: modelName },
    },
  ];
  const notes = [...extraction.notes];

  let claim = extraction.claim;
  let vendor: Vendor | null = null;

  if (claim) {
    vendor = vendorForClaim(claim, ctx);
    // O1 never trusts the model's vendorId, but the claim the server stores should still carry
    // the deterministic id so every downstream view agrees with the gate.
    claim = { ...claim, vendorId: vendor?.id ?? null };
    events.push({ type: 'claim.extracted', data: { itemId: item.id, claim } });
  }

  // ---- step 5's first half: record a payee change request before proposing ----------------
  let changeRequest: PayeeChangeRequest | null = null;
  const asksForNewPayee =
    extraction.classification === 'payee_change_request' ||
    extraction.classification === 'invoice+payee_change_request' ||
    extraction.changeRequest !== null;

  if (asksForNewPayee) {
    const requestedPayee = extraction.changeRequest?.requestedPayee ?? claim?.requestedPayee ?? null;
    if (!claim || !vendor) {
      notes.push('The email asks for new payment details but the vendor could not be recognised; no change request was recorded.');
    } else if (requestedPayee === null) {
      notes.push('The email asks for new payment details but names no address; no change request was recorded.');
    } else if (normalizeEmail(requestedPayee) === normalizeEmail(vendor.payee.receiver)) {
      notes.push('The requested payee is the payee already on file; no change request was recorded.');
    } else {
      changeRequest = {
        id: `cr_${item.id}`,
        vendorId: vendor.id,
        requestedPayee,
        sourceItemId: item.id,
        requestedAt: item.receivedAt,
        status: 'unverified',
      };
      events.push({ type: 'change_request.recorded', data: changeRequest });
    }
  }

  // ---- step 4: deterministic flags first, then (only if flagged) the note ------------------
  const flags: RiskFlag[] = claim
    ? detectRisk(
        {
          senderEmail: claim.senderEmail,
          vendor,
          body: item.bodyText,
          attachmentText: item.attachments.map((attachment) => attachment.text).join('\n\n'),
        },
        { vendors: ctx.vendors, payerDomain: ctx.payerDomain },
      )
    : [];

  let note: string | null = null;
  let noteSource: 'model' | 'template' | 'none' = 'none';
  if (claim) {
    const risk = await writeRiskNote(item, flags, ctx);
    note = risk.note;
    noteSource = risk.noteSource;
    if (risk.noteSource === 'template' && risk.note !== null) {
      notes.push('The risk note was generated from the flags because the model’s sentence failed validation.');
    }
    events.push({ type: 'risk.flagged', data: { itemId: item.id, flags, note, noteSource } });
  }

  if (flags.includes('INSTRUCTION_TO_AI')) {
    notes.push('The document contains instructions addressed to an AI; they were ignored.');
  }

  // ---- step 3: agreement ------------------------------------------------------------------
  let proposal: Proposal | null = null;
  let needsReview = false;
  let error: string | null = null;

  if (claim) {
    let agreementId: string | null = null;
    let matchedBy: 'po' | 'ai' | null = null;
    let rationale = '';

    if (claim.po !== null && claim.po.trim() !== '') {
      const byPo = ctx.agreements.find((agreement) => (agreement.po ?? '').trim() === claim.po?.trim());
      agreementId = byPo?.id ?? null;
      matchedBy = byPo ? 'po' : null;
      rationale = byPo
        ? `PO ${claim.po} matches ${byPo.id}.`
        : `No agreement carries PO ${claim.po}.`;
    } else if (vendor) {
      const match = await matchAgreement({ claim, vendor, agreements: ctx.agreements }, ctx);
      agreementId = match.agreementId;
      matchedBy = match.matchedBy;
      rationale = match.rationale;
      if (match.needsReview) {
        needsReview = true;
        error = match.error;
      }
    } else {
      rationale = 'No vendor was recognised, so no agreement could be matched.';
    }

    proposal = { claim, agreementId, agreementMatchedBy: matchedBy, rationale };
  }

  return {
    itemId: item.id,
    events,
    classification: extraction.classification,
    claim,
    changeRequest,
    risk: { flags, note, noteSource },
    proposal,
    notes,
    needsReview,
    error,
  };
}

export { classifyAndExtract } from './extract.js';
export { matchAgreement } from './match.js';
export { writeRiskNote, riskNoteFromFlags, checkRiskNote, RISK_NOTE_MAX_CHARS } from './risk-note.js';
export {
  explainIntent,
  templateExplanation,
  checkFacts,
  invoicePattern,
  dateForms,
  callsPayeeOnFileUnverified,
  internalIdsIn,
  isInternalId,
} from './explain.js';
export { summarize, totalsLine, templateHighlight, checkHighlight, HIGHLIGHT_MAX_CHARS } from './highlight.js';
export { runComparison, parsePayoutArguments, MAX_COMPARISON_ROUNDS } from './comparison.js';
export type { ComparisonResult, ComparisonToolCall, ComparisonPayout, PayoutSender } from './comparison.js';
export { createChatModel, readLlmConfig, LlmConfigError, rawFileName } from './llm.js';
export type { ChatModel, ChatRequest, ChatResponse, ChatTurn, ToolCall, ToolSpec, LlmConfig } from './llm.js';
export { parseMoneyCents, formatMoney } from './money.js';
export { readInbox, readInboxItem, extractPdfText } from './inbox.js';
export { untrustedDocument, neutralize, emailOf } from './untrusted.js';
export { sentenceCount, charCount } from './sentences.js';
export type {
  AgentContext,
  AgentEvent,
  Classification,
  ExplainInput,
  Explanation,
  InboxAttachment,
  InboxItem,
  ProcessItemResult,
  RunSummary,
  SummarizableIntent,
  Totals,
} from './types.js';
export { CLASSIFICATIONS } from './types.js';
