import { describe, expect, it } from 'vitest';
import {
  designErrorEvents,
  designEvents,
  designRunningSeq,
  designSeed,
  eventsUpTo,
} from '../fixtures/design-run';
import type { PbpEvent } from '../model';
import { bundleOf, detailOf, reduce } from './reduce';

const fullRun = () => reduce(designEvents, designSeed);

describe('reduce — full run against the scenario golden', () => {
  it('lists the eight invoices in reading order with the golden amounts', () => {
    const state = fullRun();
    expect(state.rows.map((row) => row.itemId)).toEqual([
      'in_01',
      'in_02',
      'in_03',
      'in_04',
      'in_05',
      'in_06',
      'in_07',
      'in_08',
    ]);
    expect(state.rows.map((row) => row.amount)).toEqual([
      120000, 135000, 115000, 240000, 240000, 73800, 64000, 180000,
    ]);
    expect(state.rows.map((row) => row.invoiceNumber)).toEqual([
      'INV-2026-118',
      'INV-0153',
      'INV-0142',
      'INV-2207',
      'INV-031',
      '1009',
      'INV-001',
      'INV-77',
    ]);
    expect(state.rows.map((row) => row.status)).toEqual([
      'Proven',
      'Proven',
      'Blocked',
      'Held',
      'Held',
      'Proven',
      'Awaiting proof',
      'Proven',
    ]);
  });

  it('shows four stamps per row and never calls a non-proven row paid', () => {
    const state = fullRun();
    const [priya, , kenji142, ana, leo, sofia, jonas, tomas] = state.rows;
    expect(priya?.stamps).toEqual({ owed: 'pass', payee: 'pass', policy: 'pass', paypal: 'proven' });
    expect(kenji142?.stamps).toEqual({ owed: 'fail', payee: 'pass', policy: 'pass', paypal: 'na' });
    expect(ana?.stamps).toEqual({ owed: 'pass', payee: 'hold', policy: 'pass', paypal: 'na' });
    expect(leo?.stamps).toEqual({ owed: 'hold', payee: 'pass', policy: 'pass', paypal: 'na' });
    expect(sofia?.stamps.paypal).toBe('proven');
    expect(jonas?.stamps.paypal).toBe('awaiting');
    expect(tomas?.stamps.paypal).toBe('proven');
    expect(state.rows.filter((row) => row.stamps.paypal === 'proven')).toHaveLength(4);
  });

  it('computes the four KPI cells from the projection (SPEC §6.4 totalsAfterRun)', () => {
    const state = fullRun();
    expect(state.kpis.map((cell) => [cell.label, cell.amount, cell.sub])).toEqual([
      ['Proven by PayPal', 508800, '4 payments'],
      ['Awaiting proof', 64000, '1 payment'],
      ['Held for review', 480000, '2 payments'],
      ['Stopped', 115000, '1 duplicate'],
    ]);
  });

  it('moves the header button from run to review when the run completes', () => {
    expect(fullRun().button).toEqual({ label: 'Review 2 held', disabled: false });
    expect(fullRun().phase).toBe('done');
  });

  it('counts the ignored email and verifies the hash chain', () => {
    const state = fullRun();
    expect(state.ignoredCount).toBe(1);
    expect(state.ledgerVerified).toBe(true);
    expect(state.eventCount).toBe(designEvents.length);
  });

  it('is deterministic: the same events give the same screen state', () => {
    expect(JSON.stringify(reduce(designEvents, designSeed))).toBe(JSON.stringify(reduce(designEvents, designSeed)));
  });
});

