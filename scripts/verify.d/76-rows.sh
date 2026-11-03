#!/usr/bin/env bash
# T11 第 3 輪（AME-907）· 跑動列表的最後一行不得被頁腳壓住。
#
# 主控退回的第 1 條：錯誤態 1280×720 下第 9 行（Studio Ops）從 634.2 到 674.2，頁腳從 663 開始，
# 被壓掉 11.2px，連「Not checked」的狀態片底邊都被切掉。原因是沒被查過的 8 行寫死 `0 0 40px`
# 又沿用了 `.run-row` 的 `min-height: 40px`：9 行 × 40 = 360px 擠進 349px 的列表區。卡片
# overflow hidden，所以 `screenshots.ts` 的 scroll/overflow 斷言看不到這種「藏在頁腳底下」。
#
# 量的是真實運行的帳本，不是設計夾具：夾具的信箱只有 8 封（第 9 封 Studio Ops 不在 seed 裡），
# 它的錯誤態是 8 行、擠不破，這一類在夾具上量不出來——上一輪的尺子就是這樣漏掉的。
#   ・錯誤態：data/e2e/shots-error（70-screenshots.sh 產出，9 行＋橫幅）
#   ・完成態：data/e2e/ac13b（60-e2e.sh 產出，8 行）
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# 需要建置過的 apps/server/dist 與 apps/web/dist，以及 Playwright 的 chromium，所以是 need_local。

rows_clear_footer() {
  ( cd apps/web && { [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1; } ) || return 1
  ( cd apps/web && node --input-type=module - <<'NODE'
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const web = process.cwd();
const root = path.resolve(web, '../..');
const DATA = {
  error: path.join(root, 'data/e2e/shots-error'),
  done: path.join(root, 'data/e2e/ac13b'),
};
for (const [label, dir] of Object.entries(DATA)) {
  if (!existsSync(path.join(dir, 'ledger.jsonl'))) {
    console.error(
      `缺 ${path.relative(root, dir)}——先跑 70-screenshots.sh（產出錯誤態）與 60-e2e.sh（產出完成態）`,
    );
    process.exit(2);
  }
}

const requireWeb = createRequire(path.join(web, 'package.json'));
const pw = await import(pathToFileURL(requireWeb.resolve('playwright')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const PORTS = { error: 8797, done: 8799 };
const servers = {};
for (const [label, dir] of Object.entries(DATA)) {
  const port = PORTS[label];
  const proc = spawn(process.execPath, [path.join(root, 'apps/server/dist/main.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PBP_DATA_DIR: dir },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((done) => setTimeout(done, 250));
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) {
      proc.kill('SIGTERM');
      console.error(`${label} 伺服器沒有起來`);
      process.exit(2);
    }
  }
  servers[label] = proc;
}

const browser = await chromium.launch({ headless: true });
const VIEWPORTS = [
  [1280, 720],
  [1440, 900],
];
const problems = [];
const lines = [];
// 錯誤態選 in_01（退回的那一屏：1 行「Not sent」＋ 8 行「Not checked」）；完成態選 in_04（主屏）。
const SCREENS = [
  ['error', '?select=in_01'],
  ['done', '?select=in_04'],
];
try {
  for (const [label, query] of SCREENS) {
    for (const [width, height] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${PORTS[label]}/${query}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.run-row', { timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const measured = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.run-row'));
        const foot = document.querySelector('.run-foot');
        const list = document.querySelector('.run-rows');
        const last = rows[rows.length - 1];
        return {
          rows: rows.length,
          lastBottom: last ? Number(last.getBoundingClientRect().bottom.toFixed(1)) : null,
          footTop: foot ? Number(foot.getBoundingClientRect().top.toFixed(1)) : null,
          listClient: list?.clientHeight ?? null,
          listScroll: list?.scrollHeight ?? null,
        };
      });
      await page.close();
      const overlap =
        measured.lastBottom !== null && measured.footTop !== null
          ? Number((measured.lastBottom - measured.footTop).toFixed(1))
          : null;
      lines.push(
        `${label} ${width}x${height}: ${measured.rows} 行，末行底 ${measured.lastBottom}，頁腳頂 ${measured.footTop}，越界 ${overlap}px，列表 ${measured.listScroll}/${measured.listClient}`,
      );
      if (overlap === null) problems.push(`${label} ${width}x${height}: 找不到 .run-row 或 .run-foot`);
      else if (overlap > 0) problems.push(`${label} ${width}x${height}: 末行越過頁腳 ${overlap}px（被壓住）`);
      if (measured.listClient !== null && measured.listScroll > measured.listClient + 1) {
        problems.push(`${label} ${width}x${height}: .run-rows 藏了 ${measured.listScroll - measured.listClient}px`);
      }
    }
  }
} finally {
  await browser.close();
  for (const proc of Object.values(servers)) proc.kill('SIGTERM');
}

for (const line of lines) console.log(line);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
NODE
  )
}

need_local "T11 第 3 輪：錯誤態與完成態×兩視口，最後一行不越過頁腳" rows_clear_footer
