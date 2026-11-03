#!/usr/bin/env bash
# T8（AME-904）· 接真 server ＋ 全部屏幕 ＋ 一鍵啟動 ＋ 端到端
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# CI 不裝依賴：這裡自己 npm ci；@pbp/core 是 file: 依賴，apps/web 也吃它的 dist。
#
# 分兩半：
#   check      —— 不需要憑證、不需要本地服務的結構檢查與 web 的 typecheck／unit／build；
#   need_local —— AC-11（真 PayPal 沙箱＋真模型）：demo:reset → 點 Run → 每行與 KPI 等於 golden
#                 → 獨立腳本 crosscheck 逐筆向 PayPal GET 對 transaction id。

WEB=apps/web
SERVER=apps/server

if [ ! -d "$WEB/node_modules" ]; then
  check "e2e: web 安裝依賴（npm ci）" bash -c "cd $WEB && npm ci --no-audit --no-fund"
fi
if [ ! -d "$SERVER/node_modules" ]; then
  check "e2e: server 安裝依賴（npm ci）" bash -c "cd $SERVER && npm ci --no-audit --no-fund"
fi

# ---- 組裝：一個入口，接真軌道與真模型（SPEC §6.7）
check "server 有 src/main.ts（組裝入口）" test -f $SERVER/src/main.ts
check "server 依賴含 @pbp/paypal 與 @pbp/agent（file:）" node -e '
  const d = require("./'$SERVER'/package.json").dependencies || {};
  if (!String(d["@pbp/paypal"] || "").startsWith("file:")) { console.error("no @pbp/paypal"); process.exit(1); }
  if (!String(d["@pbp/agent"] || "").startsWith("file:")) { console.error("no @pbp/agent"); process.exit(1); }
'
check "web 依賴含 @pbp/core（型別從 core 匯入）" node -e '
  const d = require("./'$WEB'/package.json").dependencies || {};
  if (!String(d["@pbp/core"] || "").startsWith("file:")) { console.error("no @pbp/core"); process.exit(1); }
'

# ---- 一鍵啟動（AC-17）
check "根 npm run dev 腳本存在" node -e '
  const s = require("./package.json").scripts || {};
  if (s.dev !== "node scripts/dev.mjs") { console.error("scripts.dev =", s.dev); process.exit(1); }
'
check ".env.example 只寫鍵名（SPEC §6.9 的 11 個鍵都在、沒有值）" node -e '
  const fs = require("fs");
  const text = fs.readFileSync(".env.example", "utf8");
  const keys = ["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","PAYPAL_ENV","LLM_API_BASE","LLM_API_KEY",
    "LLM_MODEL","PBP_DATA_DIR","PBP_RECEIVER_MAP","PBP_ALLOW_COMPARISON","PBP_FAULT","PORT"];
  const seen = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) { console.error("not a KEY= line:", trimmed); process.exit(1); }
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (value !== "") { console.error("value leaked for", key); process.exit(1); }
    seen.add(key);
  }
  const missing = keys.filter((key) => !seen.has(key));
  if (missing.length) { console.error("missing keys:", missing.join(",")); process.exit(1); }
'

# ---- web：型別、單元、建置（check 部分）
check "e2e: web typecheck（tsc --noEmit，含 e2e 腳本）" bash -c "cd $WEB && npm run --silent typecheck"
check "e2e: web unit（投影 reduce）" bash -c "cd $WEB && npm test --silent"
check "e2e: web build（vite）" bash -c "cd $WEB && npx vite build"

# ---- 端到端（真沙箱＋真模型，need_local）
# AC-11 跑完順便產出 proof/e2e/ 的日誌與 proof/ui/hero-done-1280x720.png；crosscheck 是 AC-11
# 的最後一句（每個 proven 的證明包向 PayPal GET，斷言 SUCCESS 與 transaction id 一致），
# ac11.ts 內部會叫它，所以這裡不重複跑一次。
need_local "AC-11 端到端：demo:reset → Run → golden 對帳 → crosscheck" \
  bash -c 'npx --prefix apps/web tsx apps/web/e2e/ac11.ts'

need_local "AC-12 人工四步（接在 AC-11 的帳本上）" \
  bash -c 'npx --prefix apps/web tsx apps/web/e2e/ac12.ts'

# (a) 與 (b) 分開兩段：每一段自己種一次歷史、跑一輪，合起來約 9 分鐘，超過單條命令的上限。
need_local "AC-13 (a) 故障注入：掉回應之後同鍵重試仍只付一次" \
  bash -c 'npx --prefix apps/web tsx apps/web/e2e/ac13.ts a'

need_local "AC-13 (b) kill -9：重啟後續完、不重付" \
  bash -c 'npx --prefix apps/web tsx apps/web/e2e/ac13.ts b'

need_local "AC-14 對照模式（無閘的 agent，預設關閉）" \
  bash -c 'npx --prefix apps/web tsx apps/web/e2e/ac14.ts'
