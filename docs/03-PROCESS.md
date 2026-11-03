# 03-PROCESS：过程打卡与稽核表

> Public snapshot note: the reference thumbnails (`ruler/`), the blind-ranking artefacts (`rank/`) and the internal ticket-by-ticket build logs (`docs/process/`, `docs/friction/`) are not published in this repository. Everything else in this file is as written.


> 施工票每完成一步就在本票那一行填上；稽核票只在文末「稽核表」写判定，不改上面的打卡。

## 每票打卡

索引列：一行一票，指向該票的過程文件與 PR；內容不抄，逐條證據看 `docs/process/Tn.md`。

| 票 | 验收条件 | 测试文件 | 测试先失败（输出摘要） | 实现 PR | 全量验证（输出摘要） | 合并确认（`gh pr view` 结果） |
| --- | --- | --- | --- | --- | --- | --- |
| T1（偵察，不在本次稽核範圍） | `docs/process/T1.md` §1 | 不適用（偵察票） | 不適用 | #5 #7 #12 #17 | `docs/process/T1.md` §4 | 四個 PR 均 `MERGED`（T1 §5） |
| T2 | `docs/process/T2.md` §1（3 條） | `packages/core/test/` 7 檔；返工輪 `test/rework-1.test.ts` | 首輪 11 failed / 77（已實作）；返工輪 14 failed / 16（先紅） | #3 #8 #9 | core 111 passed、typecheck/build exit 0、`verify.sh` ALL PASS（T2 §4） | #3 `MERGED` 2026-10-22T14:13:11Z；#8 `MERGED` 2026-10-22T14:40:20Z |
| T3 | `docs/process/T3.md` §1（3 條） | `demo/generator/src/check.ts` 四個閘（由 `scripts/verify.d/15-demo.sh` 載入） | 只有負控制（移走 PDF 讓閘紅），§6 第 5 條自認非先紅 | #4 | `verify.sh` ALL PASS（T3 6 條）；`TZ=UTC/New_York/Tokyo` 重跑位元組相同（T3 §4） | #4 `MERGED` 2026-10-22T14:19:41Z |
| T4 | `docs/process/T4.md` §1（4 條） | `apps/web/src/state/reduce.test.ts`（16 支）＋截圖腳本三項斷言 | 首跑 3 failed / 13 passed（已實作） | #10 #11 #13 #14 | `verify.sh` ALL PASS；7 張截圖斷言全過（T4 §4） | #10 `MERGED` 2026-10-22T14:58:04Z；#13 `MERGED` 15:09:20；#14 `MERGED` 15:14:41 |
| T5 | `docs/process/T5.md` §1（3 條） | `packages/paypal/test/` 6 檔（現 51 支） | 六檔在 `src/index.ts` 未存在時全紅（T5 §2a） | #30 #31 #33 | 單元 51 passed、typecheck/build exit 0、`verify.sh`（含 need_local）ALL PASS（T5 §4） | #30 `MERGED` 2026-10-29T08:17:49Z；#31 `MERGED` 2026-10-29T13:40:25Z |
| T6 | `docs/process/T6.md` §1（6 條） | `packages/agent/test/` 8 檔（現 89 支） | 首跑 6 failed / 43 passed（已實作）；第 2 輪 23 failed / 38（退回舊 src） | #23 #24 #26 #27 | 89 passed、typecheck exit 0、`verify.sh` ALL PASS；AC-8 9/9 ×3、AC-10 9/9 ×3（T6 §4、§7.4） | #23 `MERGED` 2026-10-22T17:16:49Z；#26 `MERGED` 2026-10-22T17:47:57Z |
| T7 | `docs/process/T7.md` §1（2 條） | `apps/server/test/`（現 11 檔 65 支） | 不是先紅（T7 §2 開頭自認）；三盞紅燈是實作後跑出 | #18 #19 #21 #22 | 49 passed（現 65）、typecheck/build exit 0、`verify.sh` ALL PASS（T7 §4） | #18 `MERGED` 2026-10-22T16:45:44Z；#21 `MERGED` 2026-10-22T17:14:20Z |
| T8 | `docs/process/T8.md` §1（8 條） | `apps/server/test/`、`apps/web/e2e/*`、`apps/web/src/state/reduce.test.ts` | 紅燈是反向驗證與 E2E 缺陷（T8 §2 a–e），非先紅 | #34 #35 #36 #37 #38 #39 #41 | 分段 7 段各 `ALL PASS`；完整復驗 55/56（AC-14 沙箱額度），換帳號補跑 AC-14＋截圖 PASS（T8 §7.7–§7.8） | #34 `MERGED` 2026-10-29T16:23:38Z；#38 `MERGED` 2026-10-30T02:46:39Z；#41 `MERGED` 2026-10-30T04:59:39Z |
| T12（包裝） | `docs/process/T12.md` §1（5 條；第 5 條盲排是主控的活） | `scripts/verify.d/95-submission.sh`（封面比例、圖庫上限、表單欄位、金鑰佔位符、公開網址、LICENSE） | 三個負控制各紅一次（封面尺寸／缺 Built with／影片連結指回私有倉庫）；本票產物由 AME-1152 打樣，不是先紅 | #49 | 匿名 clone：`npm run setup` exit 0；`verify.sh --ci` 52 PASS / 10 SKIP / 0 FAIL、exit 0；README 14 個連結匿名可開；ffprobe 135.7 s；公開與私有 Release 的 mp4 sha256 相同 | #49 `MERGED` 2026-11-03T04:33:09Z（4947824） |

