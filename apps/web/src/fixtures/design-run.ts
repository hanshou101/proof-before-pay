/**
 * Design fixture — ONE hand-written payout run (SPEC §7 allows exactly this,
 * and only this: a fixture event sequence for the stage-1 design screenshots).
 *
 * Every amount, invoice number, check code and final state below is copied from
 * `demo/scenario/scenario.json` (golden.items / totalsAfterRun) so the screen
 * can be compared against the normative data line by line. PayPal ids are
 * deliberately obvious placeholders (DEMO-BATCH-…): this fixture never talks to
 * PayPal, and T8 replaces it with the real server projection.
 *
 * URL parameters understood by the app (see src/App.tsx):
 *   ?fixture=design           load this run
 *   ?fixture=design&at=<seq>  stop after event seq (0 = nothing read yet)
 *   ?fixture=design&error=paypal
 *   ?fixture=design&select=in_04
 *   ?fixture=design&drawer=in_02
 *   ?fixture=design&modal=verify
 */
import type {
  CheckId,
  CheckResult,
  CheckStatus,
  Claim,
  PbpEvent,
  PayeeChangeRequest,
  RiskFlag,
} from '../model';
import type { InboxSeedItem } from '../state/reduce';

/* ------------------------------------------------------------------ */
/* Deterministic placeholder hashes                                    */
/* ------------------------------------------------------------------ */

