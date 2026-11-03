# @pbp/paypal — PayPal Payouts 軌道

SPEC §6.5 的實作，接上 `@pbp/core` 的 `RailAdapter`。這一包只做三件事：把一個意圖送成
**一筆批次、一筆項目**；用 **GET** 取回執；對 UNCLAIMED 的項目取消。它不碰界面、不碰帳本、不碰模型。

```bash
cd packages/paypal
npm ci
npm test          # 49 支單元測試，全部用錄製／官方文件的回應，不發任何請求
npm run typecheck # src + test + scripts/spike.ts
npm run build     # dist/（server 與 demo:reset 吃這個）
```

## 一、接線

```ts
import { createPayPalRail } from '@pbp/paypal';

const rail = createPayPalRail(env); // env = .env + process.env
```

`createPayPalRail(env)` 會在**建構時**檢查設定，任何一項不合格就拋 `PayPalRailError` 且不發請求：

| 鍵 | 規則 | 缺了或錯了 |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | 非空 | `Add PAYPAL_CLIENT_ID to .env — nothing was sent.` |
| `PAYPAL_CLIENT_SECRET` | 非空 | `Add PAYPAL_CLIENT_SECRET to .env — nothing was sent.` |
| `PAYPAL_ENV` | 只接受 `sandbox`（大小寫不拘）；未設視為 sandbox | `Only the PayPal sandbox is supported — set PAYPAL_ENV=sandbox. Nothing was sent.` |
| `PBP_RECEIVER_MAP` | JSON 物件；鍵可以是 vendorId 或情境電郵 | `PBP_RECEIVER_MAP is not valid JSON — nothing was sent.` |
| `PBP_FAULT` | `drop_after_submit`、`drop_after_submit:first`、`drop_after_submit:<intentId>` | 認不得的值直接拒絕啟動 |

base URL 寫死 `https://api-m.sandbox.paypal.com`，不從環境讀；`PAYPAL_ENV` 打錯也到不了正式環境。
空字串一律當未設定（AGENTS 坑 A1）。

## 二、`submit(intent)`

- `sender_batch_id` 與 `PayPal-Request-Id` 都是 `intent.idempotencyKey`，**原樣**，不生成、不改寫。
- `items` 只有一筆：`recipient_type: "EMAIL"`、`amount.value` 由整數分轉兩位小數字串（整數運算，
  不經浮點）、`currency: "USD"`、`receiver`、`note`（原樣放 `intent.memo`，server 產生
  「Lumen & Lark · INV-0153 · PO-1191」）、`sender_item_id = intent.intentId`。
- `receiver` 先過 `PBP_RECEIVER_MAP`：`intent.vendorId`（若有）→ 實際電郵 → 大小寫不敏感的電郵鍵。
  回傳值同時帶 `receiver`（真的送去的）與 `requestedReceiver`（發票上寫的），證明包兩個都記。
- 回傳 `{ senderBatchId, payoutBatchId }`。**201 不是回執**；`payoutBatchId` 只是之後要 GET 的 id。

### 重複與重試（SPEC §6.5.2）

| 情況 | 行為 |
| --- | --- |
| 201 / 200 | 記下 `batch_header.payout_batch_id`（可能是冪等重放） |
| 400 `USER_BUSINESS_ERROR`「Batch with given sender_batch_id already exists」 | 從錯誤找原批次鏈接，**GET** 它，回傳原批次 id — 這筆已經送出過，不是失敗 |
| 5xx | 同鍵等 2、4、8 秒重試，最多 3 次；仍失敗拋 `unavailable`（`retryable: true`），意圖留在 submitted 交人 |
| 網路錯／回應丟失 | 拋 `network`（`retryable: true`）；呼叫方用**同一個鍵**再送一次，靠上面的 400 分支找回原批次 |
| 401 | 丟掉 token 快取，換一個新 token 重送**同一個請求**一次（401 代表 PayPal 沒收） |
| 其他 4xx | 拋 `rejected`，訊息是人話；`detail` 只有 name/message/debug_id/issue |

原批次鏈接的位置在官方文件與實測之間不一致：官方 error schema 的 `details[]` 沒有 `link` 欄位，
但沙箱實錄把它放在 `details[0].link[].href`、頂層 `links` 是空的。這一包依序讀
`details[].link[]` → `details[].links[]` → 頂層 `links[]`，只跟像 `/v1/payments/payouts/<id>` 的鏈接。
第二段的沙箱實測會確認一次；不相符就停手交主控改 SPEC。

