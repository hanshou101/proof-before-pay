// `demo:reset` (SPEC §6.7): a new epoch, an empty ledger, and one real payout for
// `hist_kenji_0142` that goes through the same gate and the same rail as a live run.
//
// The historical payment is *not* turned into a live intent: SPEC §6.3.2 gives
// `history.seeded` exactly three fields (historyId, intentId, fingerprint), and leaving the seed
// out of the intent projection is what keeps `replay`'s totals equal to
// `golden.totalsAfterRun` (the four payments the Friday run makes, not five). The rail ids —
// including the PayPal transaction id the demo links to — live in `data/history.json`, and are
// what O4 reports as the original payment.

import {
  evaluate,
  fingerprint,
  idempotencyKey,
  type Claim,
  type Proposal,
  type RailAdapter,
  type RailRef,
  type ReceiptResult,
} from '@pbp/core';
import type { ServerConfig } from './config.js';
import { credentialMessage, missingCredentials } from './config.js';
import { BadRequestError, ConflictError, messageOf } from './errors.js';
import { credentialFailure, humanRailMessage } from './rail-errors.js';
import { buildGateContext } from './gate-context.js';
import { newEpoch, type Runtime, type SeededHistory } from './runtime.js';
import { sha256Text, vendorOf, type LoadedDemo } from './scenario.js';

export const HISTORY_INTENT_ID = 'hist_kenji_0142';

export interface ResetDeps {
  runtime: Runtime;
  demo: LoadedDemo;
  rail: RailAdapter;
  config: ServerConfig;
}

