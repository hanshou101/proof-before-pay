/**
 * D1-12: the 400 ms between "the page is open" and "the snapshot arrived" used to be a blank
 * screen. It now shows the same geometry as the real screen — the headline, four totals and
 * eight rows — drawn in `--surface-2` so nothing jumps when the data lands.
 *
 * The sizes are the real ones on purpose: it uses the same classes as RunHero and RunList.
 */
export function HeroSkeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading Friday payout run">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <span className="skeleton skeleton-logo" />
            <span className="skeleton skeleton-brand" />
          </div>
          <div className="topbar-right">
            <span className="skeleton skeleton-chip" />
            <span className="skeleton skeleton-avatar" />
            <span className="skeleton skeleton-button" />
          </div>
        </div>
      </header>
      <main className="page">
        <section className="hero" aria-hidden="true">
          <div className="hero-text">
            <span className="skeleton skeleton-overline" />
            <span className="skeleton skeleton-headline" />
            <span className="skeleton skeleton-headline skeleton-headline--short" />
          </div>
          <div className="kpis">
            {[0, 1, 2, 3].map((index) => (
              <div className="kpi" key={index}>
                <span className="skeleton skeleton-label" />
                <span className="skeleton skeleton-amount" />
                <span className="skeleton skeleton-sub" />
              </div>
            ))}
          </div>
        </section>
        <div className="work">
          <section className="card run" aria-hidden="true">
            <div className="run-head">
              <div className="run-head-main">
                <span className="skeleton skeleton-title" />
                <span className="skeleton skeleton-meta" />
              </div>
            </div>
            <div className="run-rows">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                <div className="run-row skeleton-row" key={index}>
                  <span className="payee-cell">
                    <span className="skeleton skeleton-avatar-sm" />
                    <span className="payee-text">
                      <span className="skeleton skeleton-name" />
                      <span className="skeleton skeleton-note" />
                    </span>
                  </span>
                  <span className="amount-cell">
                    <span className="skeleton skeleton-cell" />
                  </span>
                  <span className="proof-chain">
                    <span className="stamp-cell">
                      <span className="skeleton skeleton-stamp" />
                    </span>
                    <span className="stamp-cell">
                      <span className="skeleton skeleton-stamp" />
                    </span>
                    <span className="stamp-cell">
                      <span className="skeleton skeleton-stamp" />
                    </span>
                    <span className="stamp-cell">
                      <span className="skeleton skeleton-stamp" />
                    </span>
                  </span>
                  <span className="status-cell">
                    <span className="skeleton skeleton-status" />
                  </span>
                </div>
              ))}
            </div>
            <div className="run-foot">
              <span className="skeleton skeleton-foot" />
            </div>
          </section>
          <aside className="card detail" aria-hidden="true">
            <div className="detail-body">
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-sub" />
              <span className="skeleton skeleton-block" />
              <span className="skeleton skeleton-block" />
              <span className="skeleton skeleton-block skeleton-block--short" />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
