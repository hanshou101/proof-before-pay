#!/usr/bin/env bash
# T11 第 2 輪（AME-907）· 證明包抽屜在 1280×720 一屏裝下：主控退回的第 1 條。
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# 需要 data/e2e/ac13b（60-e2e.sh 的產出）、建置過的 apps/server/dist 與 apps/web/dist，
# 以及 Playwright 的 chromium——所以是 need_local。
#
# 判據：`.drawer-body` 的 scrollHeight 不得大於 clientHeight（內容藏在捲動區＝截斷，
# AGENTS §4.6「不截斷」）；同時 PayPal 回執必須在抽屜頂部那一塊，不是最底下的區塊。

drawer_fits_1280() {
  ( cd apps/web && { [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1; } ) || return 1
  ( cd apps/web && node --input-type=module - <<'NODE'
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const web = process.cwd();
const root = path.resolve(web, '../..');
const data = path.join(root, 'data/e2e/ac13b');
if (!existsSync(path.join(data, 'ledger.jsonl'))) {
  console.error('缺 data/e2e/ac13b——先跑 60-e2e.sh（或 npx tsx apps/web/e2e/ac13.ts b）');
  process.exit(2);
}

const PORT = 8798;
const server = spawn(process.execPath, [path.join(root, 'apps/server/dist/main.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PBP_DATA_DIR: data },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const deadline = Date.now() + 30_000;
for (;;) {
  await new Promise((done) => setTimeout(done, 250));
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
  } catch {}
  if (Date.now() > deadline) {
    server.kill('SIGTERM');
    console.error('伺服器沒有起來');
    process.exit(2);
  }
}

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${PORT}/?select=in_02`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.run-row', { timeout: 20_000 });
await page.getByRole('button', { name: 'Open proof bundle' }).click();
await page.waitForSelector('.drawer', { timeout: 20_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(250);

const measured = await page.evaluate(() => {
  const body = document.querySelector('.drawer-body');
  const receipt = document.querySelector('.drawer-receipt');
  const drawer = document.querySelector('.drawer');
  const last = body?.lastElementChild;
  return {
    client: body?.clientHeight ?? 0,
    total: body?.scrollHeight ?? 0,
    receiptTop: receipt ? Math.round(receipt.getBoundingClientRect().top) : -1,
    drawerTop: drawer ? Math.round(drawer.getBoundingClientRect().top) : -1,
    slack: body && last ? Math.round(body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : -1,
    receiptText: receipt?.innerText.replace(/\s+/g, ' ').trim() ?? '',
  };
});

await browser.close();
server.kill('SIGTERM');

const problems = [];
if (measured.total > measured.client + 1) {
  problems.push(`.drawer-body 藏了 ${measured.total - measured.client}px（scrollHeight ${measured.total} > clientHeight ${measured.client}）`);
}
if (measured.receiptTop < 0 || measured.receiptTop - measured.drawerTop > 120) {
  problems.push(`PayPal 回執不在抽屜頂部（top ${measured.receiptTop}，抽屜 top ${measured.drawerTop}）`);
}
if (!/SUCCESS/.test(measured.receiptText) || !/Transaction/.test(measured.receiptText)) {
  problems.push(`回執那一塊沒有 PayPal 的交易號與狀態：${measured.receiptText}`);
}
console.log(
  `drawer 1280×720：scrollHeight ${measured.total} / clientHeight ${measured.client}，底部留白 ${measured.slack}px；回執 top ${measured.receiptTop}`,
);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
NODE
  )
}

need_local "T11 第 2 輪：證明包抽屜 1280×720 不捲動、PayPal 回執在頂部" drawer_fits_1280
