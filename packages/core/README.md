# @pbp/core — 證明閘核心

Proof Before Pay 的心臟：**LLM 提議，閘來決定**。agent 可以把任何一張發票讀成任何樣子、
可以在郵件裡被寫給 AI 的指令騙走，但錢出不出門由這裡的九項檢查決定，由這裡的狀態機記錄，
由這裡的雜湊鏈帳本留下無法默默改寫的歷史。

這一包刻意做成可搬的模組：零運行時依賴（`dependencies` 為空）、只用 `node:crypto` 一個內建模組、
不碰網路、不碰檔案系統、不讀牆上時鐘（時間一律由呼叫方以 `now` 傳入）。之後要搬去 Airwallex、
PAYATHON 那一類「agent 動錢」的賽道時，換的是軌道介面卡，不是這一包。

- 規範來源：`docs/01-SPEC.md` §6.2–§6.3、§6.5.3；情境資料：`demo/scenario/*.json`。
- 對拍向量：`vectors/golden.json`（換語言重寫時直接拿它比）。
- 測試：`npm test`（vitest）；`npm run typecheck`；`npm run build` 產 `dist/`。

## 九項檢查

三枚印章、九項檢查。印章顯示該組最壞的狀態，`fail > hold > pass`。

| 印章 | 檢查 | 問題 | 通過 / 待查 / 擋下 |
| --- | --- | --- | --- |
| Owed | O1 | 認得這個供應商嗎 | `VENDOR_MATCHED` / `UNKNOWN_VENDOR` / — |
| Owed | O2 | 有合約、金額對得上嗎 | `AMOUNT_MATCHES` / `NO_AGREEMENT`·`CURRENCY_MISMATCH`·`AMOUNT_MISMATCH`·`OVER_CAP` / — |
| Owed | O3 | 交付驗收了嗎 | `DELIVERY_ACCEPTED` / `NOT_ACCEPTED` / — |
| Owed | O4 | 付過了嗎 | `NOT_DUPLICATE` / — / `DUPLICATE` |
| Payee | P1 | 收款人是核驗過的那個嗎 | `PAYEE_VERIFIED` / `PAYEE_MISMATCH` / — |
| Payee | P2 | 有沒有未核實的改帳戶請求 | `NO_CHANGE_REQUEST` / `CHANGE_REQUEST_PENDING` / — |
| Policy | L1 | 單筆額度 | `WITHIN_LIMIT` / `OVER_LIMIT` / — |
| Policy | L2 | 當日額度 | `WITHIN_DAILY_LIMIT` / `OVER_DAILY_LIMIT` / — |
| Policy | L3 | 新供應商首付額度 | `VENDOR_ESTABLISHED`·`NEW_VENDOR_WITHIN_LIMIT` / `NEW_VENDOR_OVER_LIMIT` / — |

決策：任一 `fail` → `blocked`；否則任一 `hold` → `held`；否則 `approved`。
`O1` 不通過時，`O2`、`O3`、`P1`、`P2`、`L3` 記 `na`（沒有供應商就沒有合約、沒有收款人可核）。

`O1` **不採信** `claim.vendorId`（那是 LLM 抽出來的，可能是偽造的）：依序用寄件人電郵完全相等、
PO 對到的合約、供應商名稱（不分大小寫）解析；解析結果與 claim 不同時以解析結果為準，並在
`facts.claimedVendorId` 記下 claim 原本的值。

`O4` 把 `context.history` 的每一筆**一律當 proven**，不看記錄上帶的 `state`（`scenario.json` 的
`history` 根本沒有這一欄）；`originalState` 回 `proven`。現存意圖才看狀態：
`approved` / `submitted` / `awaiting` / `proven` 算重複，`rejected` / `failed` / `cancelled` 不算。

`L1`–`L3` 判的是**真正會付出去的金額**：本筆用 `context.approvedAmount ?? total`；
`L2` 的 `todayTotal` 裡每一筆也取它自己的 `approvedAmount ?? amount`。人工把 in_05 降到 192000
之後，當日已付 800000 仍然過得了 1000000 的日限額。

