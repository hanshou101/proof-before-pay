import { CircleAlert, Lock } from 'lucide-react';
import { initials, money } from '../format';
import type { DetailModel, ViewRow, ViewState } from '../state/reduce';
import { Stamp, StatusChip } from './Stamps';

export function RunList({
  state,
  selected,
  onSelect,
  verified,
}: {
  state: ViewState;
  selected: string | null;
  onSelect: (itemId: string) => void;
  /** The server's own chain check (`/api/state.ledger.verified`); it re-hashes every row. */
  verified?: boolean;
}) {
  return (
    <section className="card run" aria-label="Friday payout run">
      <div className="run-head">
        <div className="run-head-main">
          <h2 className="run-title">Payments</h2>
          <span className="run-meta">{invoiceSummary(state)}</span>
        </div>
        <span className="run-head-label is-num">Amount</span>
        <span className="proof-legend run-head-label" aria-hidden="true">
          <span>Owed</span>
          <span>Payee</span>
          <span>Policy</span>
          <span>PayPal</span>
        </span>
        <span className="run-head-label status-label">Status</span>
      </div>

      {state.error ? (
        <div className="run-banner" role="alert">
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden />
          <span className="run-banner-text">{state.error.message}</span>
          <button type="button" className="btn btn--secondary btn--sm">
            {state.error.action}
          </button>
        </div>
      ) : null}

      <div className="run-rows">
        {state.rows.map((row) => (
          <button
            type="button"
            key={row.itemId}
            data-item-id={row.itemId}
            className={`run-row${selected === row.itemId ? ' is-selected' : ''}`}
            onClick={() => onSelect(row.itemId)}
          >
            <span className="payee-cell">
              <span className="avatar" aria-hidden="true">
                {row.initials}
              </span>
              <span className="payee-text">
                <span className="payee-name">{row.name}</span>
                <span className="row-note">{rowNote(row, state.details[row.itemId])}</span>
              </span>
            </span>
            <span className="amount-cell">
              {/* Defect 8: what moved, not what was invoiced. Leo was approved at $1,920 on a
                  $2,400 invoice; the row said $2,400 and the proven rows stopped adding up. */}
              {money(row.paid ?? row.amount)}
              <span className="amount-invoice">{row.invoiceNumber}</span>
            </span>
            <span className="proof-chain">
              <span className="stamp-cell">
                <Stamp state={row.stamps.owed} />
              </span>
              <span className="stamp-cell">
                <Stamp state={row.stamps.payee} />
              </span>
              <span className="stamp-cell">
                <Stamp state={row.stamps.policy} />
              </span>
              <span className="stamp-cell">
                <Stamp state={row.stamps.paypal} />
              </span>
            </span>
            <span className="status-cell">
              <StatusChip text={row.status} tone={row.tone} />
            </span>
          </button>
        ))}

        {/* A run that stopped never looked at the rest of the inbox. Saying so, in the place the
            rows would be, is more useful than an empty half-card (defect 2). */}
        {state.unchecked.map((item) => (
          <div className="run-row run-row--unchecked" key={item.itemId} data-unchecked-id={item.itemId}>
            <span className="payee-cell">
              <span className="avatar" aria-hidden="true">
                {initials(item.name)}
              </span>
              <span className="payee-text">
                <span className="payee-name">{item.name}</span>
              </span>
            </span>
            <span className="amount-cell">—</span>
            <span className="proof-chain">
              <span className="stamp-cell">
                <Stamp state="pending" />
              </span>
              <span className="stamp-cell">
                <Stamp state="pending" />
              </span>
              <span className="stamp-cell">
                <Stamp state="pending" />
              </span>
              <span className="stamp-cell">
                <Stamp state="pending" />
              </span>
            </span>
            <span className="status-cell">
              <StatusChip text="Not checked" tone="neutral" />
            </span>
          </div>
        ))}
      </div>

      <div className="run-foot">
        <span>{footerNote(state)}</span>
        <span className="ledger">
          <Lock size={12} strokeWidth={1.5} aria-hidden />
          {(verified ?? state.ledgerVerified) ? 'Ledger verified' : 'Ledger check failed'} ·{' '}
          {count(state.eventCount, 'event')}
        </span>
      </div>
    </section>
  );
}

/**
 * A row's second line is a summary; the panel is where the sentence goes. These two panel titles
 * are 225px at 14px in the 218px name cell, so the row says the same fact in fewer words instead
 * of ending in an ellipsis (measure-ui「不裁切、不截斷」, T11).
 */
const ROW_NOTE: Record<string, string> = {
  'Payment details changed by email': 'Payment details changed',
  'Sent — PayPal has not confirmed it': 'Sent, not yet confirmed',
};

function rowNote(row: ViewRow, detail: DetailModel | undefined): string {
  if (!detail) return row.business;
  // Before a run every row would otherwise repeat the panel's title ("Nothing is paid until
  // it's proven.") nine times; the row says who the sender is instead.
  if (detail.kind === 'empty') return row.business || 'Not checked yet';
  // The stopped-approved panel says "Approved — PayPal was not reachable"; in the row the chip
  // already says "Not sent".
  if (detail.kind === 'approved' && detail.status === null) return 'PayPal was not reachable';
  const short = ROW_NOTE[detail.title];
  if (short) return short;
  if (detail.kind === 'proven') {
    const timeline = detail.sections.find((section) => section.kind === 'timeline');
    const proven = timeline?.kind === 'timeline' ? timeline.items.find((item) => item.label === 'Proven') : undefined;
    // "PayPal receipt 5YE04019KT…883L" is 224px in the 218px cell on the real run; "PayPal" plus
    // the reference is the same fact without the ellipsis, and the panel still says "receipt".
    return proven?.note ? `PayPal ${proven.note}` : detail.title;
  }
  return detail.title;
}

function invoiceSummary(state: ViewState): string {
  // Defect 2: before the run these are nine emails, not nine invoices — the model has not said
  // which ones are invoices yet, and calling the notice an invoice is what made the count lie.
  // T11 rework: both numbers come from `state.inbox`, the same pair the empty panel prints.
  if (state.phase === 'idle') return `${count(state.inbox.emails, 'email')} · ${count(state.inbox.senders, 'sender')}`;
  const freelancers = new Set(state.rows.map((row) => row.name)).size;
  return `${count(state.rows.length, 'invoice')} · ${count(freelancers, 'freelancer')}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function footerNote(state: ViewState): string {
  if (state.ignoredCount > 0) return `${count(state.ignoredCount, 'email')} ignored — not an invoice`;
  if (state.phase === 'idle') return `${count(state.rows.length, 'email')} in this week's inbox`;
  if (state.phase === 'running') return `${count(state.rows.length, 'invoice')} checked so far`;
  if (state.phase === 'error') {
    const rest = state.unchecked.length;
    return rest > 0 ? `${rest} not checked — the run stopped` : `${state.rows.length} checked before the run stopped`;
  }
  return `${count(state.rows.length, 'invoice')} in this run`;
}
