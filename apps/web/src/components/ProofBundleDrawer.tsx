import { BadgeCheck, Check, CircleCheck, CircleDashed, Download, RefreshCw } from 'lucide-react';
import type { BundleModel, Fact, TimelineStep } from '../state/reduce';
import { CloseButton } from './DetailPanel';
import { StatusChip } from './Stamps';

export function ProofBundleDrawer({
  bundle,
  onClose,
  onVerifyAgain,
  onExport,
  verifying = false,
}: {
  bundle: BundleModel;
  onClose?: () => void;
  /** "Verify again": GET PayPal for this payout again and re-read the bundle (SPEC §6.7). */
  onVerifyAgain?: () => void | Promise<void>;
  /** "Export JSON": the same document the drawer renders, as a download. */
  onExport?: () => void;
  verifying?: boolean;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Proof bundle">
        <header className="drawer-head">
          <div>
            <h2 className="drawer-title">{bundle.title}</h2>
            <p className="drawer-sub">{bundle.subtitle}</p>
          </div>
          <div className="drawer-head-right">
            <StatusChip text={bundle.status.text} tone={bundle.status.tone} />
            <CloseButton onClick={onClose} />
          </div>
        </header>

        {/* T11 rework, item 1: the receipt is the first thing under the title, and the sheet is
            laid out to end above the buttons at 1280×720 — nothing is parked in a scroll area. */}
        <div className="drawer-body">
          <section className="drawer-receipt" aria-label="PayPal receipt">
            {/* The label stays "PayPal": `apps/web/scripts/screenshots.ts` waits for this exact
                text inside `.drawer` (it is the主控's file, not ours to change). */}
            <h3 className="section-label">PayPal</h3>
            <dl className="fact-list fact-list--receipt">
              {bundle.receipt.map((item) => (
                <div className="fact-row" key={`receipt-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd className={factClass(item)}>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="drawer-section">
            <h3 className="section-label">Proof trail</h3>
            <ProofTrail items={bundle.timeline} />
          </section>

          <div className="drawer-grid">
            {bundle.sections.map((section) => (
              <section className="drawer-section" key={section.title}>
                <h3 className="section-label">{section.title}</h3>
                <dl className="fact-list">
                  {section.items.map((item) => (
                    <div className="fact-row" key={`${section.title}-${item.label}`}>
                      <dt>{item.label}</dt>
                      <dd className={factClass(item)}>
                        {item.value}
                        {item.ai ? <span className="ai-tag">AI</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          <div className="drawer-footline">
            {bundle.ledger ? (
              <p className="drawer-ledger mono">
                Ledger {bundle.ledger.event} · {bundle.ledger.hash.slice(0, 4)}…{bundle.ledger.hash.slice(-4)} ·{' '}
                {bundle.ledger.verified ? 'chain verified' : 'CHAIN BROKEN'}
              </p>
            ) : null}
            {bundle.dev && bundle.dev.length > 0 ? (
              <details className="drawer-dev">
                <summary className="drawer-dev-summary">Developer details</summary>
                <dl className="fact-list">
                  {bundle.dev.map((item) => (
                    <div className="fact-row" key={`dev-${item.label}`}>
                      <dt>{item.label}</dt>
                      <dd className={factClass(item)}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </div>
        </div>

        <footer className="drawer-foot">
          <div className="drawer-foot-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void onVerifyAgain?.()}
              disabled={verifying}
            >
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
              {verifying ? 'Asking PayPal…' : 'Verify again'}
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={onExport}>
              <Download size={16} strokeWidth={1.5} aria-hidden />
              Export JSON
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

function factClass(item: Fact): string {
  return [item.mono ? 'mono' : '', item.tone ? `tone-${item.tone}` : ''].filter(Boolean).join(' ');
}

/**
 * The six gate steps as one chain — the same hairline-and-mark motif the row uses for its four
 * stamps (07-UI §3: 四枚印章用一條細線串成「證明鏈」), so the drawer says the same thing at a
 * glance and costs one band instead of six rows.
 */
function ProofTrail({ items }: { items: TimelineStep[] }) {
  return (
    <ol className="trail">
      {items.map((item) => {
        const state = item.state ?? 'done';
        const Mark = state === 'proven' ? BadgeCheck : state === 'pending' ? CircleDashed : CircleCheck;
        return (
          <li className={`trail-step trail-step--${state}`} key={item.label}>
            <span className="trail-mark" aria-hidden="true">
              <Mark size={16} strokeWidth={1.5} />
            </span>
            <span className="trail-label">{item.label}</span>
            <span className="trail-at mono">{item.at}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function VerifiedBadge() {
  return (
    <span className="verified-badge">
      <Check size={12} strokeWidth={2} aria-hidden />
      Verified
    </span>
  );
}
