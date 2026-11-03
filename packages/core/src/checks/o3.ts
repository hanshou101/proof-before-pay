// O3 — was the work accepted? SPEC §6.2.2.
//
// Every delivery the agreement names must have `acceptedAt` set and not in the future
// relative to `context.now`. A future acceptance date is treated as not accepted yet.

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { na, result, statusOf } from './util.js';

export function checkO3(deps: CheckDeps): CheckResult {
  const { context, agreement } = deps;

  if (statusOf(deps.results, 'O1') !== 'pass') return na('O3');
  if (!agreement) return na('O3');

  const now = Date.parse(context.now);

  for (const deliveryId of agreement.deliveryIds) {
    const delivery = context.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) {
      return result('O3', 'hold', 'NOT_ACCEPTED', {
        deliveryId,
        acceptedAt: null,
        submittedAt: null,
        reason: 'missing-delivery',
      });
    }
    if (!delivery.acceptedAt) {
      return result('O3', 'hold', 'NOT_ACCEPTED', {
        deliveryId: delivery.id,
        submittedAt: delivery.submittedAt,
        acceptedAt: null,
      });
    }
    if (Date.parse(delivery.acceptedAt) > now) {
      return result('O3', 'hold', 'NOT_ACCEPTED', {
        deliveryId: delivery.id,
        submittedAt: delivery.submittedAt,
        acceptedAt: delivery.acceptedAt,
        reason: 'accepted-in-future',
      });
    }
  }

  const first = agreement.deliveryIds
    .map((id) => context.deliveries.find((d) => d.id === id))
    .find((d) => d !== undefined);

  return result('O3', 'pass', 'DELIVERY_ACCEPTED', {
    deliveryId: first?.id ?? null,
    acceptedAt: first?.acceptedAt ?? null,
    acceptedBy: first?.acceptedBy ?? null,
    deliveryCount: agreement.deliveryIds.length,
  });
}