## 三、`fetchReceipt(ref)`

- 有 `payoutItemId` → `GET /v1/payments/payouts-item/{id}`；只有 `payoutBatchId` →
  `GET /v1/payments/payouts/{id}` 取 `items[0]`。兩個都沒有 → 拋 `no_reference`，不編造回執。
- 回 `{ railStatus, proof, payoutItemId, transactionId, fetchedAt, source: 'rail_get', statusKnown, receiver }`。
- `proof` 用 core 的 `resolveProof`：`SUCCESS` **且** transaction id 非空才是 `proven`；
  `PENDING` / `UNCLAIMED` / `ONHOLD` → pending；`FAILED` / `BLOCKED` / `REFUNDED` / `REVERSED` → failed；
  `RETURNED` → failed，**除非是我們自己 cancel 的那一筆**，才回 `cancelled`。
- 表外的狀態照 SPEC §6.5.3 回 pending，並把 `statusKnown: false` 交給呼叫方記 `error` 事件。
  `batch_status` 完全不參與判斷（batch SUCCESS 也可能有 UNCLAIMED 的 item）。

## 四、`cancel(ref)`

只對 `UNCLAIMED`：先 GET 一次確認狀態，不是 UNCLAIMED 就拋 `not_cancelable`，**不發** cancel POST。
是 UNCLAIMED 才 `POST /v1/payments/payouts-item/{id}/cancel`（body `{}`）。成功之後仍要等下一次
GET 回 `RETURNED` 才算 `cancelled`（SPEC §6.3.3：取消也要先有證明）。若對方搶先領了，cancel 回
`ITEM_INCORRECT_STATUS`，接著的 GET 會是 `SUCCESS` → `proven`，帳上不會把已付的錢記成取消。

**已知限制**：「哪一筆是我們取消的」記在進程記憶體；server 重啟後同一個 `RETURNED` 會退回
`failed`（30 天未領的自動退回）。T8 要接這條時，server 的帳本裡已有 `human.action: cancel_payout`，
可以由 server 在重啟後把「我們取消過的」帶回來，或由 core 的 `RailRef` 擴充一個旗標。

## 五、故障注入（SPEC §6.5.4）

`PBP_FAULT=drop_after_submit`：PayPal 回 201 之後把回應丟掉、拋 `lost_response`。批次真的存在，
所以同一個鍵重送會拿到 400 重複、順著鏈接找回原批次 —— AC-7(f) / AC-13(a) 就是這樣證的。
`:first` 只在這個 rail 實例的第一次觸發；`:<intentId>` 只對那一個意圖。預設關閉。

## 六、沙箱實測腳本

```bash
# 憑證放倉庫根 .env（PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV=sandbox）
npm run spike                 # AC-7 (a)–(f) + 本票要回答的六個問題 → docs/research/paypal-sandbox-spike.md
npm run spike -- --quick      # 只跑 (b) 一筆 SUCCESS + (e) 同鍵不重付（verify.sh 的 need_local 用）
```

- 只打沙箱；`PAYPAL_ENV` 不是 sandbox 就啟動不了。
- 報告會去敏：client id、secret、token、Authorization 都不寫進去；`_source` 之外的每個回應都經過
  `redact` 與鍵名過濾。
- `--probe-request-id`（預設開）會用**同一個 `PayPal-Request-Id`、不同的 `sender_batch_id`** 送一筆，
  回答「Request-Id 單獨會不會重放」。如果 PayPal 建了新批次，那是沙箱多一筆付款，報告會註明。
- `--probe-limits` 另外送一個 257 字的 `sender_batch_id` 觀察上限（預設不跑）。
- 第一段（2026-10-27）**沒有跑過**：當時沒有憑證。`docs/research/paypal-sandbox-spike.md` 只有
  骨架與六個問題，沒有任何數字。

## 七、夾具

`test/fixtures/` 每一支 JSON 的 `_source` 寫明官方頁 URL 與小節名；`fixtures/README.md` 有總表。
官方文件的範例回應優先；官方沒有給的（重複鍵 400、422）由 schema ＋ `paypal-facts` 引用的
第三方沙箱實錄組出，並在 `_source.note` 寫清楚。第二段換成我們自己錄到的去敏回應，測試要在
真回應上照樣全綠。
