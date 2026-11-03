# T7（AME-903）· apps/server —— 帳本檔、運行器、SSE、人工操作、demo:reset、重啟恢復
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# CI 不裝依賴：這裡自己 npm ci；@pbp/core 是 file: 依賴，必須先有 dist/ 才能編譯 server。

if [ ! -d apps/server/node_modules ]; then
  check "server 安裝依賴（npm ci）" bash -c 'cd apps/server && npm ci --no-audit --no-fund'
fi

check "server 前置：core 已建置（file: 依賴要 dist/）" bash -c '
  if [ -f packages/core/dist/index.d.ts ]; then exit 0; fi
  cd packages/core && npm ci --no-audit --no-fund && npm run build --silent
'

check "server 整合測試（AC-12・AC-13・AC-15・AC-17 的 server 部分）" \
  bash -c 'cd apps/server && npm test --silent'
check "server 型別檢查（src + test）" bash -c 'cd apps/server && npm run typecheck --silent'
check "server 建置（dist + .d.ts）" \
  bash -c 'cd apps/server && npm run build --silent && test -f dist/index.d.ts'

check "proof-bundle schema 是 2020-12 且列齊 AC-15 的欄位" node -e '
  const s = require("./schemas/proof-bundle.schema.json");
  const need = ["source","extraction","claim","agreement","amountRule","delivery","payee","checks","payment","ledger"];
  if (s.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("draft mismatch");
  for (const key of need) if (!s.required.includes(key)) throw new Error("missing required: " + key);
  if (s.properties.checks.minItems !== 9) throw new Error("checks must be the nine gate checks");
'

check "根 demo:reset 腳本存在（端到端接真軌道在 T8）" bash -c '
  node -e "const p=require(\"./package.json\");if(!p.scripts[\"demo:reset\"])process.exit(1)" &&
  test -f apps/server/scripts/reset.mjs
'
