# @pbp/server — HTTP API、SSE、帳本檔與運行器

SPEC §6.7 的實作。這一包**不碰**界面、不碰 PayPal 的 HTTP、也不碰模型；它把 agent 與軌道當成兩個介面
組裝起來，錢出不出門由 `@pbp/core` 的閘決定。

```bash
cd apps/server
npm ci
npm test          # 整合測試：假軌道＋假 agent（SPEC §7）
npm run typecheck
npm run build     # dist/，T8 的 main.ts 與 scripts/reset.mjs 都吃這個
```

## 一、接了誰

| 介面 | 來源 | 契約 |
| --- | --- | --- |
| `RailAdapter` | `@pbp/core` | `submit` / `fetchReceipt` / `cancel` / `mapStatus`（`packages/core/README.md`） |
| `AgentPort` | `src/types.ts` | `processItem` / `explainIntent` / `summarize` / `runComparison` |

`AgentPort` 是 SPEC §6.6.2 的六步裡屬於「模型那一半」的切片：分類抽取、合約匹配、風險說明、解釋、總結、
對照模式。`packages/agent`（T6）合併後若形狀不同，改的是 `src/types.ts` 與呼叫端，**不改閘**。

`processItem` 回 `ItemOutcome`：分類、抽取出的 `Claim`、變更收款人的請求、風險旗標與說明、以及提議
（`agreementId` + `agreementMatchedBy` + `rationale`）。它**不回決定**——決定是 `core.evaluate` 給的。

## 二、端點（SPEC §6.7）

| 方法 | 路徑 | 行為 |
| --- | --- | --- |
| GET | `/` | 伺服器資訊（T8 之後改為同源代理 `apps/web`） |
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/state` | 投影快照：`epoch`、`head`、`ledger{verified,…}`、`run{phase,…}`、`inbox[]`、`vendors[]`、`intents{}`、`byItem{}`、`totals{}`、`ignored{count}`、`errors[]` |
| GET | `/api/events?since=<seq>` | SSE，`event: ledger`，`data` 是 `LedgerEvent`；`since` 之後的依序補送再轉直播 |
| POST | `/api/runs` `{mode}` | `{runId}`。同時只允許一個；`mode: "comparison"` 還要 `PBP_ALLOW_COMPARISON=1` |
| GET | `/api/intents/:id/bundle` | 證明包（AC-15），回應前先過 `schemas/proof-bundle.schema.json` |
| POST | `/api/intents/:id/actions` | `{action, input, by}` → 200 / 409（人話） |
| GET | `/api/inbox/:itemId/files/:name` | 原件（PDF）；只送該封信附件清單裡有的檔 |
| POST | `/api/demo/reset` | 新 epoch、清帳本、經軌道付掉 `hist_kenji_0142`，proven 才回 200 |
| GET | `/api/comparison/state` | 對照模式帳本的畫面狀態（`payouts[]`、`summary`、`verified`） |

`inbox[]` 的每筆同時給 `attachments: string[]`（檔名，對齊 `apps/web` 的 `InboxSeedItem`）與
`files: [{name, sha256, url}]`。

## 三、資料檔（`PBP_DATA_DIR`，預設根目錄 `data/`，不進 Git）

| 檔 | 內容 |
| --- | --- |
| `ledger.jsonl` | 主帳本。每行一個 `LedgerEvent`，雜湊鏈接上一行 |
| `comparison.jsonl` | 對照模式帳本，只有 `comparison.*` 三種事件；主帳本完全不受影響 |
| `history.json` | `demo:reset` 種下的歷史付款（batch / item / transaction id）。**不在雜湊鏈裡**——權威是 PayPal 自己的紀錄 |

啟動時：`verifyChain` → `replay` → 重建人工操作疊層 → 續跑未完成的 run（見第六節）。鏈壞掉就拋錯，不靜默吞。

## 四、幾個實作上的決定（T8 接手前請先讀）

1. **時鐘**：預設用 `scenario.testClock` 為錨、隨真實時間往前走（`src/clock.ts`）。理由：情境是 2026 年
   11 月的虛構週五，附件交付日是 11-02～11-05；用牆上時鐘跑會讓所有交付「在未來才驗收」，
   O3 一律 hold，AC-11 不可能過。要換成牆上時鐘傳 `clock: wallClock()`。
2. **`payment.submitted` 寫兩次**：第一次在呼叫軌道**之前**（`payoutBatchId: null`），第二次在 PayPal
   回應之後把 batch id 補上。沒有第二次，重啟後只知道「送過」卻不知道要問哪個批次；兩次都走
   狀態機的 `submitted → submitted`。
3. **種歷史不建 live intent**：`history.seeded` 只有三個欄位（SPEC §6.3.2），種下的付款**不**進
   intent 投影——否則 `replay` 的合計會多一筆 115000，對不上 `golden.totalsAfterRun`。交易號在
   `history.json`，O4 與證明包都從那裡讀。
4. **重啟會續跑**：啟動時若帳本裡最後一個 `run.started` 沒有對應的 `run.completed`，先恢復在途意圖
   （有 batch id 就 GET；`payoutBatchId: null` 就走 §6.5.2 同鍵重送），再把這一輪跑完——不會另開新 run。
5. **斷線尾行**：`kill -9` 可能留下半行 JSON。`LedgerFile.load()` 只丟掉**最後一行**的不完整寫入並把檔案
   重寫乾淨；其他任何一行壞掉都當帳本損壞拋錯。
6. **憑證**：`POST /api/runs` 先檢查 `PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`LLM_API_BASE`、
   `LLM_API_KEY`、`LLM_MODEL`（空字串算未設），缺就 400 且不發任何請求（AC-17）。`PAYPAL_ENV` 只接受
   `sandbox`。
