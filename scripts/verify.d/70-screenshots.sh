#!/usr/bin/env bash
# T8（AME-904）· 截圖（07-UI §5 中 T4、T8 負責的每一張，全部來自真實運行）
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
#
# 為什麼是 70 而不是 40：截圖要讀 60-e2e.sh 跑出來的真實帳本（data/e2e/ac13b 等）。
# 排在 E2E 之前跑，全新 clone 一定 FAIL（2026-10-30，T8 第 3 輪驗收第 5 項）。
# 需要瀏覽器（npx playwright install chromium），所以是 need_local。

need_local "web: screenshots + no-overflow assertions（來自真實運行）" \
  bash -c "cd apps/web && npx tsx scripts/screenshots.ts"