## 稽核表

> 稽核日期：2026-11-01 · 稽核依據：AGENTS.md 第 4.5 節（六問）＋本票加的一欄「文件衛生」。
> 判法一（測試先行）：每個 PR 都 squash 成一個 commit，測試檔與實現檔在同一個 commit，`git log` 分不出先後（`git log --oneline` 一票一行）。所以照任務書的另一半證據判——`docs/process/Tn.md` 第 2 節的紅燈，紅的原因必須是「功能還沒實現」（AGENTS §4.2 第 2 步），不是實作寫完才跑出來的缺陷；負控制與事後退回舊版都記為「不是先紅」。
> 判法二（PR）：一律由本票自己跑 `gh pr view <號> --json state,mergedAt`，不採信評論與 process 文件的自述；檔案清單用 `gh pr diff <號> --name-only`（與 `--json files` 對過，一致）。
> 判法三（判定）：六欄＋衛生欄全部 PASS 才判 PASS；第 5、6 欄（造假、密鑰）單獨回答交付物的真假，不受其他欄牽連。
> 本票自己重跑：`packages/core` 111、`packages/paypal` 51、`packages/agent` 89、`apps/server` 65、`apps/web` 20，全數 passed；`bash scripts/verify.sh --ci` → 48 PASS、8 SKIP（need_local）、exit 0。

| 票 | 证据齐 | 测试先行且通过 | PR 已合并 | 无范围外改动 | 无造假 | 无密钥 | 文件卫生 | 判定 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T2 | PASS | **FAIL** | PASS | PASS | PASS | PASS | **FAIL** | FAIL（流程） | G1 G2 |
| T3 | PASS | **FAIL** | PASS | PASS | PASS | PASS | PASS | FAIL（流程） | G3 |
| T4 | PASS | **FAIL** | PASS | PASS | PASS | PASS | PASS | FAIL（流程） | G4 |
| T5 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | — |
| T6 | PASS | **FAIL** | PASS | PASS | PASS | PASS | PASS | FAIL（流程） | G5 |
| T7 | PASS | **FAIL** | PASS | PASS | PASS | PASS | PASS | FAIL（流程） | G6 |
| T8 | **FAIL** | **FAIL** | PASS | PASS | PASS | PASS | **FAIL** | FAIL（流程＋文件） | G7 G8 G9 G10 |

### 逐格證據

**T2**
- 证据齐 · PASS：§1 三條逐條對上 §4 的表——8 個測試檔 111 支（含返工輪的 `rework-1`）、AC-1 八案全等 golden、AC-9(a)(b)、typecheck/build exit 0、全新 clone `npm run setup`、`verify.sh` ALL PASS。
- 测试先行且通过 · FAIL：§2 首跑 11 failed / 77，實作已存在；§6 第 1 條自認「不是嚴格的測試先行」。返工輪 `test/rework-1.test.ts` 確有 14 紅先於修法（G1）。
- PR 已合并 · PASS：`gh pr view 3` → `MERGED` 2026-10-22T14:13:11Z（47812b2）；`gh pr view 8` → `MERGED` 2026-10-22T14:40:20Z（a73f923）；#9 文件 PR `MERGED` 14:41:30。
- 无范围外改动 · PASS：`gh pr diff 3 --name-only` 43 檔全在 `packages/core/**`、根 `package.json`、`.nvmrc`、`scripts/setup.mjs`、`scripts/verify.d/10-core.sh`、`docs/process/T2.md`、`docs/friction/T2.md`；#8 的 11 檔同一範圍。
- 无造假 · PASS：`packages/core/src` 沒有情境字面值（唯一的 `studi0` 在 `risk.ts:78` 的註解）；`vectors/golden.json` 只當測試向量，`scripts/build-vectors.mjs` 對不上就拒寫。
- 无密钥 · PASS：見註 A。
- 文件卫生 · FAIL：`docs/process/T2.md:186` 寫了執行機的暫存目錄路徑（不含使用者名）（G2）。

