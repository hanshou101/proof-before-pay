/**
 * The only place the browser talks to the server (SPEC §6.8: the UI reads `/api/state` and SSE
 * and never computes a business result itself).
 *
 * Everything below is a thin `fetch`; errors carry the server's own human sentence, because the
 * server already writes one ("Add PAYPAL_CLIENT_ID to .env — nothing was sent.").
 */

import type { LedgerEvent, PbpEvent } from './model';

export interface ServerInboxRow {
  itemId: string;
  from: string;
  subject: string;
  receivedAt: string;
  layout: string;
  bodyText: string;
  attachments: string[];
  files: { name: string; sha256: string; url: string }[];
  business: string | null;
  intentId: string | null;
  classification: string | null;
}

export interface ServerLedger {
  verified: boolean;
  brokenAtSeq: number | null;
  head: number;
  droppedTornTail: boolean;
  checkedAt: string;
}

export interface ServerRun {
  phase: 'idle' | 'running' | 'done';
  runId: string | null;
  mode: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ServerError {
  scope: string;
  message: string;
  detail: string | null;
  at?: string;
  seq?: number;
}

export interface ServerIntent {
  id: string;
  itemId: string;
  vendorId: string | null;
  agreementId: string | null;
  amount: number;
  currency: 'USD';
  state: string;
  decision: string | null;
  checks: unknown[] | null;
  explanation?: { text: string; source: 'model' | 'template' } | null;
  submission?: { senderBatchId: string; payoutBatchId: string | null; attempt: number; at: string } | null;
  receipt?: {
    railStatus: string;
    proof: string;
    payoutItemId: string | null;
    transactionId: string | null;
    fetchedAt: string;
  } | null;
  approvedAmount?: number | null;
  idempotencyKey: string;
}

export interface ServerState {
  ok: boolean;
  epoch: string;
  scenario: string;
  version: string;
  head: number;
  ledger: ServerLedger;
  run: ServerRun;
  inbox: ServerInboxRow[];
  vendors: {
    id: string;
    name: string;
    business: string;
    payee: { receiver: string };
    priorPayments: number;
  }[];
  intents: Record<string, ServerIntent>;
  byItem: Record<string, string>;
  totals: {
    proven: { count: number; amount: number };
    awaitingProof: { count: number; amount: number };
    held: { count: number; amount: number };
    stopped: { count: number; amount: number };
  };
  ignored: { count: number };
  errors: ServerError[];
}

export interface ComparisonPayoutRow {
  toolCallId: string;
  receiver: string;
  /** The sandbox account PayPal actually received (SPEC §6.5.5); null when the send failed. */
  receiverSent?: string | null;
  amount: number;
  memo: string;
  senderBatchId: string | null;
  payoutBatchId: string | null;
  railStatus: string | null;
  transactionId: string | null;
  fetchedAt: string | null;
}

export interface ComparisonState {
  ok: boolean;
  epoch: string;
  runId: string | null;
  head: number;
  verified: boolean;
  payouts: ComparisonPayoutRow[];
  summary: { text: string; at: string } | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as { error?: string; code?: string };
    throw new ApiError(
      record.error ?? `The server answered ${response.status}.`,
      response.status,
      record.code ?? null,
    );
  }
  return body as T;
}

export async function fetchState(): Promise<ServerState> {
  return readJson<ServerState>(await fetch('/api/state', { headers: { accept: 'application/json' } }));
}

export async function startRun(mode: 'proof' | 'comparison' = 'proof'): Promise<{ runId: string }> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return readJson<{ runId: string }>(response);
}

export async function act(
  intentId: string,
  action: string,
  input: Record<string, unknown> = {},
): Promise<{ intent: ServerIntent }> {
  const response = await fetch(`/api/intents/${encodeURIComponent(intentId)}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, input }),
  });
  return readJson<{ intent: ServerIntent }>(response);
}

export async function fetchBundle(intentId: string): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(
    await fetch(`/api/intents/${encodeURIComponent(intentId)}/bundle`, { headers: { accept: 'application/json' } }),
  );
}

export async function fetchComparison(): Promise<ComparisonState> {
  return readJson<ComparisonState>(await fetch('/api/comparison/state', { headers: { accept: 'application/json' } }));
}

export async function resetDemo(): Promise<{ epoch: string }> {
  const response = await fetch('/api/demo/reset', { method: 'POST' });
  return readJson<{ epoch: string }>(response);
}

export interface EventStream {
  close(): void;
}

/**
 * `GET /api/events?since=` — the ledger from `since` onwards, then live (SPEC §6.7).
 * A reconnect replays from the last seq we saw, so no event is lost and none is applied twice.
 */
export function subscribe(
  since: number,
  onEvent: (event: PbpEvent) => void,
  onStatus?: (status: 'open' | 'closed') => void,
): EventStream {
  let last = since;
  let closed = false;
  let source: EventSource | null = null;

  const open = (): void => {
    if (closed) return;
    source = new EventSource(`/api/events?since=${last}`);
    source.addEventListener('ledger', (message) => {
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as LedgerEvent;
        if (typeof event.seq === 'number' && event.seq <= last) return;
        last = event.seq;
        onEvent(event as PbpEvent);
      } catch {
        // A frame we cannot parse is skipped; the next reconnect replays from `last`.
      }
    });
    source.onopen = () => onStatus?.('open');
    source.onerror = () => {
      onStatus?.('closed');
      source?.close();
      if (!closed) setTimeout(open, 1500);
    };
  };

  open();

  return {
    close: () => {
      closed = true;
      source?.close();
    },
  };
}
