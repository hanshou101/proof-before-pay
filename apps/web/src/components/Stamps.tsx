import {
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Hourglass,
  LoaderCircle,
  Minus,
} from 'lucide-react';
import type { StampState, Tone } from '../state/reduce';

const ICONS = {
  pending: CircleDashed,
  checking: LoaderCircle,
  pass: CircleCheck,
  hold: CircleAlert,
  fail: CircleX,
  na: Minus,
  proven: BadgeCheck,
  awaiting: Hourglass,
} as const;

const LABELS: Record<StampState, string> = {
  pending: 'Not checked yet',
  checking: 'Checking',
  pass: 'Passed',
  hold: 'On hold',
  fail: 'Failed',
  na: 'Not applicable',
  proven: 'Proven by PayPal',
  awaiting: 'Waiting for PayPal',
};

export function Stamp({ state }: { state: StampState }) {
  const Icon = ICONS[state];
  return (
    <span className={`stamp stamp--${state}`} role="img" aria-label={LABELS[state]} title={LABELS[state]}>
      <Icon size={20} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

export function StatusChip({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`chip chip--${tone}`}>
      {/* D1-6: the turning mark is what says "in flight" once the tint alone is invisible. */}
      {tone === 'progress' ? <LoaderCircle size={12} strokeWidth={2} aria-hidden /> : null}
      {text}
    </span>
  );
}

/**
 * The signature moment: a zero standing in for the letter "o". The mark keeps
 * the danger tint and pulses once (150ms) when it appears (07-UI §3).
 */
export function ZeroMark({ text }: { text: string }) {
  const index = text.indexOf('studi0');
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index + 5)}
      <mark className="zero-mark">0</mark>
      {text.slice(index + 6)}
    </>
  );
}
