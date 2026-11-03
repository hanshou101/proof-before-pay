/**
 * AC-12 — the four human steps, performed in the interface (SPEC §5).
 *
 * It continues the ledger AC-11 produced (`data/e2e/ac11`): the same run, the same holds, exactly
 * like an ops person coming back after the run. Nothing is re-run, so the state this test sees is
 * the state the screen showed.
 *
 * Run: npx tsx apps/web/e2e/ac12.ts   (after ac11.ts)
 */
import {
  E2E_URL,
  golden,
  keyLog,
  fetchEvents,
  openApp,
  readScreen,
  shot,
  shotProof,
  startServer,
  state,
  totalsMatch,
  until,
  writeJson,
  writeProof,
} from './lib';

async function main(): Promise<void> {
  const g = golden();
  const server = await startServer({ dataDir: 'data/e2e/ac11', label: 'AC-12' });
  const lines: string[] = [];
  const log = (line: string): void => {
    console.log(line);
    lines.push(line);
  };

  try {
    log(`# AC-12 · ${new Date().toISOString()}`);
    const before = await state();
    log(`starting from: phase ${before.run.phase} · proven ${before.totals.proven.count} · held ${before.totals.held.count}`);

    const session = await openApp();
    const { page } = session;
    try {
      // ---- step 1: verify the payee by phone, not confirmed -------------------------------
      await page.locator('.run-row[data-item-id="in_04"]').click();
      await page.getByRole('button', { name: 'Verify by phone' }).click();
      await page.locator('.dialog').waitFor({ state: 'visible' });
      await page.getByRole('radio', { name: 'Not confirmed — likely fraud' }).click();
      await shot(page, 'verify-payee-1280x720.png');
      await page.getByRole('button', { name: 'Record result' }).click();
      await page.locator('.dialog').waitFor({ state: 'detached' });

      const afterVerify = await until('the verification to be recorded', async () => {
        const current = await state();
        return current.intents.int_in_04?.checks?.find((check) => check.id === 'P1')?.status === 'hold' ? current : null;
      }, 20_000);
      const p1 = afterVerify.intents.int_in_04?.checks?.find((check) => check.id === 'P1');
      const p2 = afterVerify.intents.int_in_04?.checks?.find((check) => check.id === 'P2');
      log(`step 1 → in_04 state ${afterVerify.intents.int_in_04?.state} · P1 ${p1?.status}:${p1?.code} · P2 ${p2?.status}:${p2?.code}`);
      if (afterVerify.intents.int_in_04?.state !== 'held') throw new Error('step 1 should leave the payment held');
      if (p1?.status !== 'hold' || p2?.status !== 'hold') throw new Error('step 1 should leave P1 and P2 on hold');

      const approveDisabled = await page
        .locator('.detail-actions .btn--primary')
        .first()
        .isDisabled()
        .catch(() => false);
      log(`step 1 → Approve in the panel is ${approveDisabled ? 'disabled (correct)' : 'ENABLED (wrong)'}`);

      // ---- step 2: reject as fraud -------------------------------------------------------
      await page.getByRole('button', { name: 'Reject as fraud' }).click();
      const afterFraud = await until('the rejection', async () => {
        const current = await state();
        return current.intents.int_in_04?.state === 'rejected' ? current : null;
      }, 20_000);
      const vendor = (await (await fetch(`${E2E_URL}/api/state`)).json()) as {
        vendors: { id: string; payee: { receiver: string } }[];
      };
      const ana = vendor.vendors.find((entry) => entry.id === 'ven_ana');
      log(`step 2 → in_04 ${afterFraud.intents.int_in_04?.state} · payee on file ${ana?.payee.receiver ?? '?'}`);
      if (ana?.payee.receiver !== 'ana@studionorth.example') throw new Error('mark_fraud must not change the payee on file');

      // ---- step 3: accept Leo's delivery -------------------------------------------------
      await page.locator('.run-row[data-item-id="in_05"]').click();
      await page.getByRole('button', { name: 'Accept delivery' }).click();
      const afterAccept = await until('the delivery acceptance', async () => {
        const current = await state();
        return current.intents.int_in_05?.checks?.find((check) => check.id === 'O3')?.status === 'pass' ? current : null;
      }, 20_000);
      const o2 = afterAccept.intents.int_in_05?.checks?.find((check) => check.id === 'O2');
      const o3 = afterAccept.intents.int_in_05?.checks?.find((check) => check.id === 'O3');
      log(`step 3 → in_05 ${afterAccept.intents.int_in_05?.state} · O3 ${o3?.status}:${o3?.code} · O2 ${o2?.status}:${o2?.code}`);
      if (o2?.status !== 'hold' || o2.code !== 'OVER_CAP') throw new Error('step 3 should leave O2 hold:OVER_CAP');

      // ---- step 4: approve down to the contract cap --------------------------------------
      const approveLabel = await page.locator('.detail-actions .btn--primary').first().innerText();
      log(`step 4 → button says "${approveLabel.trim()}"`);
      await page.locator('.detail-actions .btn--primary').first().click();
      const afterApprove = await until('Leo to be proven', async () => {
        const current = await state();
        return current.intents.int_in_05?.state === 'proven' ? current : null;
      }, 180_000, 2000);
      log(`step 4 → in_05 ${afterApprove.intents.int_in_05?.state} · approvedAmount ${afterApprove.intents.int_in_05?.approvedAmount} · transaction ${afterApprove.intents.int_in_05?.receipt?.transactionId}`);
      if (afterApprove.intents.int_in_05?.approvedAmount !== 192_000) throw new Error('Leo should have been paid the contract cap of $1,920.00');

      const totals = totalsMatch(afterApprove.totals, g.totalsAfterHumanSteps);
      log(`totals vs golden.totalsAfterHumanSteps: ${totals.ok ? 'EQUAL' : totals.diff.join('; ')}`);
      if (!totals.ok) throw new Error(`totals differ: ${totals.diff.join('; ')}`);

      // SPEC §3 2:00–2:20 reads these two numbers off the screen: "Proven $7,008.00 · Stopped
      // $3,550.00". The API agreeing is not enough — the screen has to say it (T8 round 3,
      // items 2 and 6).
      const screen = await until(
        'the screen to show $7,008.00 proven',
        async () => {
          const current = await readScreen(page);
          return current.kpis[0] === '$7,008.00' ? current : null;
        },
        30_000,
        500,
      );
      log(`screen KPI after the four steps: ${screen.kpis.join(' ')}`);
      if (screen.kpis[0] !== '$7,008.00') throw new Error(`Proven should read $7,008.00, screen says ${screen.kpis[0]}`);
      if (screen.kpis[2] !== '$0.00') throw new Error(`Held should read $0.00, screen says ${screen.kpis[2]}`);
      if (screen.kpis[3] !== '$3,550.00') throw new Error(`Stopped should read $3,550.00, screen says ${screen.kpis[3]}`);
      if (screen.banner !== null) throw new Error(`the screen shows a run banner after the human steps: ${screen.banner}`);
      const leo = screen.rows.find((row) => row.itemId === 'in_05');
      log(`screen row in_05 → ${leo?.status} · banner none`);
      if (leo?.status !== 'Proven') throw new Error(`in_05 should read Proven on screen, got ${leo?.status}`);
      await shotProof(page, 'ac12-hero-after-human-steps-1280x720.png');
      log('wrote proof/e2e/ac12-hero-after-human-steps-1280x720.png');

      const events = await fetchEvents();
      writeProof('ac12-ledger.log', keyLog(events));
      writeJson('ac12-state.json', { totals: afterApprove.totals, steps: 4 });
      log('\nAC-12 PASS');
    } finally {
      await session.close();
    }
  } catch (error) {
    log(`\nAC-12 FAIL — ${error instanceof Error ? error.message : String(error)}`);
    log(`server log:\n${server.log.slice(-30).join('\n')}`);
    process.exitCode = 1;
  } finally {
    writeProof('ac12.log', `${lines.join('\n')}\n`);
    await server.stop();
  }
}

void main();
