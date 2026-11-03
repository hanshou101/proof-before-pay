/**
 * The live application (SPEC §6.8): `/api/state` for the snapshot, `/api/events` for everything
 * that happens after it, `reduce()` for the screen. No business decision is taken here — the
 * four stamps, the totals and the row states all come out of ledger events the server wrote.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  act,
  fetchBundle,
  fetchComparison,
  fetchState,
  startRun,
  subscribe,
  type ComparisonState,
  type ServerState,
} from './api';
import { bundleToModel, type ServerBundle } from './bundle';
import { DetailPanel } from './components/DetailPanel';
import { HeroSkeleton } from './components/HeroSkeleton';
import { Logo } from './components/Logo';
import { ProofBundleDrawer } from './components/ProofBundleDrawer';
import { RunHero } from './components/RunHero';
import { RunList } from './components/RunList';
import { VerifyPayeeDialog } from './components/VerifyPayeeDialog';
import type { PbpEvent } from './model';
import { detailOf, reduce, type DetailAction, type InboxSeedItem } from './state/reduce';
import { ComparisonView } from './views/ComparisonView';
import { InboxView } from './views/InboxView';
import { LedgerView } from './views/LedgerView';

export type Screen = 'run' | 'inbox' | 'ledger' | 'comparison';

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'run', label: 'Payout run' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'comparison', label: 'Comparison' },
];

export function LiveApp() {
  const [snapshot, setSnapshot] = useState<ServerState | null>(null);
  const [events, setEvents] = useState<PbpEvent[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(() => screenFromUrl());
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('select'),
  );
  const [drawer, setDrawer] = useState<ServerBundle | null>(null);
  const [modal, setModal] = useState<'verify' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [comparisonUnavailable, setComparisonUnavailable] = useState<string | null>(null);
  const [comparisonRunning, setComparisonRunning] = useState(false);
  const streamRef = useRef<{ close(): void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((state) => {
        if (cancelled) return;
        setSnapshot(state);
        streamRef.current = subscribe(0, (event) => setEvents((previous) => [...previous, event]));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      streamRef.current?.close();
    };
  }, []);

  const seed: InboxSeedItem[] = useMemo(
    () =>
      (snapshot?.inbox ?? []).map((row) => ({
        itemId: row.itemId,
        from: row.from,
        subject: row.subject,
        receivedAt: row.receivedAt,
        attachments: row.attachments,
        business: row.business ?? undefined,
      })),
    [snapshot],
  );

  const vendors = useMemo(() => {
    const directory: Record<string, { name: string; business: string }> = {};
    for (const vendor of snapshot?.vendors ?? []) {
      directory[vendor.id] = { name: vendor.name, business: vendor.business };
    }
    return directory;
  }, [snapshot]);

  // `?until=<seq>` stops the replay at one ledger row. It exists so the screenshot script can
  // photograph a *real* run mid-flight (`hero-running`) without replaying it against PayPal; the
  // events are still the ones the server wrote, only fewer of them.
  const until = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('until');
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  }, []);
  const visible = useMemo(
    () => (until === null ? events : events.filter((event) => event.seq <= until)),
    [events, until],
  );

  const view = useMemo(() => reduce(visible, seed, { vendors }), [visible, seed, vendors]);
  const active = selected ?? view.selected;
  const detail = detailOf(view, active);
  const row = view.rows.find((candidate) => candidate.itemId === active);

  // Comparison mode is off unless the server allows it (AC-14); ask, and say why if not.
  const loadComparison = useCallback(async () => {
    try {
      setComparison(await fetchComparison());
      setComparisonUnavailable(null);
    } catch (error) {
      setComparisonUnavailable(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (screen === 'comparison') void loadComparison();
  }, [screen, loadComparison]);

  const refreshBundle = useCallback(async (intentId: string, withReceipt: boolean) => {
    if (withReceipt) await act(intentId, 'refresh_receipt');
    const raw = (await fetchBundle(intentId)) as unknown as ServerBundle;
    setDrawer(raw);
  }, []);

  // The drawer's developer-only lines follow the switch even when it is flipped while open.
  const drawerModel = useMemo(() => (drawer ? bundleToModel(drawer, { dev: devMode }) : null), [drawer, devMode]);

  const runPayouts = useCallback(async () => {
    setNotice(null);
    try {
      await startRun('proof');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const onAction = useCallback(
    async (action: DetailAction) => {
      if (!active) return;
      const intentId = view.rows.find((candidate) => candidate.itemId === active)?.intentId;
      setNotice(null);

      if (action.label === 'Open proof bundle' && intentId) {
        setBusy('bundle');
        try {
          await refreshBundle(intentId, false);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(null);
        }
        return;
      }
      if (action.label === 'Verify by phone') {
        setModal('verify');
        return;
      }
      if (!intentId) return;

      const request = (name: string, input: Record<string, unknown> = {}) => act(intentId, name, input);
      setBusy(action.label);
      try {
        if (action.label === 'Reject as fraud') await request('mark_fraud', { reason: 'Payee change could not be verified' });
        else if (action.label === 'Reject') await request('reject', { reason: 'Rejected by ops' });
        else if (action.label === 'Refresh receipt') await request('refresh_receipt');
        else if (action.label === 'Cancel payout') await request('cancel_payout', { reason: 'Cancelled from the run list' });
        else if (action.label === 'Accept delivery') {
          await request('accept_delivery', { deliveryId: detail.deliveryId ?? '' });
        } else if (action.label.startsWith('Approve')) {
          const cap = /Approve up to \$([\d,]+\.\d{2})/.exec(action.label)?.[1]?.replace(/,/g, '');
          await request('approve', cap ? { amount: Math.round(Number(cap) * 100) } : {});
        } else {
          setNotice(`"${action.label}" is not wired to the server yet.`);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
        void refreshSnapshot(setSnapshot);
      }
    },
    [active, detail.sections, refreshBundle, view.rows],
  );

  const primary = view.button;
  const heldRows = view.rows.filter((candidate) => candidate.tone === 'warning');

  if (failure !== null) {
    return <CannotReachServer message={failure} />;
  }
  if (snapshot === null) {
    return <HeroSkeleton />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <Logo className="brand-mark" />
            <span className="brand-name">Proof Before Pay</span>
            <span className="topbar-divider" aria-hidden="true" />
            <span className="studio-name">Lumen &amp; Lark Studio</span>
          </div>
          <nav className="topnav" aria-label="Screens">
            {SCREENS.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`topnav-tab${screen === entry.id ? ' is-on' : ''}`}
                aria-current={screen === entry.id ? 'page' : undefined}
                onClick={() => setScreen(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="sandbox-chip">
              <span className="dot dot--success" aria-hidden="true" />
              PayPal sandbox
            </span>
            <div className="avatar-wrap">
              <button
                type="button"
                className="avatar avatar--menu"
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                M
                <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              </button>
              {menuOpen ? (
                <>
                  <div className="menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                  <div className="menu" role="menu">
                    <button
                      type="button"
                      className="menu-row"
                      role="menuitemcheckbox"
                      aria-checked={devMode}
                      onClick={() => {
                        setDevMode((on) => !on);
                        setMenuOpen(false);
                      }}
                    >
                      <span>Developer details</span>
                      <span className={`switch${devMode ? ' is-on' : ''}`} aria-hidden="true">
                        <span className="switch-knob" />
                      </span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <button
              type="button"
              className={`btn btn--primary${view.phase === 'running' ? ' is-running' : ''}`}
              disabled={primary.disabled || (view.phase === 'done' && heldRows.length === 0)}
              onClick={() => {
                if (view.phase === 'done') {
                  setSelected(heldRows[0]?.itemId ?? null);
                  setScreen('run');
                  return;
                }
                void runPayouts();
              }}
            >
              {primary.label}
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        {notice ? (
          <div className="run-banner run-banner--global" role="alert">
            <span className="run-banner-text">{notice}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {screen === 'run' ? (
          <>
            <RunHero view={view} />
            <div className="work">
              <RunList
                state={view}
                selected={active}
                onSelect={setSelected}
                verified={snapshot.ledger.verified}
              />
              <DetailPanel
                detail={detail}
                devMode={devMode}
                rawEvents={visible
                  .filter((event) => {
                    const data = event.data as { intentId?: string; itemId?: string };
                    return data.intentId === row?.intentId || data.itemId === row?.itemId;
                  })
                  .map((event) => ({ seq: event.seq, type: event.type }))}
                onAction={(action) => void onAction(action)}
              />
            </div>
          </>
        ) : null}

        {screen === 'inbox' ? <InboxView inbox={snapshot.inbox} /> : null}

        {screen === 'ledger' ? (
          <LedgerView events={visible} verified={snapshot.ledger.verified && view.ledgerVerified} />
        ) : null}

        {screen === 'comparison' ? (
          <ComparisonView
            state={comparison}
            unavailable={comparisonUnavailable}
            running={comparisonRunning}
            devMode={devMode}
            onRun={() => {
              setComparisonRunning(true);
              setNotice(null);
              startRun('comparison')
                .then(async () => {
                  // The comparison agent makes its own model calls; poll until the summary lands.
                  for (let attempt = 0; attempt < 120; attempt += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    const next = await fetchComparison();
                    setComparison(next);
                    if (next.summary !== null) break;
                  }
                })
                .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)))
                .finally(() => setComparisonRunning(false));
            }}
          />
        ) : null}
      </main>

      {drawer && drawerModel ? (
        <ProofBundleDrawer
          bundle={drawerModel}
          onClose={() => setDrawer(null)}
          onVerifyAgain={
            drawerModel.intentId
              ? async () => {
                  setBusy('verify-again');
                  try {
                    await refreshBundle(drawerModel.intentId, true);
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : String(error));
                  } finally {
                    setBusy(null);
                  }
                }
              : undefined
          }
          verifying={busy === 'verify-again'}
          onExport={() => {
            const body = `${JSON.stringify(drawer, null, 2)}\n`;
            const blob = new Blob([body], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${drawer.intentId}-proof-bundle.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        />
      ) : null}

      {modal === 'verify' && detail.kind === 'held' && row?.intentId ? (
        <VerifyPayeeDialog
          detail={detail}
          amount={row.amount}
          onClose={() => setModal(null)}
          onSubmit={async (result, note) => {
            setBusy('verify');
            try {
              await act(row.intentId!, 'verify_payee', {
                result,
                method: 'phone_call',
                note,
              });
              setModal(null);
              void refreshSnapshot(setSnapshot);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : String(error));
            } finally {
              setBusy(null);
            }
          }}
          submitting={busy === 'verify'}
        />
      ) : null}
    </div>
  );
}

async function refreshSnapshot(set: (state: ServerState) => void): Promise<void> {
  try {
    set(await fetchState());
  } catch {
    // The ledger is the source of truth; a failed snapshot refresh must not blank the screen.
  }
}

function screenFromUrl(): Screen {
  const value = new URLSearchParams(window.location.search).get('screen');
  return value === 'inbox' || value === 'ledger' || value === 'comparison' ? value : 'run';
}

function CannotReachServer({ message }: { message: string }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <Logo className="brand-mark" />
            <span className="brand-name">Proof Before Pay</span>
          </div>
        </div>
      </header>
      <main className="not-connected">
        <div className="card not-connected-card">
          <h1 className="not-connected-title">The server is not answering</h1>
          <p className="detail-text">
            Nothing can be paid while the ledger is unreachable. Start it with <code>npm run dev</code> and
            reload this page.
          </p>
          <p className="detail-text mono">{message}</p>
        </div>
      </main>
    </div>
  );
}