**T3**
- 证据齐 · PASS：AC-6 拆成 6 個閘（`scripts/verify.d/15-demo.sh`），§4 ALL PASS；結論評論附 A/B/C 三張版式 PNG（AME-911 附件 `Nair-Words-INV-2026-118.png`、`kenji-INV-0153.png`、`StudioNorth-INV-2207.png`）；`proof/dataset/` 7 張 1240px。
- 测试先行且通过 · FAIL：§2 只有負控制（把 `demo/inbox/files/kenji-INV-0142.pdf` 移走讓閘紅），§6 第 5 條自認「生成器與閘在同一輪寫成」（G3）。
- PR 已合并 · PASS：`gh pr view 4` → `MERGED` 2026-10-22T14:19:41Z（f1e1659）。
- 无范围外改动 · PASS：48 檔全在 `demo/generator/**`、`demo/inbox/**`、`demo/history/**`、`proof/dataset/**`、`scripts/verify.d/15-demo.sh`、兩份 docs。
- 无造假 · PASS：17 個產物由 `scenario.json` / `inbox-content.json` 生成，`regen` 連跑兩次位元組相同；PDF 文字層用 unpdf 逐張抽取斷言。
- 无密钥 · PASS：見註 A。
- 文件卫生 · PASS：`T3.md` / `friction/T3.md` 在註 C 的掃描裡 0 命中。

**T4**
- 证据齐 · PASS：結論評論第 1 節「規格 → 實作位置 → 截圖可見」逐列、第 2 節 §4.6 衛生清單逐條、7 張 PNG 附件齊；`screenshots.ts` 每張三項斷言全過、`verify.sh` ALL PASS。
- 测试先行且通过 · FAIL：§2 首跑 3 failed / 13 passed，`reduce.ts` 已存在；紅的是實作缺陷（錯誤態用到 `int_01`、Leo 兩個 hold 只生一個動作）與一條測試期望值寫錯，不是「功能還沒實現」（G4）。
- PR 已合并 · PASS：`gh pr view 10` → `MERGED` 2026-10-22T14:58:04Z（9b8550d）；#13 `MERGED` 15:09:20；#14 `MERGED` 15:14:41。
- 无范围外改动 · PASS：#10 38 檔、#13 5 檔、#14 7 檔，全在 `apps/web/**`、`design/fonts/**`、`scripts/verify.d/40-web.sh`、`proof/ui/**`、`docs/process/T4.md`；沒有改 `design/tokens.css`。
- 无造假 · PASS：設計夾具只在 `?fixture=design`（`apps/web/src/App.tsx:22`：`if (fixture !== 'design') return <LiveApp />`），夾具 id 用一眼示意的 `DEMO-BATCH-…`；這是 SPEC §7 允許的唯一 mock。
- 无密钥 · PASS：見註 A。
- 文件卫生 · PASS：註 C 掃描 0 命中。