/** FNV-1a based 64-hex generator: stable across runs, obviously not sha256. */
function hex64(seed: string): string {
  let h = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    h ^= seed.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  let out = '';
  let state = h >>> 0;
  for (let block = 0; block < 8; block += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out += (state >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

const fileHash = (itemId: string) => hex64(`file:${itemId}`);

/* ------------------------------------------------------------------ */
/* Pre-run snapshot (what GET /api/state will return in T8)            */
/* ------------------------------------------------------------------ */

export const designSeed: InboxSeedItem[] = [
  {
    itemId: 'in_01',
    from: 'Priya Nair <priya@nairwords.example>',
    subject: 'Invoice INV-2026-118 — website copy',
    receivedAt: '2026-11-03T12:04:00Z',
    attachments: ['Nair-Words-INV-2026-118.pdf'],
    business: 'Nair Words',
  },
  {
    itemId: 'in_02',
    from: 'Kenji Watanabe <kenji@kenjimotion.example>',
    subject: 'INV-0153 — logo animation',
    receivedAt: '2026-11-04T10:15:00Z',
    attachments: ['kenji-INV-0153.pdf'],
    business: 'Kenji Motion',
  },
  {
    itemId: 'in_03',
    from: 'Kenji Watanabe <kenji@kenjimotion.example>',
    subject: 'Friendly reminder — INV-0142',
    receivedAt: '2026-11-05T08:02:00Z',
    attachments: ['kenji-INV-0142.pdf'],
    business: 'Kenji Motion',
  },
  {
    itemId: 'in_04',
    from: 'Ana Ribeiro <billing@studi0-north.example>',
    subject: 'Updated payment details + INV-2207',
    receivedAt: '2026-11-04T21:47:00Z',
    attachments: ['StudioNorth-INV-2207.pdf'],
    business: 'Studio North',
  },
  {
    itemId: 'in_05',
    from: 'Leo Martin <leo@polyform3d.example>',
    subject: 'INV-031 — Hero animation v2',
    receivedAt: '2026-11-05T19:30:00Z',
    attachments: ['Polyform3D-INV-031.pdf'],
    business: 'Polyform 3D',
  },
  {
    itemId: 'in_06',
    from: 'Sofia Rossi <sofia@linguaviva.example>',
    subject: 'Invoice 1009 — brand guidelines translation',
    receivedAt: '2026-11-05T12:30:00Z',
    attachments: [],
    business: 'LinguaViva',
  },
  {
    itemId: 'in_07',
    from: 'Jonas Berg <jonas@bergaudio.example>',
    subject: 'Invoice INV-001 — sound design',
    receivedAt: '2026-11-05T11:10:00Z',
    attachments: ['BergAudio-INV-001.pdf'],
    business: 'Berg Audio',
  },
  {
    itemId: 'in_08',
    from: 'Tomás Herrera <tomas@herreraweb.example>',
    subject: 'INV-77 — landing page milestone 2',
    receivedAt: '2026-11-04T14:00:00Z',
    attachments: ['HerreraWeb-INV-77.pdf'],
    business: 'Herrera Web',
  },
];

/* ------------------------------------------------------------------ */
/* Event builders                                                      */
/* ------------------------------------------------------------------ */

type RawEvent = { at: string; type: PbpEvent['type']; data: unknown };

const at = (second: number): string => {
  const base = Date.UTC(2026, 10, 6, 17, 30, 0);
  return new Date(base + second * 1000).toISOString();
};

const check = (
  id: CheckId,
  status: CheckStatus,
  code: string,
  facts: Record<string, string | number | boolean | null> = {},
): CheckResult => ({ id, status, code, facts });

const claim = (
  itemId: string,
  vendorId: string,
  vendorName: string,
  senderEmail: string,
  invoiceNumber: string,
  issueDate: string,
  total: number,
  po: string | null,
  requestedPayee: string,
  description: string,
  quantity: number,
  unit: 'item' | 'hour' | 'word',
  unitPrice: number,
  second: number,
): Claim => ({
  itemId,
  vendorId,
  vendorName,
  senderEmail,
  invoiceNumber,
  issueDate,
  currency: 'USD',
  total,
  po,
  requestedPayee,
  lines: [{ description, quantity, unit, unitPrice, amount: total }],
  sourceSha256: fileHash(itemId),
  extractedBy: { model: 'design-fixture', at: at(second) },
});

const PASS_CHECKS = {
  L1: (amount: number) => check('L1', 'pass', 'WITHIN_LIMIT', { amount, limit: 250000 }),
  L2: (amount: number) => check('L2', 'pass', 'WITHIN_DAILY_LIMIT', { todayTotal: amount, limit: 1000000 }),
  L3: (priorPayments: number, amount: number, code = 'VENDOR_ESTABLISHED') =>
    check('L3', 'pass', code, { priorPayments, amount, limit: 100000 }),
  P2: () => check('P2', 'pass', 'NO_CHANGE_REQUEST', { requestId: null }),
};

const p1Pass = (onFile: string, verifiedAt: string) =>
  check('P1', 'pass', 'PAYEE_VERIFIED', {
    onFile,
    requested: onFile,
    verifiedAt,
    method: 'video_call',
  });

const o1 = (vendorId: string, matchedBy: string) =>
  check('O1', 'pass', 'VENDOR_MATCHED', { vendorId, matchedBy });

const o4Pass = () => check('O4', 'pass', 'NOT_DUPLICATE', { duplicateOf: null, originalState: null });

const files = (itemId: string, name?: string) =>
  name ? [{ name, sha256: fileHash(itemId) }] : [];

/** One invoice, fully processed by the gate; returns its events in run order. */
function invoice(input: {
  itemId: string;
  second: number;
  from: string;
  subject: string;
  fileName?: string;
  claim: Claim;
  checks: CheckResult[];
  decision: 'approved' | 'held' | 'blocked';
  risk?: { flags: RiskFlag[]; note: string };
  explanation?: string;
  submit?: { batch: string; second: number };
  receipt?: {
    railStatus: string;
    proof: 'proven' | 'pending';
    transactionId: string | null;
    second: number;
  };
}): RawEvent[] {
  const { itemId, second, claim: invoiceClaim } = input;
  const events: RawEvent[] = [
    {
      at: at(second),
      type: 'item.read',
      data: { itemId, from: input.from, subject: input.subject, files: files(itemId, input.fileName) },
    },
    {
      at: at(second + 1),
      type: 'item.classified',
      data: {
        itemId,
        classification: input.risk ? 'invoice+payee_change_request' : 'invoice',
        model: 'design-fixture',
      },
    },
    { at: at(second + 1), type: 'claim.extracted', data: { itemId, claim: invoiceClaim } },
  ];

  if (input.risk) {
    events.push({
      at: at(second + 2),
      type: 'change_request.recorded',
      data: {
        id: 'chg_ana_01',
        vendorId: 'ven_ana',
        requestedPayee: 'billing@studi0-north.example',
        sourceItemId: 'in_04',
        requestedAt: '2026-11-04T21:47:00Z',
        status: 'unverified',
      } satisfies PayeeChangeRequest,
    });
    events.push({
      at: at(second + 2),
      type: 'risk.flagged',
      data: { itemId, flags: input.risk.flags, note: input.risk.note, noteSource: 'model' },
    });
  }

  const intentId = `int_${itemId}`;
  events.push({
    at: at(second + 3),
    type: 'intent.proposed',
    data: {
      intentId,
      itemId,
      vendorId: invoiceClaim.vendorId ?? '',
      agreementId: String(input.checks.find((entry) => entry.id === 'O2')?.facts.agreementId ?? ''),
      agreementMatchedBy: input.checks.find((entry) => entry.id === 'O2')?.facts.matchedBy === 'ai' ? 'ai' : 'po',
      amount: invoiceClaim.total,
      payee: {
        rail: 'paypal',
        recipientType: 'EMAIL',
        receiver: invoiceClaim.requestedPayee ?? invoiceClaim.senderEmail,
      },
      fingerprint: hex64(`fingerprint:${itemId}`),
      idempotencyKey: `pbp-${hex64(`key:${itemId}`).slice(0, 28)}`,
    },
  });
  events.push({
    at: at(second + 4),
    type: 'intent.checked',
    data: { intentId, checks: input.checks, decision: input.decision },
  });

  if (input.explanation) {
    events.push({
      at: at(second + 5),
      type: 'intent.explained',
      data: { intentId, text: input.explanation, source: 'model' },
    });
  }

  if (input.submit) {
    events.push({
      at: at(input.submit.second),
      type: 'payment.submitted',
      data: {
        intentId,
        rail: 'paypal',
        senderBatchId: input.submit.batch,
        payoutBatchId: `DEMO-PAYOUT-${itemId}`,
        attempt: 1,
      },
    });
  }

  if (input.receipt) {
    events.push({
      at: at(input.receipt.second),
      type: 'receipt.updated',
      data: {
        intentId,
        railStatus: input.receipt.railStatus,
        proof: input.receipt.proof,
        payoutItemId: `DEMO-ITEM-${itemId}`,
        transactionId: input.receipt.transactionId,
        source: 'rail_get',
        fetchedAt: at(input.receipt.second),
      },
    });
  }

  return events;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

const rawEvents: RawEvent[] = [
  {
    at: at(0),
    type: 'ledger.opened',
    data: { epoch: 'demo-epoch-01', scenario: 'lumen-lark-friday-payouts', version: '1.0.0' },
  },
  {
    at: at(1),
    type: 'history.seeded',
    data: {
      historyId: 'hist_kenji_0142',
      intentId: 'int_hist_0142',
      fingerprint: hex64('fingerprint:hist_kenji_0142'),
    },
  },
  { at: at(4), type: 'run.started', data: { runId: 'run_20261106', mode: 'proof', inboxCount: 9 } },
  {
    at: at(5),
    type: 'item.read',
    data: {
      itemId: 'in_09',
      from: 'Studio Ops <ops@lumenlark.example>',
      subject: 'Lunch & learn on Thursday?',
      files: [],
    },
  },
  {
    at: at(6),
    type: 'item.classified',
    data: { itemId: 'in_09', classification: 'other', model: 'design-fixture' },
  },

  // in_01 — Priya, paid and proven
  ...invoice({
    itemId: 'in_01',
    second: 7,
    from: 'Priya Nair <priya@nairwords.example>',
    subject: 'Invoice INV-2026-118 — website copy',
    fileName: 'Nair-Words-INV-2026-118.pdf',
    claim: claim(
      'in_01',
      'ven_priya',
      'Priya Nair',
      'priya@nairwords.example',
      'INV-2026-118',
      '2026-11-03',
      120000,
      'PO-1184',
      'priya@nairwords.example',
      'Website copy — 12 pages',
      1,
      'item',
      120000,
      9,
    ),
    checks: [
      o1('ven_priya', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_priya_03',
        po: 'PO-1184',
        kind: 'fixed',
        billed: 120000,
        expected: 120000,
        fee: 120000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_priya_03',
        deliveryTitle: 'Website copy v3 — 12 pages',
        acceptedAt: '2026-11-03T10:12:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-212 · approved',
      }),
      o4Pass(),
      p1Pass('priya@nairwords.example', '2026-01-14T16:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(120000),
      PASS_CHECKS.L2(0),
      PASS_CHECKS.L3(9, 120000),
    ],
    decision: 'approved',
    submit: { batch: 'DEMO-BATCH-0118', second: 12 },
    receipt: { railStatus: 'SUCCESS', proof: 'proven', transactionId: 'DEMO-TXN-0118', second: 17 },
  }),

  // in_02 — Kenji INV-0153, paid and proven
  ...invoice({
    itemId: 'in_02',
    second: 18,
    from: 'Kenji Watanabe <kenji@kenjimotion.example>',
    subject: 'INV-0153 — logo animation',
    fileName: 'kenji-INV-0153.pdf',
    claim: claim(
      'in_02',
      'ven_kenji',
      'Kenji Watanabe',
      'kenji@kenjimotion.example',
      'INV-0153',
      '2026-11-04',
      135000,
      'PO-1191',
      'kenji@kenjimotion.example',
      'Logo animation — 3 variants',
      1,
      'item',
      135000,
      20,
    ),
    checks: [
      o1('ven_kenji', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_kenji_12',
        po: 'PO-1191',
        kind: 'fixed',
        billed: 135000,
        expected: 135000,
        fee: 135000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_kenji_12',
        deliveryTitle: 'Logo animation — 3 variants',
        acceptedAt: '2026-11-04T09:05:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-219 · approved',
      }),
      o4Pass(),
      p1Pass('kenji@kenjimotion.example', '2026-09-20T15:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(135000),
      PASS_CHECKS.L2(120000),
      PASS_CHECKS.L3(14, 135000),
    ],
    decision: 'approved',
    submit: { batch: 'DEMO-BATCH-0153', second: 23 },
    receipt: { railStatus: 'SUCCESS', proof: 'proven', transactionId: 'DEMO-TXN-0153', second: 28 },
  }),

  // in_03 — Kenji INV-0142, blocked as a duplicate
  ...invoice({
    itemId: 'in_03',
    second: 29,
    from: 'Kenji Watanabe <kenji@kenjimotion.example>',
    subject: 'Friendly reminder — INV-0142',
    fileName: 'kenji-INV-0142.pdf',
    claim: claim(
      'in_03',
      'ven_kenji',
      'Kenji Watanabe',
      'kenji@kenjimotion.example',
      'INV-0142',
      '2026-10-28',
      115000,
      'PO-1176',
      'kenji@kenjimotion.example',
      'Storyboard animatic',
      1,
      'item',
      115000,
      31,
    ),
    checks: [
      o1('ven_kenji', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_kenji_11',
        po: 'PO-1176',
        kind: 'fixed',
        billed: 115000,
        expected: 115000,
        fee: 115000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_kenji_11',
        deliveryTitle: 'Storyboard animatic — final cut',
        acceptedAt: '2026-10-28T15:40:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-197 · approved',
      }),
      check('O4', 'fail', 'DUPLICATE', {
        duplicateOf: 'hist_kenji_0142',
        originalState: 'proven',
        transactionId: 'DEMO-TXN-0142',
        paidAt: '2026-11-04T09:05:00Z',
      }),
      p1Pass('kenji@kenjimotion.example', '2026-09-20T15:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(115000),
      PASS_CHECKS.L2(255000),
      PASS_CHECKS.L3(14, 115000),
    ],
    decision: 'blocked',
    explanation:
      'INV-0142 was paid on Nov 4 to the verified Kenji Motion address. This reminder is the same invoice, so nothing is sent.',
  }),

  // in_04 — the spoofed payee change, held for a human
  ...invoice({
    itemId: 'in_04',
    second: 35,
    from: 'Ana Ribeiro <billing@studi0-north.example>',
    subject: 'Updated payment details + INV-2207',
    fileName: 'StudioNorth-INV-2207.pdf',
    claim: claim(
      'in_04',
      'ven_ana',
      'Ana Ribeiro',
      'billing@studi0-north.example',
      'INV-2207',
      '2026-11-04',
      240000,
      'PO-1187',
      'billing@studi0-north.example',
      'Spring campaign illustrations — final 6',
      1,
      'item',
      240000,
      37,
    ),
    checks: [
      o1('ven_ana', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_ana_07',
        po: 'PO-1187',
        kind: 'fixed',
        billed: 240000,
        expected: 240000,
        fee: 240000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_ana_07',
        deliveryTitle: 'Spring campaign — final 6 illustrations',
        acceptedAt: '2026-11-02T16:30:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-205 · approved',
      }),
      o4Pass(),
      check('P1', 'hold', 'PAYEE_MISMATCH', {
        onFile: 'ana@studionorth.example',
        requested: 'billing@studi0-north.example',
        verifiedAt: '2026-03-02T17:00:00Z',
        method: 'video_call',
      }),
      check('P2', 'hold', 'CHANGE_REQUEST_PENDING', {
        requestId: 'chg_ana_01',
        requestedAt: '2026-11-04T21:47:00Z',
        sourceItemId: 'in_04',
      }),
      PASS_CHECKS.L1(240000),
      PASS_CHECKS.L2(255000),
      PASS_CHECKS.L3(6, 240000),
    ],
    decision: 'held',
    risk: {
      flags: ['SENDER_DOMAIN_MISMATCH', 'LOOKALIKE_DOMAIN', 'INSTRUCTION_TO_AI', 'URGENCY'],
      note: "The sender's domain imitates studionorth.example — a zero replaces the letter o. It urges same-day payment and tells an AI to approve it.",
    },
    explanation:
      'The requested address is not the verified payee for Ana Ribeiro, and it came from an unverified email. Verify the change by phone before anything is sent.',
  }),

  // in_05 — Leo, over the hour cap and not accepted yet
  ...invoice({
    itemId: 'in_05',
    second: 42,
    from: 'Leo Martin <leo@polyform3d.example>',
    subject: 'INV-031 — Hero animation v2',
    fileName: 'Polyform3D-INV-031.pdf',
    claim: claim(
      'in_05',
      'ven_leo',
      'Leo Martin',
      'leo@polyform3d.example',
      'INV-031',
      '2026-11-05',
      240000,
      'PO-1189',
      'leo@polyform3d.example',
      'Hero animation v2 — modelling & animation',
      40,
      'hour',
      6000,
      44,
    ),
    checks: [
      o1('ven_leo', 'sender'),
      check('O2', 'hold', 'OVER_CAP', {
        agreementId: 'agr_leo_02',
        po: 'PO-1189',
        kind: 'hourly',
        rate: 6000,
        billed: 240000,
        billedUnits: 40,
        capUnits: 32,
        cap: 192000,
      }),
      check('O3', 'hold', 'NOT_ACCEPTED', {
        deliveryId: 'del_leo_02',
        deliveryTitle: 'Hero animation v2 — render set',
        submittedAt: '2026-11-05T19:10:00Z',
        evidence: 'Project board · task LL-223 · in review',
      }),
      o4Pass(),
      p1Pass('leo@polyform3d.example', '2026-05-11T14:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(240000),
      PASS_CHECKS.L2(255000),
      PASS_CHECKS.L3(4, 240000),
    ],
    decision: 'held',
    explanation:
      'Leo billed 40 hours against a 32-hour cap, and the render set is still in review. Pay the cap or accept the delivery first.',
  }),

  // in_06 — Sofia, contract matched by AI, paid and proven
  ...invoice({
    itemId: 'in_06',
    second: 49,
    from: 'Sofia Rossi <sofia@linguaviva.example>',
    subject: 'Invoice 1009 — brand guidelines translation',
    claim: claim(
      'in_06',
      'ven_sofia',
      'Sofia Rossi',
      'sofia@linguaviva.example',
      '1009',
      '2026-11-05',
      73800,
      null,
      'sofia@linguaviva.example',
      'Translation of the Lumen & Lark brand guidelines, Italian → English',
      8200,
      'word',
      9,
      51,
    ),
    checks: [
      o1('ven_sofia', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_sofia_05',
        po: null,
        kind: 'per_word',
        rate: 9,
        billed: 73800,
        expected: 73800,
        billedUnits: 8200,
        capUnits: 9000,
        matchedBy: 'ai',
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_sofia_05',
        deliveryTitle: 'Brand guidelines — EN translation',
        acceptedAt: '2026-11-05T11:00:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-216 · approved',
      }),
      o4Pass(),
      p1Pass('sofia@linguaviva.example', '2026-02-09T10:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(73800),
      PASS_CHECKS.L2(375000),
      PASS_CHECKS.L3(7, 73800),
    ],
    decision: 'approved',
    submit: { batch: 'DEMO-BATCH-1009', second: 54 },
    receipt: { railStatus: 'SUCCESS', proof: 'proven', transactionId: 'DEMO-TXN-1009', second: 59 },
  }),

  // in_07 — Jonas, first payment, UNCLAIMED: awaiting proof
  ...invoice({
    itemId: 'in_07',
    second: 60,
    from: 'Jonas Berg <jonas@bergaudio.example>',
    subject: 'Invoice INV-001 — sound design',
    fileName: 'BergAudio-INV-001.pdf',
    claim: claim(
      'in_07',
      'ven_jonas',
      'Jonas Berg',
      'jonas@bergaudio.example',
      'INV-001',
      '2026-11-05',
      64000,
      'PO-1195',
      'jonas@bergaudio.example',
      'Sound design & mix — 60s product film',
      1,
      'item',
      64000,
      62,
    ),
    checks: [
      o1('ven_jonas', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_jonas_01',
        po: 'PO-1195',
        kind: 'fixed',
        billed: 64000,
        expected: 64000,
        fee: 64000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_jonas_01',
        deliveryTitle: 'Product film — sound design & mix',
        acceptedAt: '2026-11-05T10:30:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-220 · approved',
      }),
      o4Pass(),
      p1Pass('jonas@bergaudio.example', '2026-11-02T16:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(64000),
      PASS_CHECKS.L2(448800),
      PASS_CHECKS.L3(0, 64000, 'NEW_VENDOR_WITHIN_LIMIT'),
    ],
    decision: 'approved',
    submit: { batch: 'DEMO-BATCH-0001', second: 65 },
    receipt: { railStatus: 'UNCLAIMED', proof: 'pending', transactionId: null, second: 70 },
  }),

  // in_08 — Tomás, paid and proven
  ...invoice({
    itemId: 'in_08',
    second: 71,
    from: 'Tomás Herrera <tomas@herreraweb.example>',
    subject: 'INV-77 — landing page milestone 2',
    fileName: 'HerreraWeb-INV-77.pdf',
    claim: claim(
      'in_08',
      'ven_tomas',
      'Tomás Herrera',
      'tomas@herreraweb.example',
      'INV-77',
      '2026-11-04',
      180000,
      'PO-1193',
      'tomas@herreraweb.example',
      'Landing page build — milestone 2',
      1,
      'item',
      180000,
      73,
    ),
    checks: [
      o1('ven_tomas', 'sender'),
      check('O2', 'pass', 'AMOUNT_MATCHES', {
        agreementId: 'agr_tomas_04',
        po: 'PO-1193',
        kind: 'fixed',
        billed: 180000,
        expected: 180000,
        fee: 180000,
      }),
      check('O3', 'pass', 'DELIVERY_ACCEPTED', {
        deliveryId: 'del_tomas_04',
        deliveryTitle: 'Landing page — milestone 2 (responsive build)',
        acceptedAt: '2026-11-04T13:25:00Z',
        acceptedBy: 'Maya',
        evidence: 'Project board · task LL-218 · approved',
      }),
      o4Pass(),
      p1Pass('tomas@herreraweb.example', '2026-06-22T18:00:00Z'),
      PASS_CHECKS.P2(),
      PASS_CHECKS.L1(180000),
      PASS_CHECKS.L2(512800),
      PASS_CHECKS.L3(3, 180000),
    ],
    decision: 'approved',
    submit: { batch: 'DEMO-BATCH-0077', second: 76 },
    receipt: { railStatus: 'SUCCESS', proof: 'proven', transactionId: 'DEMO-TXN-0077', second: 81 },
  }),

  { at: at(84), type: 'run.completed', data: { runId: 'run_20261106', totals: {} } },
];

/* ------------------------------------------------------------------ */
/* Seal the chain                                                      */
/* ------------------------------------------------------------------ */

function seal(events: RawEvent[]): PbpEvent[] {
  let previous = '0'.repeat(64);
  return events.map((event, index) => {
    const seq = index + 1;
    const hash = hex64(`${seq}:${event.type}:${event.at}:${previous}`);
    const sealed = {
      seq,
      at: event.at,
      type: event.type,
      data: event.data,
      prevHash: previous,
      hash,
    } as unknown as PbpEvent;
    previous = hash;
    return sealed;
  });
}

export const designEvents: PbpEvent[] = seal(rawEvents);

/** Stop after `seq` events (0 = the pre-run inbox). */
export function eventsUpTo(events: readonly PbpEvent[], seq: number): PbpEvent[] {
  return events.filter((event) => event.seq <= seq);
}

/** The run stops when PayPal cannot be reached — nothing was sent. */
export const designErrorEvents: PbpEvent[] = seal([
  ...rawEvents.slice(0, rawEvents.findIndex((event) => event.type === 'run.started') + 1),
  ...rawEvents.slice(
    rawEvents.findIndex((event) => event.type === 'item.read' && (event.data as { itemId: string }).itemId === 'in_01'),
    rawEvents.findIndex((event) => event.type === 'intent.checked' && (event.data as { intentId: string }).intentId === 'int_in_01') + 1,
  ),
  {
    at: at(13),
    type: 'error',
    data: {
      scope: 'rail',
      message: "Couldn't reach the PayPal sandbox. Nothing was sent. Check PAYPAL_CLIENT_ID in .env, then retry.",
      detail: 'fetch failed: getaddrinfo ENOTFOUND api-m.sandbox.paypal.com',
    },
  },
]);

/** A moment mid-run that reads well in a screenshot: 6 of 8 checked, one sending. */
export const designRunningSeq = 44;
