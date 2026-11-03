/**
 * AC-11 — the whole thing, once, from an empty ledger (SPEC §5).
 *
 *   demo:reset (real sandbox payout for the seeded history)
 *   → open the page → press "Run Friday payouts"
 *   → every row's final state and every KPI cell must equal `golden.totalsAfterRun`, within 4 min
 *   → an independent script then asks PayPal about each proven payout (AC-11's last clause).
 *
 * Run: npx tsx apps/web/e2e/ac11.ts
 * Output: proof/e2e/ac11-*.{log,json,md} and proof/ui/hero-done-1280x720.png
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  clickRun,
  golden,
  keyLog,
  fetchEvents,
  openApp,
  readScreen,
  resetDemo,
  shot,
  startServer,
  state,
  totalsMatch,
  until,
  waitForDone,
  writeJson,
  writeProof,
} from './lib';

const EXPECTED_FINAL: Record<string, string> = {
  in_01: 'proven',
  in_02: 'proven',
  in_03: 'blocked',
  in_04: 'held',
  in_05: 'held',
  in_06: 'proven',
  in_07: 'awaiting',
  in_08: 'proven',
  in_09: 'ignored',
};

/** The chip each row must show when the run is finished (07-UI §4.2 wording). */
const EXPECTED_CHIP: Record<string, string> = {
  in_01: 'Proven',
  in_02: 'Proven',
  in_03: 'Blocked',
  in_04: 'Held',
  in_05: 'Held',
  in_06: 'Proven',
  in_07: 'Awaiting proof',
  in_08: 'Proven',
};

/** `golden.totalsAfterRun`, as the KPI band prints it. */
const EXPECTED_KPI = ['$5,088.00', '$640.00', '$4,800.00', '$1,150.00'];