export async function resetDemo(deps: ResetDeps): Promise<{ epoch: string; history: SeededHistory }> {
  const { runtime, demo, rail, config } = deps;
  const scenario = demo.scenario;

  // Before anything is wiped: a reset with no credentials used to empty the ledger first and then
  // take two minutes to say it could not pay. Check first, answer in the same breath (T8 round 3).
  const missing = missingCredentials(config.env);
  if (missing.length > 0) {
    throw new BadRequestError(credentialMessage(missing), 'missing_credentials');
  }

  const epoch = newEpoch();
  runtime.openEpoch(epoch);

  const seed = scenario.history.find((entry) => entry.id === HISTORY_INTENT_ID);
  if (!seed) throw new BadRequestError('The scenario has no hist_kenji_0142 to seed.', 'no_history');

  const vendor = vendorOf(scenario, seed.vendorId);
  if (!vendor) throw new BadRequestError('The seeded history vendor is not in the scenario.', 'no_vendor');

  const agreement = scenario.agreements.find((entry) => entry.id === seed.agreementId) ?? null;
  const sourceFile = demo.byId.get('in_03')?.attachments[0];

  const claim: Claim = {
    itemId: HISTORY_INTENT_ID,
    vendorId: seed.vendorId,
    vendorName: vendor.name,
    senderEmail: vendor.payee.receiver,
    invoiceNumber: seed.invoiceNumber,
    issueDate: '2026-10-28',
    currency: seed.currency,
    total: seed.total,
    po: agreement?.po ?? null,
    requestedPayee: vendor.payee.receiver,
    lines: [
      {
        description: agreement?.scope ?? 'Historical payment',
        quantity: 1,
        unit: 'item',
        unitPrice: seed.total,
        amount: seed.total,
      },
    ],
    sourceSha256: sourceFile?.sha256 ?? sha256Text(seed.id),
    extractedBy: null,
  };

  const proposal: Proposal = {
    claim,
    agreementId: seed.agreementId,
    agreementMatchedBy: 'po',
    rationale: 'Seeded history — paid through the same gate and the same rail as a live run.',
  };

  const context = buildGateContext(runtime);
  // The row we are about to create must not look like a duplicate of itself: at seed time this
  // payment does not exist yet (O4 would otherwise block the very payout that creates it).
  const evaluation = evaluate(proposal, {
    ...context,
    history: context.history.filter((record) => record.id !== HISTORY_INTENT_ID),
  });
  if (evaluation.decision !== 'approved') {
    const worst = evaluation.checks.find((check) => check.status === 'fail' || check.status === 'hold');
    throw new ConflictError(
      `The historical payment does not pass the gate (${worst?.id ?? '?'} ${worst?.code ?? '?'}), so nothing was sent.`,
      'seed_not_approved',
    );
  }

  const fp = fingerprint({
    vendorId: seed.vendorId,
    invoiceNumber: seed.invoiceNumber,
    currency: seed.currency,
    total: seed.total,
  });
  const key = idempotencyKey(epoch, fp);
  const memo = `${scenario.payer.name} · ${seed.invoiceNumber} · ${claim.po ?? 'no PO'}`;

  let batchId: string | null = null;
  let sandboxReceiver: string | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < config.poll.submitAttempts && batchId === null; attempt += 1) {
    try {
      const result = await rail.submit({
        intentId: HISTORY_INTENT_ID,
        idempotencyKey: key,
        amount: seed.total,
        currency: seed.currency,
        receiver: vendor.payee.receiver,
        memo,
        // SPEC §6.5.5: the sandbox cannot host `.example` addresses, so the rail swaps in the
        // sandbox account from `PBP_RECEIVER_MAP` (keyed by vendorId). Without this the seed
        // payout goes to a non-existent address and never leaves UNCLAIMED.
        vendorId: seed.vendorId,
      } as Parameters<typeof rail.submit>[0]);
      batchId = result.payoutBatchId;
      sandboxReceiver = (result as { receiver?: string }).receiver ?? null;
    } catch (error) {
      lastError = humanRailMessage(error, messageOf(error));
      appendResetError(runtime, 'demo.reset', 'The seeded historical payment was not confirmed by PayPal.', error);
      // PayPal refused us (bad credentials), so asking three more times cannot help: answer in
      // one second with the reason instead of after the receipt window (T8 round 3, item 5).
      if (credentialFailure(error)) {
        throw new ConflictError(lastError, 'seed_refused');
      }
    }
    if (batchId === null && attempt < config.poll.submitAttempts - 1) {
      await sleep(config.poll.submitBackoffMs[attempt] ?? 0);
    }
  }

  const ref: RailRef = {
    intentId: HISTORY_INTENT_ID,
    idempotencyKey: key,
    senderBatchId: key,
    payoutBatchId: batchId,
    payoutItemId: null,
  };

  let receipt: ReceiptResult | null = null;
  const deadline = Date.now() + config.poll.windowMs;
  for (;;) {
    try {
      const current = await rail.fetchReceipt(ref);
      receipt = current;
      if (current.proof === 'proven') break;
    } catch {
      // keep asking until the window closes
    }
    if (Date.now() >= deadline) break;
    await sleep(config.poll.intervalMs);
  }

  if (!receipt || receipt.proof !== 'proven' || !receipt.transactionId) {
    // Name PayPal's own reason when there is one: "not proven yet" alone sent a reader looking in
    // the wrong place when the sandbox account had simply run out of money.
    throw new ConflictError(
      `The seeded payment is not proven yet, so the demo did not reset. Run demo:reset again once PayPal confirms the payout.${
        lastError === null ? '' : ` PayPal last said: ${lastError}`
      }`,
      'seed_not_proven',
    );
  }

  runtime.append('history.seeded', {
    historyId: HISTORY_INTENT_ID,
    intentId: HISTORY_INTENT_ID,
    fingerprint: fp,
  });

  const record: SeededHistory = {
    historyId: HISTORY_INTENT_ID,
    intentId: HISTORY_INTENT_ID,
    fingerprint: fp,
    rail: 'paypal',
    senderBatchId: key,
    payoutBatchId: batchId,
    payoutItemId: receipt.payoutItemId,
    transactionId: receipt.transactionId,
    railStatus: receipt.railStatus,
    fetchedAt: receipt.fetchedAt,
    amount: seed.total,
    currency: seed.currency,
    receiver: vendor.payee.receiver,
    sandboxReceiver,
    seededAt: runtime.now,
  };
  runtime.recordHistory(record);
  runtime.recordReceiver(HISTORY_INTENT_ID, {
    requested: vendor.payee.receiver,
    sent: sandboxReceiver ?? vendor.payee.receiver,
  });

  return { epoch, history: record };
}

function appendResetError(runtime: Runtime, scope: string, message: string, error: unknown): void {
  try {
    runtime.append('error', { scope, message, detail: messageOf(error) });
  } catch {
    // nothing else we can do; the caller still gets a 409
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
