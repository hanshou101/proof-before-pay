// The proof bundle (AC-15): everything about one payout in one document, tied back to the
// ledger row that recorded it. The response is validated against
// `schemas/proof-bundle.schema.json` before it leaves the server — a bundle that does not satisfy
// the schema is a bug, not a payload.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatUSD, type CheckResult } from '@pbp/core';
import { REPO_ROOT } from './config.js';
import { NotFoundError } from './errors.js';
import { validateSchema, type JsonSchema } from './json-schema.js';
import type { Runtime } from './runtime.js';
import { vendorOf } from './scenario.js';
import type { Agreement, Claim, Delivery } from './types.js';

let cachedSchema: JsonSchema | null = null;

export function bundleSchema(): JsonSchema {
  if (!cachedSchema) {
    const path = resolve(REPO_ROOT, 'schemas/proof-bundle.schema.json');
    cachedSchema = JSON.parse(readFileSync(path, 'utf8')) as JsonSchema;
  }
  return cachedSchema;
}

export function buildBundle(runtime: Runtime, intentId: string): Record<string, unknown> {
  const intent = runtime.intent(intentId);
  if (!intent) throw new NotFoundError(`No payment intent ${intentId}.`);

  const scenario = runtime.demo.scenario;
  const claim = runtime.claimOf(intent.itemId) as Claim | null;
  if (!claim) throw new NotFoundError(`Intent ${intentId} has no extracted invoice.`);

  const item = runtime.demo.byId.get(intent.itemId);
  const historyEntry = scenario.history.find((entry) => entry.id === intent.itemId);

  const fileName = item?.attachments[0]?.name ?? (historyEntry ? historyEntry.sourceFile : 'email body');
  const kind = historyEntry ? 'history' : item?.attachments.length ? 'attachment' : 'email_body';

  const agreement: Agreement | null = intent.agreementId
    ? (scenario.agreements.find((entry) => entry.id === intent.agreementId) ?? null)
    : null;

  const checks: CheckResult[] = intent.checks ?? [];
  const deliveryId = (checks.find((check) => check.id === 'O3')?.facts.deliveryId as string | undefined) ?? null;
  const delivery: Delivery | null = deliveryId
    ? (scenario.deliveries.find((entry) => entry.id === deliveryId) ?? null)
    : agreement
      ? (scenario.deliveries.find((entry) => entry.id === agreement.deliveryIds[0]) ?? null)
      : null;

  const accepted = delivery ? runtime.overlay.deliveryAccepted.get(delivery.id) : undefined;
  const p1 = checks.find((check) => check.id === 'P1');
  const vendor = vendorOf(scenario, intent.vendorId);
  const changedPayee = intent.vendorId ? runtime.overlay.vendorPayee.get(intent.vendorId) : undefined;

  const humanVerification = runtime.events
    .filter((event) => event.type === 'human.action')
    .filter((event) => (event.data as { intentId?: string }).intentId === intentId)
    .filter((event) => (event.data as { action?: string }).action === 'verify_payee')
    .map((event) => {
      const data = event.data as { by?: string | null; input?: { result?: string; method?: string } };
      return {
        at: event.at,
        by: data.by ?? 'human',
        method: data.input?.method ?? 'phone_call',
        result: data.input?.result ?? '',
      };
    })
    .pop() ?? null;

  const lastEvent = [...runtime.events].reverse().find((event) => {
    const data = event.data as { intentId?: string } | null;
    return data && data.intentId === intentId;
  });

  // One clock for the whole story (07-UI §4.4, D1-11): the extraction time comes from the ledger
  // row that recorded the read, not from the machine's wall clock. Otherwise the drawer mixes
  // "Oct 30 · 02:30" (real time) with "17:30:04" (the demo clock) in one timeline.
  const extractedAt = [...runtime.events]
    .reverse()
    .find((event) => event.type === 'claim.extracted' && (event.data as { itemId?: string }).itemId === intent.itemId)?.at;

  // …and the three gate steps happened at `intent.checked`, not when someone opened the drawer.
  // Using `generatedAt` there put "Owed 17:33:55" above "Sent to PayPal 17:30:37" — a timeline
  // that runs backwards (T8 round 3, item 4).
  const checkedAt =
    [...runtime.events]
      .reverse()
      .find((event) => event.type === 'intent.checked' && (event.data as { intentId?: string }).intentId === intentId)?.at ??
    runtime.now;

  const verification = runtime.ledgerVerification();

  const bundle: Record<string, unknown> = {
    bundleVersion: 'proof-bundle/1',
    intentId,
    itemId: intent.itemId,
    generatedAt: runtime.now,
    /** When the gate decided — the timestamp of the Owed / Payee / Policy steps (D1-11). */
    checkedAt,
    source: {
      fileName,
      sha256: claim.sourceSha256,
      from: item?.from ?? (vendor ? `${vendor.name} <${vendor.payee.receiver}>` : ''),
      subject: item?.subject ?? (historyEntry ? `Paid before this run — ${historyEntry.invoiceNumber}` : ''),
      receivedAt: item?.receivedAt ?? historyEntry?.seededBy ?? '',
      kind,
    },
    extraction: claim.extractedBy
      ? { model: claim.extractedBy.model, at: extractedAt ?? claim.extractedBy.at }
      : null,
    claim,
    agreement: agreement
      ? {
          id: agreement.id,
          vendorId: agreement.vendorId,
          po: agreement.po,
          scope: agreement.scope,
          kind: agreement.kind,
          currency: agreement.currency,
          fee: agreement.fee ?? null,
          rate: agreement.rate ?? null,
          capUnits: agreement.capUnits ?? null,
          deliveryIds: agreement.deliveryIds,
        }
      : null,
    amountRule: amountRuleFor(agreement, intent.approvedAmount),
    delivery: delivery
      ? {
          id: delivery.id,
          title: delivery.title,
          submittedAt: delivery.submittedAt,
          acceptedAt: accepted?.acceptedAt ?? delivery.acceptedAt,
          acceptedBy: accepted?.acceptedBy ?? delivery.acceptedBy,
          evidence: delivery.evidence,
        }
      : null,
    payee: {
      onFile: typeof p1?.facts.onFile === 'string' ? p1.facts.onFile : (vendor?.payee.receiver ?? ''),
      requested: typeof p1?.facts.requested === 'string' ? p1.facts.requested : (claim.requestedPayee ?? ''),
      verifiedAt: typeof p1?.facts.verifiedAt === 'string' ? p1.facts.verifiedAt : (vendor?.payeeVerified.at ?? ''),
      method: typeof p1?.facts.method === 'string' ? p1.facts.method : (vendor?.payeeVerified.method ?? ''),
      verifiedBy: vendor?.payeeVerified.by ?? '',
      onFileNow: changedPayee?.receiver ?? vendor?.payee.receiver ?? '',
      humanVerification,
    },
    checks,
    decision: intent.decision,
    // The gate's prose is evidence only while the decision it explains is still the decision.
    // After a human approved a held payment, an explanation that arrived late still reads
    // "so it is held" — publishing it would describe a state that no longer exists.
    explanation:
      intent.decision === 'held' || intent.decision === 'blocked' ? (intent.explanation ?? null) : null,
    payment: intent.submission
      ? {
          rail: 'paypal',
          amount: intent.approvedAmount ?? intent.amount,
          currency: intent.currency,
          receiver: intent.payee?.receiver ?? '',
          // SPEC §6.5.5: the invoice asks for the scenario address; PayPal was handed the
          // sandbox account from `PBP_RECEIVER_MAP`. Both are evidence, so both are recorded.
          receiverRequested: intent.payee?.receiver ?? '',
          receiverSent: runtime.receiverOf(intentId)?.sent ?? null,
          senderBatchId: intent.submission.senderBatchId,
          payoutBatchId: intent.submission.payoutBatchId,
          payoutItemId: intent.receipt?.payoutItemId ?? null,
          transactionId: intent.receipt?.transactionId ?? null,
          railStatus: intent.receipt?.railStatus ?? 'PENDING',
          fetchedAt: intent.receipt?.fetchedAt ?? intent.submission.at,
          submittedAt: intent.submission.at,
          attempts: intent.submission.attempt,
        }
      : null,
    ledger: {
      seq: lastEvent?.seq ?? 0,
      hash: lastEvent?.hash ?? '',
      eventType: lastEvent?.type ?? 'none',
      head: runtime.projection.head,
      verified: verification.verified,
    },
  };

  if (intent.state === 'proven' && !intent.receipt?.transactionId) {
    throw new Error(`Intent ${intentId} is proven without a PayPal transaction id — refusing to publish a bundle.`);
  }

  const bundleForValidation = {
    ...bundle,
    ledger: { ...(bundle.ledger as Record<string, unknown>), seq: Math.max(1, lastEvent?.seq ?? 1) },
  };
  const errors = validateSchema(bundleForValidation, bundleSchema());
  if (errors.length > 0) {
    const first = errors
      .slice(0, 3)
      .map((error) => `${error.path} ${error.message}`)
      .join('; ');
    throw new Error(`Proof bundle failed its own schema: ${first}`);
  }

  return bundle;
}

function amountRuleFor(agreement: Agreement | null, approvedAmount: number | null): string {
  if (!agreement) return 'No contract matched — the gate never approved this payment.';
  if (approvedAmount !== null) {
    const cap =
      agreement.kind !== 'fixed' && agreement.rate != null && agreement.capUnits != null
        ? agreement.rate * agreement.capUnits
        : null;
    return `Human-approved ${formatUSD(approvedAmount)}${cap !== null ? ` (contract cap ${formatUSD(cap)})` : ''} — below the invoiced amount.`;
  }
  if (agreement.kind === 'fixed') {
    return `fixed fee: the invoice total must equal ${formatUSD(agreement.fee ?? 0)}.`;
  }
  if (agreement.kind === 'hourly') {
    return `hourly: quantity × ${formatUSD(agreement.rate ?? 0)} per hour, capped at ${agreement.capUnits ?? 0} h.`;
  }
  return `per word: quantity × ${formatUSD(agreement.rate ?? 0)} per word, capped at ${agreement.capUnits ?? 0} words.`;
}
