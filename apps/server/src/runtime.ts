// Runtime state for one server process: the ledger file, its projection, the human-action
// overlay the gate needs to see, and the SSE subscriber list.
//
// The projection is never stored — it is recomputed from the ledger on every append (SPEC §6.7
// "投影從不落盤，永遠由帳本重算"). Every append is validated by replaying *before* it is written,
// so the file can never contain a transition the state machine forbids.

import {
  appendEvent,
  fingerprint,
  replay,
  verifyChain,
  IllegalTransitionError,
  type CheckResult,
  type HistoryRecord,
  type IntentProjection,
  type IntentState,
  type LedgerEvent,
  type PayeeChangeRequest,
  type Projection,
} from '@pbp/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Clock } from './clock.js';
import type { ServerConfig } from './config.js';
import { LedgerFile, type LedgerLoad } from './ledger-file.js';
import type { LoadedDemo } from './scenario.js';
import type { Totals } from './types.js';

export interface SeededHistory {
  historyId: string;
  intentId: string;
  fingerprint: string;
  rail: string;
  senderBatchId: string;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  transactionId: string | null;
  railStatus: string;
  fetchedAt: string;
  amount: number;
  currency: string;
  receiver: string;
  /** The sandbox account the money actually went to (SPEC §6.5.5: never the `.example` one). */
  sandboxReceiver: string | null;
  seededAt: string;
}

export interface Overlay {
  /** Payee replaced by a confirmed `verify_payee` (SPEC §6.3.3). */
  vendorPayee: Map<string, { receiver: string; at: string; by: string; method: string }>;
  /** Every change request the agent recorded, with the status a human action gave it. */
  changeRequests: Map<string, PayeeChangeRequest>;
  /** Deliveries a human accepted during this epoch. */
  deliveryAccepted: Map<string, { acceptedAt: string; acceptedBy: string }>;
  /** When each intent was proposed — the gate's L2 buckets by this. */
  intentAt: Map<string, string>;
  /** How the agreement was matched (`po` / `ai`) — the projection does not keep it. */
  intentAgreementMatchedBy: Map<string, 'po' | 'ai' | null>;
  /** `history.seeded` events, so restart knows which history rows are already paid. */
  sealedHistory: Map<string, string>;
  /**
   * Intents a human asked to cancel. The rail only remembers "we cancelled this" inside the
   * process that sent the request, so after a restart it cannot tell our own `RETURNED` apart
   * from the 30-day auto-return — this set is what carries that fact across a restart.
   */
  cancelRequested: Set<string>;
}

function emptyOverlay(): Overlay {
  return {
    vendorPayee: new Map(),
    changeRequests: new Map(),
    deliveryAccepted: new Map(),
    intentAt: new Map(),
    intentAgreementMatchedBy: new Map(),
    sealedHistory: new Map(),
    cancelRequested: new Set(),
  };
}

export interface RuntimeInit {
  config: ServerConfig;
  demo: LoadedDemo;
  clock: Clock;
}

export class Runtime {
  readonly config: ServerConfig;
  readonly demo: LoadedDemo;
  readonly clock: Clock;
  readonly ledger: LedgerFile;
  readonly comparisonLedger: LedgerFile;

  events: LedgerEvent[] = [];
  head: LedgerEvent | null = null;
  projection: Projection;
  overlay: Overlay = emptyOverlay();
  loaded!: LedgerLoad;
  comparisonEvents: LedgerEvent[] = [];
  comparisonHead: LedgerEvent | null = null;
  history: Map<string, SeededHistory>;
  /**
   * The address each intent was actually sent to, after `PBP_RECEIVER_MAP` (SPEC §6.5.5).
   * Like `history.json`, this is a rail fact and not part of the hash chain: the ledger keeps
   * the scenario address, PayPal's own record keeps the sandbox one.
   */
  receivers: Map<string, { requested: string; sent: string }>;

  private listeners = new Set<(event: LedgerEvent) => void>();
  private comparisonListeners = new Set<(event: LedgerEvent) => void>();

  constructor(init: RuntimeInit) {
    this.config = init.config;
    this.demo = init.demo;
    this.clock = init.clock;
    this.ledger = new LedgerFile(join(init.config.dataDir, 'ledger.jsonl'));
    this.comparisonLedger = new LedgerFile(join(init.config.dataDir, 'comparison.jsonl'));
    this.projection = replay([]);
    this.history = new Map();
    this.receivers = new Map();
  }

