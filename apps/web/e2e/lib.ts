/**
 * Shared plumbing for the end-to-end runs (AC-11 … AC-14).
 *
 * One rule shapes this file: the E2E talks to the *real* server, the *real* model and the *real*
 * PayPal sandbox. Nothing is stubbed. That makes it slow and a little flaky by nature, so every
 * wait is a poll with an upper bound (never a fixed sleep) and every failure prints what the
 * server was actually doing at the time.
 *
 * The server runs on its own port with its own data directory, so an E2E never fights a
 * `npm run dev` someone left running.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const E2E_PORT = Number(process.env.PBP_E2E_PORT ?? 8790);
export const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;
export const PROOF_DIR = join(REPO_ROOT, 'proof', 'e2e');

export interface Golden {
  totalsAfterRun: Totals;
  totalsAfterHumanSteps: Totals;
  humanSteps: { step: number; intentOf: string; action: string; input?: Record<string, unknown>; expect: string }[];
  comparisonMode: {
    payouts: { itemId: string; receiver: string; amount: number; paypal: string; problem?: string }[];
    totalSent: number;
  };
}

export interface Totals {
  proven: { count: number; amount: number };
  awaitingProof: { count: number; amount: number };
  held: { count: number; amount: number };
  stopped: { count: number; amount: number };
}

export function golden(): Golden {
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'demo', 'scenario', 'scenario.json'), 'utf8')) as {
    golden: Golden;
  };
  return scenario.golden;
}

export interface ServerHandle {
  url: string;
  proc: ChildProcess;
  dataDir: string;
  log: string[];
  stop(): Promise<void>;
  kill9(): Promise<void>;
}

/** Start `apps/server/dist/main.js` with the repo `.env` plus the overrides this scenario needs. */
export async function startServer(options: {
  dataDir: string;
  env?: Record<string, string>;
  label: string;
  /** Start from an empty data directory (a scenario that must not inherit a previous run). */
  fresh?: boolean;
}): Promise<ServerHandle> {
  const dataDir = resolve(REPO_ROOT, options.dataDir);
  if (options.fresh) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const log: string[] = [];
  const proc = spawn(process.execPath, [join(REPO_ROOT, 'apps', 'server', 'dist', 'main.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      PORT: String(E2E_PORT),
      PBP_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [proc.stdout, proc.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) if (line.trim() !== '') log.push(line);
    });
  }

  const deadline = Date.now() + 60_000;
  for (;;) {
    await wait(300);
    try {
      const response = await fetch(`${E2E_URL}/api/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`the server did not start (${options.label}); log:\n${log.join('\n')}`);
    }
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    proc.kill('SIGTERM');
    const until = Date.now() + 5000;
    while (proc.exitCode === null && Date.now() < until) await wait(100);
  };

  return {
    url: E2E_URL,
    proc,
    dataDir,
    log,
    stop,
    kill9: async () => {
      proc.kill('SIGKILL');
      const until = Date.now() + 5000;
      while (proc.exitCode === null && Date.now() < until) await wait(50);
    },
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

export async function until<T>(
  what: string,
  probe: () => Promise<T | null | false | undefined>,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastProblem = 'never answered';
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
      lastProblem = 'not yet';
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what} (${lastProblem})`);
    await wait(intervalMs);
  }
}

export interface ServerState {
  run: { phase: 'idle' | 'running' | 'done'; runId: string | null; mode: string | null };
  head: number;
  totals: Totals;
  intents: Record<
    string,
    {
      id: string;
      itemId: string;
      state: string;
      amount: number;
      approvedAmount: number | null;
      explanation?: { text: string; source: string } | null;
      receipt?: { transactionId: string | null; railStatus: string } | null;
      checks?: { id: string; status: string; code: string }[] | null;
    }
  >;
  byItem: Record<string, string>;
  errors: { scope: string; message: string }[];
}

export async function state(url = E2E_URL): Promise<ServerState> {
  const response = await fetch(`${url}/api/state`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/state answered ${response.status}`);
  return (await response.json()) as ServerState;
}

export async function resetDemo(url = E2E_URL): Promise<{ epoch: string }> {
  const response = await fetch(`${url}/api/demo/reset`, { method: 'POST' });
  const body = (await response.json()) as { ok?: boolean; epoch?: string; error?: string };
  if (!response.ok || !body.ok || !body.epoch) {
    throw new Error(`demo:reset failed (${response.status}): ${body.error ?? 'no message'}`);
  }
  return { epoch: body.epoch };
}

export function totalsMatch(actual: Totals, expected: Totals): { ok: boolean; diff: string[] } {
  const diff: string[] = [];
  for (const key of ['proven', 'awaitingProof', 'held', 'stopped'] as const) {
    if (actual[key].count !== expected[key].count) {
      diff.push(`${key}.count ${actual[key].count} != ${expected[key].count}`);
    }
    if (actual[key].amount !== expected[key].amount) {
      diff.push(`${key}.amount ${actual[key].amount} != ${expected[key].amount}`);
    }
  }
  return { ok: diff.length === 0, diff };
}

export function writeProof(name: string, body: string): string {
  mkdirSync(PROOF_DIR, { recursive: true });
  const path = join(PROOF_DIR, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

export function writeJson(name: string, value: unknown): string {
  return writeProof(name, `${JSON.stringify(value, null, 2)}\n`);
}

/** The ledger, one line per event, without the hash bodies (they are long and add nothing here). */
export function keyLog(events: { seq: number; at: string; type: string; data: unknown }[]): string {
  return events
    .map((event) => {
      const data = event.data as Record<string, unknown>;
      const bits: string[] = [];
      for (const key of ['itemId', 'intentId', 'classification', 'decision', 'state', 'railStatus', 'proof', 'transactionId', 'action', 'scope', 'message', 'text']) {
        if (data[key] !== undefined && data[key] !== null) bits.push(`${key}=${String(data[key])}`);
      }
      if (data.totals) bits.push(`totals=${JSON.stringify(data.totals)}`);
      return `#${String(event.seq).padStart(3)} ${event.at} ${event.type.padEnd(22)} ${bits.join(' ')}`;
    })
    .join('\n');
}

