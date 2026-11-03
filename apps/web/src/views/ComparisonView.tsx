/**
 * Comparison screen (07-UI §4.7 / AC-14): the same agent with no proofs.
 *
 * Everything here is read from `data/comparison.jsonl` through `/api/comparison/state`; the
 * main ledger's totals are untouched by design. The closing summary is the agent's own words,
 * printed verbatim — including the part where it says everything went out.
 */
import { CircleAlert, RefreshCw } from 'lucide-react';
import type { ComparisonState } from '../api';
import { money } from '../format';
import { StatusChip } from '../components/Stamps';
import { ModelSummary } from '../components/ModelSummary';

/**
 * A rail status is only red when it means the money was refused. PENDING is the ordinary
 * "PayPal has not answered yet" state and used to paint the row red (defect 4, 07-UI §4.2:
 * red is reserved for blocked and fraud).
 */
function railTone(status: string | null): 'success' | 'neutral' | 'danger' {
  if (status === 'SUCCESS') return 'success';
  if (status && /^(FAILED|DENIED|RETURNED|BLOCKED|REVERSED)$/i.test(status)) return 'danger';
  return 'neutral';
}

export function ComparisonView({
  state,
  unavailable,
  onRun,
  running,
  devMode = false,
}: {
  state: ComparisonState | null;
  unavailable: string | null;
  onRun: () => void;
  running: boolean;
  /** Developer switch (07-UI §4.6): both addresses, as SPEC §6.5.5 records them. */
  devMode?: boolean;
}) {
  const payouts = state?.payouts ?? [];
  const sentTotal = payouts.reduce((sum, payout) => sum + payout.amount, 0);

  return (
    <section className="card comparison" aria-label="Comparison mode">
      <div className="run-head">
        <h1 className="run-title">The same agent, without the gate</h1>
        {/* What it sent, in one number: the payouts are the evidence, and the reader should not
            have to add seven rows up (or read the model's paragraph) to get the total. */}
        {payouts.length > 0 ? (
          <span className="run-meta">
            {payouts.length} payouts · {money(sentTotal)} sent
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRun}
          disabled={running || unavailable !== null}
          title={unavailable ?? undefined}
        >
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
          {running ? 'Running…' : payouts.length > 0 ? 'Run again' : 'Run comparison'}
        </button>
      </div>

      <div className="run-banner run-banner--comparison" role="note">
        <CircleAlert size={16} strokeWidth={1.5} aria-hidden />
        <span className="run-banner-text">
          Comparison mode — the same agent with no proofs. For demonstration only.
        </span>
      </div>

      {unavailable ? <p className="detail-text">{unavailable}</p> : null}

      <div className="run-colhead comparison-head" aria-hidden="true">
        <span>WHAT IT PAID</span>
        <span>AMOUNT</span>
        <span>PAYPAL SAID</span>
        <span>WHAT IT SAID</span>
      </div>

      <div className="run-rows comparison-rows">
        {payouts.length === 0 ? (
          <p className="detail-text comparison-empty">
            The ungated agent has not run yet. It reads the same nine emails and pays whatever it
            decides to pay — nothing here is checked.
          </p>
        ) : (
          payouts.map((payout) => (
            <div className="comparison-row" key={payout.toolCallId}>
              <span className="mono comparison-who">
                {payout.receiver}
                {/* SPEC §6.5.5: the invoice's address and the sandbox account PayPal actually
                    paid. Only under the developer switch — the demo screen shows one address. */}
                {devMode && payout.receiverSent && payout.receiverSent !== payout.receiver ? (
                  <span className="comparison-who-dev">→ {payout.receiverSent}</span>
                ) : null}
              </span>
              <span className="mono amount-cell">{money(payout.amount)}</span>
              <span>
                <StatusChip text={payout.railStatus ?? 'no answer'} tone={railTone(payout.railStatus)} />
              </span>
              <span className="comparison-verdict">
                {/* The fourth column is what the agent claimed, not what PayPal reported. */}
                {payout.railStatus === 'SUCCESS' ? '“Paid”' : '“Sent”'}
              </span>
            </div>
          ))
        )}
      </div>

      {state?.summary ? (
        <footer className="comparison-summary">
          <span className="section-label">What the agent said, in its own words</span>
          <ModelSummary text={state.summary.text} />
        </footer>
      ) : null}
    </section>
  );
}
