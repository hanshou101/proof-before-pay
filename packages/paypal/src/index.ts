// @pbp/paypal — the PayPal Payouts rail (SPEC §6.5).
//
// `createPayPalRail(env)` is the factory the server and `demo:reset` call with the merged
// environment. It throws a `PayPalRailError` with a human sentence when the configuration is
// unusable, before any request can be made. Everything else the caller needs is a `RailAdapter`
// from `@pbp/core`; `PayPalIntent.vendorId`, `PayPalSubmitResult.receiver` and
// `PayPalReceipt.statusKnown` are the extras this rail adds.

export { buildPayoutPayload, createPayPalRail, PayPalRail, formatCents, SUBMIT_RETRY_DELAYS_MS } from './rail.js';
export type { PayPalIntent, PayPalRailOptions, PayPalReceipt, PayPalSubmitResult } from './rail.js';
export { PayPalRailError, redact } from './errors.js';
export type { PayPalErrorKind, PayPalRailErrorOptions } from './errors.js';
export { isKnownRailStatus, mapStatus, normaliseStatus, PAYPAL_ITEM_STATUSES } from './status.js';
export {
  MAX_NOTE_LENGTH,
  MAX_REQUEST_ID,
  MAX_SENDER_BATCH_ID,
  MAX_SENDER_ITEM_ID,
  readEnv,
  readPayPalConfig,
  SANDBOX_BASE_URL,
  TOKEN_REFRESH_SKEW_MS,
} from './config.js';
export type { Env, FaultSpec, PayPalRailConfig } from './config.js';
