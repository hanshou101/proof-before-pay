// Test doubles (SPEC §7: fake rails and fake models live under `test/` and are never exported
// from the package entry).
//
// The fake rail is *file-backed* on purpose: the restart test kills the server with `kill -9`
// and starts a new process, so the "PayPal side" must survive the process the same way the real
// one would. It records, per `sender_batch_id`, how many payouts it actually created — which is
// what makes "each key paid exactly once" checkable.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mapStatus,
  resolveProof,
  type RailAdapter,
  type RailIntent,
  type RailRef,
  type ReceiptResult,
  type SubmitResult,
} from '@pbp/core';
import { sha256Text, vendorOf } from '../src/scenario.js';
import type {
  AgentPort,
  Claim,
  Classification,
  ComparisonSendRequest,
  ItemOutcome,
  RunSummaryInput,
  Scenario,
  SendPayoutTool,
} from '../src/types.js';
import { templateSummary } from '../src/runner.js';

export interface RailBatch {
  payoutBatchId: string;
  payoutItemId: string;
  receiver: string;
  amount: number;
  memo: string;
  status: string;
  transactionId: string | null;
  cancelled: boolean;
  /** How many payouts this batch actually created. Must never exceed 1. */
  payouts: number;
}

export interface RailState {
  batches: Record<string, RailBatch>;
  calls: Record<string, number>;
}

/** Credential-shaped environment for the tests: present, but obviously not real. */
export const TEST_ENV: Record<string, string> = {
  PAYPAL_CLIENT_ID: 'test-client-id',
  PAYPAL_CLIENT_SECRET: 'test-client-secret',
  PAYPAL_ENV: 'sandbox',
  LLM_API_BASE: 'http://127.0.0.1:9/v1',
  LLM_API_KEY: 'test-llm-key',
  LLM_MODEL: 'test-model',
};

export class FakeRail implements RailAdapter {
  readonly file: string;
  private readonly scenario: Scenario;
  private dropArmed = false;
  private failNextCancel = false;
  private refuseNextCancel = false;
  private failNextFetch = false;
  private credentialFailure = false;
  private readonly refusedReceivers = new Set<string>();
  private submitDelayMs: number;
  submitCalls = 0;

  constructor(file: string, scenario: Scenario, options: { submitDelayMs?: number } = {}) {
    this.file = file;
    this.scenario = scenario;
    this.submitDelayMs = options.submitDelayMs ?? 0;
  }

  /** Drop the next submit response *after* the payout was created (AC-13a). */
  armDroppedResponse(): void {
    this.dropArmed = true;
  }

  /** Move a batch to another PayPal status behind the server's back (payee claimed it, etc.). */
  setStatus(senderBatchId: string, status: string, transactionId: string | null = null): void {
    const state = this.state();
    const batch = state.batches[senderBatchId];
    if (!batch) throw new Error(`Unknown batch ${senderBatchId}`);
    batch.status = status;
    batch.transactionId = transactionId;
    this.save(state);
  }

  /** The next cancel call fails the way an unreachable PayPal does. */
  armCancelFailure(): void {
    this.failNextCancel = true;
  }

  /**
   * The next cancel is *refused by PayPal* the way the sandbox really refuses it (T5's recording,
   * `cancel-internal-service-error-500.json`), and the payout keeps its status. This is the case
   * SPEC v1.7 §6.3.3 describes: the refusal is recorded, the GET still says UNCLAIMED, and
   * nothing is ever called cancelled.
   */
  armCancelRefusal(): void {
    this.refuseNextCancel = true;
  }

  /** The next receipt GET fails the way an unreachable PayPal does. */
  armFetchFailure(): void {
    this.failNextFetch = true;
  }

  /**
   * PayPal refuses *us*: the token endpoint answers 401 (a wrong `PAYPAL_CLIENT_SECRET`). The
   * rail's error carries `kind: 'unauthorized'`, which is what the runner treats as "stop the
   * run" rather than "this one payment failed" (07-UI §4.5).
   */
  armCredentialFailure(): void {
    this.credentialFailure = true;
  }