7. **對照模式的送出**：每次送出一樣寫兩行 `comparison.payout_sent`（先 null、後補 batch id），
   `GET /api/comparison/state` 以 `toolCallId` 取最後一筆。

## 五、T8 要接什麼

`src/main.ts` 還沒寫（本票允許：`@pbp/paypal`／`@pbp/agent` 當時尚未合併）。T8 的最小接法：

```ts
import { readDotEnvFile, loadConfig, startServer } from '@pbp/server';
import { createPayPalRail } from '@pbp/paypal';   // T5 的工廠（實際名字以該包為準）
import { createAgent } from '@pbp/agent';         // T6 的工廠

const env = { ...readDotEnvFile('.env'), ...process.env };
const server = await startServer({ config: loadConfig({ env }), rail: createPayPalRail(env), agent: createAgent(env) });
```

`scripts/reset.mjs` 已經按這個形狀寫好（找不到工廠就退出並列出 `@pbp/paypal` 的匯出），T8 只需要讓那個
工廠存在。`GET /` 目前回 JSON；T8 改成同源代理 `apps/web` 的建置產物即可。

## 六、測試（`test/`）

| 檔 | 證什麼 |
| --- | --- |
| `run.test.ts` | 一輪完整運行：合計、逐項狀態、九項檢查、帳本鏈、證明包、原件下載 |
| `human-steps.test.ts` | `golden.humanSteps` 1–4 依序、每步結果、P1/P2 未解除時 approve 409 |
| `disconnect.test.ts` | 假軌道「已收錢、回應丟失」→ 同鍵重試 → 每鍵只付一次（AC-13a） |
| `restart.test.ts` | 子進程跑到第一個 `payment.submitted` 就 `kill -9`，重啟續完、結果等於 golden（AC-13b） |
| `comparison.test.ts` | 對照模式預設 403、開啟後送出的收款人與金額等於 golden、主帳本不動 |
| `sse.test.ts` | 事件順序、`seq` 連續、`?since=` 不重播 |
| `credentials.test.ts` | 缺憑證 400＋人話、零外部請求、空字串視為未設 |
| `bundle-schema.test.ts` | schema 會拒絕壞掉的證明包（不是只會點頭） |
| `ledger-recovery.test.ts` | 尾行截斷可恢復、中間壞行拋錯、改一行報對 seq |

假軌道（`test/fakes.ts`）寫檔：重啟測試要跨進程看到「PayPal 那邊」的狀態，也才能在測試裡斷言
每個 `sender_batch_id` 只產生過一筆付款。
