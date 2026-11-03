// SPEC §6.5.3 — PayPal's item status vocabulary onto our four proof states.
//
// `mapStatus` is `@pbp/core`'s table, unchanged: one table, one place to change it. What this
// module adds is `isKnownRailStatus`, because the rail must be able to tell the caller "PayPal
// said something the table does not contain" so the caller can record an `error` event
// (SPEC §6.5.3 last sentence). The value is still treated as pending.

import { KNOWN_RAIL_STATUSES, mapStatus as coreMapStatus } from '@pbp/core';
import type { ProofState } from '@pbp/core';

/** The nine documented item statuses, uppercased. `batch_status` is not part of this list. */
export const PAYPAL_ITEM_STATUSES: readonly string[] = KNOWN_RAIL_STATUSES;

export function normaliseStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** False when PayPal returned a status outside SPEC §6.5.3; the caller records an error event. */
export function isKnownRailStatus(value: string): boolean {
  return PAYPAL_ITEM_STATUSES.includes(normaliseStatus(value));
}

export function mapStatus(railStatus: string): ProofState {
  return coreMapStatus(railStatus);
}
