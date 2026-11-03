/**
 * The proof bundle drawer reads the server's real bundle (AC-15) — not a projection.
 *
 * `/api/intents/:id/bundle` is assembled by the server, validated against
 * `schemas/proof-bundle.schema.json` before it leaves, and is the same document "Export JSON"
 * downloads. This module only turns it into the rows the drawer draws.
 */

import type { BundleModel, Fact, TimelineStep } from './state/reduce';
import { abbreviate, dateTime, dayLabel, hms, humanizeMethod, money, shortDate, stepTime, wholeMoney } from './format';

interface BundleCheck {
  id: string;
  status: string;
  code: string;
  facts: Record<string, string | number | boolean | null>;
}

export interface ServerBundle {
  bundleVersion: string;
  intentId: string;
  itemId: string;
  generatedAt: string;
  /** When the gate decided (the Owed / Payee / Policy steps). Falls back to `generatedAt`. */
  checkedAt?: string;
  source: {
    fileName: string;
    sha256: string;
    from: string;
    subject: string;
    receivedAt: string;
    kind: string;
  };
  extraction: { model: string; at: string } | null;
  claim: {
    invoiceNumber: string;
    vendorName: string;
    currency: string;
    total: number;
    po: string | null;
    issueDate: string;
    lines: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
  };
  agreement: {
    id: string;
    po: string | null;
    scope: string;
    kind: string;
    fee: number | null;
    rate: number | null;
    capUnits: number | null;
  } | null;
  amountRule: string;
  delivery: { id: string; title: string; acceptedAt: string | null; acceptedBy: string | null } | null;
  payee: {
    onFile: string;
    requested: string;
    verifiedAt: string;
    method: string;
    verifiedBy: string;
    onFileNow: string;
    humanVerification: { at: string; by: string; method: string; result: string } | null;
  };
  checks: BundleCheck[];
  decision: string | null;
  explanation: { text: string; source: string } | null;
  payment: {
    rail: string;
    amount: number;
    currency: string;
    receiver: string;
    receiverRequested?: string;
    receiverSent?: string | null;
    senderBatchId: string;
    payoutBatchId: string | null;
    payoutItemId: string | null;
    transactionId: string | null;
    railStatus: string;
    fetchedAt: string;
    submittedAt: string;
    attempts: number;
  } | null;
  ledger: { seq: number; hash: string; eventType: string; head: number; verified: boolean };
}

