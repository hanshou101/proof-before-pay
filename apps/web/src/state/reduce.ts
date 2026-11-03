/**
 * Projection: ledger events in, screen state out.
 *
 * `reduce(events, seed)` is a pure function (SPEC §6.8: the UI never decides
 * business outcomes). Stage 3 replaces the design fixture with the server
 * projection and keeps this module: the server sends the same `LedgerEvent`
 * sequence over SSE, the app replays it and renders.
 *
 * The seed is the pre-run snapshot the server already has (this week's inbox
 * rows plus their vendor-directory entry); GET /api/state returns the same
 * shape in T8.
 */
import type {
  CheckId,
  CheckResult,
  Claim,
  Cents,
  Decision,
  PayeeChangeRequest,
  PbpEvent,
  ReceiptUpdatedData,
  RiskFlag,
} from '../model';
import { abbreviate, dateTime, dayLabel, hms, humanizeMethod, initials, money, shortDate, stepTime, wholeMoney } from '../format';

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

export type StampState =
  | 'pending' // circle-dashed, muted
  | 'checking' // loader-circle, muted, spinning
  | 'pass' // circle-check, success
  | 'hold' // circle-alert, warning
  | 'fail' // circle-x, danger
  | 'na' // minus, border
  | 'proven' // badge-check, success
  | 'awaiting'; // hourglass, muted

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface Stamps {
  owed: StampState;
  payee: StampState;
  policy: StampState;
  paypal: StampState;
}

export interface ViewRow {
  itemId: string;
  intentId: string | null;
  name: string;
  business: string;
  initials: string;
  senderEmail: string;
  invoiceNumber: string;
  /** What the invoice asks for. */
  amount: Cents | null;
  /**
   * What actually left, when a human approved less than the invoice (SPEC §6.2.2). The row, the
   * panel and the totals all show this number; the invoice amount stays next to it so the
   * difference is on screen instead of being hidden behind the invoice total (defect 8).
   */
  paid: Cents | null;
  stamps: Stamps;
  status: string;
  tone: Tone;
}

export interface KpiCell {
  label: string;
  amount: Cents | null;
  sub: string;
  tone: Tone;
  dot: 'solid' | 'hollow';
}

export interface Fact {
  label: string;
  value: string;
  mono?: boolean;
  ai?: boolean;
  tone?: Tone;
  /** A stamp drawn before the label (07-UI §4.2 icons), e.g. what the gate checks on an empty run. */
  stamp?: StampState;
}

export interface WhyItem {
  text: string;
  tone: 'warning' | 'danger';
}

export interface TimelineStep {
  label: string;
  note: string;
  at: string;
  /** D1-8: how far this step got — checked, the PayPal proof, or still to come. */
  state?: 'done' | 'proven' | 'pending';
}

export type DetailSection =
  | { kind: 'payee'; onFile: { email: string; note: string }; requested: { email: string; note: string } }
  | { kind: 'note'; text: string; ai: boolean }
  | { kind: 'why'; title: string; items: WhyItem[] }
  | { kind: 'timeline'; items: TimelineStep[] }
  | { kind: 'facts'; title: string | null; items: Fact[] }
  | { kind: 'message'; text: string }
  | { kind: 'callout'; title: string; text: string }
  | { kind: 'legend'; title: string; items: { stamp: StampState; label: string }[] };

export interface DetailAction {
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  hint?: string;
  icon?: 'phone' | 'doc' | 'refresh' | 'chevron' | 'shield';
}

export interface DetailModel {
  kind: 'empty' | 'checking' | 'approved' | 'submitted' | 'held' | 'blocked' | 'proven' | 'awaiting' | 'failed';
  status: { text: string; tone: Tone } | null;
  title: string;
  subtitle: string | null;
  sections: DetailSection[];
  actions: DetailAction[];
  footer: string | null;
  /** Which delivery `accept_delivery` refers to (O3's fact). The panel never shows it. */
  deliveryId?: string | null;
}

export interface BundleModel {
  itemId: string;
  intentId: string;
  title: string;
  subtitle: string;
  status: { text: string; tone: Tone };
  /**
   * The PayPal receipt, drawn as the band under the title. It is the one piece of evidence the
   * drawer exists for (尺子 w04: 付款證明是看得見的一欄，不是腳註), so it is not one of the
   * sections at the bottom of the sheet.
   */
  receipt: Fact[];
  timeline: TimelineStep[];
  sections: { title: string; items: Fact[] }[];
  /**
   * Developer-only facts (the model's name, the sandbox account the map swapped in). 07-UI §4.6
   * keeps developer information behind the switch and, in the panel, behind a collapsed
   * "Raw events" — the drawer does the same so opening the switch cannot push the sheet past 720px.
   */
  dev?: Fact[];
  /** The ledger row the bundle was built from — one line above the buttons, not a section. */
  ledger: { event: string; hash: string; verified: boolean } | null;
}

export interface ViewState {
  phase: 'idle' | 'running' | 'done' | 'error';
  button: { label: string; disabled: boolean };
  progress: { done: number; total: number } | null;
  error: { message: string; action: string } | null;
  kpis: KpiCell[];
  rows: ViewRow[];
  selected: string | null;
  details: Record<string, DetailModel>;
  bundles: Record<string, BundleModel>;
  ignoredCount: number;
  /**
   * Emails a stopped run never got to (defect 2's other half): the card lists them with
   * "Not checked" instead of pretending the run saw the whole inbox or leaving a hole.
   */
  unchecked: { itemId: string; name: string; subject: string }[];
  eventCount: number;
  ledgerVerified: boolean;
  /**
   * The inbox before a run: the list header and the empty panel read these same two numbers
   * (T11 rework: the header said "9 emails · 8 senders" while the panel said "9 documents from
   * 7 freelancers", and the footer said "1 events").
   */
  inbox: { emails: number; senders: number };
  /**
   * Human sentences the ledger wrote about one intent — a refused cancel, an unreachable
   * receipt. They are shown on that row (SPEC v1.7 §6.3.3: the row says why, and never says
   * "Cancelled" when PayPal did not cancel it).
   */
  notices: Record<string, string>;
}

/** The empty detail a fresh page shows before anything has been read. */
export const EMPTY_DETAIL: DetailModel = {
  kind: 'empty',
  status: null,
  title: "Nothing is paid until it's proven.",
  subtitle: null,
  sections: [
    { kind: 'message', text: 'Nothing has been read yet.' },
    {
      kind: 'facts',
      title: 'What the gate checks',
      items: [
        { label: 'Owed', value: 'a contract and an accepted delivery', stamp: 'pending' },
        { label: 'Payee', value: 'the address verified out of band', stamp: 'pending' },
        { label: 'Policy', value: 'per-payment, daily and vendor limits', stamp: 'pending' },
        { label: 'PayPal', value: 'a receipt that says SUCCESS', stamp: 'awaiting' },
      ],
    },
    // D1-2: the empty panel was two thirds white card at 1440. The four stamps say what a row
    // has to earn, in the order it earns it, without inventing data.
    {
      kind: 'legend',
      title: 'How a row turns green',
      items: [
        { stamp: 'pending', label: 'Not checked' },
        { stamp: 'checking', label: 'Checking' },
        { stamp: 'pass', label: 'Passed' },
        { stamp: 'proven', label: 'Proven' },
      ],
    },
  ],
  // The header keeps the screen's single accent button (07-UI §1: one accent,
  // for the most important action); the panel repeats the same action quietly.
  actions: [{ label: 'Run Friday payouts', kind: 'secondary' }],
  footer: null,
};

