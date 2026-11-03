import { BadgeCheck, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleX, FileText, Phone, RefreshCw, Shield, Sparkles, X } from 'lucide-react';
import type { DetailAction, DetailModel, DetailSection, TimelineStep } from '../state/reduce';
import { StatusChip, ZeroMark, Stamp } from './Stamps';

export function DetailPanel({
  detail,
  onAction,
  devMode = false,
  rawEvents = [],
}: {
  detail: DetailModel;
  onAction?: (action: DetailAction) => void;
  devMode?: boolean;
  rawEvents?: { seq: number; type: string }[];
}) {
  return (
    <aside className={`card detail${devMode ? ' is-dev' : ''}`} aria-label="Payment details">
      <div className="detail-body">
        <div className="detail-head">
          {detail.status ? <StatusChip text={detail.status.text} tone={detail.status.tone} /> : null}
          <h2 className="detail-title">{detail.title}</h2>
        </div>
        {detail.subtitle ? <p className="detail-sub">{detail.subtitle}</p> : null}
        {detail.sections.map((section, index) => (
          <Section key={`${section.kind}-${index}`} section={section} />
        ))}
      </div>
      {detail.actions.length > 0 ? (
        <div className="detail-actions">
          {detail.actions.map((action) => (
            <ActionButton key={action.label} action={action} onAction={onAction} />
          ))}
        </div>
      ) : null}
      {/* The proof log and the raw event list carry the same developer detail;
          in developer mode the list replaces the log so the panel keeps its
          height at 1280x720 (07-UI §4.6). */}
      {devMode && rawEvents.length > 0 ? (
        <details className="raw">
          <summary className="raw-summary">Raw events</summary>
          <pre className="raw-body mono">
            {rawEvents.map((event) => JSON.stringify(event)).join('\n')}
          </pre>
        </details>
      ) : detail.footer ? (
        <p className="detail-foot mono">{detail.footer}</p>
      ) : null}
    </aside>
  );
}

function Section({ section }: { section: DetailSection }) {
  switch (section.kind) {
    case 'message':
      return <p className="detail-text">{section.text}</p>;
    case 'payee':
      return (
        <section className="detail-section detail-section--payee">
          <h3 className="section-label">Payee check</h3>
          <div className="payee-row">
            <CircleCheck size={16} strokeWidth={1.5} className="tone-success" aria-hidden />
            <div className="payee-main">
              <span className="payee-label">On file · {section.onFile.note}</span>
              <span className="mono payee-email">{section.onFile.email}</span>
            </div>
          </div>
          <div className="payee-row">
            <CircleX size={16} strokeWidth={1.5} className="tone-danger" aria-hidden />
            <div className="payee-main">
              <span className="payee-label">Requested · {section.requested.note}</span>
              <span className="mono payee-email">
                <ZeroMark text={section.requested.email} />
              </span>
            </div>
          </div>
        </section>
      );
    case 'note':
      return (
        <section className="detail-section">
          <h3 className="section-label">
            <Sparkles size={14} strokeWidth={1.5} aria-hidden />
            AI risk note
            {section.ai ? <span className="ai-tag">AI</span> : null}
          </h3>
          <p className="note-text">{section.text}</p>
        </section>
      );
    case 'why':
      return (
        <section className="detail-section">
          <h3 className="section-label">{section.title}</h3>
          <ul className="why-list">
            {section.items.map((item) => (
              <li key={item.text} className={`why-item why-item--${item.tone}`}>
                <CircleAlert size={14} strokeWidth={1.5} aria-hidden />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'timeline':
      return <Timeline items={section.items} />;
    case 'callout':
      return (
        <section className="detail-section">
          <h3 className="section-label">{section.title}</h3>
          <p className="detail-text">{section.text}</p>
        </section>
      );
    case 'legend':
      return (
        <section className="detail-section">
          <h3 className="section-label">{section.title}</h3>
          <ol className="legend">
            {section.items.map((item) => (
              <li className="legend-step" key={item.label}>
                <Stamp state={item.stamp} />
                <span className="legend-label">{item.label}</span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'facts':
      return (
        <section className="detail-section">
          {section.title ? <h3 className="section-label">{section.title}</h3> : null}
          <dl className="fact-list">
            {section.items.map((item) => (
              <div className="fact-row" key={item.label}>
                <dt>
                  {item.stamp ? <Stamp state={item.stamp} /> : null}
                  {item.label}
                </dt>
                <dd className={item.mono ? 'mono' : undefined}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
  }
}

export function Timeline({ items }: { items: TimelineStep[] }) {
  return (
    <ol className="timeline">
      {items.map((item) => {
        const state = item.state ?? 'done';
        const Mark = state === 'proven' ? BadgeCheck : state === 'pending' ? CircleDashed : CircleCheck;
        return (
          <li className="timeline-row" key={item.label}>
            <span className={`timeline-mark timeline-mark--${state}`} aria-hidden="true">
              <Mark size={14} strokeWidth={1.5} />
            </span>
            <span className="timeline-label">{item.label}</span>
            <span className="timeline-note">{item.note}</span>
            <span className="timeline-at mono">{item.at}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ACTION_ICONS = {
  phone: Phone,
  doc: FileText,
  refresh: RefreshCw,
  chevron: ChevronRight,
  shield: Shield,
} as const;

function ActionButton({
  action,
  onAction,
}: {
  action: DetailAction;
  onAction?: (action: DetailAction) => void;
}) {
  const Icon = action.icon ? ACTION_ICONS[action.icon] : null;
  return (
    <button
      type="button"
      className={`btn btn--${action.kind} btn--sm`}
      disabled={action.disabled}
      title={action.hint}
      onClick={() => onAction?.(action)}
    >
      {Icon ? <Icon size={16} strokeWidth={1.5} aria-hidden /> : null}
      {action.label}
    </button>
  );
}

export function CloseButton({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} aria-label="Close">
      <X size={18} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
