// The shapes the rest of the application (server, eval, tests) shares with the agent.
//
// SPEC §6.6: the agent reads inbox items and returns *proposals and text*. It never decides
// whether money moves and never holds anything that can move money — the only payout code it
// touches is `comparison.ts`, whose sender is injected by the caller (SPEC §6.6.4).

import type {
  Agreement,
  CheckResult,
  Claim,
  Decision,
  PayeeChangeRequest,
  Proposal,
  RiskFlag,
  Vendor,
} from '@pbp/core';
import type { ChatModel } from './llm.js';

/** SPEC §6.3.2 `item.classified` accepts exactly these four values. */
export const CLASSIFICATIONS = [
  'invoice',
  'payee_change_request',
  'invoice+payee_change_request',
  'other',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/** One attachment, already reduced to plain text by the caller (`unpdf` for PDFs, SPEC §4). */
export interface InboxAttachment {
  name: string;
  sha256: string;
  text: string;
}

/** One email from `demo/inbox/<id>.json`, with attachment text extracted. */
export interface InboxItem {
  id: string;
  to: string;
  from: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: InboxAttachment[];
}

/** Everything the agent is allowed to see. No rail, no ledger, no gate. */
export interface AgentContext {
  vendors: Vendor[];
  agreements: Agreement[];
  /** The paying studio's own domain (`scenario.payer.domain`); used by risk detection. */
  payerDomain: string;
  /** The model client. Tests inject a recorded one; production injects `createChatModel()`. */
  model: ChatModel;
  /** Directory for the raw model output (SPEC §6.6.1, e.g. `data/ai/<runId>/`). */
  rawDir?: string | null;
}

/** Subset of SPEC §6.3.2 the agent writes. The server adds `at` and its own seq. */
export type AgentEvent =
  | { type: 'item.classified'; data: { itemId: string; classification: Classification; model: string } }
  | { type: 'claim.extracted'; data: { itemId: string; claim: Claim } }
  | { type: 'change_request.recorded'; data: PayeeChangeRequest }
  | {
      type: 'risk.flagged';
      data: { itemId: string; flags: RiskFlag[]; note: string | null; noteSource: 'model' | 'template' | 'none' };
    };

export interface ProcessItemResult {
  itemId: string;
  events: AgentEvent[];
  classification: Classification | null;
  claim: Claim | null;
  changeRequest: PayeeChangeRequest | null;
  risk: { flags: RiskFlag[]; note: string | null; noteSource: 'model' | 'template' | 'none' };
  /** What the server forwards to `core.evaluate(proposal, context)`. */
  proposal: Proposal | null;
  /** Model notes plus deterministic notes (e.g. "the document addressed an AI"). */
  notes: string[];
  /**
   * True when the model could not produce a valid extraction after one retry. In that case
   * nothing is invented: no claim, no proposal, and `error` says what went wrong.
   */
  needsReview: boolean;
  error: string | null;
}

export interface ExplainInput {
  intentId: string;
  itemId: string;
  decision: Decision;
  claim: Claim;
  checks: CheckResult[];
  /**
   * The payment this intent duplicates, when O4 reports `DUPLICATE`. Everything here is a fact
   * the explanation may use: the record id (for logging only, never sent to the model),
   * PayPal's transaction id and the moment the original was paid.
   *
   * The server fills `transactionId` and `paidAt` from `data/history.json` (the seeded payment
   * `demo:reset` made through the real rail). There is deliberately no `issuedAt`: SPEC v1.4
   * removed the original invoice's issue date as a substitute for the payment evidence.
   */
  original?: {
    id: string;
    transactionId?: string | null;
    paidAt?: string | null;
  } | null;
}

export interface Explanation {
  text: string;
  /** `template` means the model's answer failed the fact check and the UI must not badge it "AI". */
  source: 'model' | 'template';
  attempts: number;
  model: string | null;
  /** Why the model answer was rejected, when it was. */
  rejectedFor?: string | null;
}

export interface Totals {
  proven: { count: number; amount: number };
  awaitingProof: { count: number; amount: number };
  held: { count: number; amount: number };
  stopped: { count: number; amount: number };
  ignored?: { count: number };
}

/** One intent as the highlight writer sees it (only held / blocked ones matter). */
export interface SummarizableIntent {
  intentId: string;
  itemId: string;
  vendorName: string;
  invoiceNumber: string;
  amount: number;
  decision: Decision;
  /** Check codes + facts, exactly as the gate reported them. */
  checks: CheckResult[];
}

export interface RunSummary {
  /** The deterministic totals line (always code-generated, never the model). */
  line: string;
  /** One sentence about what needs a human, fact-checked; `template` when the model failed. */
  highlight: {
    text: string;
    source: 'model' | 'template';
    attempts: number;
    model: string | null;
  };
}