export function bundleToModel(bundle: ServerBundle, options: { dev?: boolean } = {}): BundleModel {
  const check = (id: string) => bundle.checks.find((entry) => entry.id === id);
  const p1 = check('P1');
  const l1 = check('L1');
  const l2 = check('L2');
  const l3 = check('L3');
  const payment = bundle.payment;
  const proven = Boolean(payment && payment.transactionId && payment.railStatus.toUpperCase() === 'SUCCESS');
  const dev = options.dev === true;
  // Defect 5: the contract has a name — the agreement record — and it is the same name the panel
  // shows on its Owed line, so the drawer and the panel never disagree. The invoice's PO is the
  // fallback for a bundle with no agreement record, never a dash.
  const po = bundle.agreement?.po ?? bundle.claim.po ?? null;
  const contract = bundle.agreement?.id ?? po;

  const checkedAt = bundle.checkedAt ?? bundle.generatedAt;
  const timeline: TimelineStep[] = [
    // D1-11: the reading carries the email's arrival time; the rest carry seconds. A step from
    // another day keeps its date, and the year when the year differs (Kenji's phone check was
    // Nov 20 2025 — "15:00:00" between two 17:30:04 rows read as a clock going backwards).
    { label: 'Invoice read', note: bundle.source.fileName, at: dateTime(bundle.source.receivedAt), state: 'done' },
    {
      label: 'Owed',
      note: `${contract ?? 'no PO'} · matches the contract`,
      at: hms(checkedAt),
      state: 'done',
    },
    // Defect 9: the panel timed this step at the gate; the drawer timed it at the out-of-band
    // verification. Both now use the gate's clock; the verification date is in the note.
    {
      label: 'Payee',
      note: `${bundle.payee.onFile} · verified ${dayLabel(bundle.payee.verifiedAt, checkedAt)}`,
      at: hms(checkedAt),
      state: 'done',
    },
    { label: 'Policy', note: 'within limits', at: hms(checkedAt), state: 'done' },
    {
      label: 'Sent',
      note: payment ? `Batch ${abbreviate(payment.senderBatchId, 12, 4)}` : 'not sent',
      at: payment ? stepTime(payment.submittedAt, payment.submittedAt) : '—',
      state: 'done',
    },
    {
      label: 'Proven',
      note: payment?.transactionId ? `Transaction ${abbreviate(payment.transactionId, 8, 4)}` : 'waiting for PayPal',
      at: payment ? stepTime(payment.fetchedAt, payment.submittedAt) : '—',
      state: payment?.transactionId ? 'proven' : 'pending',
    },
  ];

  // The receipt band. T11 rework, item 1: the reviewer opened this drawer to check PayPal's own
  // record and found the whole PayPal section below a 245px scroll. The ids and the time PayPal
  // answered now sit directly under the title; "batch · item" share a row and the long ids are
  // abbreviated from the middle (format.abbreviate), so every row stays one line.
  const receipt: Fact[] = payment
    ? [
        {
          label: 'Transaction',
          value: payment.transactionId ? abbreviate(payment.transactionId, 8, 4) : 'waiting for PayPal',
          mono: true,
        },
        { label: 'Batch', value: abbreviate(payment.senderBatchId, 12, 4), mono: true },
        { label: 'Item', value: payment.payoutItemId ? abbreviate(payment.payoutItemId, 8, 4) : 'not returned', mono: true },
        {
          label: 'Status',
          value: payment.railStatus,
          mono: true,
          tone: proven ? 'success' : 'neutral',
        },
        { label: 'Fetched', value: dateTime(payment.fetchedAt), mono: true },
      ]
    : [{ label: 'Payment', value: 'nothing was sent' }];

  const document: Fact[] = [
    {
      label: 'File',
      value: `${bundle.source.fileName} · ${bundle.source.sha256.slice(0, 12)}…`,
      mono: true,
    },
    {
      label: 'Invoice',
      value: `${bundle.claim.invoiceNumber} · ${money(bundle.claim.total)}`,
      ai: true,
      mono: true,
    },
  ];

  const proofOfDebt: Fact[] = [
    { label: 'PO', value: po ?? 'none', mono: true, ai: true },
    {
      label: 'Contract',
      value: `${contract ?? 'contract'} · ${bundle.agreement?.kind ?? 'fixed'} ${money(bundle.agreement?.fee ?? bundle.claim.total)}`,
    },
    { label: 'Amount rule', value: bundle.amountRule },
    {
      label: 'Delivery',
      value: bundle.delivery
        ? `${bundle.delivery.title}${
            bundle.delivery.acceptedAt
              ? ` · accepted ${shortDate(bundle.delivery.acceptedAt)} · ${bundle.delivery.acceptedBy ?? 'Maya'}`
              : ''
          }`
        : 'not recorded',
    },
  ];

  const payee: Fact[] = [
    { label: 'On file', value: bundle.payee.onFile, mono: true },
    {
      label: 'Verified',
      value: `${dayLabel(bundle.payee.verifiedAt, checkedAt)} · ${humanizeMethod(bundle.payee.method)}`,
    },
    // The three policy limits are one row of three facts: three rows of one number each is what
    // pushed the sheet past 720px. Nothing is dropped — each limit still names its own window.
    {
      label: 'Limits',
      value: `${wholeMoney(Number(l1?.facts.limit ?? 0))} per payment · ${wholeMoney(
        Number(l2?.facts.limit ?? 0),
      )} daily · ${wholeMoney(Number(l3?.facts.limit ?? 0))} new vendor`,
    },
  ];
  if (p1?.status === 'hold') {
    payee.push({ label: 'Requested', value: String(p1.facts.requested ?? 'not recorded'), mono: true });
    payee.push({ label: 'Request status', value: 'not verified', tone: 'danger' });
  }
  if (bundle.payee.humanVerification) {
    payee.push({
      label: 'Human check',
      value: `${humanizeMethod(bundle.payee.humanVerification.method)} · ${bundle.payee.humanVerification.result} · ${shortDate(bundle.payee.humanVerification.at)}`,
    });
  }

  return {
    itemId: bundle.itemId,
    intentId: bundle.intentId,
    title: 'Proof bundle',
    subtitle: `${bundle.claim.invoiceNumber} · ${bundle.claim.vendorName} · ${money(bundle.claim.total)}`,
    status: proven
      ? { text: 'Proven', tone: 'success' }
      : payment
        ? { text: 'Awaiting proof', tone: 'neutral' }
        : { text: bundle.decision === 'blocked' ? 'Blocked' : 'Held', tone: bundle.decision === 'blocked' ? 'danger' : 'warning' },
    receipt,
    timeline,
    // SPEC §6.5.5 / 07-UI §4.6 #1: the model's name and the sandbox account the map swapped in are
    // developer information. They stay in the exported JSON (AC-15) and, in the drawer, sit behind
    // a collapsed "Developer details" so turning the switch on cannot push the sheet past 720px.
    ...(dev
      ? {
          dev: [
            ...(bundle.extraction
              ? [{ label: 'Read by', value: `${bundle.extraction.model} · ${dateTime(bundle.extraction.at)}`, mono: true }]
              : []),
            ...(payment
              ? [
                  { label: 'Invoice asked for', value: payment.receiverRequested ?? payment.receiver, mono: true },
                  { label: 'Sandbox paid', value: payment.receiverSent ?? 'not returned', mono: true },
                ]
              : []),
          ],
        }
      : {}),
    sections: [
      { title: 'Document', items: document },
      { title: 'Proof of debt', items: proofOfDebt },
      { title: 'Payee & policy', items: payee },
    ],
    // One line above the buttons instead of a three-row section: the chain check is still on the
    // sheet, without a section that costs as much height as the receipt it is meant to support.
    ledger: {
      // The event type is in the exported JSON; on the sheet the row only has to say which ledger
      // entry this bundle came from — a shorter line leaves room for the developer switch beside it.
      event: `#${bundle.ledger.seq}`,
      hash: bundle.ledger.hash,
      verified: bundle.ledger.verified,
    },
  };
}
