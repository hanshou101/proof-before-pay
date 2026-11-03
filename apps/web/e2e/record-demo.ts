/**
 * Record the demo video's raw footage from a *real* run (SPEC §3; AGENTS.md §4.4).
 *
 * Why this is not the template's `scripts/video/record.mjs`: that recorder re-plays every earlier
 * step before recording the next one. Here every run pays real sandbox money and the server is
 * stateful, so one take is one continuous session. Each page is captured with a CDP screencast
 * (JPEG frames + their timestamps, viewport 1280×720 at deviceScaleFactor 1.5 = 1920×1080), and
 * every story beat is logged with the on-screen boxes of the elements it is about. The editor
 * (`video/`, Remotion) cuts, speeds and annotates from that log; the product UI is not touched.
 *
 * Run (needs the repo `.env`: PayPal sandbox + LLM + PBP_RECEIVER_MAP; spends ≈ $25k sandbox):
 *   npx --prefix apps/web tsx apps/web/e2e/record-demo.ts <take-name> [main|fault|all]
 * Output: proof/video/take/<take-name>/ (git-ignored): <page>/frames/*.jpg, <page>/frames.json,
 *   beats.json, driver.log, export-*.json, fault-crosscheck.log, ledger logs, cover shots.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright';
import { E2E_URL, REPO_ROOT, fetchEvents, keyLog, resetDemo, startServer, state, until, wait, type ServerHandle } from './lib';

const TAKE = process.argv[2] ?? 'take1';
const PART = (process.argv[3] ?? 'all') as 'main' | 'fault' | 'all' | 'smoke';
const OUT = join(REPO_ROOT, 'proof', 'video', 'take', TAKE);
const VIEWPORT = { width: 1280, height: 720 };
const SCALE = 1.5;

mkdirSync(OUT, { recursive: true });
const logLines: string[] = [];
function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  logLines.push(stamped);
  writeFileSync(join(OUT, 'driver.log'), `${logLines.join('\n')}\n`);
}

interface Box { x: number; y: number; w: number; h: number }
interface Beat { t: number; page: string; name: string; boxes: Record<string, Box | null>; note?: string }
const beats: Beat[] = [];
function saveBeats(): void {
  writeFileSync(join(OUT, 'beats.json'), `${JSON.stringify({ take: TAKE, scale: SCALE, viewport: VIEWPORT, beats }, null, 2)}\n`);
}

async function boxOf(locator: Locator): Promise<Box | null> {
  try {
    if ((await locator.count()) === 0) return null;
    const box = await locator.first().boundingBox();
    return box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null;
  } catch {
    return null;
  }
}

type Target = string | Locator | Box | null;
const isBox = (value: Target): value is Box =>
  value !== null && typeof value === 'object' && typeof (value as Box).x === 'number' && typeof (value as Box).w === 'number';

async function beat(page: Page, pageName: string, name: string, targets: Record<string, Target> = {}, note?: string): Promise<void> {
  const t = Date.now() / 1000;
  const boxes: Record<string, Box | null> = {};
  for (const [key, target] of Object.entries(targets)) {
    // Already-measured boxes (kpiBoxes, rowBoxes) are kept as they are; take2 lost them by
    // measuring a box as if it were a locator.
    if (target === null || isBox(target)) boxes[key] = target;
    else boxes[key] = await boxOf(typeof target === 'string' ? page.locator(target) : target);
  }
  beats.push({ t, page: pageName, name, boxes, ...(note ? { note } : {}) });
  saveBeats();
  log(`beat ${pageName}:${name}${note ? ` — ${note}` : ''}`);
}

/** CDP screencast of one page: every repaint becomes a JPEG with its swap timestamp. */
class Recorder {
  private cdp: CDPSession | null = null;
  private frames: { file: string; t: number }[] = [];
  private pending: Promise<void>[] = [];
  private index = 0;
  private stoppedAt = 0;
  constructor(private readonly page: Page, private readonly name: string) {}