  /** Load from disk, verify the chain, replay, rebuild the overlay. Throws on corruption. */
  open(): this {
    const loaded = this.ledger.load();
    if (!loaded.chain.ok) {
      throw new Error(`The ledger at ${this.ledger.path} is corrupt: chain breaks at seq ${loaded.chain.seq}.`);
    }
    this.loaded = loaded;
    this.events = loaded.events;
    this.head = loaded.head;
    // One clock per epoch (07-UI §4.4 / D1-11): a restarted process continues after the last row
    // the ledger already wrote, so the timeline never runs backwards on screen.
    this.clock.continueAfter?.(loaded.head?.at ?? null);
    this.projection = replay(this.events);
    this.overlay = rebuildOverlay(this.events, this.projection);
    this.history = this.loadHistoryFile();
    this.receivers = this.loadReceiversFile();

    const comparison = this.comparisonLedger.load();
    if (!comparison.chain.ok) {
      throw new Error(
        `The comparison ledger at ${this.comparisonLedger.path} is corrupt: chain breaks at seq ${comparison.chain.seq}.`,
      );
    }
    this.comparisonEvents = comparison.events;
    this.comparisonHead = comparison.head;

    if (this.events.length === 0) this.openEpoch(newEpoch());
    return this;
  }

  get epoch(): string {
    return this.projection.epoch ?? 'epoch-unopened';
  }

  get now(): string {
    return this.clock();
  }

