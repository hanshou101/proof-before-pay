/**
 * Screenshot harness for 07-UI §5 — every T4 and T8 row, from a **real run**.
 *
 *   npm --prefix apps/web run build && npx tsx apps/web/scripts/screenshots.ts
 *
 * Before T8 this script shot the design fixture (`?fixture=design`). Now it starts the real server
 * and photographs what it serves: one completed Friday run (`data/e2e/ac13a`, produced by the
 * AC-13 E2E), one empty ledger, one failing PayPal connection, and the comparison ledger. The
 * design fixture is still there for regression, but no screenshot in `proof/ui/` comes from it any
 * more.
 *
 * Every shot still asserts the three things T4 asserted:
 *   1. the document does not scroll (one screen),
 *   2. no element's scrollWidth exceeds its clientWidth (nothing clipped or overflowing),
 *   3. no console errors.
 * The web-dashboard sample (design/sample/README.md) added two more:
 *   4. no text is cut by an ellipsis, measured to the sub-pixel,
 *   5. the detail panel's last line ends at least 16px above its action bar,
 *   6. the headline sentence takes at most two lines.
 * Any failure exits non-zero and names the offending element.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../..');
const outDir = path.join(REPO_ROOT, 'proof/ui');

/** The completed real run the screenshots are taken from (AC-11/AC-13 E2E output). */
// AC-13(b): the kill -9 run finishes the Friday run with no injected fault, so the screen shows
// the completed run rather than the "PayPal did not answer" banner AC-13(a) produces.
const RUN_DATA = path.join(REPO_ROOT, 'data/e2e/ac13b');
/** A second real run (AC-11) used for the mid-flight shot: it has no injected fault, so the
 *  "running" screen shows stamps lighting up rather than an error banner. */
const RUNNING_DATA = path.join(REPO_ROOT, 'data/e2e/ac11');
const EMPTY_DATA = path.join(REPO_ROOT, 'data/e2e/shots-empty');
const ERROR_DATA = path.join(REPO_ROOT, 'data/e2e/shots-error');
const COMPARISON_DATA = path.join(REPO_ROOT, 'data/e2e/ac14');

const PORTS = { run: 8791, empty: 8792, error: 8793, running: 8795 };

interface Problem {
  shot: string;
  kind: 'scroll' | 'overflow' | 'console' | 'setup';
  detail: string;
}

const problems: Problem[] = [];

