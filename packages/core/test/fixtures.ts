// Fixtures for the golden tests.
//
// READ-ONLY view of the normative scenario: every vendor, agreement, delivery, policy value
// and expected outcome comes from `demo/scenario/*.json` (SPEC §6.4). Nothing is hand-copied,
// because a hand-copied fixture stops catching drift the day the scenario changes.
//
// Two things are not in the scenario and are supplied here, both named in the T2 ticket:
//   - the `PayeeChangeRequest` for in_04 (the agent records it before proposing, SPEC §6.6.2)
//   - the seeded history intent `hist_kenji_0142`, which O4 must treat as proven.

import { readFileSync } from 'node:fs';
import {
  fingerprint,
  idempotencyKey,
  resolveVendor,
} from '../src/index.ts';
import type {
  Agreement,
  Claim,
  Delivery,
  GateContext,
  IntentRecord,
  PayeeChangeRequest,
  Policy,
  Proposal,
  Vendor,
} from '../src/index.ts';

export interface ScenarioItem {
  itemId: string;
  classification: string;
  claim: {
    vendorId: string | null;
    invoiceNumber: string;
    issueDate: string;
    currency: 'USD';
    total: number;
    po: string | null;
    requestedPayee: string | null;
    lines: { description: string; quantity: number; unit: 'item' | 'hour' | 'word'; unitPrice: number; amount: number }[];
  } | null;
  agreementId: string | null;
  agreementMatchedBy?: 'po' | 'ai' | null;
  checks: Record<string, string> | null;
  riskFlags: string[];
  duplicateOf?: string;
  decision: 'approved' | 'held' | 'blocked' | null;
  final: string;
}

export interface ScenarioFile {
  version: string;
  scenario: string;
  testClock: string;
  payer: { name: string; operator: string; domain: string; currency: 'USD' };
  policy: Policy;
  vendors: Vendor[];
  agreements: Agreement[];
  deliveries: Delivery[];
  /** Seeded payments (`demo:reset`). No `state` field — SPEC §6.2.2 O4 says they are proven. */
  history: {
    id: string;
    vendorId: string;
    invoiceNumber: string;
    agreementId: string;
    total: number;
    currency: 'USD';
    sourceFile: string;
    seededBy: string;
  }[];
  inbox: { id: string; from: string; subject: string; attachments: string[]; layout: string }[];
  golden: {
    items: ScenarioItem[];
    totalsAfterRun: Record<string, { count: number; amount?: number }>;
    totalsAfterHumanSteps: Record<string, { count: number; amount?: number }>;
    humanSteps: { step: number; intentOf: string; action: string; input?: Record<string, unknown>; expect: string }[];
    comparisonMode: { payouts: { itemId: string; receiver: string; amount: number; paypal: string }[]; totalSent: number };
  };
}

export interface InboxContent {
  billTo: { name: string; attn: string; email: string; city: string };
  emails: Record<string, string>;
  invoices: Record<string, Record<string, unknown>>;
}

const SCENARIO_URL = new URL('../../../demo/scenario/scenario.json', import.meta.url);
const INBOX_URL = new URL('../../../demo/scenario/inbox-content.json', import.meta.url);

export function readScenario(): ScenarioFile {
  return JSON.parse(readFileSync(SCENARIO_URL, 'utf8')) as ScenarioFile;
}

export function readInboxContent(): InboxContent {
  return JSON.parse(readFileSync(INBOX_URL, 'utf8')) as InboxContent;
}

export const EPOCH = 'ep_demo_2026_11_06';
/** Fixed stand-in for the SHA-256 of the source file; the gate never reads it. */
export const FIXED_SOURCE_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** `Priya Nair <priya@nairwords.example>` → `priya@nairwords.example`. */
export function emailFromHeader(header: string): string {
  const bracketed = /<([^<>]+)>/.exec(header);
  return (bracketed?.[1] ?? header).trim();
}

const scenario = readScenario();
const inboxContent = readInboxContent();

export function vendorById(id: string | null): Vendor | null {
  if (!id) return null;
  return scenario.vendors.find((vendor) => vendor.id === id) ?? null;
}