## API

```ts
import {
  evaluate, sealOf, sealReason, approveBlockedBy,
  fingerprint, idempotencyKey, normalizeInvoiceNumber,
  detectRisk, transition, IllegalTransitionError, INTENT_TRANSITIONS,
  canonical, appendEvent, verifyChain, replay,
  mapStatus, resolveProof, formatUSD,
  type CheckResult, type Decision, type GateContext, type Proposal, type RailAdapter,
} from '@pbp/core';
```

### `evaluate(proposal, context) → { checks: CheckResult[]; decision: Decision }`

純函數。同樣的 `proposal` 與 `context` 一定得到同樣的結果（`JSON.stringify` 逐字相同）。

```ts
const context: GateContext = {
  vendors, agreements, deliveries, changeRequests,
  intents,        // 現存意圖（任何狀態）
  history,        // 環境種下的歷史；一律當 proven
  policy,         // perPaymentAutoLimit / dailyLimit / newVendorAutoLimit / changeRequestWindowDays
  now,            // ISO 時間；唯一的時鐘
  epoch,          // demo:reset 換一次；進冪等鍵，不進指紋
  approvedAmount, // 選填：人工降額後重算用（O2 判它，L1–L3 也用它當本筆金額；帶 approvedBy）
};
```

### `sealOf(checks, 'owed' | 'payee' | 'policy') → 'pass' | 'hold' | 'fail' | 'na'`

印章狀態，取該組最壞的一項。`sealReason` 回傳造成該狀態的那一項檢查，給 UI 說明用。

### `approveBlockedBy(checks) → CheckResult | null`

`P1` 或 `P2` 處於 `hold` / `fail` 時回傳那一項，代表「人工 Approve 必須被拒絕」；否則 `null`。
server 接受 `human.action: approve` 之前先問它（AC-3、AC-12）。

### `fingerprint(input)` / `idempotencyKey(epoch, fingerprint)`

- `fingerprint = sha256(vendorId | normalizeInvoiceNumber(invoiceNumber) | currency | total)` 的 hex。
- `normalizeInvoiceNumber`：NFKC → 大寫 → 去掉空白與各類連字號（U+002D、U+2010–U+2015、U+2212）
  → 數字段去前導零。`INV-0142`、`inv 0142`、`INV-142`、`INV‑0142` 都是 `INV142`。
- `idempotencyKey = "pbp-" + sha256(epoch | fingerprint) 的前 28 個 hex`，共 32 字元、字元集
  `[a-z0-9-]`。它同時是 PayPal 的 `sender_batch_id` 與 `PayPal-Request-Id`（SPEC §6.5.2）。
- 同一個 epoch 裡同一張發票永遠得到同一個鍵，所以重試不可能付第二次；換 epoch 等於換一家公司
  （演示重置用）。epoch 不進指紋，所以換 epoch 不會讓舊帳本裡的同一張發票看起來像新發票。

### `transition(state, trigger) → IntentState` / `IllegalTransitionError`

只走 SPEC §6.3.3（v1.1）的表；表外一律拋 `IllegalTransitionError`（帶 `from` 與 `trigger`）。
`INTENT_TRANSITIONS` 把同一張表以資料形式匯出（含三列「不變」），測試與稽核可以直接列舉，不必抽樣。

三列**合法但不動狀態**的操作（`transition()` 回傳原狀態，事件照記）：

| 操作 | 只在這些狀態合法 |
| --- | --- |
| `human.action: verify_payee`（`not_confirmed`） | `held` |
| `human.action: cancel_payout` | `awaiting` |
| `human.action: refresh_receipt` | `submitted` / `awaiting` / `proven` / `failed` / `cancelled` |

在表上沒列的狀態做同一個操作，一律拋錯。`replay()` 對每一筆 `human.action` 都經過
`transition()`，不繞開——帳本裡出現表外轉移就代表帳本壞了。