  append(type: Parameters<typeof appendEvent>[1]['type'], data: unknown, at = this.clock()): LedgerEvent {
    const event = appendEvent(this.head, { type, data, at });
    const next = [...this.events, event];
    // Validate before persisting: a ledger that replay refuses must never reach the disk.
    const projection = replay(next);
    this.ledger.write(event);
    this.events = next;
    this.head = event;
    this.projection = projection;
    this.overlay = rebuildOverlay(next, projection);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  appendComparison(type: Parameters<typeof appendEvent>[1]['type'], data: unknown, at = this.clock()): LedgerEvent {
    const event = appendEvent(this.comparisonHead, { type, data, at });
    this.comparisonLedger.write(event);
    this.comparisonEvents = [...this.comparisonEvents, event];
    this.comparisonHead = event;
    for (const listener of this.comparisonListeners) listener(event);
    return event;
  }

  /** Start a fresh epoch: new idempotency keys, empty ledger (SPEC §6.2.4 `demo:reset`). */
  openEpoch(epoch: string): void {
    // A new epoch is a new story, so the demo clock may start at the scenario's Friday again.
    // Without this, every reset pushed the day forward by however long the last run took.
    this.clock.restart?.();
    this.ledger.reset();
    this.events = [];
    this.head = null;
    this.projection = replay([]);
    this.overlay = emptyOverlay();
    this.history = new Map();
    this.writeHistoryFile();
    this.receivers = new Map();
    this.writeReceiversFile();
    this.comparisonLedger.reset();
    this.comparisonEvents = [];
    this.comparisonHead = null;
    this.append('ledger.opened', {
      epoch,
      scenario: this.demo.scenario.scenario,
      version: this.demo.scenario.version,
    });
  }

  subscribe(listener: (event: LedgerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeComparison(listener: (event: LedgerEvent) => void): () => void {
    this.comparisonListeners.add(listener);
    return () => this.comparisonListeners.delete(listener);
  }

  eventsSince(seq: number): LedgerEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  intent(id: string): IntentProjection | undefined {
    return this.projection.intents[id];
  }

  intents(): IntentProjection[] {
    return Object.values(this.projection.intents);
  }

  claimOf(itemId: string): unknown | null {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event?.type === 'claim.extracted' && (event.data as { itemId?: string }).itemId === itemId) {
        return (event.data as { claim?: unknown }).claim ?? null;
      }
    }
    return null;
  }

  checksOf(intentId: string): CheckResult[] | null {
    return this.projection.intents[intentId]?.checks ?? null;
  }

  /** Totals exactly as `replay` computes them — the server never adds a second calculator. */
  totals(): Totals {
    return this.projection.totals;
  }

  /** `history` for the gate: scenario rows plus whatever `demo:reset` actually paid. */
  historyRecords(): HistoryRecord[] {
    return this.demo.scenario.history.map((entry) => {
      const seeded = this.history.get(entry.id);
      return {
        id: entry.id,
        itemId: entry.id,
        vendorId: entry.vendorId,
        agreementId: entry.agreementId,
        amount: entry.total,
        currency: entry.currency,
        payee: seeded
          ? { rail: 'paypal', recipientType: 'EMAIL', receiver: seeded.receiver }
          : null,
        fingerprint: fingerprint({
          vendorId: entry.vendorId,
          invoiceNumber: entry.invoiceNumber,
          currency: entry.currency,
          total: entry.total,
        }),
        idempotencyKey: seeded?.senderBatchId ?? '',
        at: seeded?.seededAt ?? this.demo.scenario.testClock,
        transactionId: seeded?.transactionId ?? null,
      };
    });
  }

  ledgerVerification(): { verified: boolean; seq: number | null; head: number; droppedTornTail: boolean } {
    const result = verifyChain(this.events);
    return {
      verified: result.ok,
      seq: result.ok ? null : result.seq,
      head: this.projection.head,
      droppedTornTail: Boolean(this.loaded?.droppedTornTail),
    };
  }

  recordHistory(record: SeededHistory): void {
    this.history.set(record.historyId, record);
    this.writeHistoryFile();
  }

  /** Remember where an intent was really sent (SPEC §6.5.5). Read back by the proof bundle. */
  recordReceiver(intentId: string, value: { requested: string; sent: string }): void {
    this.receivers.set(intentId, value);
    this.writeReceiversFile();
  }

  receiverOf(intentId: string): { requested: string; sent: string } | null {
    return this.receivers.get(intentId) ?? null;
  }

  private historyFile(): string {
    return join(this.config.dataDir, 'history.json');
  }

  private loadHistoryFile(): Map<string, SeededHistory> {
    try {
      const raw = JSON.parse(readFileSync(this.historyFile(), 'utf8')) as { records?: Record<string, SeededHistory> };
      return new Map(Object.entries(raw.records ?? {}));
    } catch {
      return new Map();
    }
  }

  private writeHistoryFile(): void {
    mkdirSync(dirname(this.historyFile()), { recursive: true });
    writeFileSync(
      this.historyFile(),
      `${JSON.stringify({ records: Object.fromEntries(this.history) }, null, 2)}\n`,
      'utf8',
    );
  }

  private receiversFile(): string {
    return join(this.config.dataDir, 'receivers.json');
  }

  private loadReceiversFile(): Map<string, { requested: string; sent: string }> {
    try {
      const raw = JSON.parse(readFileSync(this.receiversFile(), 'utf8')) as {
        records?: Record<string, { requested: string; sent: string }>;
      };
      return new Map(Object.entries(raw.records ?? {}));
    } catch {
      return new Map();
    }
  }

  private writeReceiversFile(): void {
    mkdirSync(dirname(this.receiversFile()), { recursive: true });
    writeFileSync(
      this.receiversFile(),
      `${JSON.stringify({ records: Object.fromEntries(this.receivers) }, null, 2)}\n`,
      'utf8',
    );
  }
}

function newEpoch(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  for (const byte of bytes) out += alphabet.charAt(byte % alphabet.length);
  return `ep-${out}`;
}

export { newEpoch };

/**
 * Fold the ledger's human actions onto the scenario data. Rebuilt (never patched) so a restart
 * sees exactly what the previous process had, and a hand-edited scenario cannot drift from it.
 */
export function rebuildOverlay(events: readonly LedgerEvent[], projection: Projection): Overlay {
  const overlay = emptyOverlay();

  for (const event of events) {
    switch (event.type) {
      case 'intent.proposed': {
        const data = event.data as { intentId: string; agreementMatchedBy?: 'po' | 'ai' | null };
        overlay.intentAt.set(data.intentId, event.at);
        overlay.intentAgreementMatchedBy.set(data.intentId, data.agreementMatchedBy ?? null);
        break;
      }
      case 'change_request.recorded': {
        const request = event.data as PayeeChangeRequest;
        overlay.changeRequests.set(request.id, { ...request });
        break;
      }
      case 'history.seeded': {
        const data = event.data as { historyId: string; intentId: string };
        overlay.sealedHistory.set(data.historyId, data.intentId);
        break;
      }
      case 'human.action': {
        const data = event.data as {
          intentId: string;
          action: string;
          by: string | null;
          input?: { result?: string | null; amount?: number; deliveryId?: string | null; method?: string | null } | null;
        };
        const intent = projection.intents[data.intentId];
        if (!intent) break;
        const vendorId = intent.vendorId;

        if (data.action === 'cancel_payout') {
          overlay.cancelRequested.add(data.intentId);
          break;
        }

        if (data.action === 'accept_delivery' && data.input?.deliveryId) {
          overlay.deliveryAccepted.set(data.input.deliveryId, {
            acceptedAt: event.at,
            acceptedBy: data.by ?? 'human',
          });
          break;
        }

        if (!vendorId) break;
        const pending = latestPendingRequest(overlay, vendorId);

        if (data.action === 'verify_payee' && (data.input?.result ?? '') === 'confirmed') {
          if (pending) {
            overlay.changeRequests.set(pending.id, { ...pending, status: 'confirmed' });
            overlay.vendorPayee.set(vendorId, {
              receiver: pending.requestedPayee,
              at: event.at,
              by: data.by ?? 'human',
              method: data.input?.method ?? 'out_of_band',
            });
          }
          break;
        }

        if (data.action === 'mark_fraud' && pending) {
          overlay.changeRequests.set(pending.id, { ...pending, status: 'fraudulent' });
        }
        break;
      }
      default:
        break;
    }
  }

  return overlay;
}

function latestPendingRequest(overlay: Overlay, vendorId: string): PayeeChangeRequest | null {
  const pending = [...overlay.changeRequests.values()]
    .filter((request) => request.vendorId === vendorId && request.status === 'unverified')
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  return pending[0] ?? null;
}

export function isTerminal(state: IntentState | null): boolean {
  return state === 'blocked' || state === 'rejected' || state === 'proven' || state === 'failed' || state === 'cancelled';
}

export { IllegalTransitionError };
