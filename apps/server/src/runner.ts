// The payout runner (SPEC §6.7).
//
//   POST /api/runs → item.read → agent.processItem → claim.extracted → gate.evaluate →
//   intent.checked → (held/blocked: agent.explainIntent) → (approved, in order: payment.submitted
//   *before* the rail call) → receipt polling → agent.summarize → run.completed
//
// Rules this file keeps:
//   - every external call is preceded by its event ("先寫事件再做事"), so a crash never leaves
//     money moving without a trace in the ledger;
//   - amounts, states and totals come from core's `replay`, never from a second calculator here;
//   - a retry reuses the same idempotency key — a retry can never pay twice (SPEC §6.5.2).

import {
  approveBlockedBy,
  evaluate,
  fingerprint,
  idempotencyKey,
  resolveVendor,
  transition,
  IllegalTransitionError,
  type CheckResult,
  type Claim,
  type IntentProjection,
  type Proposal,
  type RailAdapter,
  type RailRef,
  type ReceiptResult,
} from '@pbp/core';
import type { ServerConfig } from './config.js';
import { buildGateContext } from './gate-context.js';
import { BadRequestError, ConflictError, NotFoundError, messageOf } from './errors.js';
import { humanRailMessage, credentialFailure, outOfFunds, PAYPAL_UNREACHABLE_MESSAGE } from './rail-errors.js';
import { type Runtime, type SeededHistory } from './runtime.js';
import { resetDemo } from './reset.js';
import { sha256Text, vendorOf, type LoadedDemo } from './scenario.js';
import type {
  AgentPort,
  ComparisonSendResult,
  HumanAction,
  InboxItem,
  ItemOutcome,
  RunMode,
  Totals,
} from './types.js';

/** One comparison payout: what was asked for, and what the rail said about it. */
interface ComparisonSend extends ComparisonSendResult {
  receiver: string;
  amount: number;
  memo: string;
  payoutItemId: string | null;
}

export interface RunnerDeps {
  runtime: Runtime;
  demo: LoadedDemo;
  agent: AgentPort;
  rail: RailAdapter;
  config: ServerConfig;
}

export interface RunHandle {
  runId: string;
  mode: RunMode;
  /** Resolves when the run (including receipt polling) is finished or handed to a human. */
  done: Promise<void>;
}

interface ActiveRun {
  runId: string;
  mode: RunMode;
  done: Promise<void>;
  startedAt: string;
}

export class Runner {
  private readonly runtime: Runtime;
  private readonly demo: LoadedDemo;
  private readonly agent: AgentPort;
  private readonly rail: RailAdapter;
  private readonly config: ServerConfig;
  private active: ActiveRun | null = null;
  private timers = new Set<ReturnType<typeof setInterval>>();
  private polls = new Map<string, ReturnType<typeof setInterval>>();
  private comparisonCalls = 0;
  private closed = false;
  /**
   * Set when PayPal refused us rather than one payment (bad credentials, bad app). The run stops
   * at that point: every later row would fail identically, and the screen says why (07-UI §4.5).
   */
  private stopped = false;