  /** One receiver PayPal will not pay — the comparison run must record it and carry on. */
  armRefusedReceiver(receiver: string): void {
    this.refusedReceivers.add(receiver.toLowerCase());
  }

  state(): RailState {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as RailState;
    } catch {
      return { batches: {}, calls: {} };
    }
  }

  private save(state: RailState): void {
    writeFileSync(this.file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  async submit(intent: RailIntent): Promise<SubmitResult> {
    if (this.credentialFailure) {
      throw Object.assign(new Error('PayPal would not issue an access token. Nothing was sent.'), {
        kind: 'unauthorized',
      });
    }
    if (this.refusedReceivers.has(intent.receiver.toLowerCase())) {
      throw Object.assign(new Error('PayPal rejected this payout — nothing was sent.'), { kind: 'rejected', status: 422 });
    }
    this.submitCalls += 1;
    const state = this.state();
    const key = intent.idempotencyKey;
    state.calls[key] = (state.calls[key] ?? 0) + 1;

    let batch = state.batches[key];
    if (!batch) {
      const status = this.statusFor(intent.receiver);
      batch = {
        payoutBatchId: `BATCH-${sha256Text(key).slice(0, 12).toUpperCase()}`,
        payoutItemId: `ITEM-${sha256Text(`item:${key}`).slice(0, 12).toUpperCase()}`,
        receiver: intent.receiver,
        amount: intent.amount,
        memo: intent.memo,
        status,
        transactionId: status === 'SUCCESS' ? `TXN-${sha256Text(`txn:${key}`).slice(0, 16).toUpperCase()}` : null,
        cancelled: false,
        payouts: 1,
      };
      state.batches[key] = batch;
    }
    this.save(state);

    if (this.submitDelayMs > 0) await new Promise((resolveSleep) => setTimeout(resolveSleep, this.submitDelayMs));

    if (this.dropArmed) {
      this.dropArmed = false;
      // PayPal has the money; our client never saw the answer (SPEC §6.5.2).
      return { senderBatchId: key, payoutBatchId: null };
    }

    return { senderBatchId: key, payoutBatchId: batch.payoutBatchId };
  }

  async fetchReceipt(ref: RailRef): Promise<ReceiptResult> {
    if (this.failNextFetch) {
      this.failNextFetch = false;
      throw new Error('PayPal did not answer the receipt request.');
    }
    const state = this.state();
    const batch = state.batches[ref.senderBatchId] ?? Object.values(state.batches).find((entry) => entry.payoutBatchId === ref.payoutBatchId);
    if (!batch) {
      throw new Error(`Unknown batch ${ref.payoutBatchId ?? ref.senderBatchId}`);
    }
    const proof = batch.cancelled ? 'cancelled' : resolveProof(batch.status, batch.transactionId);
    return {
      railStatus: batch.cancelled ? 'RETURNED' : batch.status,
      proof,
      payoutItemId: batch.payoutItemId,
      transactionId: batch.transactionId,
      fetchedAt: new Date().toISOString(),
    };
  }

  async cancel(ref: RailRef): Promise<void> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error('PayPal did not answer the cancel request.');
    }
    if (this.refuseNextCancel) {
      this.refuseNextCancel = false;
      // Verbatim shape of the sandbox recording: HTTP 500 INTERNAL_SERVICE_ERROR, no status
      // change. The rail turns this into a thrown error, and the server records it.
      const recording = JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../../../packages/paypal/test/fixtures/cancel-internal-service-error-500.json'), 'utf8'),
      ) as { response: { name: string; message: string } };
      throw new Error(`${recording.response.name}: ${recording.response.message}`);
    }
    const state = this.state();
    const batch = state.batches[ref.senderBatchId];
    if (!batch) throw new Error(`Unknown batch ${ref.senderBatchId}`);
    if (batch.status !== 'UNCLAIMED') throw new Error('Only an unclaimed payout can be cancelled.');
    batch.cancelled = true;
    this.save(state);
  }

  mapStatus(status: string): ReturnType<typeof mapStatus> {
    return mapStatus(status);
  }

  private statusFor(receiver: string): string {
    const vendor = this.scenario.vendors.find(
      (entry) => entry.payee.receiver.toLowerCase() === receiver.toLowerCase(),
    );
    if (!vendor) return 'UNCLAIMED'; // no sandbox account at that address
    if (vendor.sandboxAccount === 'must_not_exist') return 'UNCLAIMED';
    return 'SUCCESS';
  }
}