/**
 * `GET /api/events?since=0` is an endless stream, so this reads for a bounded time and then hangs
 * up — the replay is complete long before that, and an E2E must never wait on a live socket.
 */
export async function fetchEvents(url = E2E_URL, ms = 3000): Promise<{ seq: number; at: string; type: string; data: unknown }[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let buffer = '';
  try {
    const response = await fetch(`${url}/api/events?since=0`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
    }
  } catch {
    // Aborting the read is how this function ends; whatever arrived is already in `buffer`.
  } finally {
    clearTimeout(timer);
  }

  const events: { seq: number; at: string; type: string; data: unknown }[] = [];
  for (const block of buffer.split('\n\n')) {
    const line = block.split('\n').find((entry) => entry.startsWith('data: '));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      // trailing frame
    }
  }
  return events;
}

export interface BrowserSession {
  browser: Browser;
  page: Page;
  close(): Promise<void>;
}

const SCREENSHOT_DIR = join(REPO_ROOT, 'proof', 'ui');

export async function openApp(query = ''): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await page.goto(`${E2E_URL}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app', { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  (page as Page & { consoleErrors?: string[] }).consoleErrors = consoleErrors;
  return {
    browser,
    page,
    close: async () => {
      if (consoleErrors.length > 0) console.log(`console errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
      await browser.close();
    },
  };
}

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SCREENSHOT_DIR, name), animations: 'disabled' });
}

/** A screenshot kept next to the logs (proof/e2e/), for evidence that is not a 07-UI screen. */
export async function shotProof(page: Page, name: string): Promise<string> {
  mkdirSync(PROOF_DIR, { recursive: true });
  const path = join(PROOF_DIR, name);
  await page.waitForTimeout(200);
  await page.screenshot({ path, animations: 'disabled' });
  return path;
}

/** Click the primary header button and wait for `phase === running`. */
export async function clickRun(page: Page): Promise<void> {
  // The empty detail panel repeats the same action as a quiet secondary button (07-UI §4.5),
  // so the header's one accent button is what the E2E presses.
  await page.locator('.topbar .btn--primary').click();
  await until('the run to start', async () => (await state()).run.phase === 'running', 30_000, 500);
}

export async function waitForDone(timeoutMs: number): Promise<ServerState> {
  return until(
    'the run to finish',
    async () => {
      const current = await state();
      return current.run.phase === 'done' ? current : null;
    },
    timeoutMs,
    1500,
  );
}

export function summaryOf(snapshot: ServerState): string {
  return Object.values(snapshot.intents)
    .map((intent) => `${intent.itemId} ${intent.state} ${intent.amount}${intent.approvedAmount !== null ? ` (approved ${intent.approvedAmount})` : ''}`)
    .sort()
    .join('\n');
}

/**
 * What the screen is actually showing — read from the DOM, not from the API.
 *
 * T8 round 3, item 6: AC-11 and AC-12 asserted the API only, so a run whose totals were right
 * but whose screen was stuck on an error banner passed. These assertions are the ones the
 * reviewer makes with their eyes.
 */
export interface ScreenState {
  kpis: string[];
  rows: { itemId: string; status: string }[];
  banner: string | null;
  primary: string;
  ledger: string;
}

export async function readScreen(page: Page): Promise<ScreenState> {
  // No function literals inside `page.evaluate`: tsx compiles this file with `keepNames`, which
  // wraps every nested arrow/function in a `__name(...)` helper that does not exist in the page —
  // the first version of this helper died with "ReferenceError: __name is not defined".
  return page.evaluate(() => {
    const kpis: string[] = [];
    const kpiNodes = document.querySelectorAll('.kpi-amount');
    for (let index = 0; index < kpiNodes.length; index += 1) {
      kpis.push((kpiNodes[index]?.textContent ?? '').trim());
    }

    const rows: { itemId: string; status: string }[] = [];
    const rowNodes = document.querySelectorAll('.run-row');
    for (let index = 0; index < rowNodes.length; index += 1) {
      const node = rowNodes[index];
      const chip = node?.querySelector('.chip');
      rows.push({
        itemId: node?.getAttribute('data-item-id') ?? '',
        status: (chip?.textContent ?? '').trim(),
      });
    }

    // The run banner is the one inside the run card; a global "notice" banner is a different
    // element and must not be mistaken for a failed run.
    const bannerNode = document.querySelector('.run .run-banner');
    const primaryNode = document.querySelector('.topbar .btn--primary');
    const ledgerNode = document.querySelector('.run-foot .ledger');

    return {
      kpis,
      rows,
      banner: bannerNode ? (bannerNode.textContent ?? '').trim() : null,
      primary: (primaryNode?.textContent ?? '').trim(),
      ledger: (ledgerNode?.textContent ?? '').trim(),
    };
  });
}