**T5**
- 证据齐 · PASS：AC-7 (a)–(f) 在 `docs/research/paypal-sandbox-spike.md`；(d) 依 SPEC v1.7（PR #32 / `fa2c9b3`）改判為「拒絕即照實處理」；§4 兩段 `verify.sh`（含 need_local）ALL PASS；憑證值比對兩條都是 `0`。
- 测试先行且通过 · PASS：§2(a) 六個測試檔（49 支）在 `src/index.ts` 還不存在時跑，6 檔全紅（`Cannot find module '../src/index.js'`），之後才寫實作；§2(c) 另有反向檢查（拿掉重複鍵分支 → 6 紅）。
- PR 已合并 · PASS：`gh pr view 30` → `MERGED` 2026-10-29T08:17:49Z（6a40fd7，第一段 draft）；`gh pr view 31` → `MERGED` 2026-10-29T13:40:25Z（32c0f54）。
- 无范围外改动 · PASS：#30 34 檔、#31 24 檔，全在 `packages/paypal/**`、`docs/research/paypal-sandbox-spike.md`、`scripts/verify.d/20-paypal.sh`、`docs/process/T5.md`、`docs/friction/T5.md`。
- 无造假 · PASS：回執只走 GET——`fetchReceipt` 先 `findItem()` 再讀 `transaction_status` / `transaction_id`，回 `source: 'rail_get'`（`packages/paypal/src/rail.ts:146`）；core 的 replay 對「不是 SUCCESS + 交易號 + `rail_get`」的 proven 回執記錯誤、不採信（`packages/core/src/ledger.ts:399`）；夾具每支 `_source` 寫出處，沙箱產不出來的兩支標 `official-doc-sample-retained`。
- 无密钥 · PASS：見註 A；§4 的「比對真值」兩條命令都回 `0`。
- 文件卫生 · PASS：註 C 掃描 0 命中。

**T6**
- 证据齐 · PASS：AC-8 9/9 ×3（`proof/ai/extract-run-{1,2,3}`）；AC-10 九則 ×3 全 `model` PASS、`int_04` 風險說明 137/134/134 字元；AC-14 乾跑 6/8、`missing` 照實列；§4 與 §7.4 兩輪 `verify.sh` ALL PASS；結論評論附 4 個 summary／dry-run 檔。
- 测试先行且通过 · FAIL：§2 首跑 6 failed / 43 passed，實作已存在；第 2 輪 §7.2 的 23 紅是把 `src/` 退回到舊版「事後構造」的，不是本輪先紅（新測試確實先於新實作，記下）（G5）。
- PR 已合并 · PASS：`gh pr view 23` → `MERGED` 2026-10-22T17:16:49Z（9f401b9）；`gh pr view 26` → `MERGED` 2026-10-22T17:47:57Z（6c22df7）。
- 无范围外改动 · PASS：#23 93 檔、#26 31 檔，全在 `packages/agent/**`、`proof/ai/**`、`scripts/verify.d/30-agent.sh`、兩份 docs。
- 无造假 · PASS：`grep -rn golden packages/agent/src` 0 命中——沒有「把輸出改成 golden」的後處理；`scripts/eval.ts` 只印差異（檔頭註解第 10 行：「Nothing here "fixes" a value toward golden」）；`FIXTURE-TXN-0142` 是主控批准、`summary.json` 標 `fixture: true` 的夾具。
- 无密钥 · PASS：見註 A。
- 文件卫生 · PASS：註 C 掃描 0 命中。

**T7**
- 证据齐 · PASS：§1 兩條——11 檔 49 支整合測試（含 `kill -9` 子進程、SSE、bundle schema、缺憑證不發請求）；§4 `verify.sh` ALL PASS。
- 测试先行且通过 · FAIL：§2 開頭自認「實作與測試在同一輪內交替完成（不是嚴格的測試先行）」；三盞紅燈（`demo:reset` 409、兩個 `run.completed`、`minItems`）都是實作寫完才跑出來的缺陷（G6）。
- PR 已合并 · PASS：`gh pr view 18` → `MERGED` 2026-10-22T16:45:44Z（336b357）；`gh pr view 21` → `MERGED` 2026-10-22T17:14:20Z（4a2bf4b）。
- 无范围外改动 · PASS（有一處已追認）：#18 37 檔在 `apps/server/**`、`schemas/**`、根 `package.json`、`scripts/verify.d/50-server.sh` 內；範圍外只有根 `.gitignore` 兩行（`/data/`、`apps/server/data/`）——主控驗收 T7 時追認：SPEC §6.3.1 規定 `data/` 不進 Git，這兩行防帳本與 `data/history.json` 被誤提交（PR #18 + 該條裁定），不算未經批准。#21 6 檔同範圍。
- 无造假 · PASS：整合測試用 `test/fakes.ts` 的假軌道／假 agent，SPEC §7 明文允許；金額、狀態、合計全由 core 的 `replay` 算，server 不自算第二份；三處 SPEC 原本沒寫的行為（同一次嘗試 `payment.submitted` 兩行、`history.seeded` 交易號不在鏈上、時鐘錨定 `testClock`）已由 SPEC v1.3（PR #20）補寫，稽核以 v1.3 為準。
- 无密钥 · PASS：見註 A。
- 文件卫生 · PASS：註 C 掃描 0 命中。

