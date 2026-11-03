/**
 * AC-14 — comparison mode: the same agent, no gate (SPEC §5, §6.6.4).
 *
 * What it checks: the mode is off unless `PBP_ALLOW_COMPARISON=1`; the red banner is there; every
 * payout the agent actually made is listed with its receiver and amount, matching
 * `golden.comparisonMode.payouts` for the ones it sent; the agent's closing summary is printed
 * verbatim; and the main ledger is untouched.
 *
 * What it deliberately does not do: fill in the payouts the model skipped. If the model pays six
 * invoices out of eight, six is the result.
 *
 * Run: npx tsx apps/web/e2e/ac14.ts
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  E2E_URL,
  golden,
  keyLog,
  openApp,
  shot,
  startServer,
  state,
  until,
  writeJson,
  writeProof,
} from './lib';

async function main(): Promise<void> {
  const g = golden();
  const lines: string[] = [];
  const log = (line: string): void => {
    console.log(line);
    lines.push(line);
  };

  // First: the mode must be refused when it is not enabled (AC-14: default off).
  {
    const closed = await startServer({ dataDir: 'data/e2e/ac14-off', label: 'AC-14 (off)' });
    try {
      const response = await fetch(`${E2E_URL}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'comparison' }),
      });
      const body = (await response.json()) as { error?: string };
      log(`# AC-14 · ${new Date().toISOString()}`);
      log(`with PBP_ALLOW_COMPARISON unset → ${response.status} ${body.error ?? ''}`);
      if (response.status !== 403) throw new Error(`comparison mode should be refused with 403, got ${response.status}`);
    } finally {
      await closed.stop();
    }
  }

  const server = await startServer({
    dataDir: 'data/e2e/ac14',
    env: { PBP_ALLOW_COMPARISON: '1' },
    label: 'AC-14',
    fresh: true,
  });

  try {
    const session = await openApp('?screen=comparison');
    const { page } = session;
    try {
      const banner = await page.locator('.run-banner--comparison').innerText();
      log(`banner: ${banner.replace(/\s+/g, ' ').trim()}`);
      if (!/no proofs/i.test(banner)) throw new Error('the comparison banner is missing');

      await page.getByRole('button', { name: /Run comparison|Run again/ }).click();
      log('clicked "Run comparison" — the agent runs with no gate');

      const done = await until('the comparison summary', async () => {
        const response = await fetch(`${E2E_URL}/api/comparison/state`);
        const body = (await response.json()) as { summary: { text: string } | null; payouts: unknown[] };
        return body.summary !== null ? body : null;
      }, 420_000, 3000);

      const payouts = done.payouts as { receiver: string; amount: number; railStatus: string | null; memo: string }[];
      log(`\nthe agent paid ${payouts.length} of ${g.comparisonMode.payouts.length} invoices:`);
      for (const payout of payouts) {
        log(`  ${payout.receiver.padEnd(32)} ${(payout.amount / 100).toFixed(2).padStart(9)} USD  ${payout.railStatus ?? '—'}`);
      }

      const expected = g.comparisonMode.payouts;
      const unmatched: string[] = [];
      const missing: string[] = [];
      for (const row of payouts) {
        const match = expected.find((entry) => entry.receiver === row.receiver && entry.amount === row.amount);
        if (!match) unmatched.push(`${row.receiver} ${row.amount}`);
      }
      for (const entry of expected) {
        if (!payouts.some((row) => row.receiver === entry.receiver && row.amount === entry.amount)) {
          missing.push(`${entry.itemId} ${entry.receiver} ${entry.amount}`);
        }
      }
      log(`unexpected payouts: ${unmatched.length === 0 ? 'none' : unmatched.join('; ')}`);
      log(`not sent by the model (listed, not filled in): ${missing.length === 0 ? 'none' : missing.join('; ')}`);
      if (unmatched.length > 0) throw new Error(`the agent paid something golden does not have: ${unmatched.join('; ')}`);

      // SPEC §6.5.5 + golden.comparisonMode: each payout has an expected PayPal outcome. The
      // screen used to show "PENDING" for all seven because the receiver map was never applied
      // (T8 round 3, item 3); now every row has to end where golden says it ends.
      const terminal: string[] = [];
      const wrong: string[] = [];
      for (const entry of expected) {
        const match = payouts.find((row) => row.receiver === entry.receiver && row.amount === entry.amount);
        const actual = match ? (match.railStatus ?? 'PENDING') : '(not sent)';
        terminal.push(`${entry.itemId.padEnd(6)} golden ${entry.paypal.padEnd(10)} actual ${actual}`);
        if (!match) continue; // the model may skip one; that is recorded above, not a failure
        if (actual !== entry.paypal) wrong.push(`${entry.itemId} golden ${entry.paypal} actual ${actual}`);
      }
      log(`\ngolden → actual, per payout:\n  ${terminal.join('\n  ')}`);
      if (wrong.length > 0) throw new Error(`payout outcomes disagree with golden: ${wrong.join('; ')}`);

      log(`\nthe agent's own summary, verbatim:\n${done.summary?.text ?? '(none)'}`);

      const totalSent = payouts.reduce((sum, row) => sum + row.amount, 0);
      log(`total sent: ${(totalSent / 100).toFixed(2)} USD`);

      // The gate's ledger must be untouched by a comparison run (SPEC §6.3.2).
      const main = await state();
      log(`main ledger after the comparison run: proven ${main.totals.proven.count} · held ${main.totals.held.count} · stopped ${main.totals.stopped.count}`);
      if (main.totals.proven.count + main.totals.held.count + main.totals.stopped.count !== 0) {
        throw new Error('the comparison run wrote into the main ledger');
      }

      await shot(page, 'comparison-1280x720.png');
      // The comparison run writes its own ledger (SPEC §6.3.2); the main ledger stays closed.
      // The proof file is the comparison ledger — the old version saved the main ledger, which
      // only ever held `ledger.opened` and proved nothing (T8 round 3, item 3).
      const comparisonLedger = join(server.dataDir, 'comparison.jsonl');
      writeProof('ac14-comparison-ledger.log', keyLog(readEvents(comparisonLedger)));
      writeJson('ac14-state.json', {
        payouts,
        missing,
        terminal,
        summary: done.summary?.text ?? null,
        totalSent,
      });
      log('\nAC-14 PASS');
    } finally {
      await session.close();
    }
  } catch (error) {
    log(`\nAC-14 FAIL — ${error instanceof Error ? error.message : String(error)}`);
    log(`server log:\n${server.log.slice(-30).join('\n')}`);
    process.exitCode = 1;
  } finally {
    writeProof('ac14.log', `${lines.join('\n')}\n`);
    await server.stop();
  }
}

void main();

/** One ledger file, parsed — used for the comparison ledger, which never goes through SSE. */
function readEvents(path: string): { seq: number; at: string; type: string; data: unknown }[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { seq: number; at: string; type: string; data: unknown });
}