async function startServer(label: keyof typeof PORTS, env: Record<string, string> = {}): Promise<ChildProcess> {
  const dataDir =
    label === 'run'
      ? RUN_DATA
      : label === 'running'
        ? RUNNING_DATA
        : label === 'empty'
          ? EMPTY_DATA
          : ERROR_DATA;
  // The empty and error ledgers are built by this script, not read from it: a leftover ledger
  // from an earlier run made the server resume that run on boot, and the error screenshot
  // photographed a run in progress instead of the refusal (T8 round 3).
  if (label === 'empty' || label === 'error') rmSync(dataDir, { recursive: true, force: true });
  const proc = spawn(process.execPath, [path.join(REPO_ROOT, 'apps/server/dist/main.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...env,
      PORT: String(PORTS[label]),
      PBP_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((done) => setTimeout(done, 250));
    try {
      const response = await fetch(`http://127.0.0.1:${PORTS[label]}/api/health`);
      if (response.ok) return proc;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error(`server ${label} did not start`);
  }
}

function stop(proc: ChildProcess | null): void {
  if (proc && proc.exitCode === null) proc.kill('SIGTERM');
}

/** The ledger seq right after the sixth row was checked — a genuine mid-run moment. */
function midRunSeq(): number {
  const file = path.join(RUNNING_DATA, 'ledger.jsonl');
  if (!existsSync(file)) return 40;
  const events = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { seq: number; type: string });
  let checked = 0;
  for (const event of events) {
    if (event.type === 'intent.checked') checked += 1;
    if (checked >= 5) return event.seq;
  }
  return events[Math.floor(events.length / 2)]?.seq ?? 40;
}

async function audit(page: Page, shot: string, width: number, height: number): Promise<void> {
  const overflow = await page.evaluate(({ h, w }) => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollHeight > h + 1) found.push(`document scrollHeight ${doc.scrollHeight} > ${h}`);
    if (doc.scrollWidth > w + 1) found.push(`document scrollWidth ${doc.scrollWidth} > ${w}`);
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const label = `${element.tagName.toLowerCase()}.${String(element.className)
        .split(' ')
        .filter(Boolean)
        .join('.')}`;
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(`${label} scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}`);
        continue;
      }
      // scrollWidth is rounded to whole pixels, so text cut by an ellipsis by less than 1px passed
      // the line above (web-dashboard sample, round 1: "…second invoi…" on a 1280 shot). Measure
      // the text itself against the content box instead.
      if (style.textOverflow === 'ellipsis' && element.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect().width;
        const box =
          element.getBoundingClientRect().width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        if (text > box + 0.5) found.push(`${label} text ${text.toFixed(1)}px cut by an ellipsis at ${box.toFixed(1)}px`);
      }
    }
    // The detail panel's action bar sits at the bottom of the card, so a long panel slides its last
    // lines under the bar without any element overflowing. Keep the last line --sp-4 above the bar
    // (web-dashboard sample, round 1: "Why it's held" touched the bar on a real run, and the design
    // fixture's longer AI note hid the second reason under it).
    for (const card of Array.from(document.querySelectorAll<HTMLElement>('.detail'))) {
      const bar = card.querySelector<HTMLElement>('.detail-actions');
      const body = card.querySelector<HTMLElement>('.detail-body');
      if (!bar || !body || bar.getBoundingClientRect().height === 0) continue;
      const bottoms = Array.from(body.querySelectorAll<HTMLElement | SVGElement>('*'))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const hasText = Array.from(element.childNodes).some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
          return box.width > 0 && box.height > 0 && (hasText || element.tagName === 'svg');
        })
        .map((element) => element.getBoundingClientRect().bottom);
      if (bottoms.length === 0) continue;
      const gap = bar.getBoundingClientRect().top - Math.max(...bottoms);
      if (gap < 16) found.push(`.detail-body ends ${gap.toFixed(1)}px above .detail-actions (needs 16px)`);
    }
    // The headline sentence is the largest thing on the screen; past two lines it pushes the totals
    // down and leaves a one-word line (web-dashboard sample, round 1: the running state's
    // "…until it's / proven.").
    const headline = document.querySelector<HTMLElement>('.hero-headline');
    if (headline) {
      const lines = Math.round(headline.getBoundingClientRect().height / parseFloat(getComputedStyle(headline).lineHeight));
      if (lines > 2) found.push(`.hero-headline wraps to ${lines} lines (max 2)`);
    }
    return found;
  }, { w: width, h: height });

  for (const detail of overflow) {
    problems.push({ shot, kind: detail.startsWith('document') ? 'scroll' : 'overflow', detail });
  }
}

interface Shot {
  file: string;
  url: string;
  width: number;
  height: number;
  /** Wait for this selector before shooting. */
  ready?: string;
  before?: (page: Page) => Promise<void>;
  /** Route the API through a slow lane (the loading skeleton). */
  slow?: boolean;
}