**T8**
- 证据齐 · FAIL（一項半）：§1 八條裡，AC-11～AC-14、AC-15、AC-17、AC-10 複核、D1-11/12 都有 `proof/e2e/` 或截圖；AC-16 只做到「截圖全部由真實運行產出」，後半「§4.6 衛生清單逐條自查」在 `docs/process/T8.md` 與 AME-904 的兩條結論評論都找不到（G8）。第 4 條 `verify.sh` 照主控裁定記：分段 7 段各 `ALL PASS`，完整復驗 55/56、唯一 FAIL 是 AC-14 沙箱額度，換備用沙箱帳號後補跑 AC-14 與截圖皆 PASS，不算缺證據。
- 测试先行且通过 · FAIL：§2(a) 是「把已寫好的判定拿掉再跑」的反向驗證，(b)(c)(d) 是 E2E 跑出來的缺陷，(e) 是改動後的舊斷言紅；沒有「測試寫好、功能還沒寫」的紅燈（G7）。
- PR 已合并 · PASS：`gh pr view 34` → `MERGED` 2026-10-29T16:23:38Z（04433c1）；#35 `MERGED` 16:24:14；#36 `MERGED` 16:25:59；#37 `MERGED` 2026-10-30T02:13:48；#38 `MERGED` 02:46:39（b3f5774）；#39 `MERGED` 02:47:44；#41 `MERGED` 04:59:39（a373fb9）。
- 无范围外改动 · PASS（全部已追認）：第 2 輪——`.gitignore`、`scripts/dev.mjs`、`scripts/verify.sh`、`apps/server/tsconfig.json`、`apps/server/src` 裡 `main.ts` 以外的檔；第 3 輪——`packages/agent/src/comparison.ts` 與它的測試、`scripts/verify.d/40-web.sh`、新增的 `scripts/verify.d/70-screenshots.sh`。另 `apps/server/test/fakes.ts`、`run.test.ts` 是任務書明確允許的兩支整合測試的支援檔與 §6 第 6 條已披露的斷言調整，照實記下。
- 无造假 · PASS：11 張截圖全部來自真實運行（§4.7 的 URL 沒有 `?fixture=design`）；抽查 `proof/ui/hero-done-1280x720.png`，頁腳是「Ledger verified · 80 events」、Proof log `event #39`——設計夾具那一版是 61 events（T4 結論評論原文），這一張不是夾具版；設計夾具仍只在 `?fixture=design`。
- 无密钥 · PASS：見註 A。
- 文件卫生 · FAIL：`docs/process/T8.md:579`、`:582` 直接寫出憑證檔的位置與保管庫名（`:96` 另提同一檔名）；`proof/e2e/verify-run3.log:75` 帶執行機的本機絕對路徑（G9、G10）。

### 缺口明細（只寫，不補）

