#!/usr/bin/env node
// 審美閘量測（主控 D1 起用）。不看截圖腳本的斷言、不看自檢表，直接量瀏覽器裡的實物：
// 設計夾具的 6 個畫面 × 1280×720 / 1440×900，逐項對 AGENTS.md §4.6 衛生清單與 docs/07-UI.md §6 必改清單。
// 2026-11-01 起量的是網頁儀表板樣板（design/sample/README.md）的規矩：字號照 styles.css 頂部的階梯、
// 強調色是黑色膠囊、按鈕一級 14px、欄頭照新的表頭。過不過線不看這支，看盲排（07-UI §6）；這支只管衛生。
//
// 用法（倉庫根）：
//   (cd apps/web && npx vite build)
//   node scripts/measure-ui.mjs [輸出.json]
// 任何一項不過 → 退出碼 1。閾值的出處見下方常數旁的註記。
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const web = join(root, 'apps/web');
const outFile = process.argv[2];
if (!existsSync(join(web, 'dist/index.html'))) {
  console.error('apps/web/dist 不存在：先跑 (cd apps/web && npx vite build)');
  process.exit(2);
}
const requireWeb = createRequire(join(web, 'package.json'));
const pw = await import(pathToFileURL(requireWeb.resolve('playwright')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const { preview } = await import(pathToFileURL(requireWeb.resolve('vite')).href);

const SCREENS = [
  ['hero-done', 'select=in_04'],
  ['hero-empty', 'at=0'],
  ['hero-running', 'at=44&select=in_01'],
  ['hero-error', 'error=paypal&select=in_01'],
  ['bundle-proven', 'drawer=in_02&select=in_02'],
  ['verify-payee', 'modal=verify&select=in_04'],
];
const VIEWPORTS = [[1280, 720], [1440, 900]];
// 字號只來自樣板的階梯（styles.css 頂部：12 標籤、14 次要、16 正文、20 面板標題、28 總額、40 主句）。
// AGENTS §4.6 原寫「一屏最多 4 級」；尺子要一句最大的主句與面板標題，取捨見 07-UI §4.3，等用戶點頭。
const LADDER = ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl'];
const BODY_MIN = 16; // AGENTS §4.6：正文 ≥ 16px；哪些元素是「正文」見 07-UI §4.3
const BODY = ['.note-text', '.detail-text', '.why-item', '.run-banner-text', '.verify-instruction'];
const BLANK_MAX = 120; // 07-UI §6 D1-2：詳情面板兩個視口、抽屜與對話框在 1280×720 的卡片內最大空白
const ALIGN_TOL = 1; // 07-UI §6 D1-5：表頭與欄內容對齊 ±1px（樣板的表頭見 RunList.tsx `.run-head`）
const ZERO_TOL = 0.5; // 07-UI §6 D1-4：zero-mark 寬 = 一格等寬 ±0.5px
const DEBUG = [
  ['模型名', /deepseek|gpt-\d|glm-|claude|llama|qwen/i],
  ['stub / mock', /\bstub\b|\bmock\b/i],
  ['session / request id', /session[ _-]?id|request[ _-]?id/i],
  ['原始 JSON', /[{[]\s*"[A-Za-z_]+"\s*:/],
  ['埠號與本機路徑', /localhost|127\.0\.0\.1|:\d{4,5}\b|\/Users\/|\/home\//],
  ['延遲毫秒', /\b\d+\s?ms\b/],
  ['堆疊', /\bat [\w.$]+ \(|\bError:|Traceback/],
  ['版本串', /\bv\d+\.\d+\.\d+\b/],
];
const FAKE = [/\bPaid\b/, /lorem/i, /\btest\b/i, /\bfoo\b/i, /\bundefined\b/, /\bNaN\b/, /\bnull\b/];

const server = await preview({ root: web, logLevel: 'silent', preview: { port: 4187, strictPort: false } });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch();
const report = [];

try {
  for (const [name, query] of SCREENS) {
    for (const [width, height] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));
      await page.goto(`${base}/?fixture=design&${query}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600); // 等脈動、滑入等一次性動效走完

      const dom = await page.evaluate(({ width, height, BODY, LADDER, DEBUG, FAKE }) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
          }
          return true;
        };
        const label = (el) => {
          const raw = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
          const cls = String(raw).trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
          const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ' "' + text + '"' : ''}`;
        };
        const ownText = (el) => Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim() !== '');
        // 被抽屜／對話框蓋住的不算進字號、疊壓與強調色
        const onTop = (el) => {
          const r = el.getBoundingClientRect();
          const x = Math.min(Math.max(r.left + r.width / 2, 0), width - 1);
          const y = Math.min(Math.max(r.top + r.height / 2, 0), height - 1);
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
        };
        const all = Array.from(document.querySelectorAll('body *')).filter(visible);
        const topText = all.filter(ownText).filter(onTop);

        const sizes = {};
        for (const el of topText) {
          const key = `${parseFloat(getComputedStyle(el).fontSize)}px`;
          (sizes[key] ||= { count: 0, samples: [] }).count += 1;
          if (sizes[key].samples.length < 4) sizes[key].samples.push(label(el));
        }
        const bodySmall = BODY.flatMap((sel) => Array.from(document.querySelectorAll(sel)).filter(visible).filter(onTop))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => `${getComputedStyle(el).fontSize} ${label(el)}`);

        const clip = [], outside = [];
        for (const el of all) {
          const s = getComputedStyle(el);
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.overflowX !== 'visible') clip.push(`水平 ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
          if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && s.overflowY !== 'visible' && el !== document.body) clip.push(`垂直 ${label(el)} ${el.scrollHeight}>${el.clientHeight}`);
          if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) clip.push(`省略號 ${label(el)}`);
          const r = el.getBoundingClientRect();
          if (r.right > width + 0.5 || r.bottom > height + 0.5 || r.left < -0.5 || r.top < -0.5) outside.push(`${label(el)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
        }

        const overlaps = [];
        const boxes = topText.map((el) => [el, el.getBoundingClientRect()]);
        for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
          const [a, ra] = boxes[i]; const [b, rb] = boxes[j];
          if (a.contains(b) || b.contains(a)) continue;
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 1 && h > 1) overlaps.push(`${label(a)} ⨯ ${label(b)} (${Math.round(w)}×${Math.round(h)})`);
        }

        const probe = document.createElement('div');
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        document.body.appendChild(probe);
        const accentRgb = getComputedStyle(probe).color;
        probe.remove();
        // 樣板的強調色就是字色（黑色膠囊）：字與描邊分不出是不是強調，只數填滿強調色的按鈕
        const accentIsInk = accentRgb === getComputedStyle(document.documentElement).color;
        const accent = [];
        for (const el of all) {
          if (!onTop(el)) continue;
          const s = getComputedStyle(el);
          const hits = [];
          if (accentIsInk) {
            if (el.matches('.btn') && s.backgroundColor === accentRgb) hits.push('底');
          } else {
            if (s.backgroundColor === accentRgb) hits.push('底');
            if (s.color === accentRgb && ownText(el)) hits.push('字');
            if (s.borderTopColor === accentRgb && parseFloat(s.borderTopWidth) > 0) hits.push('框');
          }
          if (hits.length) accent.push(`${hits.join('+')} ${label(el)}`);
        }

        // 合成粗體：請求的字重沒有對應的已載入字面，瀏覽器自己加粗
        const faces = Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')}|${f.weight}`);
        const synth = new Set();
        for (const el of topText) {
          const s = getComputedStyle(el);
          const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
          if (/IBM Plex|Plus Jakarta Sans/.test(fam) && !faces.includes(`${fam}|${s.fontWeight}`)) synth.add(`${fam} ${s.fontWeight}：${label(el)}`);
        }

        // 卡片內最大空白：卡片裡可見的文字、圖示、按鈕在垂直方向上的最大空隙（含到卡片底）
        const blanks = [];
        for (const card of Array.from(document.querySelectorAll('.detail, .drawer, .dialog')).filter(visible)) {
          if (!card.matches('.drawer, .dialog') && !onTop(card)) continue;
          const cr = card.getBoundingClientRect();
          const kids = Array.from(card.querySelectorAll('*')).filter(visible)
            .filter((el) => ownText(el) || el.tagName === 'svg' || el.tagName === 'BUTTON')
            .map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
          let bottom = cr.top;
          let worst = { gap: 0, from: 0, to: 0, atEnd: false };
          for (const r of kids) {
            if (r.top - bottom > worst.gap) worst = { gap: Math.round(r.top - bottom), from: Math.round(bottom), to: Math.round(r.top), atEnd: false };
            bottom = Math.max(bottom, r.bottom);
          }
          if (cr.bottom - bottom > worst.gap) worst = { gap: Math.round(cr.bottom - bottom), from: Math.round(bottom), to: Math.round(cr.bottom), atEnd: true };
          blanks.push({ kind: card.matches('.drawer') ? 'drawer' : card.matches('.dialog') ? 'dialog' : 'detail', size: `${Math.round(cr.width)}×${Math.round(cr.height)}`, ...worst });
        }

        // 按鈕列上方：面板內文最後一行到按鈕列的分隔線至少 --sp-4（16px）。
        // 樣板 v1 的「Why it's held」貼著按鈕列，Sonnet 5.5 在盲排第 1 輪點了它（07-UI §6）
        const actionGaps = [];
        for (const card of Array.from(document.querySelectorAll('.detail')).filter(visible)) {
          const bar = card.querySelector('.detail-actions');
          const body = card.querySelector('.detail-body');
          if (!bar || !body || !visible(bar) || !onTop(card)) continue;
          const bottoms = Array.from(body.querySelectorAll('*')).filter(visible)
            .filter((el) => ownText(el) || el.tagName === 'svg').map((el) => el.getBoundingClientRect().bottom);
          if (bottoms.length) actionGaps.push(Math.round(bar.getBoundingClientRect().top - Math.max(...bottoms)));
        }

        // 主句最多兩行：再多就把總額卡往下推，最後一行常只剩一個字（樣板 v1 運行中的「…until it's / proven.」）
        const headlineEl = Array.from(document.querySelectorAll('.hero-headline')).find(visible);
        const headlineLines = headlineEl ? Math.round(headlineEl.getBoundingClientRect().height / parseFloat(getComputedStyle(headlineEl).lineHeight)) : 0;

        // 按鈕一級（07-UI §4.3，樣板）：膠囊按鈕一律 14px／700；頁頭的高 40px，其餘 btn--sm 高 36px
        const buttons = Array.from(document.querySelectorAll('.btn')).filter(visible).map((el) => {
          const fs = parseFloat(getComputedStyle(el).fontSize);
          return { label: label(el), fs, want: 14 };
        });
        const rootStyle = getComputedStyle(document.documentElement);
        const ladder = LADDER.map((v) => parseFloat(rootStyle.getPropertyValue(v)));

        const text = document.body.innerText;
        const debug = DEBUG.filter(([, src]) => new RegExp(src.source, src.flags).test(text)).map(([k, src]) => `${k}：${text.match(new RegExp(src.source, src.flags))[0]}`);
        const fake = FAKE.filter((src) => new RegExp(src.source, src.flags).test(text)).map((src) => text.match(new RegExp(src.source, src.flags))[0]);
        const emoji = text.match(/\p{Extended_Pictographic}/gu) ?? [];
        const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) ?? [];
        const natives = Array.from(document.querySelectorAll('select, input[type=checkbox], input[type=radio], input[type=date], input[type=time], input[type=datetime-local], input[type=file], input[type=range], input[type=color], progress, meter')).filter(visible).map(label);

        // 動效：過渡與動畫時長只能是 150–250ms；轉圈的載入指示（spin）是持續狀態，不算
        const motion = new Set();
        for (const el of document.querySelectorAll('body *')) {
          const s = getComputedStyle(el);
          const durs = (v) => v.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000));
          for (const ms of durs(s.transitionDuration)) if (ms !== 0 && (ms < 150 || ms > 250)) motion.add(`transition ${ms}ms ${label(el)}`);
          const names = s.animationName.split(',').map((n) => n.trim());
          durs(s.animationDuration).forEach((ms, i) => {
            const n = names[i] ?? names[0];
            if (n !== 'none' && n !== 'spin' && ms !== 0 && (ms < 150 || ms > 250)) motion.add(`animation ${n} ${ms}ms ${label(el)}`);
          });
        }

        const icon = document.querySelector('link[rel~="icon"]');
        const doc = document.documentElement;
        return {
          sizes, ladder, actionGaps, headlineLines, bodySmall, clip, outside, overlaps, accent, synth: Array.from(synth), blanks, buttons,
          debug, fake, emoji: [...new Set(emoji)], cjk: [...new Set(cjk)].slice(0, 10), natives, motion: Array.from(motion),
          title: document.title, favicon: icon ? icon.getAttribute('href') : null, scroll: [doc.scrollWidth, doc.scrollHeight],
        };
      }, { width, height, BODY, LADDER, DEBUG: DEBUG.map(([k, re]) => [k, { source: re.source, flags: re.flags }]), FAKE: FAKE.map((re) => ({ source: re.source, flags: re.flags })) });

      // D1 專項：zero-mark 寬、欄頭對齊（只在有這些元素的畫面上量）
      const special = await page.evaluate(() => {
        const out = { zero: [], align: [] };
        for (const mark of document.querySelectorAll('.zero-mark')) {
          const r = mark.getBoundingClientRect();
          if (r.width < 1) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !(hit === mark || mark.contains(hit))) continue; // 被對話框蓋住的不量
          const host = mark.parentElement;
          const s = getComputedStyle(host);
          const ruler = document.createElement('span');
          // 逐項抄字型（等寬數字等設定會讓 font 簡寫序列化成空字串）
          ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
          for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'letterSpacing']) ruler.style[k] = s[k];
          ruler.textContent = '0000000000';
          document.body.appendChild(ruler);
          const cell = ruler.getBoundingClientRect().width / 10;
          ruler.remove();
          out.zero.push({ where: mark.closest('.dialog') ? 'dialog' : 'panel', width: +r.width.toFixed(2), cell: +cell.toFixed(2), delta: +(r.width - cell).toFixed(2) });
        }
        // 表頭（樣板）：Amount 對金額的右緣，Owed／Payee／Policy／PayPal 對四枚印章的中心，Status 對狀態片的右緣
        const head = document.querySelector('.run-head');
        const row = document.querySelector('.run-row');
        if (head && row) {
          const textRect = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
          const push = (col, mode, delta) => out.align.push({ col, mode, delta: +delta.toFixed(1) });
          const amountLabel = head.querySelector('.run-head-label.is-num');
          const amountText = Array.from(row.querySelector('.amount-cell')?.childNodes ?? []).find((n) => n.nodeType === 3 && n.textContent.trim());
          if (amountLabel && amountText) push('Amount', '右緣', textRect(amountLabel).right - textRect(amountText).right);
          const legend = Array.from(head.querySelectorAll('.proof-legend > span'));
          const stamps = Array.from(row.querySelectorAll('.proof-chain .stamp-cell svg'));
          legend.forEach((l, i) => {
            if (!stamps[i]) return;
            const lr = textRect(l); const sr = stamps[i].getBoundingClientRect();
            push(l.textContent.trim(), '置中', (lr.left + lr.right) / 2 - (sr.left + sr.right) / 2);
          });
          // 相鄰兩個印章欄頭的字之間至少留 --sp-2（8px，和行內欄距一樣），不然讀起來是一串：
          // 樣板 v1 只有 4.2–5.5px，Fable 5.1 在盲排第 1 輪點了它（07-UI §6）
          for (let i = 1; i < legend.length; i += 1) {
            const gap = textRect(legend[i]).left - textRect(legend[i - 1]).right;
            if (gap < 8) out.align.push({ col: `${legend[i - 1].textContent.trim()}｜${legend[i].textContent.trim()}`, mode: '字距', delta: +gap.toFixed(1), min: 8 });
          }
          const statusLabel = head.querySelector('.status-label');
          const chip = row.querySelector('.status-cell .chip');
          if (statusLabel && chip) push('Status', '右緣', textRect(statusLabel).right - chip.getBoundingClientRect().right);
        }
        return out;
      });

      // 字體回落：CDP 問每個節點實際用了哪個平台字體
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: docRoot.nodeId, selector: 'body *' });
      const platformFonts = {};
      for (const nodeId of nodeIds) {
        try {
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          for (const f of fonts) if (f.glyphCount > 0) platformFonts[f.familyName] = (platformFonts[f.familyName] || 0) + f.glyphCount;
        } catch { /* 非元素節點 */ }
      }
      const fallback = Object.keys(platformFonts).filter((fam) => !/IBM Plex|Plus Jakarta Sans/i.test(fam));
      const faviconOk = dom.favicon ? (await page.request.get(new URL(dom.favicon, page.url()).href)).ok() : false;

      report.push({ screen: `${name}-${width}x${height}`, width, height, consoleErrors, platformFonts, fallback, faviconOk, special, ...dom });
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}