export class FakeAgent implements AgentPort {
  private readonly scenario: Scenario;
  private readonly clock: () => string;
  processCalls = 0;

  constructor(scenario: Scenario, clock: () => string) {
    this.scenario = scenario;
    this.clock = clock;
  }

  async processItem({ item, files }: { item: { id: string; from: string; subject: string; receivedAt: string; bodyText: string }; files: { name: string; sha256: string }[] }): Promise<ItemOutcome> {
    this.processCalls += 1;
    const golden = this.scenario.golden.items.find((entry) => entry.itemId === item.id);
    if (!golden) throw new Error(`No recorded extraction for ${item.id}`);

    const vendor = golden.claim ? vendorOf(this.scenario, golden.claim.vendorId) : null;
    const claim: Claim | null = golden.claim
      ? {
          ...golden.claim,
          itemId: item.id,
          vendorName: vendor?.name ?? golden.claim.vendorId ?? '',
          senderEmail: emailOf(item.from),
          sourceSha256: files[0]?.sha256 ?? sha256Text(item.bodyText),
          extractedBy: { model: 'test-golden', at: this.clock() },
        }
      : null;

    const changeRequest =
      golden.classification === 'invoice+payee_change_request' && claim?.requestedPayee
        ? {
            id: `cr_${item.id}`,
            vendorId: claim.vendorId ?? 'unknown',
            requestedPayee: claim.requestedPayee,
            sourceItemId: item.id,
            requestedAt: item.receivedAt,
            status: 'unverified' as const,
          }
        : null;

    return {
      classification: golden.classification as Classification,
      model: 'test-golden',
      claim,
      changeRequest,
      risk: golden.riskFlags.length > 0
        ? {
            flags: golden.riskFlags,
            note: 'The sender domain is not the one on file, and the note asks us to skip the checks.',
            noteSource: 'model' as const,
          }
        : null,
      proposal: claim
        ? {
            agreementId: golden.agreementId,
            agreementMatchedBy: golden.agreementMatchedBy ?? (claim.po ? 'po' : 'ai'),
            rationale: 'Replayed from the recorded golden extraction.',
          }
        : null,
    };
  }

  async explainIntent({ checks }: { checks: { id: string; status: string; code: string }[] }): Promise<{ text: string; source: 'model' | 'template' }> {
    const worst = checks.find((check) => check.status === 'fail') ?? checks.find((check) => check.status === 'hold');
    return {
      text: worst
        ? `${worst.id} did not pass (${worst.code}). It stays out of PayPal until a human decides.`
        : 'This payment is waiting for a human.',
      source: 'model',
    };
  }

  async summarize({ totals }: RunSummaryInput): Promise<{ text: string; source: 'model' | 'template' }> {
    return { text: templateSummary(totals), source: 'template' };
  }

  async runComparison({ items, sendPayout }: { items: { id: string }[]; sendPayout: SendPayoutTool }): Promise<{ text: string; source: 'model' | 'template' }> {
    const payouts = this.scenario.golden.comparisonMode.payouts;
    for (const payout of payouts) {
      const item = items.find((entry) => entry.id === payout.itemId);
      if (!item) continue;
      const request: ComparisonSendRequest = {
        receiver: payout.receiver,
        amount: payout.amount,
        memo: `Lumen & Lark · ${payout.itemId}`,
      };
      await sendPayout(request);
    }
    return { text: 'All invoices paid ✅', source: 'model' };
  }
}

function emailOf(from: string): string {
  const bracketed = /<([^<>]+)>/.exec(from);
  return (bracketed?.[1] ?? from).trim();
}

export function railFileFor(dataDir: string): string {
  return resolve(dataDir, 'test-rail.json');
}