- **G1 · T2 測試先行（首輪）**：缺的是「先寫測試、因功能還沒實現而紅」的紀錄。在哪：`docs/process/T2.md` §2 的 11 紅是實作寫完才跑的、§6 第 1 條自認；PR #3 把測試與實作放在同一個 squash commit，`git log` 分不出先後。怎麼補：新票先提交測試、貼紅燈輸出，再落實作；本票的返工輪已示範一次（`rework-1.test.ts` 14 紅）。
- **G2 · T2 文件衛生**：`docs/process/T2.md:186` 寫了執行機的暫存目錄。缺的是中性寫法（不含本機路徑）。怎麼補：改成 `<fresh dir>`，公開快照前處理。
- **G3 · T3 測試先行**：缺的是先紅的紀錄。在哪：`docs/process/T3.md` §2 是負控制（移走 PDF 才讓閘紅）、§6 第 5 條自認同輪寫成。怎麼補：先寫 `demo/generator/src/check.ts` 的閘、在產物不存在時跑紅，再產資料。
- **G4 · T4 測試先行**：缺的是「功能還沒實現」的紅燈。在哪：`docs/process/T4.md` §2 首跑 3 failed / 13 passed，`reduce.ts` 已在，紅的是缺陷與一條測試期望值寫錯。怎麼補：先提交 `reduce.test.ts`，在 `reduce.ts` 是空殼時跑紅。
- **G5 · T6 測試先行**：缺的是首輪先紅。在哪：`docs/process/T6.md` §2 首跑 6 failed / 43 passed；§7.2 的 23 紅是把 `src/` 退回舊版才得到的。怎麼補：測試目錄先合入、`src/` 後合入，各留一次輸出；第 2 輪的做法（新測試 + 舊 src = 紅）可以照抄成標準做法。
- **G6 · T7 測試先行**：缺的是先紅。在哪：`docs/process/T7.md` §2 開頭自認非嚴格 TDD；三盞紅燈都發生在實作寫完之後。怎麼補：先寫三支整合測試、對空 runner 跑紅，再寫 `runner.ts`。另建議（T7 §6）：把「catch 分支裡的外部動作失敗路徑」列為專核，本輪的缺陷都在 catch 之後。
- **G7 · T8 測試先行**：缺的是先紅。在哪：`docs/process/T8.md` §2(a) 反向驗證、(b)(c)(d) E2E 缺陷、(e) 舊斷言。怎麼補：接線前先提交 `apps/web/e2e/*` 與新增整合測試，貼一次全紅，再落實作。
- **G8 · T8 AC-16 自查（半項）**：缺的是 `AGENTS.md` §4.6 衛生清單的逐條自查。在哪：`docs/process/T8.md` 與 AME-904 兩條結論評論都沒有這張表（只有「截圖都來自真實運行」）。怎麼補：照 T4 結論評論第 2 節的格式逐條列 PASS／證據，主控判 D 分時直接用。
- **G9 · T8 文件衛生（密鑰檔位置）**：`docs/process/T8.md:579` 寫了憑證檔的位置與保管庫名、`:582` 寫了同一條 `cp` 命令、`:96` 提同一檔名。缺的是中性描述。怎麼補：改成「主控換了備用沙箱帳號，鍵名與 `PBP_RECEIVER_MAP` 相同」。
- **G10 · 公開前待清（跨票，proof/）**：`proof/e2e/verify-run3.log:75` 帶執行機的本機絕對路徑（含使用者名）。來源是 `apps/server/src/main.ts:82` 啟動時印出 web 目錄的絕對路徑。`proof/` 底下同類行只有這 **1** 行（家目錄前綴、憑證檔目錄、私有 IP、`file://` 等寫法都是 0）。怎麼補：`main.ts` 改印相對路徑，或重跑前把該行刪掉；T12 轉公開快照之前必須清完。

### 註

- **註 A · 密鑰掃描（六欄的第 6 欄用這一份）**：`git log -p | grep -icE "api[_-]?key|secret|token|password"` → **587**，逐類看過全部是環境變數鍵名、讀取 `access_token` 的程式行、去敏正則與測試佔位值（`test-client-secret`、`TOKEN-ONE`）。值形狀掃描 `git log -p | grep -inE "sk-[A-Za-z0-9]{20,}|A21AA[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{25,}|Basic [A-Za-z0-9+/]{30,}={0,2}"` → 只命中文件佔位值 `A21AA-DOC-SAMPLE-TOKEN-NOT-A-CREDENTIAL`（夾具、測試斷言、process 文件的自引用）。`git log --all --diff-filter=A -- .env` → 0，`.env` 從未進 Git，現在也沒有被追蹤；`.gitignore` 有 `.env`、`.env.*`、`!.env.example`（`.env.example` 例外）與 `/data/`、`apps/server/data/`。
- **註 B · PR 檔案清單**：逐票跑 `gh pr diff <號> --name-only | wc -l` 與 `gh pr view <號> --json files`，兩邊一致（最大 #23 93 檔）。
- **註 C · 文件衛生掃描**：`grep -rnE "<家目錄前綴>|/home/|C:\\\\|<憑證檔目錄>|\.internal" docs/process docs/friction docs/research` → 只有 T8 三行（`:96`、`:579`、`:582`）；另用 `grep -rn "/tmp" docs/process` 找到 T2 的 `:186`（暫存目錄，不含使用者名）。`docs/friction/**` 與 `docs/research/**` 0 命中。
- **註 D · 判定與交付物的關係**：6 票判 FAIL 的原因全在「測試先行」與「文件衛生」，加上 T8 的 AC-16 自查缺一項。第 5 欄（造假）與第 6 欄（密鑰）七票全 PASS：PayPal 回執只認 GET、AI 輸出沒有往 golden 修值、設計夾具只在 `?fixture=design`、歷史裡沒有可用憑證。閘 B 的答案是「流程沒有全程走完（測試先行 6/7 票不符），交付物本身沒有造假、沒有未合併、沒有密鑰」。