describe('reduce — states', () => {
  it('pre-run: eight ready rows, no amounts, KPI dashes', () => {
    const state = reduce([], designSeed);
    expect(state.phase).toBe('idle');
    expect(state.rows).toHaveLength(8);
    expect(state.rows.every((row) => row.status === 'Ready')).toBe(true);
    expect(state.rows.every((row) => row.amount === null)).toBe(true);
    expect(state.rows.every((row) => row.stamps.owed === 'pending')).toBe(true);
    expect(state.kpis.every((cell) => cell.amount === null)).toBe(true);
    expect(state.kpis[0]?.sub).toBe('0 payments');
    expect(state.button).toEqual({ label: 'Run Friday payouts', disabled: false });
    expect(state.ignoredCount).toBe(0);
    // T11 rework, item 2: the list header and the empty panel read the same two numbers, and the
    // footer says "1 event", not "1 events".
    expect(state.inbox.emails).toBe(state.rows.length);
    const empty = detailOf(state, state.selected);
    expect(empty.kind).toBe('empty');
    expect(empty.sections[0]).toEqual({
      kind: 'message',
      text: `${state.inbox.emails} emails from ${state.inbox.senders} senders arrived this week.`,
    });
  });

  it('mid-run: six of eight checked, the seventh still sending', () => {
    const state = reduce(eventsUpTo(designEvents, designRunningSeq), designSeed);
    expect(state.phase).toBe('running');
    // Defect 2: the denominator is every email the run was handed (9), not the invoices found so
    // far (8) — the count must not jump when the last email turns out not to be an invoice.
    expect(state.progress).toEqual({ done: 6, total: 9 });
    expect(state.button).toEqual({ label: 'Running… 6 / 9', disabled: true });
    expect(state.rows[5]?.status).toBe('Sending to PayPal…');
    // Defect 2: rows appear as the run puts them in, so there is no 7th "Ready" row waiting to
    // turn into "not an invoice" and vanish. The headline carries the denominator instead.
    expect(state.rows).toHaveLength(6);
    expect(state.kpis[0]?.amount).toBe(255000);
    expect(state.kpis[2]?.amount).toBe(480000);
  });

  it('error: PayPal unreachable, human sentence, nothing marked sent', () => {
    const state = reduce(designErrorEvents, designSeed);
    expect(state.phase).toBe('error');
    expect(state.button).toEqual({ label: 'Retry run', disabled: false });
    expect(state.error?.message).toBe(
      "Couldn't reach the PayPal sandbox. Nothing was sent. Check PAYPAL_CLIENT_ID in .env, then retry.",
    );
    expect(state.rows.filter((row) => row.stamps.paypal === 'proven')).toHaveLength(0);
    expect(state.kpis[0]?.amount).toBe(0);
  });
});

