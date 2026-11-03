// Types the server owns. Domain types come from `@pbp/core` (SPEC §6.2.1) and are imported,
// never re-declared; this file only adds what the HTTP layer and the runner need.

import type {
  Agreement,
  Cents,
  CheckResult,
  Claim,
  Currency,
  Decision,
  Delivery,
  HistoryRecord,
  PayeeChangeRequest,
  Policy,
  Proposal,
  RiskFlag,
  Vendor,
} from '@pbp/core';

export type {
  Agreement,
  Cents,
  CheckResult,
  Claim,
  Currency,
  Decision,
  Delivery,
  HistoryRecord,
  PayeeChangeRequest,
  Policy,
  Proposal,
  RiskFlag,
  Vendor,
};

/**
 * One inbox item as loaded from `demo/inbox/<id>.json` (AC-6). The scenario file carries the
 * envelope (sender, subject, receivedAt, attachment names); the per-item JSON carries the body
 * text and the attachment records with their sha256.
 */
export interface InboxAttachment {
  name: string;
  /** Repo-relative path, e.g. `demo/inbox/files/kenji-INV-0153.pdf`. */
  path: string;
  sha256: string;
}

export interface InboxItem {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: InboxAttachment[];
  layout: string;
}

export interface ScenarioVendor extends Vendor {
  role?: string;
  /** `required` / `not_needed` / `must_not_exist` — what the sandbox must have (SPEC §9). */
  sandboxAccount?: string;
}

export interface ScenarioHistoryEntry {
  id: string;
  vendorId: string;
  invoiceNumber: string;
  agreementId: string;
  total: Cents;
  currency: Currency;
  sourceFile: string;
  seededBy: string;
}

export type Classification =
  | 'invoice'
  | 'payee_change_request'
  | 'invoice+payee_change_request'
  | 'other';

export interface ScenarioGoldenItem {
  itemId: string;
  classification: Classification;
  claim: Omit<Claim, 'itemId' | 'vendorName' | 'senderEmail' | 'sourceSha256' | 'extractedBy'> | null;
  agreementId: string | null;
  agreementMatchedBy?: 'po' | 'ai';
  checks: Record<string, string> | null;
  riskFlags: RiskFlag[];
  duplicateOf?: string;
  decision: Decision | null;
  paypal: string | null;
  final: string;
}

export interface Scenario {
  version: string;
  scenario: string;
  testClock: string;
  payer: { name: string; operator: string; domain: string; currency: Currency };
  policy: Policy;
  vendors: ScenarioVendor[];
  agreements: Agreement[];
  deliveries: Delivery[];
  history: ScenarioHistoryEntry[];
  inbox: { id: string; from: string; subject: string; receivedAt: string; attachments: string[]; layout: string }[];
  golden: {
    items: ScenarioGoldenItem[];
    totalsAfterRun: Totals;
    humanSteps: HumanStep[];
    totalsAfterHumanSteps: Totals;
    comparisonMode: { payouts: ComparisonPayout[]; totalSent: Cents };
  };
}

export interface Totals {
  proven: { count: number; amount: Cents };
  awaitingProof: { count: number; amount: Cents };
  held: { count: number; amount: Cents };
  stopped: { count: number; amount: Cents };
}

/** SPEC §6.3.3 action vocabulary (mirrors core's `HumanAction`). */
export type HumanAction =
  | 'verify_payee'
  | 'mark_fraud'
  | 'reject'
  | 'accept_delivery'
  | 'approve'
  | 'cancel_payout'
  | 'refresh_receipt';

export interface HumanStep {
  step: number;
  intentOf: string;
  action: HumanAction;
  input?: Record<string, unknown>;
  expect: string;
}

export interface ComparisonPayout {
  itemId: string;
  receiver: string;
  amount: Cents;
  paypal: string;
  problem?: string;
}

export type RunMode = 'proof' | 'comparison';

/** What one `Agent.processItem` call hands back (SPEC §6.6.2 steps 1–5). */
export interface ItemOutcome {
  classification: Classification;
  /** The model that produced the reading, or `seeded` for data no model touched. */
  model: string;
  claim: Claim | null;
  changeRequest: PayeeChangeRequest | null;
  risk: { flags: RiskFlag[]; note: string | null; noteSource: 'model' | 'none' } | null;
  proposal: { agreementId: string | null; agreementMatchedBy: 'po' | 'ai' | null; rationale: string } | null;
}

export interface AgentExplanation {
  text: string;
  source: 'model' | 'template';
}

export interface RunSummaryInput {
  runId: string;
  mode: RunMode;
  totals: Totals;
  items: {
    itemId: string;
    intentId: string | null;
    vendorName: string;
    business: string;
    /** The invoice the highlight may name (`checkHighlight` requires one). */
    invoiceNumber: string | null;
    amount: Cents | null;
    state: string | null;
    decision: Decision | null;
    checks: CheckResult[] | null;
  }[];
}

export interface ComparisonSendRequest {
  receiver: string;
  amount: Cents;
  memo: string;
}

export interface ComparisonSendResult {
  toolCallId: string;
  senderBatchId: string;
  payoutBatchId: string | null;
  railStatus: string | null;
  transactionId: string | null;
  ok: boolean;
}

export type SendPayoutTool = (request: ComparisonSendRequest) => Promise<ComparisonSendResult>;

/**
 * The AI agent as the server uses it (SPEC §6.6.2). `packages/agent` implements this in T6;
 * `test/fakes.ts` replays the recorded golden extraction for the integration tests (SPEC §7).
 * The agent never touches money: everything it returns is a proposal.
 */
export interface AgentPort {
  processItem(input: { item: InboxItem; files: InboxAttachment[] }): Promise<ItemOutcome>;
  explainIntent(input: {
    intentId: string;
    itemId: string;
    claim: Claim;
    checks: CheckResult[];
    decision: Decision;
    /**
     * The payment this intent duplicates, when O4 says `DUPLICATE`. Filled by the runner from
     * `data/history.json` — `transactionId` and `paidAt` are PayPal's own facts about a payment
     * that really happened (SPEC v1.4 AC-10), not values borrowed from the invoice.
     */
    original?: { id: string; transactionId: string | null; paidAt: string | null } | null;
  }): Promise<AgentExplanation>;
  summarize(input: RunSummaryInput): Promise<AgentExplanation>;
  runComparison(input: { runId: string; items: InboxItem[]; sendPayout: SendPayoutTool }): Promise<AgentExplanation>;
}