// 判定：每項列出不過的畫面與元素
const checks = [
  ['字號只來自樣板階梯（12／14／16／20／28／40）', (r) => Object.keys(r.sizes).filter((k) => !r.ladder.includes(parseFloat(k))).map((k) => `${k} 不在階梯上：${r.sizes[k].samples.join('、')}`)],
  [`正文 ≥ ${BODY_MIN}px（07-UI §4.3 列名的元素）`, (r) => r.bodySmall],
  ['不裁切、不截斷', (r) => r.clip],
  ['不超出視口（一屏裝下）', (r) => [...r.outside, ...(r.scroll[0] > r.width || r.scroll[1] > r.height ? [`頁面可捲動 ${r.scroll.join('×')}`] : [])]],
  ['文字不疊壓', (r) => r.overlaps],
  ['強調色 ≤ 1 處（樣板：填滿的黑色膠囊只一顆）', (r) => (r.accent.length > 1 ? r.accent : [])],
  ['字體不回落', (r) => r.fallback],
  ['不合成粗體（字重都有字面）', (r) => r.synth],
  [`卡片內空白 ≤ ${BLANK_MAX}px`, (r) => r.blanks.filter((b) => b.gap > BLANK_MAX && (b.kind === 'detail' || r.width === 1280)).map((b) => `${b.kind} ${b.size} 空白 ${b.gap}px（y ${b.from}→${b.to}${b.atEnd ? '，卡片底' : ''}）`)],
  ['主句 ≤ 2 行', (r) => (r.headlineLines > 2 ? [`主句折成 ${r.headlineLines} 行`] : [])],
  ['按鈕列上方留白 ≥ 16px', (r) => r.actionGaps.filter((g) => g < 16).map((g) => `詳情面板內文到按鈕列 ${g}px`)],
  ['按鈕一級 14px（樣板）', (r) => r.buttons.filter((b) => b.fs !== b.want).map((b) => `${b.fs}px≠${b.want}px ${b.label}`)],
  ['沒有調試信息', (r) => r.debug],
  ['數據像真的（無 Paid／lorem／test／undefined／NaN／null）', (r) => r.fake],
  ['沒有 emoji', (r) => r.emoji],
  ['全英文', (r) => r.cjk],
  ['沒有原生控件', (r) => r.natives],
  ['動效 150–250ms', (r) => r.motion],
  ['標題與 favicon', (r) => [...(r.title.trim() ? [] : ['沒有 <title>']), ...(r.faviconOk ? [] : [`favicon 載不到：${r.favicon}`])]],
  ['console 無錯誤', (r) => r.consoleErrors],
  [`zero-mark 寬 = 一格等寬 ±${ZERO_TOL}px`, (r) => r.special.zero.filter((z) => Math.abs(z.delta) > ZERO_TOL).map((z) => `${z.where} 寬 ${z.width}px，一格 ${z.cell}px（差 ${z.delta}）`)],
  [`表頭對齊 ±${ALIGN_TOL}px、印章欄頭字距 ≥ 8px`, (r) => r.special.align.filter((a) => (a.mode === '字距' ? true : Math.abs(a.delta) > ALIGN_TOL)).map((a) => (a.mode === '字距' ? `${a.col} 字距 ${a.delta}px < ${a.min}px` : `${a.col}（${a.mode}）差 ${a.delta}px`))],
];

let failed = 0;
for (const r of report) {
  const levels = Object.keys(r.sizes).sort((a, b) => parseFloat(a) - parseFloat(b));
  console.log(`\n=== ${r.screen}`);
  console.log(`字號 ${levels.length} 級：${levels.map((k) => `${k}×${r.sizes[k].count}`).join('  ')}`);
  console.log(`卡片空白：${r.blanks.map((b) => `${b.kind} ${b.gap}px`).join('，') || '—'}｜強調色 ${r.accent.length} 處｜字體：${Object.keys(r.platformFonts).join('、')}`);
}
console.log('\n=== 判定（12 個畫面×視口）');
for (const [title, fn] of checks) {
  const bad = report.flatMap((r) => fn(r).map((x) => `${r.screen}：${x}`));
  if (bad.length) failed += 1;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${title}${bad.length ? '\n      ' + bad.slice(0, 14).join('\n      ') + (bad.length > 14 ? `\n      …共 ${bad.length} 條` : '') : ''}`);
}
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(failed ? `\n${failed} 項不過` : '\n全部通過');
process.exit(failed ? 1 : 0);