取消要等證明：`cancel_payout` 只記事件，意圖留在 `awaiting`；軌道取消後 GET 回
`RETURNED` 才算 `receipt.updated proof = cancelled`，意圖才轉 `cancelled`。若對方搶先領了、
GET 回 `SUCCESS`，照表 `awaiting → proven`，帳上不會把一筆真付出去的錢記成 Stopped。
`cancelled` 是終態，之後再收到 `cancelled` 回執是表外轉移。

### `canonical(value)` / `appendEvent(prev, input)` / `verifyChain(input)` / `replay(events)`

- `canonical`：鍵名遞迴排序、無空白的 JSON。
- `appendEvent(prev, { type, data, at })`：接在 `prev` 之後；`seq` 從 1 起算，第一行 `prevHash`
  是 64 個 `0`；`hash = sha256(canonical(event 去掉 hash))`。
- `verifyChain(events | jsonlText)`：未改動回 `{ ok: true }`；被改一行、刪一行、換兩行、插一行
  各回第一個壞掉的 `seq`。**尾端截斷偵測不到**——要防它得把 head hash 存在鏈外。
- `replay(events)`：折成投影（每個意圖的狀態、檢查、回執、金額；四類合計
  `proven` / `awaitingProof` / `held` / `stopped`）。投影從不落盤，永遠由帳本重算，所以重啟
  不會和帳本吵架。`proven` 必須是 `railStatus = SUCCESS` **且** `transactionId` 非空
  **且** `source = rail_get`；不符合的記一筆 `error`，意圖不動。

### `detectRisk(input, context) → RiskFlag[]`

四枚旗標，只有旗標、不改決策：`SENDER_DOMAIN_MISMATCH`、`LOOKALIKE_DOMAIN`、
`INSTRUCTION_TO_AI`、`URGENCY`。輸入是寄件人、已認出的供應商、正文、附件文字；`LOOKALIKE_DOMAIN`
另外需要全部已知網域（供應商的 `knownDomains` 加付款方網域）。
`in_04` 恰好四枚，其餘八封零枚（AC-9b）。

### `formatUSD(cents) → "$1,350.00"`

金額全程整數分；`Σquantity × rate` 用整數乘法（`multiplyCents`）。浮點金額在 `assertCents` 就拋錯。

## RailAdapter 契約

```ts
interface RailAdapter {
  submit(intent: RailIntent): Promise<SubmitResult>;
  fetchReceipt(ref: RailRef): Promise<ReceiptResult>;
  cancel(ref: RailRef): Promise<void>;
  mapStatus(railStatus: string): ProofState;
}
```

- `submit(intent)` → `{ senderBatchId, payoutBatchId }`。**一個意圖一個批次、一個項目**；
  `intent.idempotencyKey` 必須原樣當成該軌道的去重鍵。回應丟失（逾時、斷線、故障注入）時回
  `payoutBatchId: null`，並用**同一個鍵**重送——絕不換鍵。
- `fetchReceipt(ref)` → `{ railStatus, proof, payoutItemId, transactionId, fetchedAt }`。
  **只有 `fetchReceipt` 的回執能算「付了」**；POST 的回應永遠不是回執。
- `cancel(ref)`：只在對方還沒領取 / 還沒結算時可用；成功之後仍要等回執把狀態確認為
  `cancelled`，再讓狀態機走 `awaiting → cancelled`。
- `mapStatus(railStatus)` → `proven | pending | failed | cancelled`。SPEC §6.5.3 的對照表是
  `mapStatus`（`RETURNED` 預設 `failed`，由我方取消時由軌道改判 `cancelled`；表外的值當
  `pending` 並記 `error`）。`resolveProof` 在 `mapStatus` 之上再加一條：`SUCCESS` 但沒有
  transaction id 不算 `proven`，仍是 `pending`。

## 怎麼加一條新軌道

1. 在 `packages/<rail>/src/index.ts` 實作 `RailAdapter` 的四個方法；除了 `node:*` 與自家檔案，
   依賴由該包自己宣告，`@pbp/core` 不動。
