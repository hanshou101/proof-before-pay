// One error type with a machine-readable kind and a human sentence. The message is what the UI
// shows (SPEC §6.5 / AC-17); `detail` is only for the developer switch and is always redacted.
//
// Nothing that reaches a message, a log line or a ledger event may contain the client secret,
// the client id or an Authorization header. `redact` is the choke point for that.

export type PayPalErrorKind =
  | 'config'
  | 'missing_credentials'
  | 'unauthorized'
  | 'rejected'
  | 'network'
  | 'unavailable'
  | 'lost_response'
  | 'not_cancelable'
  | 'no_reference'
  | 'duplicate_without_link'
  | 'protocol';

export interface PayPalRailErrorOptions {
  status?: number | null;
  retryable?: boolean;
  detail?: string | null;
  cause?: unknown;
}

export class PayPalRailError extends Error {
  readonly kind: PayPalErrorKind;
  readonly status: number | null;
  /** True when resending the same key is safe and expected. */
  readonly retryable: boolean;
  /** Developer-facing context; already redacted. */
  readonly detail: string | null;

  constructor(kind: PayPalErrorKind, message: string, options: PayPalRailErrorOptions = {}) {
    super(message);
    this.name = 'PayPalRailError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail ?? null;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC = /Basic\s+[A-Za-z0-9+/=]{8,}/gi;
const ACCESS_TOKEN_JSON = /"access_token"\s*:\s*"[^"]*"/gi;
const CLIENT_SECRET_JSON = /"client_secret"\s*:\s*"[^"]*"/gi;

/**
 * Removes credentials from free text. `secrets` are the exact values we hold (client id,
 * client secret, tokens); the regexes catch header-shaped leaks we do not hold a copy of.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(BEARER, 'Bearer [redacted]')
    .replace(BASIC, 'Basic [redacted]')
    .replace(ACCESS_TOKEN_JSON, '"access_token":"[redacted]"')
    .replace(CLIENT_SECRET_JSON, '"client_secret":"[redacted]"');
}