/**
 * The empty panel for an inbox of this size. The list header above it and this sentence read
 * the same two numbers, so the panel can never say "9 documents from 7 freelancers" beside a
 * header that says "9 emails · 8 senders" (T11 rework, item 2).
 */
export function emptyDetailFor(emails: number, senders: number): DetailModel {
  return {
    ...EMPTY_DETAIL,
    sections: [
      { kind: 'message', text: `${count(emails, 'email')} from ${count(senders, 'sender')} arrived this week.` },
      ...EMPTY_DETAIL.sections.slice(1),
    ],
  };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * What the server already knows before a run starts: the inbox rows of this
 * week's invoices plus their vendor directory entry.
 */
export interface InboxSeedItem {
  itemId: string;
  from: string;
  subject: string;
  receivedAt: string;
  attachments: string[];
  business?: string;
}

/* ------------------------------------------------------------------ */
/* Internal projection state                                           */
/* ------------------------------------------------------------------ */

type IntentPhase =
  | 'proposed'
  | 'approved'
  | 'held'
  | 'blocked'
  | 'submitted'
  | 'awaiting'
  | 'proven'
  | 'failed'
  | 'cancelled'
  | 'rejected';

interface ItemState {
  itemId: string;
  from: string;
  subject: string;
  receivedAt: string;
  readAt?: string;
  files: { name: string; sha256: string }[];
  business?: string;
  classification?: string;
  claim?: Claim;
  risk?: { flags: RiskFlag[]; note: string | null; source: 'model' | 'none' };
  changeRequest?: PayeeChangeRequest;
  intentId?: string;
}

interface IntentState {
  intentId: string;
  itemId: string;
  vendorId: string;
  agreementId: string | null;
  amount: Cents;
  /**
   * What a human approved, when lower than the invoice (`packages/core/src/ledger.ts` keeps the
   * same field). The KPI band and every total use `approvedAmount ?? amount` — the screen and the
   * server must add up to the same number (SPEC §5 AC-12, 2:00–2:20 reads "$7,008.00").
   */
  approvedAmount: Cents | null;
  fingerprint: string;
  idempotencyKey: string;
  phase: IntentPhase;
  checks?: CheckResult[];
  decision?: Decision;
  checkedAt?: string;
  explanation?: { text: string; source: 'model' | 'template' };
  submitted?: { senderBatchId: string; payoutBatchId: string | null; attempt: number; at: string };
  receipt?: ReceiptUpdatedData;
}

interface Draft {
  items: Map<string, ItemState>;
  order: string[];
  intents: Map<string, IntentState>;
  /**
   * `history.seeded` rows by `historyId` — the payments this environment already proved before
   * the run (SPEC §6.2.2 O4: "歷史紀錄算 proven"). O4 points at one of them by id, so this is
   * where the date of the original payment lives; it is not copied into O4's facts.
   */
  history: Map<string, { at: string }>;
  /** How many emails the run said it would read (`run.started.inboxCount`) — the only honest
   *  denominator while the model has not said which emails are invoices yet. */
  inboxCount: number;
  phase: 'idle' | 'running' | 'done' | 'error';
  error: { message: string } | null;
  started: boolean;
  lastEventByItem: Map<string, { seq: number; hash: string }>;
  notices: Map<string, string>;
}

/* ------------------------------------------------------------------ */
/* reduce                                                              */
/* ------------------------------------------------------------------ */

const CHECK_GROUPS = {
  owed: ['O1', 'O2', 'O3', 'O4'],
  payee: ['P1', 'P2'],
  policy: ['L1', 'L2', 'L3'],
} as const satisfies Record<string, readonly CheckId[]>;

export interface ReduceOptions {
  /**
   * The server's vendor directory (`/api/state.vendors`), by id. The row shows the name on file,
   * not whatever the model wrote into `claim.vendorName` — the gate already decided which vendor
   * this is (O1), and the screen should agree with the gate.
   */
  vendors?: Record<string, { name: string; business: string }>;
}

export function reduce(
  events: readonly PbpEvent[],
  seed: readonly InboxSeedItem[] = [],
  options: ReduceOptions = {},
): ViewState {
  const draft: Draft = {
    items: new Map(),
    order: [],
    intents: new Map(),
    history: new Map(),
    inboxCount: 0,
    phase: 'idle',
    error: null,
    started: false,
    lastEventByItem: new Map(),
    notices: new Map(),
  };

  for (const item of seed) {
    draft.items.set(item.itemId, {
      itemId: item.itemId,
      from: item.from,
      subject: item.subject,
      receivedAt: item.receivedAt,
      files: item.attachments.map((name) => ({ name, sha256: '' })),
      business: item.business,
    });
    draft.order.push(item.itemId);
  }

  for (const event of events) applyEvent(draft, event);

  const rows = buildRows(draft, options.vendors ?? {});
  const details: Record<string, DetailModel> = {};
  const bundles: Record<string, BundleModel> = {};
  for (const row of rows) {
    const item = draft.items.get(row.itemId);
    const intent = row.intentId ? draft.intents.get(row.intentId) : undefined;
    details[row.itemId] = buildDetail(draft, row, intent, item);
    const bundle = buildBundle(draft, intent, item);
    if (bundle) bundles[row.itemId] = bundle;
  }

  const selected = draft.started ? (rows[0]?.itemId ?? null) : null;
  const done = rows.filter((row) => {
    const intent = row.intentId ? draft.intents.get(row.intentId) : undefined;
    return Boolean(intent?.decision);
  }).length;

  return {
    phase: draft.phase,
    button: buildButton(draft, rows),
    progress: draft.started ? { done, total: Math.max(draft.inboxCount, rows.length) } : null,
    error: draft.error ? { message: draft.error.message, action: 'Retry' } : null,
    kpis: buildKpis(rows, draft),
    rows,
    selected,
    details,
    bundles,
    ignoredCount: [...draft.items.values()].filter((item) => item.classification === 'other').length,
    unchecked:
      draft.phase === 'error'
        ? [...draft.items.values()]
            .filter((item) => !item.intentId && item.classification !== 'other')
            .map((item) => ({
              itemId: item.itemId,
              name: parseFrom(item.from).name,
              subject: item.subject,
            }))
        : [],
    eventCount: events.length,
    ledgerVerified: verifyChain(events),
    inbox: inboxCounts(draft),
    notices: Object.fromEntries(draft.notices),
  };
}

export function detailOf(state: ViewState, itemId: string | null): DetailModel {
  // With no row selected the panel still counts the inbox: the same sentence a row's panel
  // shows, never a second set of numbers (T11 rework, item 2).
  if (!itemId) return emptyDetailFor(state.inbox.emails, state.inbox.senders);
  return state.details[itemId] ?? emptyDetailFor(state.inbox.emails, state.inbox.senders);
}

export function bundleOf(state: ViewState, itemId: string | null): BundleModel | null {
  if (!itemId) return null;
  return state.bundles[itemId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Fold                                                                */
/* ------------------------------------------------------------------ */

function applyEvent(draft: Draft, event: PbpEvent): void {
  switch (event.type) {
    case 'history.seeded': {
      // A payment that was already proven before this environment existed. O4 reports its id
      // (`duplicateOf`), never its date; the date is this row's `at`.
      draft.history.set(event.data.historyId, { at: event.at });
      return;
    }
    case 'run.started': {
      draft.started = true;
      draft.phase = 'running';
      draft.inboxCount = Number(event.data.inboxCount ?? 0);
      // A retry after a screen-level failure starts clean: the banner belongs to the run that
      // failed, not to the one that is running now.
      draft.error = null;
      return;
    }
    case 'item.read': {
      const existing = draft.items.get(event.data.itemId);
      if (existing) {
        existing.from = event.data.from;
        existing.subject = event.data.subject;
        existing.files = event.data.files;
        existing.readAt = event.at;
      } else {
        draft.items.set(event.data.itemId, {
          itemId: event.data.itemId,
          from: event.data.from,
          subject: event.data.subject,
          receivedAt: event.at,
          readAt: event.at,
          files: event.data.files,
        });
        draft.order.push(event.data.itemId);
      }
      touch(draft, event.data.itemId, event);
      return;
    }
    case 'item.classified': {
      const item = draft.items.get(event.data.itemId);
      if (item) item.classification = event.data.classification;
      touch(draft, event.data.itemId, event);
      return;
    }
    case 'claim.extracted': {
      const item = draft.items.get(event.data.itemId);
      if (item) item.claim = event.data.claim;
      touch(draft, event.data.itemId, event);
      return;
    }
    case 'change_request.recorded': {
      const item = draft.items.get(event.data.sourceItemId);
      if (item) item.changeRequest = event.data;
      touch(draft, event.data.sourceItemId, event);
      return;
    }
    case 'risk.flagged': {
      const item = draft.items.get(event.data.itemId);
      if (item) {
        item.risk = {
          flags: event.data.flags,
          note: event.data.note,
          // Only a note the model wrote may be badged "AI"; the deterministic fallback is not.
          source: event.data.noteSource === 'model' ? 'model' : 'none',
        };
      }
      touch(draft, event.data.itemId, event);
      return;
    }
    case 'intent.proposed': {
      const intent: IntentState = {
        intentId: event.data.intentId,
        itemId: event.data.itemId,
        vendorId: event.data.vendorId,
        agreementId: event.data.agreementId,
        amount: event.data.amount,
        approvedAmount: null,
        fingerprint: event.data.fingerprint,
        idempotencyKey: event.data.idempotencyKey,
        phase: 'proposed',
      };
      draft.intents.set(intent.intentId, intent);
      const item = draft.items.get(event.data.itemId);
      if (item) item.intentId = intent.intentId;
      touch(draft, event.data.itemId, event);
      return;
    }
    case 'intent.checked': {
      const intent = draft.intents.get(event.data.intentId);
      if (!intent) return;
      intent.checks = event.data.checks;
      intent.decision = event.data.decision;
      intent.checkedAt = event.at;
      intent.phase = event.data.decision;
      // A re-check replaces the previous reasoning: prose written about the old decision must
      // never stay on screen as if it described this one.
      intent.explanation = undefined;
      touch(draft, intent.itemId, event);
      return;
    }
    case 'intent.explained': {
      const intent = draft.intents.get(event.data.intentId);
      if (!intent) return;
      // An explanation is only current while the gate still holds or blocks. When it lands after
      // a human action (or after the row went forward), it describes a state that no longer
      // exists — don't paint it.
      if (intent.phase !== 'held' && intent.phase !== 'blocked') return;
      intent.explanation = { text: event.data.text, source: event.data.source };
      touch(draft, intent.itemId, event);
      return;
    }
    case 'payment.submitted': {
      const intent = draft.intents.get(event.data.intentId);
      if (!intent) return;
      intent.phase = 'submitted';
      intent.submitted = {
        senderBatchId: event.data.senderBatchId,
        payoutBatchId: event.data.payoutBatchId,
        attempt: event.data.attempt,
        at: event.at,
      };
      // The row moved on: the "PayPal did not answer, we will retry" note was about the attempt
      // before this one (T8 round 3, item 1).
      draft.notices.delete(event.data.intentId);
      touch(draft, intent.itemId, event);
      return;
    }
    case 'receipt.updated': {
      const intent = draft.intents.get(event.data.intentId);
      if (!intent) return;
      intent.receipt = event.data;
      intent.phase =
        event.data.proof === 'proven'
          ? 'proven'
          : event.data.proof === 'pending'
            ? 'awaiting'
            : event.data.proof === 'failed'
              ? 'failed'
              : 'cancelled';
      // PayPal has answered, so any earlier "we could not reach it" note is out of date. A refused
      // cancel is the exception: that row is still the reason PayPal said nothing changed.
      if (event.data.proof === 'proven') draft.notices.delete(event.data.intentId);
      touch(draft, intent.itemId, event);
      return;
    }
    case 'human.action': {
      const intent = draft.intents.get(event.data.intentId);
      if (!intent) return;
      const action = event.data.action;
      const input = (event.data.input ?? {}) as { result?: string | null; amount?: number };
      if (action === 'reject' || action === 'mark_fraud') intent.phase = 'rejected';
      // SPEC §6.3.3: only a *confirmed* verification sends the intent back through the gate. A
      // "not confirmed" call changes nothing — it must not make the row look like it is checking.
      if (action === 'verify_payee') {
        if (intent.phase === 'held' && input.result === 'confirmed') intent.phase = 'proposed';
      } else if (action === 'accept_delivery' || action === 'approve') {
        if (intent.phase === 'held') intent.phase = 'proposed';
      }
      // SPEC §6.2.2: a human may approve less than the invoice; the money that leaves — and every
      // total on screen — is that approved amount (`packages/core/src/ledger.ts` does the same).
      if (action === 'approve' && typeof input.amount === 'number') {
        intent.approvedAmount = input.amount;
      }
      // The gate's prose was written about the state before this action.
      intent.explanation = undefined;
      // `cancel_payout` never moves the state by itself (SPEC v1.7 §6.3.3): the receipt does.
      // Painting it "cancelled" here is exactly the lie the sandbox refusal exposed.
      touch(draft, intent.itemId, event);
      return;
    }
    case 'run.completed': {
      // A run that hit a screen-level error keeps showing the banner: the totals are real, but
      // "everything is fine" is not.
      if (draft.phase !== 'error') draft.phase = 'done';
      return;
    }
    case 'error': {
      // Not every `error` event is a screen-level failure: a refused cancel, a receipt we could
      // not read, or one payout PayPal would not take belongs to one row and must not blank the
      // whole run (SPEC v1.7 §6.3.3; T8 round 3, item 1). The runner writes those with a
      // `<kind>:<intentId>` scope — including `payment.submit:<intentId>`, which used to fall
      // through to the screen banner and left a finished run looking broken.
      // A run that stopped, lost PayPal's credentials, or could not be summarised does belong to
      // the screen.
      const scope = event.data.scope ?? '';
      const rowScoped = /^(cancel|receipt|submit|payment\.submit|item|explain|comparison):/.test(scope);
      if (rowScoped) {
        const intentId = scope.slice(scope.indexOf(':') + 1);
        draft.notices.set(intentId, event.data.message);
        return;
      }
      draft.phase = 'error';
      draft.error = { message: event.data.message };
      return;
    }
    default:
      return;
  }
}

function touch(draft: Draft, itemId: string, event: PbpEvent): void {
  draft.lastEventByItem.set(itemId, { seq: event.seq, hash: event.hash });
}

/* ------------------------------------------------------------------ */
/* Rows, stamps, status                                                */
/* ------------------------------------------------------------------ */

function buildRows(draft: Draft, vendors: Record<string, { name: string; business: string }>): ViewRow[] {
  const rows: ViewRow[] = [];
  for (const itemId of draft.order) {
    const item = draft.items.get(itemId);
    if (!item) continue;
    if (item.classification === 'other') continue;
    const intent = item.intentId ? draft.intents.get(item.intentId) : undefined;
    // Defect 2: an email that has only been *read* is not an invoice yet. Listing it made the
    // run show nine rows ("Studio Ops · Ready") and a title that counted nine invoices, then
    // eight when the model said "not an invoice". Once a run has started a row exists only when
    // the run has put the email in — the list grows with the run instead of lying and shrinking.
    // Before the run the card is the inbox (every email, all "Ready"), which is the state the
    // screenshot harness clicks "Run" on.
    const classified = item.classification === 'invoice' || item.classification === 'invoice+payee_change_request';
    if (draft.started && !intent && !classified) continue;
    const claim = item.claim;
    const vendorId = intent?.vendorId ?? claim?.vendorId ?? null;
    const vendor = vendorId ? vendors[vendorId] : undefined;
    const name = vendor?.name ?? claim?.vendorName ?? parseFrom(item.from).name;
    const status = statusOf(intent, draft.phase);
    rows.push({
      itemId,
      intentId: intent?.intentId ?? null,
      name,
      business: vendor?.business ?? item.business ?? '',
      initials: initials(name),
      senderEmail: claim?.senderEmail ?? parseFrom(item.from).email,
      invoiceNumber: claim?.invoiceNumber ?? invoiceHint(item.subject),
      amount: claim?.total ?? null,
      paid: intent?.approvedAmount ?? null,
      stamps: stampsOf(intent, draft.phase),
      status: status.text,
      tone: status.tone,
    });
  }
  return rows;
}

function stampsOf(intent: IntentState | undefined, runPhase: 'idle' | 'running' | 'done' | 'error'): Stamps {
  if (!intent) return { owed: 'pending', payee: 'pending', policy: 'pending', paypal: 'pending' };
  if (!intent.checks) return { owed: 'checking', payee: 'pending', policy: 'pending', paypal: 'pending' };
  return {
    owed: groupStamp(intent.checks, CHECK_GROUPS.owed),
    payee: groupStamp(intent.checks, CHECK_GROUPS.payee),
    policy: groupStamp(intent.checks, CHECK_GROUPS.policy),
    paypal: paypalStamp(intent, runPhase),
  };
}

function groupStamp(checks: CheckResult[], ids: readonly CheckId[]): StampState {
  const group = checks.filter((check) => ids.includes(check.id));
  if (group.length === 0) return 'na';
  if (group.some((check) => check.status === 'fail')) return 'fail';
  if (group.some((check) => check.status === 'hold')) return 'hold';
  if (group.every((check) => check.status === 'na')) return 'na';
  return 'pass';
}

function paypalStamp(intent: IntentState, runPhase: 'idle' | 'running' | 'done' | 'error'): StampState {
  switch (intent.phase) {
    case 'proven':
      return 'proven';
    case 'awaiting':
      return 'awaiting';
    case 'submitted':
      // Nothing left when the rail refused our credentials: the stamp stays "checked, waiting",
      // not "spinning" (same reason as `statusOf`).
      return runPhase === 'error' && intent.submitted?.payoutBatchId === null ? 'pending' : 'checking';
    case 'failed':
    case 'cancelled':
      return 'fail';
    case 'held':
    case 'blocked':
    case 'rejected':
      return 'na';
    default:
      return 'pending';
  }
}

function statusOf(
  intent: IntentState | undefined,
  runPhase: 'idle' | 'running' | 'done' | 'error' = 'running',
): { text: string; tone: Tone } {
  if (!intent) return { text: 'Ready', tone: 'neutral' };
  switch (intent.phase) {
    case 'proposed':
      return { text: 'Checking…', tone: 'progress' };
    case 'approved':
      // D1-13: when the run has stopped on an error, an approved row that never left is not
      // "Sending" — the banner above says "Nothing was sent", and the row has to agree.
      return runPhase === 'error'
        ? { text: 'Not sent', tone: 'neutral' }
        : { text: 'Sending to PayPal…', tone: 'progress' };
    case 'submitted':
      // The ledger writes `payment.submitted` *before* the rail call (a crash must never move
      // money without a trace). When that call was refused — bad credentials — no batch id ever
      // came back, nothing left, and the row must not say "Awaiting PayPal…" under a banner
      // that says "Nothing was sent" (T8 round 3, item 1).
      if (runPhase === 'error' && intent.submitted?.payoutBatchId === null) {
        return { text: 'Not sent', tone: 'neutral' };
      }
      // 07-UI §4.2 copy, kept verbatim: the status column is wide enough for this chip with its
      // spinner (152px), so the pill never ends in an ellipsis.
      return { text: 'Awaiting PayPal…', tone: 'progress' };
    case 'awaiting':
      return { text: 'Awaiting proof', tone: 'neutral' };
    case 'proven':
      return { text: 'Proven', tone: 'success' };
    case 'held':
      return { text: 'Held', tone: 'warning' };
    case 'blocked':
      return { text: 'Blocked', tone: 'danger' };
    case 'rejected':
      return { text: 'Rejected', tone: 'danger' };
    case 'failed':
      return { text: 'Failed', tone: 'danger' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'neutral' };
  }
}

/* ------------------------------------------------------------------ */
/* KPI band                                                            */
/* ------------------------------------------------------------------ */

function buildKpis(rows: ViewRow[], draft: Draft): KpiCell[] {
  const intents = rows
    .map((row) => (row.intentId ? draft.intents.get(row.intentId) : undefined))
    .filter((intent): intent is IntentState => Boolean(intent));
  const byPhase = (phases: IntentPhase[]) => intents.filter((intent) => phases.includes(intent.phase));
  const untouched = intents.length === 0;

  const proven = byPhase(['proven']);
  // `packages/core/src/ledger.ts` puts `submitted` and `awaiting` in the same bucket: money that
  // has left us but is not proven yet. The screen used to drop `submitted`, so during a run the
  // KPI band and `/api/state` disagreed.
  //
  // Defect 1: the runner writes `payment.submitted` *before* it calls PayPal, so a refused call
  // (bad credentials) leaves a `submitted` intent with no batch id. Counting it as Awaiting put
  // "$1,200.00 · 1 payment" under the banner that says "Nothing was sent". When the run itself
  // stopped, an intent PayPal never received is not awaiting anything.
  const awaiting = byPhase(['awaiting', 'submitted']).filter(
    (intent) => !(draft.phase === 'error' && intent.phase === 'submitted' && intent.submitted?.payoutBatchId === null),
  );
  const held = byPhase(['held']);
  const stopped = byPhase(['blocked', 'rejected', 'failed', 'cancelled']);

  // The amount that actually moves: a human-approved reduction wins (SPEC §6.2.2).
  const paid = (intent: IntentState): Cents => intent.approvedAmount ?? intent.amount;
  const sum = (list: IntentState[]) => list.reduce((total, intent) => total + paid(intent), 0);
  const count = (list: IntentState[]) => `${list.length} ${list.length === 1 ? 'payment' : 'payments'}`;
  const duplicateOnly =
    stopped.length === 1 &&
    Boolean(stopped[0]?.checks?.some((check) => check.status === 'fail' && check.code === 'DUPLICATE'));

  return [
    {
      label: 'Proven by PayPal',
      amount: untouched ? null : sum(proven),
      sub: count(proven),
      tone: 'success',
      dot: 'solid',
    },
    {
      label: 'Awaiting proof',
      amount: untouched ? null : sum(awaiting),
      sub: count(awaiting),
      tone: 'neutral',
      dot: 'hollow',
    },
    {
      label: 'Held for review',
      amount: untouched ? null : sum(held),
      sub: count(held),
      tone: 'warning',
      dot: 'solid',
    },
    {
      label: 'Stopped',
      amount: untouched ? null : sum(stopped),
      sub: stopped.length === 0 ? '0 stopped' : duplicateOnly ? '1 duplicate' : `${stopped.length} stopped`,
      tone: 'danger',
      dot: 'solid',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Header button                                                       */
/* ------------------------------------------------------------------ */

function buildButton(draft: Draft, rows: ViewRow[]): { label: string; disabled: boolean } {
  if (draft.phase === 'error') return { label: 'Retry run', disabled: false };
  if (draft.phase === 'done') {
    const held = rows.filter((row) => row.tone === 'warning').length;
    return { label: held > 0 ? `Review ${held} held` : 'Run complete', disabled: false };
  }
  if (draft.phase === 'running') {
    const done = rows.filter((row) => {
      const intent = row.intentId ? draft.intents.get(row.intentId) : undefined;
      return Boolean(intent?.decision);
    }).length;
    const total = Math.max(draft.inboxCount, rows.length);
    return { label: `Running… ${done} / ${total}`, disabled: true };
  }
  return { label: 'Run Friday payouts', disabled: false };
}

/* ------------------------------------------------------------------ */
/* Detail panel                                                        */
/* ------------------------------------------------------------------ */

function buildDetail(
  draft: Draft,
  row: ViewRow,
  intent: IntentState | undefined,
  item: ItemState | undefined,
): DetailModel {
  const subtitle = [
    row.name,
    row.business,
    row.invoiceNumber,
    // Defect 8: when a human approved less than the invoice, the line names both numbers —
    // "$1,920.00 paid · invoice $2,400.00" — instead of repeating the invoice total over a
    // payment that was smaller.
    row.paid !== null && row.paid !== row.amount
      ? `${money(row.paid)} paid · invoice ${money(row.amount)}`
      : money(row.amount),
  ]
    .filter(Boolean)
    .join(' · ');
  const log = proofLog(draft, row.itemId);
  const notice = intent ? draft.notices.get(intent.intentId) : undefined;

  if (!intent) {
    if (draft.started) {
      return {
        kind: 'checking',
        status: { text: 'Ready', tone: 'neutral' },
        title: 'Waiting for the gate',
        subtitle,
        sections: [],
        actions: [],
        footer: log,
      };
    }
    // Defect 2, second half: the count in the panel and the count in the list header have to be
    // the same two numbers. Both come from the same inbox, computed the same way.
    return emptyDetailFor(draft.items.size, inboxCounts(draft).senders);
  }

  switch (intent.phase) {
    case 'proposed':
      return {
        kind: 'checking',
        status: { text: 'Checking…', tone: 'progress' },
        title: 'The gate is checking this invoice',
        subtitle,
        sections: [
          {
            kind: 'message',
            text: 'Four proofs, in order: we owe it, it is really them, policy allows it, PayPal confirms it.',
          },
        ],
        actions: [],
        footer: log,
      };
    case 'approved': {
      const stopped = draft.phase === 'error';
      return {
        kind: 'approved',
        status: stopped ? null : { text: 'Sending to PayPal…', tone: 'progress' },
        title: stopped ? 'Approved — PayPal was not reachable' : 'Every proof on our side passes',
        subtitle,
        sections: [
          ...(stopped
            ? [
                { kind: 'message' as const, text: 'Nothing was sent. Retry the run when the connection is back.' },
                // D1-2: the panel used to end in a third of a card of white. This is the fact that
                // makes Retry feel safe, and it comes from the payout key design (SPEC §3).
                {
                  kind: 'callout' as const,
                  title: 'Retrying is safe',
                  text: 'The payout key comes from the invoice itself, so a retry can never pay twice.',
                },
              ]
            : []),
          ...gateResult(intent, row, stopped),
        ],
        actions: [],
        footer: log,
      };
    }
    case 'submitted':
      if (draft.phase === 'error' && intent.submitted?.payoutBatchId === null) {
        return {
          kind: 'approved',
          status: null,
          title: 'Approved — PayPal was not reachable',
          subtitle,
          sections: [
            { kind: 'message', text: 'Nothing was sent. Retry the run when the connection is back.' },
            ...gateResult(intent, row, true),
          ],
          actions: [],
          footer: log,
        };
      }
      return {
        kind: 'submitted',
        status: { text: 'Awaiting PayPal…', tone: 'progress' },
        title: 'Sent — waiting for PayPal',
        subtitle,
        sections: [
          {
            kind: 'message',
            text: 'Sent is not paid. We wait for PayPal to report the transaction.',
          },
          // Defect 6: an answer that never arrived (drop_after_submit) used to leave the screen
          // silent while the runner retried under the same key. The ledger's sentence says so.
          ...(notice ? [{ kind: 'message' as const, text: notice }] : []),
          // Defect 6, second half: when the ledger shows the runner on attempt ≥ 2 with the same
          // key and still no batch id, the first call never answered. (Real ac13b ledger: seq 10
          // is attempt 1, seq 11 is attempt 2, both `payoutBatchId: null`.) Say it out loud.
          ...(!notice && intent.submitted && intent.submitted.attempt > 1 && intent.submitted.payoutBatchId === null
            ? [
                {
                  kind: 'message' as const,
                  text: "PayPal didn't answer the first call. We are retrying on the same payout key, so a retry can never pay twice.",
                },
              ]
            : []),
          ...gateResult(intent, row),
        ],
        actions: [],
        footer: log,
      };
    case 'proven':
      return provenDetail(row, intent, item, subtitle, log);
    case 'awaiting':
      return awaitingDetail(intent, subtitle, log, draft.notices.get(intent.intentId));
    case 'held':
      return heldDetail(intent, item, subtitle, log, draft.notices.get(intent.intentId));
    case 'blocked':
      return blockedDetail(draft, row, intent, subtitle, log);
    case 'rejected':
      return {
        kind: 'failed',
        status: { text: 'Rejected', tone: 'danger' },
        title: 'Rejected as fraud',
        subtitle,
        sections: [{ kind: 'message', text: 'Nothing was sent. The payee on file did not change.' }],
        actions: [],
        footer: log,
      };
    case 'failed':
      return {
        kind: 'failed',
        status: { text: 'Failed', tone: 'danger' },
        title: 'PayPal reported the payout failed',
        subtitle,
        sections: draft.notices.get(intent.intentId)
          ? [{ kind: 'message', text: String(draft.notices.get(intent.intentId)) }]
          : [],
        actions: [{ label: 'Refresh receipt', kind: 'secondary', icon: 'refresh' }],
        footer: log,
      };
    case 'cancelled':
      return {
        kind: 'failed',
        status: { text: 'Cancelled', tone: 'neutral' },
        title: 'The payout was cancelled',
        subtitle,
        sections: [],
        actions: [],
        footer: log,
      };
  }
}

function gateResult(intent: IntentState, row: ViewRow, stopped = false): DetailSection[] {
  const checks = intent.checks ?? [];
  const get = (id: CheckId) => checks.find((check) => check.id === id);
  const o2 = get('O2');
  const p1 = get('P1');
  // Defect 6: the second line of the result contradicted the panel's own title ("Sent — waiting
  // for PayPal" above "PayPal · not sent yet"). Each state says the true thing about the rail.
  // A run that stopped on its way to PayPal never sent this one, whatever the ledger wrote
  // before the call (defect 1/6: the panel used to say "sent · awaiting the receipt" under a
  // banner that said "Nothing was sent").
  const neverLeft = stopped && intent.submitted?.payoutBatchId === null;
  const paypal = neverLeft
    ? 'not sent · PayPal never received it'
    : intent.phase === 'submitted'
      ? 'sent · awaiting the receipt'
      : intent.phase === 'proven'
        ? 'receipt matched'
        : 'not sent yet';
  return [
    {
      kind: 'facts',
      title: 'Gate result',
      items: [
        // Defect 5: the real gate does not report a PO for most invoices, so the panel showed
        // "— · $1,200.00". With no PO the contract's own id is the name of the agreement.
        { label: 'Owed', value: `${contractOf(intent, o2)} · ${money(intent.amount)}`, tone: 'success' },
        { label: 'Payee', value: String(p1?.facts.onFile ?? row.senderEmail), tone: 'success' },
        { label: 'Policy', value: 'within every limit', tone: 'success' },
        { label: 'PayPal', value: paypal, tone: 'neutral' },
      ],
    },
  ];
}

/** The PO when the invoice carries one; otherwise the agreement id, never a dash (defect 5). */
function contractOf(intent: IntentState, o2: CheckResult | undefined): string {
  const po = o2?.facts.po;
  if (typeof po === 'string' && po.trim() !== '') return po;
  const agreement = o2?.facts.agreementId;
  if (typeof agreement === 'string' && agreement.trim() !== '') return agreement;
  return intent.agreementId ?? 'contract';
}

/** The gate's `per_word` is written for code; the screen reads "per word" (T11 round 3). */
function contractKind(o2: CheckResult | undefined): string {
  return String(o2?.facts.kind ?? 'fixed').replace(/_/g, ' ');
}

function provenDetail(
  row: ViewRow,
  intent: IntentState,
  item: ItemState | undefined,
  subtitle: string,
  log: string | null,
): DetailModel {
  const checks = intent.checks ?? [];
  const o2 = checks.find((check) => check.id === 'O2');
  const o3 = checks.find((check) => check.id === 'O3');
  const p1 = checks.find((check) => check.id === 'P1');
  const receipt = intent.receipt;
  // D1-11: every step used to print the same "17:30". "Invoice read" carries the moment the
  // email arrived (a different day in the scenario); the steps this run performed are seconds
  // apart, so they print to the second.
  const readAt = dateTime(item?.receivedAt);
  const checkedAt = hms(intent.checkedAt);
  return {
    kind: 'proven',
    status: { text: 'Proven', tone: 'success' },
    title: 'PayPal confirmed the payment',
    subtitle,
    sections: [
      {
        kind: 'timeline',
        items: [
          { label: 'Invoice read', note: row.invoiceNumber, at: readAt, state: 'done' },
          { label: 'Owed', note: contractOf(intent, o2), at: checkedAt, state: 'done' },
          {
            label: 'Payee',
            note: `verified ${dayLabel(String(p1?.facts.verifiedAt ?? ''), intent.checkedAt)} · ${humanizeMethod(String(p1?.facts.method ?? ''))}`,
            at: checkedAt,
            state: 'done',
          },
          { label: 'Policy', note: 'within limits', at: checkedAt, state: 'done' },
          {
            label: 'Sent to PayPal',
            note: abbreviate(intent.submitted?.senderBatchId),
            at: stepTime(intent.submitted?.at, intent.checkedAt),
            state: 'done',
          },
          {
            label: 'Proven',
            note: abbreviate(receipt?.transactionId),
            at: stepTime(receipt?.fetchedAt, intent.checkedAt),
            state: 'proven',
          },
        ],
      },
      {
        kind: 'facts',
        title: 'Evidence',
        items: [
          // T11 round 3: "Document — —" on Sofia (1009, email-only invoice; `item.read` carries
          // `files: []`). The absence of a file is not a hole, it is a fact worth printing: the
          // invoice was read out of the email body, which is exactly why the proof of debt below
          // carries the contract and the delivery instead of an attachment hash.
          item?.files[0]
            ? { label: 'Document', value: item.files[0].name, mono: true }
            : { label: 'Document', value: 'Email body, no file attached' },
          // Defect 8: the invoice total sat here over a smaller payment with no sign of the
          // difference; the proven total of the four rows did not add up to the KPI band.
          ...(row.paid !== null && row.paid !== row.amount
            ? [{ label: 'Paid', value: `${money(row.paid)} paid · invoice ${money(row.amount)}` }]
            : []),
          {
            label: 'Contract',
            value: `${contractOf(intent, o2)} · ${contractKind(o2)} ${money(Number(o2?.facts.expected ?? intent.amount))}`,
          },
          {
            label: 'Delivery',
            value: `accepted ${shortDate(String(o3?.facts.acceptedAt ?? ''))} · ${String(o3?.facts.acceptedBy ?? 'Maya')}`,
          },
          {
            label: 'Payee',
            value: `verified ${dayLabel(String(p1?.facts.verifiedAt ?? ''), intent.checkedAt)} · ${humanizeMethod(String(p1?.facts.method ?? ''))}`,
          },
        ],
      },
    ],
    actions: [{ label: 'Open proof bundle', kind: 'secondary', icon: 'chevron' }],
    footer: log,
  };
}

function awaitingDetail(intent: IntentState, subtitle: string, log: string | null, notice?: string): DetailModel {
  const receipt = intent.receipt;
  return {
    kind: 'awaiting',
    status: { text: 'Awaiting proof', tone: 'neutral' },
    title: 'Sent — PayPal has not confirmed it',
    subtitle,
    sections: [
      {
        kind: 'message',
        text: `PayPal reports ${receipt?.railStatus ?? 'PENDING'}. Sent is not paid: we only call a payout paid when PayPal's own record shows SUCCESS.`,
      },
      // A refused cancel (SPEC v1.7 §6.3.3): the row says what PayPal said, and never
      // pretends the payout was cancelled.
      ...(notice ? [{ kind: 'message' as const, text: notice }] : []),
      {
        kind: 'facts',
        title: 'Receipt',
        items: [
          // T11 round 3: a data column never prints a dash — the drawer already says "not
          // returned" for the same two fields, so the panel says the same words.
          {
            label: 'Batch',
            value: intent.submitted?.senderBatchId ?? 'not returned',
            mono: Boolean(intent.submitted?.senderBatchId),
          },
          { label: 'Item', value: receipt?.payoutItemId ?? 'not returned', mono: Boolean(receipt?.payoutItemId) },
          { label: 'Status', value: receipt?.railStatus ?? 'PENDING', mono: true },
          { label: 'Fetched', value: dateTime(receipt?.fetchedAt), mono: true },
        ],
      },
    ],
    actions: [
      { label: 'Refresh receipt', kind: 'secondary', icon: 'refresh' },
      { label: 'Cancel payout', kind: 'danger', icon: 'shield' },
    ],
    footer: log,
  };
}

function heldDetail(
  intent: IntentState,
  item: ItemState | undefined,
  subtitle: string,
  log: string | null,
  notice?: string,
): DetailModel {
  const checks = intent.checks ?? [];
  const p1 = checks.find((check) => check.id === 'P1');
  const p2 = checks.find((check) => check.id === 'P2');
  const o2 = checks.find((check) => check.id === 'O2');
  const o3 = checks.find((check) => check.id === 'O3');
  const sections: DetailSection[] = [];

  const payeeHold = p1?.status === 'hold' || p2?.status === 'hold';
  if (payeeHold) {
    sections.push({
      kind: 'payee',
      onFile: {
        email: String(p1?.facts.onFile ?? 'not recorded'),
        note: `Verified ${dayLabel(String(p1?.facts.verifiedAt ?? ''), intent.checkedAt)} · ${humanizeMethod(String(p1?.facts.method ?? ''))}`,
      },
      requested: {
        email: String(p1?.facts.requested ?? 'not recorded'),
        note: `By email · ${dayLabel(String(p2?.facts.requestedAt ?? ''), intent.checkedAt)} · not verified`,
      },
    });
  }
  if (item?.risk?.note) {
    sections.push({ kind: 'note', text: item.risk.note, ai: item.risk.source === 'model' });
  }
  if (notice) sections.push({ kind: 'message', text: notice });

  const why: WhyItem[] = [];
  if (p1?.status === 'hold') why.push({ text: 'Payee differs from the verified payee', tone: 'warning' });
  if (p2?.status === 'hold') {
    why.push({
      text: `Unverified change request (${dayLabel(String(p2.facts.requestedAt ?? ''), intent.checkedAt)})`,
      tone: 'warning',
    });
  }
  if (o2?.status === 'hold' && o2.code === 'OVER_CAP') {
    // A data column never prints a dash: with both hour counts missing the sentence says what
    // the gate decided instead of "— h billed".
    const billed = o2.facts.billedUnits;
    const cap = o2.facts.capUnits;
    why.push({
      text:
        billed === undefined || billed === null || cap === undefined || cap === null
          ? 'Billed hours are over the contract'
          : `${String(billed)} h billed · contract caps at ${String(cap)} h`,
      tone: 'warning',
    });
  }
  if (o3?.status === 'hold') {
    why.push({ text: 'Deliverable is still in review — not accepted yet', tone: 'warning' });
  }
  sections.push({ kind: 'why', title: "Why it's held", items: why });

  const actions: DetailAction[] = [];
  if (payeeHold) {
    actions.push({ label: 'Verify by phone', kind: 'secondary', icon: 'phone' });
    actions.push({ label: 'Reject as fraud', kind: 'danger' });
    actions.push({ label: 'Approve', kind: 'primary', disabled: true, hint: 'Verify the payee first' });
  } else {
    const deliveryHeld = o3?.status === 'hold';
    if (deliveryHeld) actions.push({ label: 'Accept delivery', kind: 'secondary', icon: 'doc' });
    if (o2?.status === 'hold' && o2.code === 'OVER_CAP') {
      actions.push({
        label: `Approve up to ${money(Number(o2.facts.cap ?? 0))}`,
        kind: 'primary',
        icon: 'shield',
        disabled: deliveryHeld,
        hint: deliveryHeld ? 'Accept the delivery first' : undefined,
      });
    } else if (!deliveryHeld) {
      actions.push({ label: 'Approve', kind: 'primary', icon: 'shield' });
    }
    actions.push({ label: 'Reject', kind: 'danger' });
  }

  const title = payeeHold
    ? 'Payment details changed by email'
    : o2?.code === 'OVER_CAP'
      ? 'Invoice is over the contract'
      : o3?.status === 'hold'
        ? 'Delivery is not accepted yet'
        : 'Held for review';

  return {
    kind: 'held',
    status: { text: 'Held', tone: 'warning' },
    title,
    subtitle,
    sections,
    actions,
    footer: log,
    // The server validates `accept_delivery` against the contract, so the dialog must send the
    // id the gate reported rather than something parsed out of a label.
    deliveryId: typeof o3?.facts.deliveryId === 'string' ? o3.facts.deliveryId : null,
  };
}

function blockedDetail(
  draft: Draft,
  row: ViewRow,
  intent: IntentState,
  subtitle: string,
  log: string | null,
): DetailModel {
  const o4 = intent.checks?.find((check) => check.id === 'O4');
  // T11 rework, item 3: a data column never prints a dash. When the ledger has no date for the
  // first payment the row is not evidence — it is a hole in the sentence — so it is not drawn.
  // (Not "not recorded": an operator reading a proof bundle gets a fact or nothing.)
  // Round 3: "the ledger has no date" was wrong. O4 names the original payment by `duplicateOf`,
  // and that `history.seeded` row carries the date (real run in_03: `hist_kenji_0142`). Only the
  // copy inside O4's own facts was missing, so the panel hid a date the ledger had.
  const paidAt = originalPaidOn(o4, draft);
  const transactionId =
    typeof o4?.facts.transactionId === 'string' && o4.facts.transactionId ? o4.facts.transactionId : null;
  return {
    kind: 'blocked',
    status: { text: 'Blocked', tone: 'danger' },
    title: 'Already proven — second invoice',
    subtitle,
    sections: [
      {
        kind: 'why',
        title: "Why it's blocked",
        items: [
          { text: `Same invoice as ${row.invoiceNumber}, already proven`, tone: 'danger' },
          { text: 'Two payments for one invoice is never allowed', tone: 'danger' },
        ],
      },
      {
        kind: 'facts',
        title: 'Original payment',
        items: [
          ...(paidAt ? [{ label: 'Proven on', value: paidAt, mono: true }] : []),
          ...(transactionId ? [{ label: 'Transaction', value: transactionId, mono: true }] : []),
          { label: 'Status', value: 'Proven', tone: 'success' as const },
        ],
      },
    ],
    actions: [{ label: 'View original payment', kind: 'secondary', icon: 'doc' }],
    footer: log,
  };
}

/**
 * When the payment O4 calls a duplicate was proven. O4 usually carries `paidAt` itself; when it
 * does not, the id in `duplicateOf` still names a `history.seeded` row, and that row's `at` is the
 * date the ledger recorded. Either way the date is in the ledger — the panel was printing nothing
 * because it only ever read the copy inside O4's facts.
 */
function originalPaidOn(o4: CheckResult | undefined, draft: Draft): string | null {
  const paidAt = o4?.facts.paidAt;
  if (typeof paidAt === 'string' && paidAt) return shortDate(paidAt);
  const historyId = o4?.facts.duplicateOf;
  if (typeof historyId !== 'string' || !historyId) return null;
  const seeded = draft.history.get(historyId);
  return seeded ? shortDate(seeded.at) : null;
}

function proofLog(draft: Draft, itemId: string): string | null {
  const last = draft.lastEventByItem.get(itemId);
  if (!last) return null;
  return `Proof log · event #${last.seq} · ${last.hash.slice(0, 4)}…${last.hash.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Proof bundle                                                        */
/* ------------------------------------------------------------------ */

function buildBundle(
  draft: Draft,
  intent: IntentState | undefined,
  item: ItemState | undefined,
): BundleModel | null {
  if (!intent?.checks || !item) return null;
  if (intent.phase !== 'proven' && intent.phase !== 'awaiting') return null;
  const claim = item.claim;
  if (!claim) return null;

  const get = (id: CheckId) => intent.checks?.find((check) => check.id === id);
  const o2 = get('O2');
  const o3 = get('O3');
  const p1 = get('P1');
  const l1 = get('L1');
  const l2 = get('L2');
  const l3 = get('L3');
  const receipt = intent.receipt;
  const file = item.files[0];
  const proven = intent.phase === 'proven';
  const last = draft.lastEventByItem.get(item.itemId);
  const expected = money(Number(o2?.facts.expected ?? intent.amount));

  return {
    itemId: item.itemId,
    intentId: intent.intentId,
    title: 'Proof bundle',
    subtitle: `${claim.invoiceNumber} · ${claim.vendorName} · ${money(claim.total)}`,
    status: statusOf(intent),
    // The receipt band: the drawer exists to answer "did PayPal really pay this?", so the ids and
    // the time PayPal answered sit under the title instead of in a section at the foot of a
    // scrolling sheet (T11 rework, item 1).
    receipt: [
      {
        label: 'Transaction',
        value: receipt?.transactionId ? abbreviate(receipt.transactionId, 8, 4) : 'waiting for PayPal',
        mono: true,
      },
      {
        label: 'Batch',
        value: intent.submitted?.senderBatchId ? abbreviate(intent.submitted.senderBatchId, 12, 4) : 'not returned',
        mono: true,
      },
      {
        label: 'Item',
        value: receipt?.payoutItemId ? abbreviate(receipt.payoutItemId, 8, 4) : 'not returned',
        mono: true,
      },
      {
        label: 'Status',
        value: String(receipt?.railStatus ?? 'PENDING'),
        mono: true,
        tone: proven ? 'success' : 'neutral',
      },
      {
        label: 'Fetched',
        value: receipt?.fetchedAt ? dateTime(receipt.fetchedAt) : 'not fetched yet',
        mono: true,
      },
    ],
    // Label and time only: the evidence behind each step is a row below, and repeating it here is
    // what pushed the PayPal receipt off a 720px screen.
    timeline: [
      { label: 'Invoice read', note: file?.name ?? 'no file', at: dateTime(item.receivedAt) },
      {
        label: 'Owed',
        note: `${String(o2?.facts.po ?? 'no PO')} · matches the contract`,
        at: hms(intent.checkedAt),
      },
      { label: 'Payee', note: String(p1?.facts.onFile ?? 'not recorded'), at: hms(intent.checkedAt) },
      { label: 'Policy', note: 'within limits', at: hms(intent.checkedAt) },
      {
        label: 'Sent',
        note: intent.submitted?.senderBatchId
          ? `Batch ${abbreviate(intent.submitted.senderBatchId, 12, 4)}`
          : 'not sent',
        at: hms(intent.submitted?.at),
      },
      {
        label: 'Proven',
        note: receipt?.transactionId
          ? `Transaction ${abbreviate(receipt.transactionId, 8, 4)}`
          : 'waiting for PayPal',
        at: hms(receipt?.fetchedAt),
        state: receipt?.transactionId ? 'proven' : 'pending',
      },
    ],
    sections: [
      {
        title: 'Document',
        items: [
          {
            label: 'File',
            value: `${file?.name ?? 'no file'}${file?.sha256 ? ` · ${file.sha256.slice(0, 12)}…` : ' · no hash'}`,
            mono: true,
          },
          { label: 'Invoice', value: `${claim.invoiceNumber} · ${money(claim.total)}`, ai: true, mono: true },
        ],
      },
      {
        title: 'Proof of debt',
        items: [
          { label: 'PO', value: String(o2?.facts.po ?? claim.po ?? 'none'), mono: true, ai: true },
          {
            label: 'Contract',
            // Defect 5: the drawer and the panel must name the same contract. A vendor without a
            // PO (Sofia, Priya in the error run) has an agreement id; a dash tells the reader
            // nothing.
            value: `${contractOf(intent, o2)} · ${contractKind(o2)} ${expected}`,
          },
          { label: 'Amount rule', value: `fixed fee: the invoice total must equal ${expected}.` },
          {
            label: 'Delivery',
            value: `${String(o3?.facts.deliveryTitle ?? 'not recorded')}${
              o3?.facts.acceptedAt
                ? ` · accepted ${shortDate(String(o3.facts.acceptedAt))} · ${String(o3.facts.acceptedBy ?? 'Maya')}`
                : ''
            }`,
          },
        ],
      },
      {
        title: 'Payee & policy',
        items: [
          { label: 'On file', value: String(p1?.facts.onFile ?? 'not recorded'), mono: true },
          {
            label: 'Verified',
            value: `${
              p1?.facts.verifiedAt ? shortDate(String(p1.facts.verifiedAt)) : 'not recorded'
            } · ${humanizeMethod(String(p1?.facts.method ?? ''))}`,
          },
          {
            label: 'Limits',
            value: `${wholeMoney(Number(l1?.facts.limit ?? 0))} per payment · ${wholeMoney(
              Number(l2?.facts.limit ?? 0),
            )} daily · ${wholeMoney(Number(l3?.facts.limit ?? 0))} new vendor`,
          },
        ],
      },
    ],
    // The ledger row is one line above the buttons — a section of three rows for one fact is what
    // the drawer could not afford at 720px.
    ledger: last ? { event: `#${last.seq}`, hash: last.hash, verified: true } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function verifyChain(events: readonly PbpEvent[]): boolean {
  let previous = '0'.repeat(64);
  for (const event of events) {
    if (event.prevHash !== previous) return false;
    previous = event.hash;
  }
  return true;
}

function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] ?? '', email: match[2] ?? '' };
  return { name: from, email: from };
}

/** The inbox as the list header and the empty panel both read it: "9 emails · 8 senders". */
function inboxCounts(draft: Draft): { emails: number; senders: number } {
  return {
    emails: draft.items.size,
    senders: new Set([...draft.items.values()].map((entry) => parseFrom(entry.from).name)).size,
  };
}

function invoiceHint(subject: string): string {
  const inv = subject.match(/\bINV[-‐‑‒–—―\s]?\d{2,}(?:[-‐‑‒–—―]\d+)*/i);
  if (inv) return inv[0].toUpperCase().replace(/\s+/g, '-');
  const numbered = subject.match(/invoice\s+(?:#\s*)?(\d{3,})/i);
  if (numbered?.[1]) return numbered[1];
  return '—';
}