async function main(): Promise<void> {
  const g = golden();
  const server = await startServer({ dataDir: 'data/e2e/ac11', label: 'AC-11' });
  const lines: string[] = [];
  const log = (line: string): void => {
    console.log(line);
    lines.push(line);
  };

  try {
    log(`# AC-11 · ${new Date().toISOString()}`);
    const reset = await resetDemo();
    log(`demo:reset → epoch ${reset.epoch} (seeded history paid through the real sandbox)`);

    const before = await state();
    log(`before: proven ${before.totals.proven.count} · head ${before.head} · phase ${before.run.phase}`);

    const session = await openApp();
    const { page } = session;
    try {
      const kpiBefore = (await page.locator('.kpi-amount').allInnerTexts()).join(' ');
      log(`KPI on a fresh page: ${kpiBefore}`);
      if (!kpiBefore.includes('—')) throw new Error('the empty screen should show — in every KPI cell');

      const started = Date.now();
      await clickRun(page);
      log('clicked "Run Friday payouts"');

      const done = await waitForDone(240_000);
      const elapsed = (Date.now() - started) / 1000;
      log(`run finished in ${elapsed.toFixed(1)}s (limit 240s)`);
      if (elapsed > 240) throw new Error(`the run took ${elapsed.toFixed(1)}s — over AC-11's four minutes`);

      const totals = totalsMatch(done.totals, g.totalsAfterRun);
      log(`totals vs golden.totalsAfterRun: ${totals.ok ? 'EQUAL' : totals.diff.join('; ')}`);
      if (!totals.ok) throw new Error(`totals differ: ${totals.diff.join('; ')}`);

      const rows: string[] = [];
      for (const [itemId, expected] of Object.entries(EXPECTED_FINAL)) {
        const intentId = done.byItem[itemId];
        const actual = intentId ? done.intents[intentId]?.state : 'ignored';
        rows.push(`${itemId} ${actual} ${actual === expected ? 'PASS' : `FAIL (wanted ${expected})`}`);
      }
      log('rows:\n' + rows.join('\n'));
      if (rows.some((row) => row.includes('FAIL'))) throw new Error('a row ended in the wrong state');

      const kpi = (await page.locator('.kpi-amount').allInnerTexts()).join(' ');
      log(`KPI on the finished screen: ${kpi}`);

      // AC-11 says the screen, not the API: four KPI cells, every row's chip, no error banner,
      // and a header button that is not offering a retry (T8 round 3, item 6).
      const screen = await until(
        'the finished screen to show the golden numbers',
        async () => {
          const current = await readScreen(page);
          return current.rows.length === 8 && current.kpis.join(' ') === EXPECTED_KPI.join(' ') ? current : null;
        },
        30_000,
        500,
      );
      log(`screen KPI: ${screen.kpis.join(' ')}`);
      for (const row of screen.rows) {
        log(`screen row ${row.itemId} → ${row.status}`);
      }
      const wrongChips = screen.rows.filter((row) => row.status !== EXPECTED_CHIP[row.itemId]);
      if (wrongChips.length > 0) {
        throw new Error(
          `the screen shows the wrong status for ${wrongChips.map((row) => `${row.itemId}="${row.status}"`).join(', ')}`,
        );
      }
      if (screen.banner !== null) throw new Error(`the finished screen still shows a run banner: ${screen.banner}`);
      if (/retry/i.test(screen.primary)) throw new Error(`the finished screen offers "${screen.primary}"`);
      if (!/Ledger verified/.test(screen.ledger)) throw new Error(`the footer does not confirm the chain: ${screen.ledger}`);
      log(`screen banner: none · header button: ${screen.primary} · ${screen.ledger}`);

      await shot(page, 'hero-done-1280x720.png');
      log('wrote proof/ui/hero-done-1280x720.png');

      const events = await fetchEvents();
      writeProof('ac11-ledger.log', keyLog(events));
      writeJson('ac11-state.json', { runId: done.run.runId, totals: done.totals, rows, kpi, elapsed });

      // AC-11's last clause: an independent script asks PayPal about each proven payout.
      const crosscheck = join(REPO_ROOT, 'apps', 'server', 'scripts', 'crosscheck-paypal.ts');
      let crosscheckOut = '';
      let crosscheckOk = true;
      try {
        crosscheckOut = execFileSync(
          process.execPath,
          [join(REPO_ROOT, 'apps', 'server', 'node_modules', '.bin', 'tsx'), crosscheck, '--url', 'http://127.0.0.1:8790', '--out', 'proof/e2e/ac11-crosscheck.json'],
          { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
        );
      } catch (error) {
        crosscheckOk = false;
        const failure = error as { stdout?: string; stderr?: string };
        crosscheckOut = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
      }
      log('crosscheck:\n' + crosscheckOut.trim());
      writeProof('ac11-crosscheck.log', crosscheckOut);
      if (!crosscheckOk) throw new Error('the crosscheck did not confirm every proven payout');

      log('\nAC-11 PASS');
    } finally {
      await session.close();
    }
  } catch (error) {
    log(`\nAC-11 FAIL — ${error instanceof Error ? error.message : String(error)}`);
    log(`server log:\n${server.log.slice(-40).join('\n')}`);
    process.exitCode = 1;
  } finally {
    writeProof('ac11.log', `${lines.join('\n')}\n`);
    await server.stop();
  }
}

// The scenario file is the authority for the row list; keep the two in sync loudly.
const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'demo', 'scenario', 'scenario.json'), 'utf8')) as {
  golden: { items: { itemId: string; final: string }[] };
};
for (const item of scenario.golden.items) {
  const expected = EXPECTED_FINAL[item.itemId];
  if (expected === undefined) {
    writeFileSync(
      join(REPO_ROOT, 'proof', 'e2e', 'ac11-scenario-drift.txt'),
      `scenario has ${item.itemId} (final ${item.final}) but the E2E does not know it\n`,
    );
    throw new Error(`the E2E is out of date with the scenario: ${item.itemId}`);
  }
}

void main();
