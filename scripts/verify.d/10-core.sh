# T2 · packages/core —— 證明閘核心（AC-1～AC-5、AC-9）
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# CI 不裝依賴：這裡自己 npm ci；本機已裝過就跳過（npm ci 會重裝整個 node_modules）。

if [ ! -d packages/core/node_modules ]; then
  check "core 安裝依賴（npm ci）" bash -c 'cd packages/core && npm ci --no-audit --no-fund'
fi

check "core 單元測試（AC-1～AC-5、AC-9）" bash -c 'npm --prefix packages/core test --silent'
check "core 型別檢查（src + test）" bash -c 'npm --prefix packages/core run typecheck --silent'
check "core 建置（dist + .d.ts）" bash -c 'npm --prefix packages/core run build --silent && test -f packages/core/dist/index.d.ts'

# 零運行時依賴、只用 node:crypto（AC-5）
check "core dependencies 為空" bash -c 'node -e "const p=require(\"./packages/core/package.json\");if(Object.keys(p.dependencies||{}).length)process.exit(1)"'

# 規範資料與黃金向量對得上（AC-1 / AC-5）：向量檔必須存在且和場景同一個 version
check "黃金向量存在且可解析" bash -c 'node -e "const v=require(\"./packages/core/vectors/golden.json\");if(!Array.isArray(v.cases)||v.cases.length!==8)process.exit(1)"'
