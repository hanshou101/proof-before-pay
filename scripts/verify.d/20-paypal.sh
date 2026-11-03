# T5 · packages/paypal —— PayPal Payouts 軌道（AC-7、AC-13(a) 的軌道部分）
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# CI 不裝依賴：這裡自己 npm ci；本機已裝過就跳過（npm ci 會重裝整個 node_modules）。

if [ ! -d packages/paypal/node_modules ]; then
  check "paypal 安裝依賴（npm ci）" bash -c 'cd packages/paypal && npm ci --no-audit --no-fund'
fi

# `@pbp/core` 是 file: 依賴，型別與執行期都指向 packages/core/dist。CI 從乾淨 checkout 開始。
if [ ! -f packages/core/dist/index.d.ts ]; then
  check "paypal 前置：建置 core（@pbp/core 的 dist）" bash -c 'npm --prefix packages/core run build --silent'
fi

check "paypal 單元測試（請求組裝・狀態對照全表・token 快取・同鍵重試・缺憑證不發請求）" bash -c 'npm --prefix packages/paypal test --silent'
check "paypal 型別檢查（src + test + scripts/spike.ts）" bash -c 'npm --prefix packages/paypal run typecheck --silent'
check "paypal 建置（dist + .d.ts）" bash -c 'npm --prefix packages/paypal run build --silent && test -f packages/paypal/dist/index.d.ts'

# HTTP 只能用 Node 內建 fetch：依賴就是 core 一個，沒有 HTTP 庫、沒有 PayPal SDK。
check "paypal 依賴只有 @pbp/core" bash -c 'node -e "const d=Object.keys(require(\"./packages/paypal/package.json\").dependencies||{}).sort().join(\",\");if(d!==\"@pbp/core\"){console.error(d);process.exit(1)}"'

# AC-7 (b) + (e)：一筆真的 SUCCESS，再同一個 sender_batch_id 送一次，PayPal 那邊仍只有那一筆。
# 要真沙箱憑證（.env 的 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET），所以放在 need_local。
need_local "paypal 沙箱快速實測（(b) 一筆 SUCCESS ＋ (e) 重複鍵不重付）" bash -c '
  out=$(mktemp -d)
  npm --prefix packages/paypal run spike --silent -- --quick --out "$out/quick.md"
  status=$?
  rm -rf "$out"
  exit $status
'