describe('reduce — detail panel', () => {
  it('holds Ana with both emails, the AI note and two hold facts', () => {
    const state = fullRun();
    const detail = detailOf(state, 'in_04');
    expect(detail.kind).toBe('held');
    expect(detail.status).toEqual({ text: 'Held', tone: 'warning' });
    expect(detail.title).toBe('Payment details changed by email');
    expect(detail.subtitle).toBe('Ana Ribeiro · Studio North · INV-2207 · $2,400.00');
    const payee = detail.sections.find((section) => section.kind === 'payee');
    expect(payee).toEqual({
      kind: 'payee',
      onFile: { email: 'ana@studionorth.example', note: 'Verified Mar 2 · video call' },
      requested: { email: 'billing@studi0-north.example', note: 'By email · Nov 4 · not verified' },
    });
    const note = detail.sections.find((section) => section.kind === 'note');
    expect(note?.kind === 'note' && note.ai).toBe(true);
    expect(note?.kind === 'note' && note.text).toContain('a zero replaces the letter o');
    const why = detail.sections.find((section) => section.kind === 'why');
    expect(why?.kind === 'why' && why.items.map((item) => item.text)).toEqual([
      'Payee differs from the verified payee',
      'Unverified change request (Nov 4)',
    ]);
    expect(detail.actions.map((action) => [action.label, action.disabled ?? false])).toEqual([
      ['Verify by phone', false],
      ['Reject as fraud', false],
      ['Approve', true],
    ]);
    expect(detail.footer).toMatch(/^Proof log · event #\d+ · [0-9a-f]{4}…[0-9a-f]{4}$/);
  });

  it('shows Leo over the cap with the contract numbers', () => {
    const detail = detailOf(fullRun(), 'in_05');
    expect(detail.title).toBe('Invoice is over the contract');
    const why = detail.sections.find((section) => section.kind === 'why');
    expect(why?.kind === 'why' && why.items.map((item) => item.text)).toEqual([
      '40 h billed · contract caps at 32 h',
      'Deliverable is still in review — not accepted yet',
    ]);
    expect(detail.actions.map((action) => action.label)).toEqual([
      'Accept delivery',
      'Approve up to $1,920.00',
      'Reject',
    ]);
    expect(detail.actions[1]?.disabled).toBe(true);
  });

  it('blocked duplicate points at the original payment', () => {
    const detail = detailOf(fullRun(), 'in_03');
    expect(detail.kind).toBe('blocked');
    // Shortened so the one-line row note never ends in an ellipsis at 1280 (07-UI §4.6 #3).
    expect(detail.title).toBe('Already proven — second invoice');
    const facts = detail.sections.find((section) => section.kind === 'facts');
    expect(facts?.kind === 'facts' && facts.items.map((item) => item.value)).toContain('DEMO-TXN-0142');
    // T11 rework, item 3: no data column prints a dash.
    expect(facts?.kind === 'facts' && facts.items.map((item) => item.value)).not.toContain('—');
  });

  it('blocked duplicate reads the original date from O4, or from the history row it names', () => {
    // The fixture's O4 carries `paidAt`; when it does, that date is the one shown.
    const explicit = detailOf(fullRun(), 'in_03').sections.find((section) => section.kind === 'facts');
    const shown = (detail: typeof explicit) =>
      detail?.kind === 'facts' ? detail.items.find((item) => item.label === 'Proven on')?.value : undefined;
    expect(shown(explicit)).toBe('Nov 4');

    // The real run's O4 carries no `paidAt` — only `duplicateOf: 'hist_kenji_0142'`. The ledger's
    // `history.seeded` row for that id is the date, and T11 round 3 rejected hiding it.
    const events = designEvents.map((event) =>
      event.type === 'intent.checked' && event.data.intentId === 'int_in_03'
        ? {
            ...event,
            data: {
              ...event.data,
              checks: event.data.checks.map((check) =>
                check.id === 'O4'
                  ? { ...check, facts: Object.fromEntries(Object.entries(check.facts).filter(([key]) => key !== 'paidAt')) }
                  : check,
              ),
            },
          }
        : event,
    );
    const seeded = detailOf(reduce(events, designSeed), 'in_03').sections.find((section) => section.kind === 'facts');
    expect(shown(seeded)).toBe('Nov 6');
  });

  it('a proven invoice with no attachment says so instead of printing a dash', () => {
    // Sofia's invoice is written in the email body (`item.read` carries `files: []`).
    const evidence = detailOf(fullRun(), 'in_06').sections.find(
      (section) => section.kind === 'facts' && section.title === 'Evidence',
    );
    const document = evidence?.kind === 'facts' ? evidence.items.find((item) => item.label === 'Document') : undefined;
    expect(document?.value).toBe('Email body, no file attached');
  });

  it('the contract kind reads as words, not as the gate\'s key', () => {
    const evidence = detailOf(fullRun(), 'in_06').sections.find(
      (section) => section.kind === 'facts' && section.title === 'Evidence',
    );
    const contract = evidence?.kind === 'facts' ? evidence.items.find((item) => item.label === 'Contract') : undefined;
    expect(contract?.value).toContain('per word');
    expect(contract?.value).not.toContain('per_word');
  });

  it('awaiting row explains that sent is not paid', () => {
    const detail = detailOf(fullRun(), 'in_07');
    expect(detail.kind).toBe('awaiting');
    expect(detail.title).toBe('Sent — PayPal has not confirmed it');
    const message = detail.sections.find((section) => section.kind === 'message');
    expect(message?.kind === 'message' && message.text).toContain('UNCLAIMED');
  });

  it('proven row carries the six-step proof timeline', () => {
    const detail = detailOf(fullRun(), 'in_01');
    expect(detail.kind).toBe('proven');
    const timeline = detail.sections.find((section) => section.kind === 'timeline');
    expect(timeline?.kind === 'timeline' && timeline.items.map((item) => item.label)).toEqual([
      'Invoice read',
      'Owed',
      'Payee',
      'Policy',
      'Sent to PayPal',
      'Proven',
    ]);
  });
});

describe('reduce — proof bundle', () => {
  it('builds the Kenji INV-0153 bundle with evidence, policy and PayPal ids', () => {
    const bundle = bundleOf(fullRun(), 'in_02');
    expect(bundle).not.toBeNull();
    expect(bundle?.subtitle).toBe('INV-0153 · Kenji Watanabe · $1,350.00');
    expect(bundle?.timeline).toHaveLength(6);
    expect(bundle?.sections.map((section) => section.title)).toEqual([
      'Document',
      'Proof of debt',
      'Payee & policy',
    ]);
    // T11 rework, item 1: the PayPal ids are the band under the title, not a section at the foot
    // of a sheet that scrolled.
    expect(bundle?.receipt.map((item) => item.label)).toEqual([
      'Transaction',
      'Batch',
      'Item',
      'Status',
      'Fetched',
    ]);
    expect(bundle?.receipt.map((item) => item.value)).toEqual(
      expect.arrayContaining(['DEMO-BATCH-0153', 'DEMO-TXN-0153']),
    );
    // T11 rework, item 3: a data column never prints a dash.
    const values = [...(bundle?.receipt ?? []), ...(bundle?.sections.flatMap((section) => section.items) ?? [])].map(
      (item) => item.value,
    );
    expect(values).not.toContain('—');
    const document = bundle?.sections.find((section) => section.title === 'Document');
    expect(document?.items[0]?.value).toContain('kenji-INV-0153.pdf');
    expect(document?.items.some((item) => item.ai)).toBe(true);
  });

  it('has no bundle for a row that is not proven', () => {
    expect(bundleOf(fullRun(), 'in_04')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* T8 round 3 — the screen has to agree with the server                */
/* ------------------------------------------------------------------ */

type Spec = { type: string; data: unknown };

/** Append events to an existing chain, keeping `prevHash`/`hash`/`seq` coherent. */
function append(events: readonly PbpEvent[], specs: readonly Spec[]): PbpEvent[] {
  let previous = events.at(-1)?.hash ?? '0'.repeat(64);
  let lastSeq = events.at(-1)?.seq ?? 0;
  let at = events.at(-1)?.at;
  let clock = at ? Date.parse(at) : Date.parse('2026-11-06T17:30:00Z');
  const out = [...events];
  for (const spec of specs) {
    clock += 1000;
    lastSeq += 1;
    const event = {
      seq: lastSeq,
      at: new Date(clock).toISOString(),
      type: spec.type,
      data: spec.data,
      prevHash: previous,
      hash: `hash-${String(lastSeq).padStart(59, '0')}`,
    } as unknown as PbpEvent;
    previous = event.hash;
    out.push(event);
  }
  return out;
}

const ALL_CHECKS = ['O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'L1', 'L2', 'L3'].map((id) => ({
  id,
  status: 'pass' as const,
  code: 'OK',
  facts: {},
}));

function chain(specs: readonly Spec[]): PbpEvent[] {
  return append([], specs);
}

const START: Spec[] = [
  { type: 'run.started', data: { runId: 'run_1', mode: 'proof', inboxCount: 9 } },
  {
    type: 'item.read',
    data: {
      itemId: 'in_01',
      from: 'Priya Nair <priya@nairwords.example>',
      subject: 'INV-2026-118',
      files: [{ name: 'priya-INV-2026-118.pdf', sha256: 'a'.repeat(64) }],
    },
  },
  {
    type: 'intent.proposed',
    data: {
      intentId: 'int_in_01',
      itemId: 'in_01',
      vendorId: 'ven_priya',
      agreementId: 'agr_priya_03',
      agreementMatchedBy: 'po',
      amount: 120_000,
      payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'priya@nairwords.example' },
      fingerprint: 'fp-1',
      idempotencyKey: 'key-1',
    },
  },
  { type: 'intent.checked', data: { intentId: 'int_in_01', checks: ALL_CHECKS, decision: 'approved' } },
];

describe('reduce — T8 round 3, item 1: one row failing is not the run failing', () => {
  it('keeps a per-payment submit error on its row and still finishes the run', () => {
    const events = append(chain(START), [
      {
        type: 'error',
        data: {
          scope: 'payment.submit:int_in_01',
          message: 'PayPal did not answer. We will retry with the same key — a retry can never pay twice.',
        },
      },
      {
        type: 'payment.submitted',
        data: {
          intentId: 'int_in_01',
          rail: 'paypal',
          senderBatchId: 'key-1',
          payoutBatchId: 'pbp-1',
          attempt: 2,
        },
      },
      {
        type: 'receipt.updated',
        data: {
          intentId: 'int_in_01',
          railStatus: 'SUCCESS',
          proof: 'proven',
          payoutItemId: 'ITEM-1',
          transactionId: 'TXN-1',
          source: 'rail_get',
          fetchedAt: '2026-11-06T17:30:20Z',
        },
      },
      { type: 'run.completed', data: { runId: 'run_1', totals: {} } },
    ]);

    const state = reduce(events, designSeed);
    expect(state.phase).toBe('done');
    expect(state.error).toBeNull();
    expect(state.rows[0]?.status).toBe('Proven');
    expect(state.kpis[0]?.amount).toBe(120_000);
    expect(state.notices).toEqual({});
    expect(state.button).toEqual({ label: 'Run complete', disabled: false });
  });

  it('a screen-level failure still stops the screen, and a retry clears the banner', () => {
    const events = append(chain(START), [
      {
        type: 'error',
        data: {
          scope: 'run',
          message: "Couldn't reach the PayPal sandbox. Nothing was sent. Check PAYPAL_CLIENT_ID in .env, then retry.",
        },
      },
    ]);
    const failed = reduce(events, designSeed);
    expect(failed.phase).toBe('error');
    expect(failed.button).toEqual({ label: 'Retry run', disabled: false });

    const retried = reduce(
      append(events, [{ type: 'run.started', data: { runId: 'run_2', mode: 'proof', inboxCount: 9 } }]),
      designSeed,
    );
    expect(retried.phase).toBe('running');
    expect(retried.error).toBeNull();
  });
});

describe('reduce — T8 round 3, item 2: the money on screen is the money that moved', () => {
  it('uses the approved amount, not the invoice, once a human approves less', () => {
    // The design fixture already has Leo held over the cap at $2,400 against a $1,920 cap.
    const events = append(designEvents, [
      // AC-12 step 2: Ana's change request is fraud, so she leaves "held" for "stopped".
      {
        type: 'human.action',
        data: { intentId: 'int_in_04', action: 'mark_fraud', by: 'Maya', input: { reason: 'not confirmed' } },
      },
      {
        type: 'human.action',
        data: { intentId: 'int_in_05', action: 'approve', by: 'Maya', input: { amount: 192_000 } },
      },
      { type: 'intent.checked', data: { intentId: 'int_in_05', checks: ALL_CHECKS, decision: 'approved' } },
      {
        type: 'payment.submitted',
        data: {
          intentId: 'int_in_05',
          rail: 'paypal',
          senderBatchId: 'key-leo',
          payoutBatchId: 'pbp-leo',
          attempt: 1,
        },
      },
      {
        type: 'receipt.updated',
        data: {
          intentId: 'int_in_05',
          railStatus: 'SUCCESS',
          proof: 'proven',
          payoutItemId: 'ITEM-LEO',
          transactionId: 'TXN-LEO',
          source: 'rail_get',
          fetchedAt: '2026-11-06T17:34:00Z',
        },
      },
    ]);

    const state = reduce(events, designSeed);
    // SPEC §3 2:00–2:20 reads these two numbers out loud.
    expect(state.kpis[0]?.amount).toBe(700_800);
    expect(state.kpis[2]?.amount).toBe(0);
    expect(state.kpis[3]?.amount).toBe(355_000);
    expect(state.rows.find((row) => row.itemId === 'in_05')?.status).toBe('Proven');

    // Defect 8: the row and the panel say what moved ($1,920) next to what was asked ($2,400),
    // so the four Proven rows add up to the KPI band by themselves.
    const leo = state.rows.find((row) => row.itemId === 'in_05');
    expect(leo?.paid).toBe(192_000);
    expect(leo?.amount).toBe(240_000);
    expect(state.details['in_05']?.subtitle).toContain('$1,920.00 paid · invoice $2,400.00');
    const evidence = state.details['in_05']?.sections.find(
      (section) => section.kind === 'facts' && section.title === 'Evidence',
    );
    expect(evidence?.kind === 'facts' ? evidence.items.map((entry) => entry.value) : []).toContain(
      '$1,920.00 paid · invoice $2,400.00',
    );
  });

  it('counts a submitted payment in Awaiting proof, like the server does', () => {
    const events = append(chain(START), [
      {
        type: 'payment.submitted',
        data: {
          intentId: 'int_in_01',
          rail: 'paypal',
          senderBatchId: 'key-1',
          payoutBatchId: 'pbp-1',
          attempt: 1,
        },
      },
    ]);
    const state = reduce(events, designSeed);
    expect(state.kpis[1]?.amount).toBe(120_000);
    expect(state.kpis[1]?.sub).toBe('1 payment');
    expect(state.kpis[0]?.amount).toBe(0);
  });
});
