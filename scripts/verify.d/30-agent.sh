# T6 · packages/agent —— AI agent（AC-8、AC-9(c)(d)、AC-10、AC-14 的 agent 部分）
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# CI 不裝依賴：這裡自己 npm ci；本機已裝過就跳過（npm ci 會重裝整個 node_modules）。

if [ ! -d packages/agent/node_modules ]; then
  check "agent 安裝依賴（npm ci）" bash -c 'cd packages/agent && npm ci --no-audit --no-fund'
fi

# `@pbp/core` 是 file: 依賴，型別與執行期都指向 packages/core/dist。CI 從乾淨 checkout 開始，
# 這裡不能假設 10-core.sh 已經跑過。
if [ ! -f packages/core/dist/index.d.ts ]; then
  check "agent 前置：建置 core（@pbp/core 的 dist）" bash -c 'npm --prefix packages/core run build --silent'
fi

check "agent 單元測試（AC-9c/9d、AC-10 邏輯、風險說明 140 字元）" bash -c 'npm --prefix packages/agent test --silent'
check "agent 型別檢查（src + test）" bash -c 'npm --prefix packages/agent run typecheck --silent'
check "agent 建置（dist + .d.ts）" bash -c 'npm --prefix packages/agent run build --silent && test -f packages/agent/dist/index.d.ts'

# 依賴就是任務書點名的四個：core、openai、unpdf、zod。沒有任何 PayPal SDK（AC-9c 的靜態面）。
check "agent 依賴只有 core / openai / unpdf / zod" bash -c 'node -e "const d=Object.keys(require(\"./packages/agent/package.json\").dependencies||{}).sort().join(\",\");if(d!==\"@pbp/core,openai,unpdf,zod\"){console.error(d);process.exit(1)}"'

# AC-8：9 封郵件 × 1 次，逐欄對 golden。全對才過。
# 輸出寫到暫存目錄，不覆蓋 proof/ai/extract-run-N/ 的凍結證據。
need_local "agent 真模型抽取評測（9 封逐欄對 golden）" bash -c '
  out=$(mktemp -d)
  cd packages/agent && npx tsx scripts/eval.ts extract --run 1 --out "$out/extract"
  status=$?
  rm -rf "$out"
  exit $status
'
