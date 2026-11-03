// Where the world the gate is allowed to see comes from (SPEC §6.2.2 / core's `GateContext`):
// the normative scenario, overlaid with the human actions recorded in the ledger, plus the
// intent projection. Nothing else. The gate gets no network, no files and no wall clock.

import type { GateContext, IntentRecord, PayeeChangeRequest } from '@pbp/core';
import type { Runtime } from './runtime.js';

export interface GateOverride {
  /** A human-approved lower amount (SPEC §6.2.2, O2 last paragraph). */
  approvedAmount?: number | null;
  approvedBy?: string | null;
}

export function buildGateContext(runtime: Runtime, override: GateOverride = {}): GateContext {
  const scenario = runtime.demo.scenario;
  const { overlay } = runtime;
  const now = runtime.now;

  const vendors = scenario.vendors.map((vendor) => {
    const changed = overlay.vendorPayee.get(vendor.id);
    if (!changed) return vendor;
    return {
      ...vendor,
      payee: { rail: 'paypal' as const, recipientType: 'EMAIL' as const, receiver: changed.receiver },
      payeeVerified: { at: changed.at, method: changed.method, by: changed.by },
    };
  });

  const deliveries = scenario.deliveries.map((delivery) => {
    const accepted = overlay.deliveryAccepted.get(delivery.id);
    return accepted ? { ...delivery, acceptedAt: accepted.acceptedAt, acceptedBy: accepted.acceptedBy } : delivery;
  });

  const changeRequests: PayeeChangeRequest[] = [...overlay.changeRequests.values()];

  const intents: IntentRecord[] = [];
  for (const intent of Object.values(runtime.projection.intents)) {
    if (!intent.state) continue;
    intents.push({
      id: intent.id,
      itemId: intent.itemId,
      vendorId: intent.vendorId,
      agreementId: intent.agreementId,
      amount: intent.amount,
      currency: intent.currency,
      payee: intent.payee,
      fingerprint: intent.fingerprint,
      idempotencyKey: intent.idempotencyKey,
      state: intent.state,
      at: overlay.intentAt.get(intent.id) ?? now,
      transactionId: intent.receipt?.transactionId ?? null,
      approvedAmount: intent.approvedAmount,
    });
  }

  return {
    vendors,
    agreements: scenario.agreements,
    deliveries,
    changeRequests,
    intents,
    history: runtime.historyRecords(),
    policy: scenario.policy,
    now,
    epoch: runtime.epoch,
    ...(override.approvedAmount !== undefined && override.approvedAmount !== null
      ? { approvedAmount: override.approvedAmount, approvedBy: override.approvedBy ?? null }
      : {}),
  };
}
