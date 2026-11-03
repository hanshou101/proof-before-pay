import { useState } from 'react';
import { CircleCheck, CircleX, Phone } from 'lucide-react';
import { money } from '../format';
import type { DetailModel } from '../state/reduce';
import { CloseButton } from './DetailPanel';
import { ZeroMark } from './Stamps';

/**
 * "Verify payee" dialog (07-UI §4.7). Radio options and the notes field are
 * drawn by hand — no native radio/input chrome (AGENTS §4.6).
 */
export function VerifyPayeeDialog({
  detail,
  amount,
  onClose,
  onSubmit,
  submitting = false,
}: {
  detail: DetailModel;
  amount: number | null;
  onClose?: () => void;
  /** Records the result on the server (`verify_payee`) — the gate re-checks afterwards. */
  onSubmit?: (result: 'confirmed' | 'not_confirmed', note: string) => void | Promise<void>;
  submitting?: boolean;
}) {
  const payee = detail.sections.find((section) => section.kind === 'payee');
  const [result, setResult] = useState<'confirmed' | 'not_confirmed'>('not_confirmed');
  const [note, setNote] = useState('Ana confirmed by phone she never changed her payment details.');

  if (!payee || payee.kind !== 'payee') return null;

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="verify-title">
        <header className="dialog-head">
          <div>
            <h2 id="verify-title" className="drawer-title">
              Verify payee
            </h2>
            <p className="drawer-sub">{detail.subtitle}</p>
          </div>
          <CloseButton onClick={onClose} />
        </header>

        <div className="dialog-body">
          <div className="verify-pair">
            <div className="verify-card verify-card--ok">
              <span className="verify-label">
                <CircleCheck size={16} strokeWidth={1.5} aria-hidden />
                On file
              </span>
              <span className="mono verify-email">{payee.onFile.email}</span>
              <span className="verify-note">{payee.onFile.note}</span>
            </div>
            <div className="verify-card verify-card--bad">
              <span className="verify-label">
                <CircleX size={16} strokeWidth={1.5} aria-hidden />
                Requested
              </span>
              <span className="mono verify-email">
                <ZeroMark text={payee.requested.email} />
              </span>
              <span className="verify-note">{payee.requested.note}</span>
            </div>
          </div>

          <p className="verify-instruction">
            <Phone size={16} strokeWidth={1.5} aria-hidden />
            Call the number on file — not the one in the email.
          </p>

          <div className="verify-options" role="radiogroup" aria-label="Result">
            <button
              type="button"
              role="radio"
              aria-checked={result === 'confirmed'}
              className={`radio-row${result === 'confirmed' ? ' is-checked' : ''}`}
              onClick={() => setResult('confirmed')}
            >
              <span className="radio-dot" aria-hidden="true" />
              Confirmed by phone
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={result === 'not_confirmed'}
              className={`radio-row${result === 'not_confirmed' ? ' is-checked' : ''}`}
              onClick={() => setResult('not_confirmed')}
            >
              <span className="radio-dot" aria-hidden="true" />
              Not confirmed — likely fraud
            </button>
          </div>

          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              className="field-input"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        <footer className="dialog-foot">
          <span className="dialog-amount-wrap">
            {/* D1-10: the figure in the footer was money with no noun. */}
            <span className="dialog-amount-label">Held amount</span>
            <span className="dialog-amount mono">{money(amount)}</span>
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={submitting}
            onClick={() => void onSubmit?.(result, note)}
          >
            {submitting ? 'Recording…' : 'Record result'}
          </button>
        </footer>
      </div>
    </>
  );
}