/** Build the `Claim` from `golden.items[*].claim` plus the fields the ticket says to fill in. */
export function claimOf(itemId: string): Claim {
  const item = scenario.golden.items.find((entry) => entry.itemId === itemId);
  if (!item?.claim) throw new Error(`no golden claim for ${itemId}`);
  const inboxItem = scenario.inbox.find((entry) => entry.id === itemId);
  if (!inboxItem) throw new Error(`no inbox item for ${itemId}`);
  const vendor = vendorById(item.claim.vendorId);

  return {
    itemId,
    vendorId: item.claim.vendorId,
    vendorName: vendor?.name ?? '',
    senderEmail: emailFromHeader(inboxItem.from),
    invoiceNumber: item.claim.invoiceNumber,
    issueDate: item.claim.issueDate,
    currency: item.claim.currency,
    total: item.claim.total,
    po: item.claim.po,
    requestedPayee: item.claim.requestedPayee,
    lines: item.claim.lines,
    sourceSha256: FIXED_SOURCE_SHA256,
    extractedBy: null,
  };
}

export function proposalOf(itemId: string, overrides: Partial<Claim> = {}): Proposal {
  const item = scenario.golden.items.find((entry) => entry.itemId === itemId);
  if (!item?.claim) throw new Error(`no golden claim for ${itemId}`);
  return {
    claim: { ...claimOf(itemId), ...overrides },
    agreementId: item.agreementId,
    agreementMatchedBy: item.agreementMatchedBy ?? 'po',
    rationale: 'golden fixture',
  };
}

/**
 * The change request the agent records when it sees in_04's "we moved our business account"
 * (SPEC §6.6.2 step 5). Timestamp and wording come from the scenario's inbox content.
 */
export function anaChangeRequest(): PayeeChangeRequest {
  return {
    id: 'cr_ana_2207',
    vendorId: 'ven_ana',
    requestedPayee: 'billing@studi0-north.example',
    sourceItemId: 'in_04',
    requestedAt: '2026-11-04T21:47:00Z',
    status: 'unverified',
  };
}

export function historyIntent(): IntentRecord {
  const hist = {
    id: 'hist_kenji_0142',
    vendorId: 'ven_kenji',
    invoiceNumber: 'INV-0142',
    currency: 'USD' as const,
    total: 115000,
  };
  const fp = fingerprint(hist);
  return {
    id: hist.id,
    itemId: hist.id,
    vendorId: hist.vendorId,
    agreementId: 'agr_kenji_11',
    amount: hist.total,
    currency: hist.currency,
    payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'kenji@kenjimotion.example' },
    fingerprint: fp,
    idempotencyKey: idempotencyKey(EPOCH, fp),
    state: 'proven',
    // Seeded two days before the run, so it never lands in L2's "today".
    at: '2026-11-02T09:15:00Z',
    transactionId: '7XK92134AB556677C',
  };
}

export function baseContext(): GateContext {
  return {
    vendors: structuredClone(scenario.vendors),
    agreements: structuredClone(scenario.agreements),
    deliveries: structuredClone(scenario.deliveries),
    changeRequests: [anaChangeRequest()],
    intents: [historyIntent()],
    history: [],
    policy: structuredClone(scenario.policy),
    now: scenario.testClock,
    epoch: EPOCH,
  };
}

/** Vendor the gate would resolve for this item — used by the risk test. */
export function vendorForItem(itemId: string): Vendor | null {
  const item = scenario.golden.items.find((entry) => entry.itemId === itemId);
  if (!item?.claim) return null;
  return resolveVendor(claimOf(itemId), baseContext()).vendor;
}

/** Every invoice field flattened to text, as a reader would see it on the page. */
export function invoiceTextOf(fileName: string): string {
  const invoice = inboxContent.invoices[fileName];
  if (!invoice) return '';
  return Object.entries(invoice)
    .filter(([key]) => !key.startsWith('$'))
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

export function emailBodyOf(itemId: string): string {
  return inboxContent.emails[itemId] ?? '';
}

export { scenario, inboxContent };