async function shoot(browser: Browser, shot: Shot): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push({ shot: shot.file, kind: 'console', detail: message.text() });
  });
  page.on('pageerror', (error) => problems.push({ shot: shot.file, kind: 'console', detail: `pageerror: ${error.message}` }));

  if (shot.slow) {
    await page.route('**/api/state', async (route) => {
      await new Promise((done) => setTimeout(done, 2500));
      await route.continue();
    });
  }

  const response = await page.goto(shot.url, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) {
    problems.push({ shot: shot.file, kind: 'setup', detail: `navigation answered ${response?.status()}` });
  }
  if (shot.ready) await page.waitForSelector(shot.ready, { timeout: 20_000 });
  else await page.waitForSelector('.app', { timeout: 20_000 });
  if (shot.before) await shot.before(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);

  await audit(page, shot.file, shot.width, shot.height);
  await page.screenshot({ path: path.join(outDir, shot.file), animations: 'disabled', fullPage: false });
  console.log(`shot  ${shot.file}  ${shot.width}x${shot.height}  @2x  ${shot.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`);
  await context.close();
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(path.join(RUN_DATA, 'ledger.jsonl'))) {
    problems.push({
      shot: 'setup',
      kind: 'setup',
      detail: `no real run at ${path.relative(REPO_ROOT, RUN_DATA)} — run \`npx tsx apps/web/e2e/ac13.ts b\` first (the kill -9 run finishes without an injected fault)`,
    });
    throw new Error('missing real run data');
  }

  const runServer = await startServer('run');
  const runningServer = await startServer('running');
  const emptyServer = await startServer('empty');
  // A wrong secret, not a missing one: the rail starts and the first payout is refused by PayPal,
  // which is the error state 07-UI §4.5 describes ("Nothing was sent").
  const errorServer = await startServer('error', { PAYPAL_CLIENT_SECRET: 'screenshot-not-a-real-secret' });

  const run = `http://127.0.0.1:${PORTS.run}`;
  const empty = `http://127.0.0.1:${PORTS.empty}`;
  const error = `http://127.0.0.1:${PORTS.error}`;
  const running = `http://127.0.0.1:${PORTS.running}`;
  const browser = await chromium.launch({ headless: true });

  try {
    await shoot(browser, { file: 'hero-empty-1280x720.png', url: `${empty}/`, width: 1280, height: 720 });
    await shoot(browser, {
      file: 'hero-loading-1280x720.png',
      url: `${run}/`,
      width: 1280,
      height: 720,
      ready: '.skeleton',
      slow: true,
    });
    await shoot(browser, {
      file: 'hero-running-1280x720.png',
      url: `${running}/?until=${midRunSeq()}&select=in_01`,
      width: 1280,
      height: 720,
      ready: '.run-row',
    });
    await shoot(browser, {
      file: 'hero-done-1280x720.png',
      url: `${run}/?select=in_04`,
      width: 1280,
      height: 720,
      ready: '.run-row',
    });
    await shoot(browser, {
      file: 'hero-done-1440x900.png',
      url: `${run}/?select=in_04`,
      width: 1440,
      height: 900,
      ready: '.run-row',
    });
    await shoot(browser, {
      file: 'bundle-proven-1280x720.png',
      url: `${run}/?select=in_02`,
      width: 1280,
      height: 720,
      ready: '.run-row',
      before: async (page) => {
        await page.getByRole('button', { name: 'Open proof bundle' }).click();
        await page.waitForSelector('.drawer', { timeout: 20_000 });
        await page.locator('.drawer').getByText('PayPal', { exact: true }).first().waitFor();
      },
    });
    await shoot(browser, {
      file: 'verify-payee-1280x720.png',
      url: `${run}/?select=in_04`,
      width: 1280,
      height: 720,
      ready: '.run-row',
      before: async (page) => {
        await page.getByRole('button', { name: 'Verify by phone' }).click();
        await page.waitForSelector('.dialog', { timeout: 20_000 });
      },
    });
    await shoot(browser, {
      file: 'inbox-1280x720.png',
      url: `${run}/?screen=inbox`,
      width: 1280,
      height: 720,
      ready: '.inbox-row',
    });
    await shoot(browser, {
      file: 'ledger-1280x720.png',
      url: `${run}/?screen=ledger`,
      width: 1280,
      height: 720,
      ready: '.ledger-row',
    });
    if (existsSync(path.join(COMPARISON_DATA, 'comparison.jsonl'))) {
      const comparisonServer = await (async () => {
        const proc = spawn(process.execPath, [path.join(REPO_ROOT, 'apps/server/dist/main.js')], {
          cwd: REPO_ROOT,
          env: { ...process.env, PORT: '8794', PBP_DATA_DIR: COMPARISON_DATA },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const deadline = Date.now() + 30_000;
        for (;;) {
          await new Promise((done) => setTimeout(done, 250));
          try {
            if ((await fetch('http://127.0.0.1:8794/api/health')).ok) return proc;
          } catch {
            // not yet
          }
          if (Date.now() > deadline) throw new Error('comparison server did not start');
        }
      })();
      try {
        await shoot(browser, {
          file: 'comparison-1280x720.png',
          url: 'http://127.0.0.1:8794/?screen=comparison',
          width: 1280,
          height: 720,
          ready: '.comparison-row',
        });
      } finally {
        stop(comparisonServer);
      }
    } else {
      problems.push({ shot: 'comparison-1280x720.png', kind: 'setup', detail: 'no comparison ledger to photograph' });
    }

    // The error screen last: it starts a run, so it must not share the server the others use.
    await shoot(browser, {
      file: 'hero-error-1280x720.png',
      url: `${error}/?select=in_01`,
      width: 1280,
      height: 720,
      ready: '.run-row',
      before: async (page) => {
        await page.locator('.topbar .btn--primary').click();
        // Inside the run card only: the global "notice" banner is a refused request, not a run
        // that stopped.
        await page.waitForSelector('.run .run-banner', { timeout: 120_000 });
      },
    });
  } finally {
    await browser.close();
    stop(runServer);
    stop(runningServer);
    stop(emptyServer);
    stop(errorServer);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  [${problem.kind}] ${problem.shot}: ${problem.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll shots passed: no scroll, no overflow, no console errors.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  for (const problem of problems) console.error(`  [${problem.kind}] ${problem.shot}: ${problem.detail}`);
  process.exitCode = 1;
});
