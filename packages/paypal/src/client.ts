// The HTTP half: OAuth2 client credentials, one cached token, and a request helper that never
// lets a credential into an error.
//
// SPEC §6.5.1: the token is renewed 60 seconds before `expires_in` runs out. Concurrent callers
// share one in-flight token request, so a burst of payouts cannot stampede the token endpoint.
// A 401 on a business call drops the cache and retries that call once with a fresh token — a 401
// means PayPal did not process it, so the retry cannot duplicate anything.

import { PayPalRailError, redact } from './errors.js';
import { TOKEN_REFRESH_SKEW_MS, type PayPalRailConfig } from './config.js';

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or null when PayPal sent none / not JSON. */
  body: unknown;
  url: string;
}

/** Read-only telemetry for the sandbox spike: never called for the token endpoint. */
export interface HttpExchange {
  method: string;
  url: string;
  status: number;
  body: unknown;
}

export interface ClientDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  onResponse?: (exchange: HttpExchange) => void;
}

export interface SendOptions {
  body?: string;
  headers?: Record<string, string>;
}

export class PayPalClient {
  private cached: { token: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly config: PayPalRailConfig,
    private readonly deps: ClientDeps,
  ) {}

  async token(): Promise<string> {
    const now = this.deps.now();
    if (this.cached !== null && now < this.cached.expiresAt - TOKEN_REFRESH_SKEW_MS) {
      return this.cached.token;
    }
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.fetchToken().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Drops the cached token (used when PayPal answers 401). */
  forgetToken(): void {
    this.cached = null;
  }

  async send(method: string, pathOrUrl: string, options: SendOptions = {}): Promise<HttpResult> {
    const url = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : `${this.config.baseUrl}${pathOrUrl}`;

    let token = await this.token();
    let result = await this.request(method, url, { ...options.headers, Authorization: `Bearer ${token}` }, options.body);
    this.deps.onResponse?.({ method, url, status: result.status, body: result.body });

    if (result.status === 401) {
      this.forgetToken();
      token = await this.token();
      result = await this.request(method, url, { ...options.headers, Authorization: `Bearer ${token}` }, options.body);
      this.deps.onResponse?.({ method, url, status: result.status, body: result.body });
    }
    return result;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64');
    const result = await this.request(
      'POST',
      `${this.config.baseUrl}/v1/oauth2/token`,
      {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      'grant_type=client_credentials',
    );

    if (result.status === 401 || result.status === 403) {
      throw new PayPalRailError(
        'unauthorized',
        'PayPal rejected the API credentials — check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Nothing was sent.',
        { status: result.status, detail: this.describe(result.body) },
      );
    }
    if (result.status >= 500) {
      throw new PayPalRailError('unavailable', 'PayPal is not answering right now. Nothing was sent.', {
        status: result.status,
        retryable: true,
        detail: this.describe(result.body),
      });
    }
    if (result.status !== 200) {
      throw new PayPalRailError('unauthorized', 'PayPal would not issue an access token. Nothing was sent.', {
        status: result.status,
        detail: this.describe(result.body),
      });
    }

    const body = (result.body ?? {}) as Record<string, unknown>;
    const token = typeof body.access_token === 'string' ? body.access_token.trim() : '';
    if (token === '') {
      throw new PayPalRailError('protocol', 'PayPal did not return an access token. Nothing was sent.', {
        status: result.status,
      });
    }
    const expiresIn = Number(body.expires_in);
    const lifetimeMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0;
    this.cached = { token, expiresAt: this.deps.now() + lifetimeMs };
    return token;
  }

  private async request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<HttpResult> {
    let response: Response;
    try {
      response = await this.deps.fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new PayPalRailError(
        'network',
        'PayPal did not answer. We will retry with the same key — a retry can never pay twice.',
        { retryable: true, detail: this.redact(messageOf(error)), cause: error },
      );
    }

    let text = '';
    try {
      text = await response.text();
    } catch (error) {
      throw new PayPalRailError(
        'network',
        'PayPal did not answer. We will retry with the same key — a retry can never pay twice.',
        { retryable: true, detail: this.redact(messageOf(error)), cause: error },
      );
    }

    let parsed: unknown = null;
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, body: parsed, url };
  }

  /** name / message / debug_id / issue strings only — never the whole body, which can hold emails. */
  describe(body: unknown): string | null {
    if (body === null || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['name', 'message', 'debug_id']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') parts.push(value.trim());
    }
    const details = Array.isArray(record.details) ? record.details : [];
    for (const detail of details) {
      if (detail !== null && typeof detail === 'object') {
        const issue = (detail as Record<string, unknown>).issue;
        if (typeof issue === 'string' && issue.trim() !== '') parts.push(issue.trim());
      }
    }
    return parts.length === 0 ? null : this.redact(parts.join(' · '));
  }

  private redact(text: string): string {
    return redact(text, [this.config.clientSecret, this.config.clientId, this.cached?.token ?? '']);
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
