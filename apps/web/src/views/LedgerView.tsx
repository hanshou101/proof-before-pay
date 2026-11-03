/**
 * Ledger screen (07-UI §4.7): every event in the chain, a hand-drawn filter, the chain badge,
 * and an export. The events are the same ones the run screen folded — the screen never
 * recalculates a total.
 */
import { useMemo, useState } from 'react';
import { Download, Lock } from 'lucide-react';
import type { PbpEvent } from '../model';
import { hms, money } from '../format';

type Filter = 'all' | 'payments' | 'human' | 'errors';

const FILTERS: { id: Filter; label: string; types: string[] | null }[] = [
  { id: 'all', label: 'All events', types: null },
  { id: 'payments', label: 'Payments', types: ['intent.proposed', 'intent.checked', 'payment.submitted', 'receipt.updated'] },
  { id: 'human', label: 'Human actions', types: ['human.action'] },
  { id: 'errors', label: 'Errors', types: ['error'] },
];

const TITLES: Record<string, string> = {
  'ledger.opened': 'Ledger opened',
  'history.seeded': 'History seeded',
  'run.started': 'Run started',
  'item.read': 'Email read',
  'item.classified': 'Email classified',
  'claim.extracted': 'Invoice extracted',
  'change_request.recorded': 'Payee change recorded',
  'risk.flagged': 'Risk flags',
  'intent.proposed': 'Payment proposed',
  'intent.checked': 'Gate decision',
  'intent.explained': 'Explanation written',
  'payment.submitted': 'Sent to PayPal',
  'receipt.updated': 'PayPal receipt',
  'human.action': 'Human action',
  'run.summarized': 'Run summarized',
  'run.completed': 'Run completed',
  error: 'Error',
};

export function LedgerView({ events, verified }: { events: PbpEvent[]; verified: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0]!;

  const rows = useMemo(() => {
    const list = active.types === null ? events : events.filter((event) => active.types?.includes(event.type));
    return [...list].reverse();
  }, [events, active]);

  return (
    <section className="card ledger-screen" aria-label="Ledger">
      <div className="ledger-screen-head">
        <h1 className="run-title">Ledger</h1>
        <span className="run-meta">{events.length} events · append-only · hash-chained</span>
        <span className={`chain-badge${verified ? ' is-ok' : ' is-broken'}`}>
          <Lock size={14} strokeWidth={1.5} aria-hidden />
          {verified ? `Chain verified · ${events.length} events` : 'Chain broken'}
        </span>
      </div>

      <div className="ledger-screen-toolbar">
        <div className="filters" role="group" aria-label="Filter events">
          {FILTERS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`filter${entry.id === filter ? ' is-on' : ''}`}
              aria-pressed={entry.id === filter}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            const body = events.map((event) => JSON.stringify(event)).join('\n');
            download('ledger.jsonl', `${body}\n`, 'application/x-ndjson');
          }}
        >
          <Download size={16} strokeWidth={1.5} aria-hidden />
          Export ledger
        </button>
      </div>

      <div className="ledger-rows">
        {rows.map((event) => (
          <div className="ledger-row" key={event.seq}>
            <span className="ledger-seq mono">#{event.seq}</span>
            <span className="ledger-at mono">{hms(event.at)}</span>
            <span className="ledger-title">{TITLES[event.type] ?? event.type}</span>
            <span className="ledger-detail mono">{detailOf(event)}</span>
            <span className="ledger-hash mono">{event.hash.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function detailOf(event: PbpEvent): string {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'intent.checked':
      return `${String(data.intentId)} · ${String(data.decision)}`;
    case 'receipt.updated':
      return `${String(data.intentId)} · ${String(data.railStatus)} → ${String(data.proof)}`;
    case 'payment.submitted':
      return `${String(data.intentId)} · batch ${String(data.senderBatchId).slice(0, 14)}…`;
    case 'human.action':
      return `${String(data.action)} · ${String(data.by ?? '')}`;
    case 'error':
      return `${String(data.scope)} · ${String(data.message)}`;
    case 'intent.proposed':
      return `${String(data.intentId)} · ${money(Number(data.amount))}`;
    case 'claim.extracted':
      return `${String((data.claim as { invoiceNumber?: string })?.invoiceNumber ?? '')}`;
    case 'item.read':
      return `${String(data.itemId)} · ${String(data.subject ?? '')}`;
    case 'run.completed':
      return 'totals frozen';
    default:
      return '';
  }
}

export function download(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
