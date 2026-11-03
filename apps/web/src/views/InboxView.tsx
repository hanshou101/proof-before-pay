/**
 * Inbox screen (07-UI §4.7): the nine emails, the original on the right, and what the AI said
 * each one was. Nothing here decides anything — the labels come from `item.classified` events.
 */
import { useState } from 'react';
import { FileText, Mail } from 'lucide-react';
import type { ServerInboxRow } from '../api';
import { dateTime } from '../format';

const LABELS: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' }> = {
  invoice: { text: 'Invoice', tone: 'success' },
  payee_change_request: { text: 'Payee change request', tone: 'warning' },
  'invoice+payee_change_request': { text: 'Invoice · Payee change request', tone: 'warning' },
  other: { text: 'Not an invoice', tone: 'neutral' },
};

export function InboxView({ inbox }: { inbox: ServerInboxRow[] }) {
  const [selected, setSelected] = useState<string>(inbox[0]?.itemId ?? '');
  const item = inbox.find((row) => row.itemId === selected) ?? inbox[0];

  return (
    <section className="card inbox" aria-label="Inbox">
      <div className="inbox-head">
        <h1 className="run-title">Inbox · this week</h1>
        <span className="run-meta">{inbox.length} emails · 7 freelancers · 1 notice</span>
      </div>
      <div className="inbox-body">
        <ul className="inbox-list">
          {inbox.map((row) => {
            const label = row.classification ? LABELS[row.classification] : null;
            return (
              <li key={row.itemId}>
                <button
                  type="button"
                  className={`inbox-row${row.itemId === item?.itemId ? ' is-selected' : ''}`}
                  onClick={() => setSelected(row.itemId)}
                >
                  <span className="inbox-row-top">
                    <span className="inbox-from">{row.from.replace(/\s*<.*>$/, '')}</span>
                    <span className="inbox-at mono">{dateTime(row.receivedAt)}</span>
                  </span>
                  <span className="inbox-subject">{row.subject}</span>
                  <span className="inbox-row-bottom">
                    {label ? (
                      <span className={`chip chip--${label.tone}`}>{label.text}</span>
                    ) : (
                      <span className="chip chip--neutral">Not read yet</span>
                    )}
                    <span className="inbox-files">
                      {row.attachments.map((name) => (
                        <span className="file-chip" key={name}>
                          <FileText size={12} strokeWidth={1.5} aria-hidden />
                          {name}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {item ? (
          <article className="inbox-preview" aria-label="Original message">
            <header className="preview-head">
              <span className="section-label">
                <Mail size={14} strokeWidth={1.5} aria-hidden />
                Original
              </span>
              <h2 className="preview-subject">{item.subject}</h2>
              <p className="preview-meta mono">
                {item.from} · {dateTime(item.receivedAt)}
              </p>
            </header>
            <pre className="preview-body">{item.bodyText}</pre>
            {item.files.length > 0 ? (
              <footer className="preview-foot">
                {item.files.map((file) => (
                  <a
                    className="file-chip file-chip--link"
                    key={file.name}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={12} strokeWidth={1.5} aria-hidden />
                    {file.name}
                    <span className="mono file-hash">{file.sha256.slice(0, 8)}</span>
                  </a>
                ))}
              </footer>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
