import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Logo } from './components/Logo';
import { DetailPanel } from './components/DetailPanel';
import { RunHero } from './components/RunHero';
import { RunList } from './components/RunList';
import { ProofBundleDrawer } from './components/ProofBundleDrawer';
import { VerifyPayeeDialog } from './components/VerifyPayeeDialog';
import { designErrorEvents, designEvents, designSeed, eventsUpTo } from './fixtures/design-run';
import { bundleOf, detailOf, reduce } from './state/reduce';
import { LiveApp } from './LiveApp';

const params = new URLSearchParams(window.location.search);
const fixture = params.get('fixture');

/**
 * Two entry points, one route:
 *   - `?fixture=design` replays the frozen event sequence (SPEC §7). It exists so the design can
 *     be re-shot and regressed without a sandbox, a model, or a payout.
 *   - everything else is the live app: `/api/state` + SSE (SPEC §6.8).
 */
export default function App() {
  if (fixture !== 'design') return <LiveApp />;
  return <FixtureApp />;
}

function FixtureApp() {
  const errorMode = params.get('error');
  const atRaw = params.get('at');

  const events = useMemo(() => {
    if (errorMode === 'paypal') return designErrorEvents;
    if (atRaw !== null && atRaw !== '') return eventsUpTo(designEvents, Number(atRaw));
    return designEvents;
  }, [atRaw, errorMode]);

  const state = useMemo(() => reduce(events, designSeed), [events]);
  const [selected, setSelected] = useState<string | null>(params.get('select') ?? state.selected);
  const [drawer, setDrawer] = useState<string | null>(params.get('drawer'));
  const [modal, setModal] = useState<string | null>(params.get('modal'));
  const [menuOpen, setMenuOpen] = useState(false);
  // 07-UI §4.6: developer details are off by default and only show raw events.
  const [devMode, setDevMode] = useState(false);

  const detail = detailOf(state, selected);
  const bundle = drawer ? bundleOf(state, drawer) : null;
  const row = state.rows.find((candidate) => candidate.itemId === selected);
  const rawEvents = events
    .filter((event) => {
      const data = event.data as { intentId?: string; itemId?: string };
      return data.intentId === row?.intentId || data.itemId === row?.itemId;
    })
    .map((event) => ({ seq: event.seq, type: event.type }));

  return (
    <div className="app">
      <TopBar
        buttonLabel={state.button.label}
        buttonDisabled={state.button.disabled}
        phase={state.phase}
        menuOpen={menuOpen}
        devMode={devMode}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onToggleDev={() => {
          setDevMode((on) => !on);
          setMenuOpen(false);
        }}
      />
      <main className="page">
        <RunHero view={state} />
        <div className="work">
          <RunList state={state} selected={selected} onSelect={setSelected} />
          <DetailPanel
            detail={detail}
            devMode={devMode}
            rawEvents={rawEvents}
            onAction={(action) => {
              if (action.label === 'Open proof bundle' && selected) setDrawer(selected);
              if (action.label === 'Verify by phone') setModal('verify');
            }}
          />
        </div>
      </main>

      {bundle ? <ProofBundleDrawer bundle={bundle} onClose={() => setDrawer(null)} /> : null}
      {modal === 'verify' && detail.kind === 'held' ? (
        <VerifyPayeeDialog detail={detail} amount={row?.amount ?? null} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}

function TopBar({
  buttonLabel,
  buttonDisabled,
  phase,
  menuOpen,
  devMode,
  onToggleMenu,
  onToggleDev,
}: {
  buttonLabel: string;
  buttonDisabled: boolean;
  phase: string;
  menuOpen: boolean;
  devMode: boolean;
  onToggleMenu: () => void;
  onToggleDev: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <Logo className="brand-mark" />
          <span className="brand-name">Proof Before Pay</span>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="studio-name">Lumen &amp; Lark Studio</span>
        </div>
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
              onClick={onToggleMenu}
            >
              M
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
            </button>
            {menuOpen ? (
              <>
                <div className="menu-scrim" onClick={onToggleMenu} aria-hidden="true" />
                <div className="menu" role="menu">
                  <button
                    type="button"
                    className="menu-row"
                    role="menuitemcheckbox"
                    aria-checked={devMode}
                    onClick={onToggleDev}
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
            className={`btn btn--primary${phase === 'running' ? ' is-running' : ''}`}
            disabled={buttonDisabled}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
