import type { ViewState } from '../state/reduce';

/**
 * Top of the payout screen (web-dashboard sample, design/sample/README.md): one sentence that
 * says how the run stands — the largest thing on the screen — and the four totals under it.
 * Everything in it is derived from the ledger view; nothing is typed in for the demo.
 */
export function RunHero({ view }: { view: ViewState }) {
  return (
    <section className="hero" aria-label="Run summary">
      <div className="hero-text">
        <p className="hero-overline">Friday payout run · Nov 6</p>
        <h1 className="hero-headline">
          <Headline view={view} />
        </h1>
      </div>
      <div className="kpis" aria-label="Totals">
        {view.kpis.map((cell) => (
          <div className="kpi" key={cell.label}>
            <span className="kpi-label">
              <span className={`kpi-dot kpi-dot--${cell.dot} tone-${cell.tone}`} aria-hidden="true" />
              {cell.label}
            </span>
            <span className={`kpi-amount${cell.amount === null ? ' is-empty' : ''}`}>{formatAmount(cell.amount)}</span>
            <span className="kpi-sub">{cell.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Headline({ view }: { view: ViewState }) {
  if (view.phase === 'error') return <>The run stopped. Nothing more is paid until it is fixed.</>;
  if (view.phase === 'running') {
    const progress = view.progress;
    // Sample weakness 4: the running sentence carried the tagline too and folded to three lines,
    // pushing the totals down. The promise is the empty state's line; here the count is the news.
    // The denominator is the run's inbox count, not the invoices found so far: at this moment the
    // model has not said which of the nine emails are invoices, and "5 of 5" would be a guess.
    return progress ? (
      <>
        Checking {progress.done} of {progress.total} emails.
      </>
    ) : (
      <>Reading the inbox.</>
    );
  }
  // Two balanced lines: at 40px the sentence is wider than the 512px it has next to the totals,
  // and letting it break by itself left "proven." alone on the second line. The apostrophe is the
  // straight one the panel and the rest of the screen use (`&rsquo;` printed a curly one beside
  // the panel's straight one on the same screen — T11 round 3).
  if (view.phase === 'idle' || view.rows.length === 0) {
    return (
      <>
        Nothing is paid
        <br />
        until it's proven.
      </>
    );
  }

  const proven = view.rows.filter((row) => row.stamps.paypal === 'proven').length;
  const held = view.rows.filter((row) => row.tone === 'warning').length;
  return (
    <>
      <span>{proven} paid with proof.</span>
      {held > 0 ? (
        <span className="hero-ask">
          {held} {held === 1 ? 'needs' : 'need'} your review.
        </span>
      ) : (
        <span>Nothing needs you.</span>
      )}
    </>
  );
}

function formatAmount(cents: number | null): string {
  if (cents === null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