  async start(): Promise<void> {
    const dir = join(OUT, this.name, 'frames');
    mkdirSync(dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (frame: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
      const file = `f${String(this.index).padStart(6, '0')}.jpg`;
      this.index += 1;
      this.frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      this.pending.push(writeFile(join(dir, file), Buffer.from(frame.data, 'base64')));
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    // everyNthFrame must stay 1. With 2, a change that paints a single compositor frame and then
    // goes idle (a chip turning "Held", a summary appearing) is dropped, and nothing is captured
    // until the next change: take1 lost the comparison summary and two "Held" moments that way.
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    log(`recorder ${this.name} started`);
  }

  async stop(): Promise<void> {
    if (!this.cdp) return;
    this.stoppedAt = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(this.pending);
    writeFileSync(join(OUT, this.name, 'frames.json'), `${JSON.stringify({ name: this.name, stoppedAt: this.stoppedAt, frames: this.frames }, null, 1)}\n`);
    log(`recorder ${this.name} stopped: ${this.frames.length} frames`);
    this.cdp = null;
  }
}

async function newPage(browser: Browser, query: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${E2E_URL}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app', { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  (page as Page & { errors?: string[] }).errors = errors;
  return { context, page };
}

/** A click the editor can show: log where it lands, give the cursor time to travel, then click. */
async function clickAt(_page: Page, pageName: string, locator: Locator, label: string, dwellMs = 900): Promise<void> {
  await locator.first().scrollIntoViewIfNeeded().catch(() => {});
  const box = await boxOf(locator);
  beats.push({ t: Date.now() / 1000, page: pageName, name: `cursor:${label}`, boxes: { target: box } });
  saveBeats();
  await wait(dwellMs);
  beats.push({ t: Date.now() / 1000, page: pageName, name: `click:${label}`, boxes: { target: box } });
  saveBeats();
  await locator.first().click();
  log(`click ${pageName}:${label}`);
}

const row = (page: Page, itemId: string): Locator => page.locator(`.run-row[data-item-id="${itemId}"]`);

const PANEL = {
  panel: '.detail',
  head: '.detail-head',
  payee: '.detail-section--payee',
  zero: '.detail .zero-mark',
  note: '.detail .note-text',
  why: '.detail .why-list',
  actions: '.detail-actions',
  facts: '.detail .fact-list',
  timeline: '.detail .timeline',
};
const HERO = { hero: '.hero', headline: '.hero-headline', kpis: '.kpis', list: '.card.run', foot: '.run-foot', topbtn: '.topbar .btn--primary' };

async function kpiBoxes(page: Page): Promise<Record<string, Box | null>> {
  const cells = page.locator('.kpi');
  const out: Record<string, Box | null> = {};
  const names = ['proven', 'awaiting', 'held', 'stopped'];
  for (let index = 0; index < 4; index += 1) out[`kpi_${names[index]}`] = await boxOf(cells.nth(index));
  return out;
}

async function rowBoxes(page: Page): Promise<Record<string, Box | null>> {
  const out: Record<string, Box | null> = {};
  for (const id of ['in_01', 'in_02', 'in_03', 'in_04', 'in_05', 'in_06', 'in_07', 'in_08']) {
    out[`row_${id}`] = await boxOf(row(page, id));
    out[`stamps_${id}`] = await boxOf(row(page, id).locator('.proof-chain'));
    out[`status_${id}`] = await boxOf(row(page, id).locator('.status-cell'));
  }
  return out;
}

async function screenText(page: Page): Promise<string> {
  const kpis = await page.locator('.kpi-amount').allInnerTexts().catch(() => [] as string[]);
  const statuses: string[] = [];
  for (const id of ['in_01', 'in_02', 'in_03', 'in_04', 'in_05', 'in_06', 'in_07', 'in_08']) {
    statuses.push(`${id}=${(await row(page, id).locator('.chip').first().innerText().catch(() => '?')).trim()}`);
  }
  return `kpis ${kpis.join(' | ')} · ${statuses.join(' ')}`;
}

// ---------------------------------------------------------------------------------------------
// Main take: comparison → inbox → Friday run → proof bundle → human steps → ledger → cover shots
// ---------------------------------------------------------------------------------------------
async function mainTake(browser: Browser): Promise<void> {
  const server = await startServer({ dataDir: `data/video/${TAKE}`, env: { PBP_ALLOW_COMPARISON: '1' }, label: `video ${TAKE}`, fresh: true });
  const recorders: Recorder[] = [];
  try {
    const seed = await resetDemo();
    log(`demo:reset ok (epoch ${seed.epoch}) — Kenji INV-0142 paid once through the real sandbox`);

    // 1 · Comparison: the same agent, no gate.
    const cmp = await newPage(browser, '?screen=comparison');
    const cmpRec = new Recorder(cmp.page, 'comparison');
    recorders.push(cmpRec);
    await cmpRec.start();
    await wait(1500);
    await beat(cmp.page, 'comparison', 'cmp-open', { card: '.card.comparison', banner: '.run-banner--comparison', title: '.comparison .run-title' });
    await clickAt(cmp.page, 'comparison', cmp.page.getByRole('button', { name: /Run comparison|Run again/ }), 'run-comparison');
    await beat(cmp.page, 'comparison', 'cmp-started');
    let seen = 0;
    const done = await until('the comparison summary', async () => {
      const response = await fetch(`${E2E_URL}/api/comparison/state`);
      const body = (await response.json()) as { summary: { text: string } | null; payouts: unknown[] };
      if (body.payouts.length !== seen) {
        seen = body.payouts.length;
        await beat(cmp.page, 'comparison', `cmp-payout-${seen}`, { rows: '.comparison-rows' });
      }
      return body.summary !== null ? body : null;
    }, 480_000, 1500);
    await wait(2500);
    const cmpRows = cmp.page.locator('.comparison-row');
    const rowCount = await cmpRows.count();
    const rowTargets: Record<string, Locator> = {};
    for (let index = 0; index < rowCount; index += 1) rowTargets[`row_${index}`] = cmpRows.nth(index);
    await beat(cmp.page, 'comparison', 'cmp-done', { ...rowTargets, meta: '.comparison .run-meta', summary: '.comparison-summary', banner: '.run-banner--comparison' });
    writeFileSync(join(OUT, 'comparison-state.json'), `${JSON.stringify(done, null, 2)}\n`);
    for (let index = 0; index < rowCount; index += 1) log(`comparison row ${index}: ${(await cmpRows.nth(index).innerText()).replace(/\s+/g, ' ')}`);
    await cmp.page.locator('.comparison-summary').scrollIntoViewIfNeeded().catch(() => {});
    await wait(1500);
    await beat(cmp.page, 'comparison', 'cmp-summary', { summary: '.comparison-summary' });
    await wait(4000);
    await cmpRec.stop();

    // 2 · Inbox before the run: raw email, nothing read yet. Recording continues during the run,
    //     so the AI's labels arrive on camera.
    const inbox = await newPage(browser, '?screen=inbox');
    const inboxRec = new Recorder(inbox.page, 'inbox');
    recorders.push(inboxRec);
    await inboxRec.start();
    await wait(1500);
    await beat(inbox.page, 'inbox', 'inbox-open', { card: '.card.inbox', list: '.inbox-list', preview: '.inbox-preview' });
    await clickAt(inbox.page, 'inbox', inbox.page.locator('.inbox-row', { hasText: /studi0|Studio North|Ana/ }), 'inbox-ana');
    await wait(800);
    await beat(inbox.page, 'inbox', 'inbox-ana', { row: inbox.page.locator('.inbox-row.is-selected'), preview: '.inbox-preview', body: '.preview-body', subject: '.preview-subject', meta: '.preview-meta' });
    await wait(5000);

    // 3 · The Friday run.
    const run = await newPage(browser, '');
    const runRec = new Recorder(run.page, 'run');
    recorders.push(runRec);
    await runRec.start();
    await wait(1500);
    await beat(run.page, 'run', 'run-empty', { ...HERO, ...PANEL, legend: '.detail .legend' });
    await wait(2500);
    await clickAt(run.page, 'run', run.page.locator(HERO.topbtn), 'run-friday');
    await until('the run to start', async () => (await state()).run.phase === 'running', 30_000, 250);
    await beat(run.page, 'run', 'run-started', { ...HERO, ...(await rowBoxes(run.page)) });

    const seenStates = new Map<string, string>();
    const steps = { in03: false, in04: false, in05: false, back04: false };
    const runDeadline = Date.now() + 420_000;
    for (;;) {
      const current = await state();
      for (const intent of Object.values(current.intents)) {
        const key = intent.itemId;
        if (seenStates.get(key) !== intent.state) {
          seenStates.set(key, intent.state);
          await beat(run.page, 'run', `state:${key}:${intent.state}`, { [`row_${key}`]: row(run.page, key), [`stamps_${key}`]: row(run.page, key).locator('.proof-chain'), ...HERO });
        }
      }
      const stateOf = (itemId: string): string | undefined => seenStates.get(itemId);
      if (!steps.in03 && stateOf('in_03') === 'blocked') {
        steps.in03 = true;
        await wait(1200);
        await clickAt(run.page, 'run', row(run.page, 'in_03'), 'sel-in03', 700);
        await wait(600);
        await beat(run.page, 'run', 'sel-in03', { row: row(run.page, 'in_03'), ...PANEL });
        await wait(3500);
      } else if (steps.in03 && !steps.in04 && stateOf('in_04') === 'held') {
        steps.in04 = true;
        await clickAt(run.page, 'run', row(run.page, 'in_04'), 'sel-in04', 700);
        await wait(700);
        await beat(run.page, 'run', 'sel-in04', { row: row(run.page, 'in_04'), stamps: row(run.page, 'in_04').locator('.proof-chain'), ...PANEL });
        await wait(6000);
      } else if (steps.in04 && !steps.in05 && stateOf('in_05') === 'held') {
        steps.in05 = true;
        await clickAt(run.page, 'run', row(run.page, 'in_05'), 'sel-in05', 700);
        await wait(700);
        await beat(run.page, 'run', 'sel-in05', { row: row(run.page, 'in_05'), stamps: row(run.page, 'in_05').locator('.proof-chain'), ...PANEL });
        await wait(4500);
      } else if (steps.in05 && !steps.back04) {
        steps.back04 = true;
        await clickAt(run.page, 'run', row(run.page, 'in_04'), 'back-in04', 700);
      }
      if (current.run.phase === 'done') break;
      if (Date.now() > runDeadline) throw new Error('the Friday run did not finish in 7 minutes');
      await wait(250);
    }
    await wait(1500);
    const afterRun = await state();
    if (afterRun.errors.length > 0) log(`RUN HAD ERRORS: ${JSON.stringify(afterRun.errors)}`);
    await beat(run.page, 'run', 'run-done', { ...HERO, ...PANEL, ...(await kpiBoxes(run.page)), ...(await rowBoxes(run.page)) }, await screenText(run.page));
    await beat(inbox.page, 'inbox', 'inbox-labelled', { list: '.inbox-list', preview: '.inbox-preview' });
    await inboxRec.stop();

    // Cover and README material: the finished screen with Ana selected, at 2×, outside the video.
    // A separate browser without the forced 1.5 scale, so the stills really are 2×.
    const stillBrowser = await chromium.launch({ headless: true });
    const still = await stillBrowser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const stillPage = await still.newPage();
    await stillPage.goto(`${E2E_URL}/`, { waitUntil: 'domcontentloaded' });
    await stillPage.waitForSelector('.run-row', { timeout: 30_000 });
    await stillPage.evaluate(() => document.fonts.ready);
    await row(stillPage, 'in_04').click();
    await wait(900);
    await stillPage.screenshot({ path: join(OUT, 'still-hero-done-ana@2x.png'), animations: 'disabled' });
    await stillPage.locator('.detail').screenshot({ path: join(OUT, 'still-panel-ana@2x.png'), animations: 'disabled' });
    await stillPage.locator('.detail-section--payee').screenshot({ path: join(OUT, 'still-payee-ana@2x.png'), animations: 'disabled' });
    await row(stillPage, 'in_04').screenshot({ path: join(OUT, 'still-row-ana@2x.png'), animations: 'disabled' });
    await stillPage.locator('.kpis').screenshot({ path: join(OUT, 'still-kpis@2x.png'), animations: 'disabled' });
    await still.close();
    await stillBrowser.close();
    log('stills saved (Ana selected, done state, 2×)');

    // 4 · Proof bundle for a proven payout (Kenji INV-0153), live re-check, export.
    await wait(2500);
    await clickAt(run.page, 'run', row(run.page, 'in_02'), 'sel-in02');
    await wait(1200);
    await beat(run.page, 'run', 'sel-in02', { row: row(run.page, 'in_02'), ...PANEL });
    await wait(2500);
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Open proof bundle' }), 'open-bundle');
    await run.page.locator('.drawer').waitFor({ state: 'visible' });
    await wait(900);
    await beat(run.page, 'run', 'bundle-open', { drawer: '.drawer', receipt: '.drawer-receipt' });
    await wait(4500);
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Verify again' }), 'verify-again');
    await beat(run.page, 'run', 'bundle-verifying', { drawer: '.drawer', receipt: '.drawer-receipt' });
    await until('the live re-check to return', async () => (await run.page.getByRole('button', { name: 'Verify again' }).count()) > 0, 60_000, 250);
    await wait(700);
    await beat(run.page, 'run', 'bundle-verified', { drawer: '.drawer', receipt: '.drawer-receipt' });
    await wait(2500);
    const downloadWait = run.page.waitForEvent('download', { timeout: 20_000 });
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Export JSON' }), 'export-json');
    const download = await downloadWait;
    await download.saveAs(join(OUT, `export-${download.suggestedFilename()}`));
    log(`exported ${download.suggestedFilename()}`);
    await wait(2000);
    await run.page.keyboard.press('Escape');
    await wait(500);
    if (await run.page.locator('.drawer').isVisible().catch(() => false)) {
      await clickAt(run.page, 'run', run.page.locator('.drawer').getByRole('button', { name: 'Close' }), 'close-bundle', 500);
    }
    await wait(1200);

    // 5 · Human steps (golden.humanSteps 1–4): Ana → verify → not confirmed → reject; Leo → accept → approve.
    await clickAt(run.page, 'run', row(run.page, 'in_04'), 'human-ana');
    await wait(1200);
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Verify by phone' }), 'verify-phone');
    await run.page.locator('.dialog').waitFor({ state: 'visible' });
    await wait(900);
    await beat(run.page, 'run', 'dialog-open', { dialog: '.dialog' });
    await wait(3000);
    await clickAt(run.page, 'run', run.page.getByRole('radio', { name: 'Not confirmed — likely fraud' }), 'not-confirmed', 700);
    await wait(1200);
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Record result' }), 'record-result', 700);
    await run.page.locator('.dialog').waitFor({ state: 'detached' });
    await wait(1500);
    await beat(run.page, 'run', 'ana-not-confirmed', { row: row(run.page, 'in_04'), ...PANEL });
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Reject as fraud' }), 'reject-fraud');
    await until('Ana to be rejected', async () => (await state()).intents.int_in_04?.state === 'rejected', 30_000, 250);
    await wait(1500);
    await beat(run.page, 'run', 'ana-rejected', { row: row(run.page, 'in_04'), ...PANEL, ...(await kpiBoxes(run.page)) }, await screenText(run.page));
    await wait(1500);
    await clickAt(run.page, 'run', row(run.page, 'in_05'), 'human-leo');
    await wait(1500);
    await beat(run.page, 'run', 'leo-open', { row: row(run.page, 'in_05'), ...PANEL });
    await clickAt(run.page, 'run', run.page.getByRole('button', { name: 'Accept delivery' }), 'accept-delivery');
    await wait(2500);
    const approve = run.page.locator('.detail-actions .btn--primary').first();
    const approveLabel = (await approve.innerText()).trim();
    log(`approve button reads: ${approveLabel}`);
    await beat(run.page, 'run', 'leo-accepted', { row: row(run.page, 'in_05'), ...PANEL }, approveLabel);
    await clickAt(run.page, 'run', approve, 'approve-leo');
    await until('Leo to be proven', async () => (await state()).intents.int_in_05?.state === 'proven', 180_000, 500);
    await wait(2000);
    await beat(run.page, 'run', 'leo-proven', { row: row(run.page, 'in_05'), ...PANEL, ...HERO, ...(await kpiBoxes(run.page)) }, await screenText(run.page));
    await wait(3000);

    // 6 · Ledger: the hash chain.
    await clickAt(run.page, 'run', run.page.locator('.topnav-tab', { hasText: 'Ledger' }), 'tab-ledger');
    await run.page.locator('.ledger-screen').waitFor({ state: 'visible' });
    await wait(1200);
    await beat(run.page, 'run', 'ledger', { card: '.ledger-screen', badge: '.chain-badge', rows: '.ledger-rows' });
    await wait(4000);
    await runRec.stop();

    const events = await fetchEvents();
    writeFileSync(join(OUT, 'main-ledger.log'), `${keyLog(events)}\n`);
    const finalState = await state();
    writeFileSync(join(OUT, 'main-state.json'), `${JSON.stringify({ totals: finalState.totals, intents: finalState.intents }, null, 2)}\n`);
    for (const [name, page] of [['comparison', cmp.page], ['inbox', inbox.page], ['run', run.page]] as const) {
      const errors = (page as Page & { errors?: string[] }).errors ?? [];
      log(`${name} console errors: ${errors.length === 0 ? 'none' : errors.slice(0, 5).join(' | ')}`);
    }
    await cmp.context.close();
    await inbox.context.close();
    await run.context.close();
  } finally {
    for (const recorder of recorders) await recorder.stop();
    await server.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// Fault take: PayPal takes the money, the answer is dropped, the retry uses the same key.
// ---------------------------------------------------------------------------------------------
async function faultTake(browser: Browser): Promise<void> {
  const dataDir = `data/video/${TAKE}-fault`;
  const seedServer: ServerHandle = await startServer({ dataDir, label: 'fault seed', fresh: true });
  try {
    await resetDemo();
  } finally {
    await seedServer.stop();
  }
  const server = await startServer({ dataDir, env: { PBP_FAULT: 'drop_after_submit:first' }, label: 'fault' });
  let recorder: Recorder | null = null;
  try {
    const { context, page } = await newPage(browser, '');
    recorder = new Recorder(page, 'fault');
    await recorder.start();
    await wait(1200);
    await beat(page, 'fault', 'fault-empty', { ...HERO });
    await clickAt(page, 'fault', page.locator(HERO.topbtn), 'run-fault');
    await until('the run to start', async () => (await state()).run.phase === 'running', 30_000, 250);
    let last = '';
    const proven = await until('in_01 to be proven after the dropped answer', async () => {
      const current = await state();
      const intent = current.intents.int_in_01 as unknown as { state: string; submission?: { attempt: number; senderBatchId: string } } | undefined;
      const now = `${intent?.state}/${intent?.submission?.attempt ?? 0}`;
      if (now !== last) {
        last = now;
        await beat(page, 'fault', `fault-in01:${now}`, { row: row(page, 'in_01'), stamps: row(page, 'in_01').locator('.proof-chain'), ...PANEL });
      }
      return intent?.state === 'proven' ? intent : null;
    }, 240_000, 250);
    log(`fault: in_01 proven after attempt ${proven.submission?.attempt} with key ${proven.submission?.senderBatchId}`);
    await wait(2500);
    await beat(page, 'fault', 'fault-proven', { row: row(page, 'in_01'), ...PANEL });
    await recorder.stop();
    recorder = null;

    // The independent check: GET every proven payout and re-send its key; PayPal must answer with the same batch.
    const tsx = join(REPO_ROOT, 'apps', 'server', 'node_modules', '.bin', 'tsx');
    const crosscheck = join(REPO_ROOT, 'apps', 'server', 'scripts', 'crosscheck-paypal.ts');
    let text = '';
    try {
      text = execFileSync(process.execPath, [tsx, crosscheck, '--url', E2E_URL, '--intent', 'int_in_01', '--single-batch', '--out', join(OUT, 'fault-crosscheck.json')], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 180_000,
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      text = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
    }
    writeFileSync(join(OUT, 'fault-crosscheck.log'), text);
    log(`fault crosscheck:\n${text.trim()}`);
    const events = await fetchEvents();
    writeFileSync(join(OUT, 'fault-ledger.log'), `${keyLog(events)}\n`);
    await context.close();
  } finally {
    await recorder?.stop();
    await server.stop();
  }
}


/** No money spent: open the empty run screen on a fresh ledger and record a few seconds. */
async function smokeTake(browser: Browser): Promise<void> {
  const server = await startServer({ dataDir: `data/video/${TAKE}-smoke`, label: 'smoke', fresh: true });
  try {
    const { context, page } = await newPage(browser, '');
    const recorder = new Recorder(page, 'smoke');
    const before = Date.now() / 1000;
    await recorder.start();
    await wait(1000);
    await beat(page, 'smoke', 'smoke-empty', { ...HERO, ...PANEL });
    await page.locator('.topnav-tab', { hasText: 'Inbox' }).click();
    await wait(1500);
    await page.locator('.topnav-tab', { hasText: 'Payout run' }).click();
    await wait(1500);
    await recorder.stop();
    log(`smoke: wall clock at start ${before.toFixed(3)}`);
    await context.close();
  } finally {
    await server.stop();
  }
}

async function main(): Promise<void> {
  log(`take ${TAKE} · part ${PART} · viewport ${VIEWPORT.width}×${VIEWPORT.height} @${SCALE}`);
  // The screencast is captured at the window's real scale, not the emulated one: without this flag
  // the frames come out 1280×720 even with deviceScaleFactor 1.5 (probed 11-03).
  const browser = await chromium.launch({ headless: true, args: [`--force-device-scale-factor=${SCALE}`] });
  try {
    if (PART === 'smoke') await smokeTake(browser);
    if (PART === 'main' || PART === 'all') await mainTake(browser);
    if (PART === 'fault' || PART === 'all') await faultTake(browser);
    log('TAKE COMPLETE');
  } catch (error) {
    log(`TAKE FAILED — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    saveBeats();
    await browser.close();
  }
}

void main();