  constructor(deps: RunnerDeps) {
    this.runtime = deps.runtime;
    this.demo = deps.demo;
    this.agent = deps.agent;
    this.rail = deps.rail;
    this.config = deps.config;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  current(): { runId: string; mode: RunMode; startedAt: string } | null {
    if (!this.active) return null;
    return { runId: this.active.runId, mode: this.active.mode, startedAt: this.active.startedAt };
  }

  /** Wait for the run that is active right now (tests, scripts). Resolves at once when idle. */
  waitForIdle(): Promise<void> {
    return this.active ? this.active.done : Promise.resolve();
  }

  /** Last run recorded in the main ledger, for `/api/state`. */
  lastRun(): { runId: string; mode: string; startedAt: string; completedAt: string | null } | null {
    let started: { runId: string; mode: string; startedAt: string } | null = null;
    let completedAt: string | null = null;
    for (const event of this.runtime.events) {
      if (event.type === 'run.started') {
        const data = event.data as { runId: string; mode: string };
        started = { runId: data.runId, mode: data.mode, startedAt: event.at };
        completedAt = null;
      } else if (event.type === 'run.completed' && started) {
        completedAt = event.at;
      }
    }
    return started ? { ...started, completedAt } : null;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  start(mode: RunMode): RunHandle {
    if (this.active) {
      throw new ConflictError(
        `A run is already in progress (${this.active.runId}). Wait for it to finish, then run again.`,
        'run_in_progress',
      );
    }

    const runId = this.nextRunId();
    const startedAt = this.runtime.now;
    this.stopped = false;

    if (mode === 'proof') {
      this.runtime.append('run.started', {
        runId,
        mode,
        inboxCount: this.demo.items.length,
      });
    }
    // Comparison runs write only `comparison.*` events, into their own ledger file (SPEC §6.3.2).
    // The main ledger — its projection, its totals and its chain — is never touched by them.

    const handle: ActiveRun = {
      runId,
      mode,
      startedAt,
      done: Promise.resolve(),
    };
    this.active = handle;
    handle.done = (mode === 'proof' ? this.runProof(runId) : this.runComparison(runId))
      .catch((error) => {
        this.safeError('run', `The run stopped early: ${messageOf(error)}`, messageOf(error));
      })
      .finally(() => {
        if (this.active === handle) this.active = null;
      });

    return { runId, mode, done: handle.done };
  }

  private nextRunId(): string {
    const used = this.runtime.events.filter((event) => event.type === 'run.started').length;
    return `run_${used + 1}`;
  }

  private async runProof(runId: string): Promise<void> {
    for (const item of this.demo.items) {
      if (this.closed || this.stopped) return;
      const existing = this.intentForItem(item.id);
      if (existing) {
        if (existing.state === 'approved') {
          await this.submitIntent(existing.id);
        } else if (existing.state === 'proposed') {
          await this.checkAndContinue(existing.id);
        }
        continue;
      }
      await this.processItem(item);
    }

    if (this.closed || this.stopped) return;

    const totals = this.runtime.totals();
    const summary = await this.summarize(runId, totals);
    this.runtime.append('run.summarized', {
      runId,
      totals,
      highlight: summary.text,
      highlightSource: summary.source,
    });
    this.runtime.append('run.completed', { runId, totals });
  }

  private async processItem(item: InboxItem): Promise<void> {
    this.runtime.append('item.read', {
      itemId: item.id,
      from: item.from,
      subject: item.subject,
      files: item.attachments.map((attachment) => ({ name: attachment.name, sha256: attachment.sha256 })),
    });

    let outcome: ItemOutcome;
    try {
      outcome = await this.agent.processItem({ item, files: item.attachments });
    } catch (error) {
      this.safeError(
        `item:${item.id}`,
        `We could not read ${item.subject}. It is waiting for a human.`,
        messageOf(error),
      );
      return;
    }

    this.runtime.append('item.classified', {
      itemId: item.id,
      classification: outcome.classification,
      model: outcome.model,
    });

    if (outcome.claim) {
      this.runtime.append('claim.extracted', { itemId: item.id, claim: outcome.claim });
    }

    if (outcome.changeRequest) {
      // SPEC §6.6.2 step 5: record the change request *before* proposing, so P2 sees it.
      this.runtime.append('change_request.recorded', outcome.changeRequest);
    }

    if (outcome.risk) {
      this.runtime.append('risk.flagged', {
        itemId: item.id,
        flags: outcome.risk.flags,
        note: outcome.risk.note,
        noteSource: outcome.risk.noteSource,
      });
    }

    if (!outcome.claim) return;
    if (!outcome.proposal) {
      this.safeError(
        `item:${item.id}`,
        `We read ${item.subject} but could not match it to a contract, so nothing was sent.`,
        null,
      );
      return;
    }

    this.propose(item, outcome.claim, outcome.proposal);
    await this.checkAndContinue(`int_${item.id}`);
  }

  private propose(
    item: InboxItem,
    claim: Claim,
    proposal: NonNullable<ItemOutcome['proposal']>,
  ): string {
    const intentId = `int_${item.id}`;
    const context = buildGateContext(this.runtime);
    const { vendor } = resolveVendor(claim, context);
    const vendorId = vendor?.id ?? claim.vendorId ?? 'unknown';
    const receipt = (claim.requestedPayee ?? '').trim() || vendor?.payee.receiver || '';
    const fp = fingerprint({
      vendorId,
      invoiceNumber: claim.invoiceNumber,
      currency: claim.currency,
      total: claim.total,
    });

    this.runtime.append('intent.proposed', {
      intentId,
      itemId: item.id,
      vendorId: vendor?.id ?? claim.vendorId ?? null,
      agreementId: proposal.agreementId,
      agreementMatchedBy: proposal.agreementMatchedBy,
      amount: claim.total,
      payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: receipt },
      fingerprint: fp,
      idempotencyKey: idempotencyKey(context.epoch, fp),
      currency: claim.currency,
    });

    return intentId;
  }

  private proposalFor(intentId: string): Proposal {
    const intent = this.runtime.intent(intentId);
    if (!intent) throw new NotFoundError(`No payment intent ${intentId}.`);
    const claim = this.runtime.claimOf(intent.itemId) as Claim | null;
    if (!claim) throw new NotFoundError(`Intent ${intentId} has no extracted invoice to re-check.`);
    return {
      claim,
      agreementId: intent.agreementId,
      agreementMatchedBy: this.runtime.overlay.intentAgreementMatchedBy.get(intentId) ?? null,
      rationale: 'Re-checked after a human action.',
    };
  }

  private async checkAndContinue(intentId: string): Promise<void> {
    const intent = this.runtime.intent(intentId);
    if (!intent) return;

    const proposal = this.proposalFor(intentId);
    const context = buildGateContext(this.runtime, {
      approvedAmount: intent.approvedAmount,
      approvedBy: intent.approvedAmount === null ? null : this.config.operator,
    });
    const evaluation = evaluate(proposal, context);

    this.runtime.append('intent.checked', {
      intentId,
      checks: evaluation.checks,
      decision: evaluation.decision,
    });

    if (evaluation.decision === 'approved') {
      await this.submitIntent(intentId);
      return;
    }

    await this.explain(intentId, proposal.claim, evaluation.checks, evaluation.decision);
  }

  private async explain(
    intentId: string,
    claim: Claim,
    checks: CheckResult[],
    decision: 'held' | 'blocked',
  ): Promise<void> {
    const intent = this.runtime.intent(intentId);
    if (!intent) return;

    try {
      const explanation = await this.agent.explainIntent({
        intentId,
        itemId: intent.itemId,
        claim,
        checks,
        decision,
        // AC-10 (SPEC v1.4): a DUPLICATE explanation has to carry the *original payment's*
        // PayPal transaction id or date. Both live in `data/history.json` — the record
        // `demo:reset` actually paid — not in the scenario file and not on the invoice.
        original: this.originalPayment(checks),
      });
      this.runtime.append('intent.explained', {
        intentId,
        text: explanation.text,
        source: explanation.source,
      });
    } catch (error) {
      this.runtime.append('intent.explained', {
        intentId,
        text: templateExplanation(checks),
        source: 'template',
      });
      this.safeError(
        `explain:${intentId}`,
        'The AI could not explain this one, so we used our own wording.',
        messageOf(error),
      );
    }
  }

  private async summarize(runId: string, totals: Totals): Promise<{ text: string; source: 'model' | 'template' }> {
    const items = this.demo.items.map((item) => {
      const intent = this.intentForItem(item.id);
      const vendor = vendorOf(this.demo.scenario, intent?.vendorId ?? null);
      const claim = this.runtime.claimOf(item.id) as Claim | null;
      return {
        itemId: item.id,
        intentId: intent?.id ?? null,
        vendorName: vendor?.name ?? '',
        business: vendor?.business ?? '',
        // The highlight must be able to name a held invoice (packages/agent highlight.ts).
        invoiceNumber: claim?.invoiceNumber ?? null,
        amount: intent?.amount ?? null,
        state: intent?.state ?? null,
        decision: intent?.decision ?? null,
        checks: intent?.checks ?? null,
      };
    });
    try {
      const summary = await this.agent.summarize({ runId, mode: 'proof', totals, items });
      return summary;
    } catch (error) {
      this.safeError('summarize', 'The AI could not write the run summary.', messageOf(error));
      return { text: templateSummary(totals), source: 'template' };
    }
  }

  // -------------------------------------------------------------------------
  // Money: submit + receipts
  // -------------------------------------------------------------------------

  /**
   * Send one approved intent. Called only after `payment.submitted` is in the ledger.
   * A lost response leaves `payoutBatchId: null`; the retry reuses the same key (SPEC §6.5.2),
   * which is exactly what makes a duplicate impossible.
   */
  private async submitIntent(intentId: string): Promise<void> {
    let intent = this.runtime.intent(intentId);
    if (!intent) return;

    const needsSend =
      intent.state === 'approved' ||
      (intent.state === 'submitted' && intent.submission?.payoutBatchId === null);
    if (!needsSend) {
      if (intent.state === 'submitted' || intent.state === 'awaiting') await this.pollReceipt(intentId);
      return;
    }

    const amount = intent.approvedAmount ?? intent.amount;
    const receiver = intent.payee?.receiver ?? '';
    if (receiver === '') {
      this.safeError(`submit:${intentId}`, 'This payment has no payee address, so nothing was sent.', null);
      return;
    }

    const memo = this.memoFor(intentId);
    let attempt = (intent.submission?.attempt ?? 0) + 1;
    let batchId: string | null = null;
    let lastFailure: unknown = null;

    for (let index = 0; index < this.config.poll.submitAttempts; index += 1) {
      this.runtime.append('payment.submitted', {
        intentId,
        rail: 'paypal',
        senderBatchId: intent.idempotencyKey,
        payoutBatchId: null,
        attempt,
      });

      try {
        const result = await this.rail.submit({
          intentId,
          idempotencyKey: intent.idempotencyKey,
          amount,
          currency: intent.currency,
          receiver,
          memo,
          // SPEC §6.5.5: `PBP_RECEIVER_MAP` is keyed by vendorId, so the rail must be told
          // which vendor this payout is for. It falls back to the email when the map has no
          // entry (Jonas and the impostor never get a sandbox account).
          ...(intent.vendorId ? { vendorId: intent.vendorId } : {}),
        });
        batchId = result.payoutBatchId;
        // SPEC §6.5.5: the bundle records both the scenario address and the sandbox account
        // PayPal actually received. The rail hands back the one it used.
        const sent = (result as { receiver?: string }).receiver;
        if (typeof sent === 'string' && sent !== '') {
          this.runtime.recordReceiver(intentId, { requested: receiver, sent });
        }
        if (batchId !== null) {
          // Same attempt, now with the batch id PayPal gave us. Without this second row a restart
          // would know we sent something but not which batch to ask about.
          this.runtime.append('payment.submitted', {
            intentId,
            rail: 'paypal',
            senderBatchId: intent.idempotencyKey,
            payoutBatchId: batchId,
            attempt,
          });
          break;
        }
      } catch (error) {
        lastFailure = error;
        if (credentialFailure(error)) {
          // PayPal refused us, not this payout: stop the whole run with 07-UI §4.5's sentence
          // instead of retrying the same key against a sandbox that will never accept it, and
          // instead of telling the row "we will retry" (T8 round 3, item 1).
          this.stopped = true;
          this.safeError('run', PAYPAL_UNREACHABLE_MESSAGE, messageOf(error));
          return;
        }
        // A sandbox that ran out of money must not be reported as "did not answer": one is a
        // reason to retry, the other is a reason to stop and top the account up.
        this.safeError(
          `payment.submit:${intentId}`,
          outOfFunds(error)
            ? humanRailMessage(error, 'PayPal did not take this payment — nothing was sent.')
            : 'PayPal did not answer. We will retry with the same key — a retry can never pay twice.',
          messageOf(error),
        );
      }

      attempt += 1;
      intent = this.runtime.intent(intentId);
      if (!intent || index === this.config.poll.submitAttempts - 1) break;
      const backoff = this.config.poll.submitBackoffMs[index] ?? 8000;
      if (backoff > 0) await sleep(backoff);
    }

    if (batchId === null) {
      // Nothing was sent when the sandbox refused for lack of funds, so "Sent — receipt pending"
      // would be a lie; the row says what actually happened.
      this.safeError(
        `payment.submit:${intentId}`,
        outOfFunds(lastFailure)
          ? humanRailMessage(lastFailure, 'PayPal did not take this payment — nothing was sent.')
          : 'Sent — receipt pending. PayPal has not confirmed this batch yet; we keep checking in the background.',
        null,
      );
      this.scheduleBackgroundPoll(intentId);
      return;
    }

    await this.pollReceipt(intentId);
  }

  private memoFor(intentId: string): string {
    const intent = this.runtime.intent(intentId);
    const claim = (intent ? (this.runtime.claimOf(intent.itemId) as Claim | null) : null) ?? null;
    const invoice = claim?.invoiceNumber ?? intentId;
    const po = claim?.po ?? 'no PO';
    return `${this.demo.scenario.payer.name} · ${invoice} · ${po}`;
  }

  private async pollReceipt(intentId: string): Promise<void> {
    const deadline = Date.now() + this.config.poll.windowMs;
    for (;;) {
      const settled = await this.fetchReceipt(intentId);
      if (settled || this.closed) return;
      if (Date.now() >= deadline) break;
      await sleep(this.config.poll.intervalMs);
    }
    this.scheduleBackgroundPoll(intentId);
  }

  /** One GET. Returns true when the intent's receipt can no longer change (or it already has). */
  private async fetchReceipt(intentId: string): Promise<boolean> {
    const intent = this.runtime.intent(intentId);
    if (!intent || !intent.submission) return true;

    const ref: RailRef = {
      intentId,
      idempotencyKey: intent.idempotencyKey,
      senderBatchId: intent.submission.senderBatchId,
      payoutBatchId: intent.submission.payoutBatchId,
      payoutItemId: intent.receipt?.payoutItemId ?? null,
    };

    let receipt: ReceiptResult;
    try {
      receipt = await this.rail.fetchReceipt(ref);
    } catch (error) {
      if (credentialFailure(error)) {
        this.stopped = true;
        this.safeError('run', PAYPAL_UNREACHABLE_MESSAGE, messageOf(error));
        return true;
      }
      this.safeError(
        `receipt:${intentId}`,
        'We could not read the receipt from PayPal. The payment is not called paid until we do.',
        messageOf(error),
      );
      return false;
    }

    return this.applyReceipt(intentId, receipt);
  }

  private applyReceipt(intentId: string, receipt: ReceiptResult): boolean {
    const intent = this.runtime.intent(intentId);
    if (!intent) return true;

    // SPEC §6.5.3: a `RETURNED` payout is "cancelled" when *we* cancelled it, and "failed"
    // when PayPal returned it on its own (30 days unclaimed). The rail can only remember our
    // cancel inside the process that sent it, so a restart loses that fact. The ledger does
    // not: `human.action: cancel_payout` is replayed into `overlay.cancelRequested`.
    const cancelledByUs =
      receipt.proof === 'failed' &&
      receipt.railStatus.trim().toUpperCase() === 'RETURNED' &&
      this.runtime.overlay.cancelRequested.has(intentId);
    const proof = cancelledByUs ? 'cancelled' : receipt.proof;

    const payload = {
      intentId,
      railStatus: receipt.railStatus,
      proof,
      payoutItemId: receipt.payoutItemId,
      transactionId: receipt.transactionId,
      source: 'rail_get',
      // The server's clock, not the machine's: the whole demo runs on the scenario clock
      // (`testClock` anchored, SPEC §6.7), and a timeline that mixes an anchored 17:30 with a real
      // wall-clock time shows two different days for one run. The rail's own timestamp is still
      // in the PayPal response; this is the moment *this ledger* recorded it.
      fetchedAt: this.runtime.now,
    };

    if (proof === 'pending') {
      // Only the first pending receipt moves `submitted → awaiting`; a later identical one is not
      // a new fact, so it is not written (SPEC §6.3.3 last bullet).
      if (intent.state === 'submitted') {
        this.runtime.append('receipt.updated', payload);
        return false;
      }
      // Still waiting for the payee: the state already says so, nothing new to write.
      if (intent.state === 'awaiting') return false;
      // The intent is settled and PayPal now says something that would move it backwards. The
      // ledger keeps the settled state — but only after saying, in words, that the two disagree.
      this.safeError(
        `receipt:${intentId}`,
        `PayPal reported ${receipt.railStatus} after this payment was already ${intent.state}. The ledger was not changed — check the payment by hand.`,
        null,
      );
      return true;
    }

    try {
      transition(intent.state, { kind: 'receipt.updated', proof });
    } catch {
      if (intent.receipt?.proof === proof) return true;
      this.safeError(
        `receipt:${intentId}`,
        `PayPal reported ${receipt.railStatus} after this payment was already ${intent.state}. The ledger was not changed — check the payment by hand.`,
        null,
      );
      return true;
    }

    this.runtime.append('receipt.updated', payload);
    return true;
  }

  private scheduleBackgroundPoll(intentId: string): void {
    const existing = this.runtime.intent(intentId);
    if (!existing) return;
    if (this.closed) return;
    // One poller per intent: a human action that also arms the background retry must not double
    // the GET rate PayPal sees.
    if (this.polls.has(intentId)) return;

    let timer: ReturnType<typeof setInterval>;
    const stop = () => {
      clearInterval(timer);
      this.timers.delete(timer);
      this.polls.delete(intentId);
    };

    timer = setInterval(() => {
      void (async () => {
        const intent = this.runtime.intent(intentId);
        if (!intent || (intent.state !== 'submitted' && intent.state !== 'awaiting')) {
          stop();
          return;
        }
        const settled = await this.fetchReceipt(intentId);
        if (settled) stop();
      })();
    }, this.config.poll.backgroundMs);
    timer.unref?.();
    this.timers.add(timer);
    this.polls.set(intentId, timer);
  }

  // -------------------------------------------------------------------------
  // Human actions (SPEC §6.3.3)
  // -------------------------------------------------------------------------

  async act(
    intentId: string,
    action: HumanAction,
    input: Record<string, unknown>,
    by: string | null,
  ): Promise<IntentProjection> {
    const intent = this.runtime.intent(intentId);
    if (!intent) throw new NotFoundError(`No payment intent ${intentId}.`);

    switch (action) {
      case 'verify_payee': {
        const result = typeof input.result === 'string' ? input.result.trim().toLowerCase() : '';
        if (result !== 'confirmed' && result !== 'not_confirmed') {
          throw new ConflictError(
            'Tell us what the call found — "confirmed" or "not_confirmed". Nothing was changed.',
            'verify_result_required',
          );
        }
        this.appendHuman(intentId, action, by, {
          result,
          method: typeof input.method === 'string' ? input.method : null,
          note: typeof input.note === 'string' ? input.note : null,
        });
        if (result === 'confirmed') await this.checkAndContinue(intentId);
        return this.requireIntent(intentId);
      }

      case 'accept_delivery': {
        const deliveryId = typeof input.deliveryId === 'string' ? input.deliveryId : '';
        const agreement = this.demo.scenario.agreements.find((item) => item.id === intent.agreementId);
        const known = agreement?.deliveryIds.includes(deliveryId) ?? false;
        if (!deliveryId || !known) {
          throw new ConflictError(
            'That delivery does not belong to this contract. Nothing was changed.',
            'unknown_delivery',
          );
        }
        this.appendHuman(intentId, action, by, { deliveryId });
        await this.checkAndContinue(intentId);
        return this.requireIntent(intentId);
      }

      case 'approve': {
        const blocked = intent.checks ? approveBlockedBy(intent.checks) : null;
        if (blocked) {
          throw new ConflictError(
            'Verify the payee first — approval is disabled while payment details are unverified.',
            'approve_blocked_by_payee',
          );
        }

        const amount = readAmount(input.amount, intent.amount);
        if (amount !== null) {
          const agreement = this.demo.scenario.agreements.find((item) => item.id === intent.agreementId);
          const cap =
            agreement && agreement.kind !== 'fixed' && agreement.rate != null && agreement.capUnits != null
              ? agreement.rate * agreement.capUnits
              : null;
          if (amount > intent.amount) {
            throw new ConflictError(
              'You can approve less than the invoice, not more. Nothing was sent.',
              'amount_above_invoice',
            );
          }
          if (cap !== null && amount > cap) {
            throw new ConflictError(
              'That is above the contract cap. Lower the amount to the cap and approve again.',
              'amount_above_cap',
            );
          }
        }

        this.appendHuman(intentId, action, by, {
          amount,
          reason: typeof input.reason === 'string' ? input.reason : null,
        });
        await this.checkAndContinue(intentId);
        return this.requireIntent(intentId);
      }

      case 'mark_fraud':
      case 'reject': {
        this.appendHuman(intentId, action, by, {
          reason: typeof input.reason === 'string' ? input.reason : null,
        });
        return this.requireIntent(intentId);
      }

      case 'cancel_payout': {
        this.appendHuman(intentId, action, by, {
          reason: typeof input.reason === 'string' ? input.reason : null,
        });
        await this.cancelAtRail(intentId);
        return this.requireIntent(intentId);
      }

      case 'refresh_receipt': {
        this.appendHuman(intentId, action, by, null);
        await this.fetchReceipt(intentId);
        return this.requireIntent(intentId);
      }

      default:
        throw new BadRequestError(`Unknown action "${String(action)}".`, 'unknown_action');
    }
  }

  private appendHuman(
    intentId: string,
    action: HumanAction,
    by: string | null,
    input: Record<string, unknown> | null,
  ): void {
    try {
      this.runtime.append('human.action', { intentId, action, by, input });
    } catch (error) {
      if (error instanceof IllegalTransitionError) {
        const intent = this.runtime.intent(intentId);
        throw new ConflictError(conflictMessage(action, intent?.state ?? null), 'illegal_transition');
      }
      throw error;
    }
  }

  private async cancelAtRail(intentId: string): Promise<void> {
    const intent = this.runtime.intent(intentId);
    if (!intent || !intent.submission) return;

    const ref: RailRef = {
      intentId,
      idempotencyKey: intent.idempotencyKey,
      senderBatchId: intent.submission.senderBatchId,
      payoutBatchId: intent.submission.payoutBatchId,
      payoutItemId: intent.receipt?.payoutItemId ?? null,
    };

    try {
      await this.rail.cancel(ref);
    } catch (error) {
      // PayPal only cancels an UNCLAIMED payout (SPEC §6.5), so a refusal usually means the payee
      // got there first. The GET below is how we learn that — a refused cancel is precisely when
      // the receipt matters most. The refusal is recorded, but the receipt decides the state.
      this.safeError(
        `cancel:${intentId}`,
        'PayPal did not confirm the cancellation. We check the receipt — a payout the payee already claimed still counts as paid.',
        messageOf(error),
      );
    }

    // SPEC §6.3.3 v1.1: cancel_payout itself never moves the state. The GET right after decides:
    // RETURNED (by us) → cancelled, SUCCESS (claimed first) → proven, still UNCLAIMED → awaiting.
    const settled = await this.fetchReceipt(intentId);
    if (!settled) this.scheduleBackgroundPoll(intentId);
  }

  private requireIntent(intentId: string): IntentProjection {
    const intent = this.runtime.intent(intentId);
    if (!intent) throw new NotFoundError(`No payment intent ${intentId}.`);
    return intent;
  }

  // -------------------------------------------------------------------------
  // Comparison mode (SPEC §6.6.4 / AC-14)
  // -------------------------------------------------------------------------

  private async runComparison(runId: string): Promise<void> {
    const sent: ComparisonSend[] = [];
    const sendPayout = async (request: { receiver: string; amount: number; memo: string }) => {
      const result = await this.sendComparisonPayout(runId, request);
      sent.push(result);
      return result;
    };

    const summary = await this.agent.runComparison({ runId, items: this.demo.items, sendPayout });

    // Every batch is settled after the model has finished, not one 10-second window per send:
    // the model's turn should not wait on PayPal's claim window, and the receipt of the first
    // payout is still moving while the eighth is being sent (T8 round 3, item 3).
    await this.settleComparisonPayouts(runId, sent);
    this.runtime.appendComparison('comparison.summary', { runId, text: summary.text });
  }

  /**
   * Wait for every batch to reach a terminal status, polling them together. The cap is wall-clock
   * and every row is re-read inside it; whatever is still PENDING when it runs out is shown as
   * PayPal reported it — the screen never guesses.
   */
  private async settleComparisonPayouts(runId: string, sent: readonly ComparisonSend[]): Promise<void> {
    const open = new Map<string, ComparisonSend>();
    for (const entry of sent) if (entry.payoutBatchId !== null) open.set(entry.toolCallId, entry);
    if (open.size === 0) return;

    const deadline = Date.now() + this.config.poll.comparisonSettleMs;
    for (;;) {
      for (const [toolCallId, entry] of [...open]) {
        const ref: RailRef = {
          intentId: toolCallId,
          idempotencyKey: entry.senderBatchId,
          senderBatchId: entry.senderBatchId,
          payoutBatchId: entry.payoutBatchId,
          payoutItemId: entry.payoutItemId,
        };
        try {
          const receipt = await this.rail.fetchReceipt(ref);
          entry.payoutItemId = receipt.payoutItemId ?? entry.payoutItemId;
          this.runtime.appendComparison('comparison.receipt', {
            runId,
            toolCallId,
            railStatus: receipt.railStatus,
            transactionId: receipt.transactionId,
            fetchedAt: this.runtime.now,
          });
          if (receipt.proof !== 'pending') open.delete(toolCallId);
        } catch (error) {
          this.safeError(
            `comparison:${toolCallId}`,
            'PayPal did not answer about this comparison payout — it is shown as unconfirmed.',
            messageOf(error),
          );
          if (credentialFailure(error)) return;
          open.delete(toolCallId);
        }
      }
      if (open.size === 0 || Date.now() >= deadline) return;
      await sleep(this.config.poll.intervalMs);
    }
  }

  /**
   * One payout for the ungated comparison agent. It does not throw when the money cannot move:
   * a failed send is a tool result the model gets to see, exactly like a real tool (T8 round 3,
   * item 3). The row still lands in the comparison ledger with `relayStatus: null` and ok:false.
   */
  private async sendComparisonPayout(
    runId: string,
    request: { receiver: string; amount: number; memo: string },
  ): Promise<ComparisonSend & ComparisonSendResult> {
    this.comparisonCalls += 1;
    const toolCallId = `call_${this.comparisonCalls}`;
    // The ungated agent gets a random batch key on purpose (SPEC §6.6.4): it has no invoice
    // fingerprint, which is exactly why a retry can pay twice.
    const senderBatchId = `cmp-${sha256Text(`${runId}|${toolCallId}|${Math.random()}`).slice(0, 20)}`;
    // SPEC §6.5.5: the model pays whatever address it read out of the email. The demo's sandbox
    // cannot receive `.example` mail, so the same receiver map the gate uses is applied — matched
    // by the *on-file* address, which is how an invoice address becomes a vendor. An address that
    // belongs to nobody (the impostor, Jonas) stays unmapped and lands UNCLAIMED, which is the
    // outcome golden records.
    const vendorId = this.vendorIdForReceiver(request.receiver);

    this.runtime.appendComparison('comparison.payout_sent', {
      runId,
      toolCallId,
      receiver: request.receiver,
      amount: request.amount,
      memo: request.memo,
      senderBatchId,
      payoutBatchId: null,
    });

    let batchId: string | null = null;
    let sentReceiver: string | null = null;
    try {
      const result = await this.rail.submit({
        intentId: toolCallId,
        idempotencyKey: senderBatchId,
        amount: request.amount,
        currency: 'USD',
        receiver: request.receiver,
        memo: request.memo,
        ...(vendorId === null ? {} : { vendorId }),
      });
      batchId = result.payoutBatchId;
      const sent = (result as { receiver?: string }).receiver;
      if (typeof sent === 'string' && sent !== '') sentReceiver = sent;
    } catch (error) {
      this.safeError(`comparison:${toolCallId}`, 'The comparison payout did not go through.', messageOf(error));
    }

    this.runtime.appendComparison('comparison.payout_sent', {
      runId,
      toolCallId,
      receiver: request.receiver,
      amount: request.amount,
      memo: request.memo,
      senderBatchId,
      payoutBatchId: batchId,
      // Both addresses are evidence (SPEC §6.5.5): the developer switch shows them side by side.
      receiverSent: sentReceiver,
    });

    return {
      toolCallId,
      receiver: request.receiver,
      amount: request.amount,
      memo: request.memo,
      senderBatchId,
      payoutBatchId: batchId,
      payoutItemId: null,
      railStatus: null,
      transactionId: null,
      ok: batchId !== null,
    };
  }

  /** The scenario vendor whose verified payee is this address, if there is one. */
  private vendorIdForReceiver(receiver: string): string | null {
    const wanted = receiver.trim().toLowerCase();
    if (wanted === '') return null;
    for (const vendor of this.demo.scenario.vendors) {
      if (vendor.payee.receiver.trim().toLowerCase() === wanted) return vendor.id;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // demo:reset (SPEC §6.7) — seed hist_kenji_0142 through the same gate and the same rail
  // -------------------------------------------------------------------------

  async resetDemo(): Promise<{ epoch: string; history: SeededHistory }> {
    if (this.active) {
      throw new ConflictError('A run is in progress. Reset when the run has finished.', 'run_in_progress');
    }
    return resetDemo({ runtime: this.runtime, demo: this.demo, rail: this.rail, config: this.config });
  }

  // -------------------------------------------------------------------------
  // Restart recovery (SPEC §6.7 last bullet)
  // -------------------------------------------------------------------------

  async recover(): Promise<void> {
    for (const intent of this.runtime.intents()) {
      if (intent.state === 'submitted') {
        if (intent.submission?.payoutBatchId === null) {
          await this.submitIntent(intent.id); // §6.5.2 retry with the same key
        } else {
          await this.fetchReceipt(intent.id);
        }
      }
      const after = this.runtime.intent(intent.id);
      if (after && (after.state === 'submitted' || after.state === 'awaiting')) {
        this.scheduleBackgroundPoll(intent.id);
      }
    }

    const lastStarted = [...this.runtime.events].reverse().find((event) => event.type === 'run.started');
    if (!lastStarted) return;
    const data = lastStarted.data as { runId?: string };
    if (!data.runId) return;

    const finished = this.runtime.events.some(
      (event) => event.type === 'run.completed' && (event.data as { runId?: string }).runId === data.runId,
    );
    if (finished || this.active) return;

    const handle: ActiveRun = { runId: data.runId, mode: 'proof', startedAt: lastStarted.at, done: Promise.resolve() };
    this.active = handle;
    handle.done = this.runProof(data.runId)
      .catch((error) => this.safeError('run.resume', 'The interrupted run could not be resumed.', messageOf(error)))
      .finally(() => {
        if (this.active === handle) this.active = null;
      });
    await handle.done;
  }

  // -------------------------------------------------------------------------

  private intentForItem(itemId: string): IntentProjection | undefined {
    const id = this.runtime.projection.byItem[itemId];
    return id ? this.runtime.intent(id) : undefined;
  }

  /**
   * The payment O4 says this one duplicates, with PayPal's own facts about it.
   * `data/history.json` is written by `demo:reset` after the sandbox confirms the seed payout;
   * until that has run, `transactionId` / `paidAt` are null and the explanation falls back to
   * the deterministic template (AC-10 only accepts real evidence).
   */
  private originalPayment(checks: CheckResult[]): { id: string; transactionId: string | null; paidAt: string | null } | null {
    const o4 = checks.find((check) => check.id === 'O4');
    if (!o4 || o4.status !== 'fail' || o4.code !== 'DUPLICATE') return null;
    const id = typeof o4.facts.duplicateOf === 'string' ? o4.facts.duplicateOf : '';
    if (id === '') return null;
    const seeded = this.runtime.history.get(id);
    return {
      id,
      transactionId: seeded?.transactionId ?? (typeof o4.facts.transactionId === 'string' ? o4.facts.transactionId : null),
      paidAt: seeded?.seededAt ?? null,
    };
  }

  private safeError(scope: string, message: string, detail: string | null): void {
    try {
      this.runtime.append('error', { scope, message, detail });
    } catch {
      // A broken ledger must not take the runner down with it; the caller still gets the error.
    }
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.polls.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readAmount(value: unknown, invoiced: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > invoiced) {
    throw new ConflictError(
      'The approved amount must be a whole number of cents, above zero and no more than the invoice. Nothing was sent.',
      'bad_amount',
    );
  }
  return amount;
}

function conflictMessage(action: HumanAction, state: string | null): string {
  switch (action) {
    case 'approve':
      return `Only a payment on hold can be approved — this one is ${label(state)}. Nothing was sent.`;
    case 'verify_payee':
      return `Only a payment on hold can be re-verified — this one is ${label(state)}. Nothing was changed.`;
    case 'accept_delivery':
      return `Only a payment on hold can have its delivery accepted — this one is ${label(state)}. Nothing was changed.`;
    case 'reject':
    case 'mark_fraud':
      return `Only a payment on hold can be stopped — this one is ${label(state)}. Nothing was changed.`;
    case 'cancel_payout':
      return `Only a sent, unclaimed payout can be cancelled — this one is ${label(state)}. Nothing was changed.`;
    case 'refresh_receipt':
      return `There is no PayPal receipt to refresh for a payment that is ${label(state)}.`;
    default:
      return `That action is not allowed while the payment is ${label(state)}.`;
  }
}

function label(state: string | null): string {
  if (!state) return 'not proposed';
  if (state === 'held') return 'on hold';
  if (state === 'blocked') return 'blocked';
  if (state === 'proven') return 'already proven';
  if (state === 'submitted') return 'sent, waiting for a receipt';
  if (state === 'awaiting') return 'waiting for the payee to claim it';
  return state;
}

/** Deterministic explanation used when the model output is missing or unusable (AC-10 fallback). */
export function templateExplanation(checks: readonly { id: string; status: string; code: string }[]): string {
  const worst = checks.find((check) => check.status === 'fail') ?? checks.find((check) => check.status === 'hold');
  if (!worst) return 'This payment is waiting for a human.';
  return `The ${worst.id} check did not pass (${worst.code}). It stays out of PayPal until a human looks at it.`;
}

export function templateSummary(totals: Totals): string {
  const parts = [
    `${totals.proven.count} proven (${formatCents(totals.proven.amount)})`,
    `${totals.awaitingProof.count} awaiting proof (${formatCents(totals.awaitingProof.amount)})`,
    `${totals.held.count} on hold (${formatCents(totals.held.amount)})`,
    `${totals.stopped.count} stopped (${formatCents(totals.stopped.amount)})`,
  ];
  return `${parts.join(' · ')}.`;
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