2. 決定**冪等鍵放哪**：`intent.idempotencyKey` 必須被送到該軌道的去重機制（請求標頭、批次鍵或
   等價物）。如果該軌道沒有請求級去重，就在 `submit` 裡先用批次鍵反查，查到就回同一個批次，
   不要送出第二筆。
3. 決定**哪個狀態才算證實**：把該軌道的狀態字串全部列進 `mapStatus`；只有「錢真的到了、而且有
   一個非空的交易識別」才回 `proven`。對不出來的狀態回 `pending`，並讓呼叫方記 `error`。
4. 決定**怎麼取消或退回**：`cancel(ref)` 的成功條件與失敗模式寫進該包的 README；不可取消時
   拋錯，由 server 交人。
5. 寫測試：`submit` 冪等（同鍵兩次只有一筆）、`fetchReceipt` 的每個狀態都對到正確的 `proof`、
   `cancel` 的兩條路徑、以及「`SUCCESS` 沒有 transaction id 不算 proven」。
6. 在 `packages/core/test` 之外補一個跨包測試：用假軌道跑一遍 `evaluate → submit → fetchReceipt
   → replay`，斷言投影的四類合計。
7. 在下面「對照清單」新增一節，三問都要有答案或「待該賽道核實」。

## 對照清單

兩條下一站軌道。三問之下，凡是查不到官方原文的欄位名與語義，一律寫「待該賽道核實」並附官方
文檔入口——這一節不許出現猜出來的欄位名。

### Airwallex Payouts

官方文檔入口：<https://www.airwallex.com/docs>

- **冪等鍵放哪**：待該賽道核實。契約要求：`submit()` 必須把 `intent.idempotencyKey` 送到
  Airwallex 的請求去重機制；若它只做「批次/轉帳建立」層級的去重，就一個意圖一個轉帳，重試用
  同一個鍵。真正可用的標頭或參數名稱與有效期，以該賽道沙箱實測為準。
- **哪個狀態才算證實**：待該賽道核實。契約要求：只有 `fetchReceipt()` 回來的狀態能算，而且必須
  拿得到一個非空的交易識別才可回 `proven`；`pending` 一律顯示「Awaiting proof」。狀態字串對照表
  未核實前不得上線。
- **怎麼取消或退回**：待該賽道核實。契約要求：`cancel(ref)` 只在對方尚未結算時呼叫；不可取消時
  拋錯交人；退回（refund/return）是否與取消同一條路徑，待核實。

### 支付寶 Machine Pay（HTTP 402）

官方文檔入口：<https://open.alipay.com/>

- **冪等鍵放哪**：待該賽道核實。HTTP 402 是「請求即付款」的協議，重放同一請求會不會扣第二次
  完全取決於協議自己的去重語義；`intent.idempotencyKey` 要對到哪個欄位、服務端保留多久，未核實
  之前這條軌道不得上線。
- **哪個狀態才算證實**：待該賽道核實。契約要求不變：`proven` 只能來自該軌道自己的查詢結果，
  而且要有一個非空的交易識別；402 回應本身不是回執。
- **怎麼取消或退回**：待該賽道核實。契約要求：先確認該軌道是否支援在付款後取消；不支援就把
  `cancel()` 實作成拋錯，由 server 走人工退款流程並在帳本留下 `human.action`。

## 邊界與已知限制

- 不讀時鐘：`now` 由呼叫方給。同一個 `now` 下結果完全確定。
- 不碰檔案：帳本的讀寫由 server 做，這一包只處理「行」與「事件」。
- `verifyChain` 偵測不到尾端截斷（鏈本身看不出少了一截），要防它得把 head hash 存在鏈外。
- `replay` 遇到表外的轉移會拋 `IllegalTransitionError`：帳本壞了就是要炸，不要靜靜吞掉。
- L2 以 UTC 日切分；跨時區的公司在邊界那幾個小時會看到兩天。
- 多幣種、OCR、部分付款都不在這一包：`Currency` 目前只有 `USD`，金額是單一整數分。
