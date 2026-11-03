/**
 * AC-13 — a dropped answer and a killed process must not pay anything twice (SPEC §5).
 *
 *   (a) `PBP_FAULT=drop_after_submit:first`: PayPal has the money, the answer never arrives. The
 *       runner retries with the *same* key. Result must equal golden, and PayPal must know of
 *       exactly one batch per intent (`crosscheck --single-batch`).
 *   (b) `kill -9` right after the first `payment.submitted`: the process dies with the run half
 *       done. A new process replays the ledger, resumes the run, and finishes with the same
 *       totals — and again one payout per intent.
 *
 * Run: npx tsx apps/web/e2e/ac13.ts
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  E2E_URL,
  REPO_ROOT,
  fetchEvents,
  golden,
  keyLog,
  resetDemo,
  startServer,
  state,
  totalsMatch,
  until,
  wait,
  writeJson,
  writeProof,
} from './lib';

const TSX = join(REPO_ROOT, 'apps', 'server', 'node_modules', '.bin', 'tsx');
const CROSSCHECK = join(REPO_ROOT, 'apps', 'server', 'scripts', 'crosscheck-paypal.ts');

function crosscheck(out: string): { ok: boolean; text: string } {
  try {
    const text = execFileSync(process.execPath, [TSX, CROSSCHECK, '--url', E2E_URL, '--single-batch', '--out', out], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 180_000,
    });
    return { ok: true, text };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, text: `${failure.stdout ?? ''}\n${failure.stderr ?? ''}` };
  }
}

async function startRun(): Promise<void> {
  const response = await fetch(`${E2E_URL}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'proof' }),
  });
  if (!response.ok) throw new Error(`POST /api/runs answered ${response.status}: ${await response.text()}`);
}

async function main(): Promise<void> {
  const g = golden();
  const lines: string[] = [];
  const log = (line: string): void => {
    console.log(line);
    lines.push(line);
  };
  let failed = false;
  const only = process.argv[2] === 'a' || process.argv[2] === 'b' ? process.argv[2] : null;

  // ---------------------------------------------------------------- (a) lost answer
  if (only === null || only === 'a') {
    // `drop_after_submit:first` fires on the *first* submit of the process, and `demo:reset`
    // makes one of its own. So the seed is paid first, in a process without the fault, and the
    // faulting process is started after it — otherwise the fault would be spent on the seed and
    // the Friday run would never see it.
    const seedServer = await startServer({ dataDir: 'data/e2e/ac13a', label: 'AC-13a (seed)', fresh: true });
    let server = seedServer;
    try {
      await resetDemo();
      await seedServer.stop();
      server = await startServer({
        dataDir: 'data/e2e/ac13a',
        env: { PBP_FAULT: 'drop_after_submit:first' },
        label: 'AC-13a',
      });
      log(`# AC-13 (a) · ${new Date().toISOString()} · PBP_FAULT=drop_after_submit:first`);
      await startRun();
      const done = await until('the run to finish after the first lost answer', async () => {
        const current = await state();
        return current.run.phase === 'done' ? current : null;
      }, 300_000, 2000);

      const totals = totalsMatch(done.totals, g.totalsAfterRun);
      log(`(a) totals vs golden: ${totals.ok ? 'EQUAL' : totals.diff.join('; ')}`);
      if (!totals.ok) throw new Error(`(a) totals differ: ${totals.diff.join('; ')}`);

      const attempts = done.intents.int_in_01 as unknown as {
        submission?: { attempt: number; senderBatchId: string };
      };
      log(`(a) in_01 submission attempt ${attempts.submission?.attempt} · key ${attempts.submission?.senderBatchId}`);
      if ((attempts.submission?.attempt ?? 0) < 2) throw new Error('(a) the fault did not cause a retry');

      const events = await fetchEvents();
      writeProof('ac13a-ledger.log', keyLog(events));

      const check = crosscheck('proof/e2e/ac13a-crosscheck.json');
      log(`(a) crosscheck (receipt + single batch per key):\n${check.text.trim()}`);
      writeProof('ac13a-crosscheck.log', check.text);
      if (!check.ok) throw new Error('(a) crosscheck failed');
      writeJson('ac13a-state.json', { totals: done.totals });
      log('(a) PASS');
    } catch (error) {
      failed = true;
      log(`(a) FAIL — ${error instanceof Error ? error.message : String(error)}`);
      log(`server log:\n${server.log.slice(-30).join('\n')}`);
    } finally {
      await server.stop();
      await seedServer.stop();
    }  }

  // ---------------------------------------------------------------- (b) kill -9
  if (only === null || only === 'b') {
    const server = await startServer({ dataDir: 'data/e2e/ac13b', label: 'AC-13b', fresh: true });
    let restarted: Awaited<ReturnType<typeof startServer>> | null = null;
    try {
      log(`\n# AC-13 (b) · ${new Date().toISOString()} · kill -9 after the first payment.submitted`);
      await resetDemo();
      await startRun();

      const killed = await until('the first payment.submitted', async () => {
        const current = await state();
        const submitted = Object.values(current.intents).find((intent) => intent.state === 'submitted');
        return submitted ? submitted.id : null;
      }, 120_000, 50);
      await server.kill9();
      log(`(b) killed the server right after ${killed} was submitted (pid exit ${server.proc.exitCode})`);

      // A killed process may leave a torn last line; the restart has to survive that.
      restarted = await startServer({ dataDir: 'data/e2e/ac13b', label: 'AC-13b (restart)' });
      log('(b) restarted on the same data directory; recovery replays the ledger and resumes');

      const done = await until('the resumed run to finish', async () => {
        const current = await state();
        return current.run.phase === 'done' ? current : null;
      }, 300_000, 2000);

      const totals = totalsMatch(done.totals, g.totalsAfterRun);
      log(`(b) totals vs golden: ${totals.ok ? 'EQUAL' : totals.diff.join('; ')}`);
      if (!totals.ok) throw new Error(`(b) totals differ: ${totals.diff.join('; ')}`);

      const events = await fetchEvents();
      writeProof('ac13b-ledger.log', keyLog(events));

      const check = crosscheck('proof/e2e/ac13b-crosscheck.json');
      log(`(b) crosscheck (receipt + single batch per key):\n${check.text.trim()}`);
      writeProof('ac13b-crosscheck.log', check.text);
      if (!check.ok) throw new Error('(b) crosscheck failed');
      writeJson('ac13b-state.json', { totals: done.totals });
      log('(b) PASS');
    } catch (error) {
      failed = true;
      log(`(b) FAIL — ${error instanceof Error ? error.message : String(error)}`);
      log(`server log:\n${server.log.slice(-30).join('\n')}`);
      if (restarted) log(`restart log:\n${restarted.log.slice(-30).join('\n')}`);
    } finally {
      await restarted?.stop();
      await server.stop();
      await wait(200);
    }
  }

  writeProof('ac13.log', `${lines.join('\n')}\n`);
  log(failed ? '\nAC-13 FAIL' : '\nAC-13 PASS');
  if (failed) process.exitCode = 1;
}

void main();
