# PayPal 沙箱實測（T5 第 2 段 · AC-7）

> 執行：2026-10-29 12:49–13:00 UTC，`packages/paypal/scripts/spike.ts`（完整 AC-7）與
> `packages/paypal/scripts/capture-fixtures.ts`（把真實回應錄成夾具）各跑一次。
> 端點 `https://api-m.sandbox.paypal.com`（rail 只接受 `PAYPAL_ENV=sandbox`，base URL 寫死沙箱）。
> 每筆 $1.00，收款人 `priya11111@personal.example.com`（`PBP_RECEIVER_MAP.ven_priya`）。
> 去敏：client id、client secret、`access_token`、`Authorization` 標頭從未寫進本檔；批次／項目／交易號
> 是沙箱物件，照原樣保留。付的都是沙箱餘額，不是真錢。
>
> 裁定：主控 2026-10-29 在另一台機器重現取消被拒後，出了 SPEC v1.7（PR #32，merge `fa2c9b3`）——
> AC-7 (d) 改成「照官方端點送出取消，PayPal 沒確認就不說已取消」。本檔已照新寫法更新。
>
> 補記（主控 2026-11-01，SPEC v1.9）：T9 複驗時沙箱接受了一筆取消——item `5WS349UQ2C7UJ`
> （UNCLAIMED、批次已完成）回 200、`RETURNED`（原文 `proof/t9/run2/ac7d-cancel-verbatim.txt`，主控同日獨立 GET
> 核對）。下文的「沙箱沒有實證」「一律拒絕」是 10-29 當天的結果，原文保留；現在的說法以 SPEC §6.5.1 為準：
> 沙箱對取消時拒時收。

## 結論（先看這裡）

- **AC-7 (a)(b)(c)(d)(e)(f) 全部 PASS（(d) 依 SPEC v1.7 的新寫法）**，每條都有原始回應與 GET 證據。
- **AC-7 (d)**：對 (c) 那筆發官方取消請求，PayPal **拒絕**——批次還沒完成時 400 `BATCH_NOT_COMPLETED`
  「Only item belonging to a batch in Processed status can be cancelled.」，批次完成之後 500
  `INTERNAL_SERVICE_ERROR`。三筆不同的 UNCLAIMED 款項（`L6ULZKAKC8H6U`、`8SZCC3PCRRBP6`、
  `W5VDA3RB56CVG`）、四種標頭／body 形狀、間隔兩分鐘以上重試，結果一致；取消失敗後 GET 仍是
  `UNCLAIMED`，錢沒動。依 v1.7，拒絕就是這條要證的結果：`cancel()` 拋錯、意圖留在 awaiting、
  帳本與界面都不出現 cancelled（兩支以真錄音為夾具的測試釘住）。
  **取消成功的分支（200 → `RETURNED` → cancelled）在沙箱沒有實證，只有官方範例夾具**。
- 主控 2026-10-29 13:20 UTC 用官方範例的請求形狀（body `{}`、JSON、Bearer）獨立重現同一個 500，
  之後 GET 仍是 `UNCLAIMED`——是沙箱拒絕，不是請求寫錯。
- **`PayPal-Request-Id` 單獨不防重**：同一個 Request-Id、換一個 `sender_batch_id`，回 201 並建立新批次。
  防重只靠 `sender_batch_id`；SPEC §6.5.2 已照實測改寫（v1.7），程式不用改。
- 重複 `sender_batch_id` 的回應**與 SPEC §6.5.2 相符**：400、`USER_BUSINESS_ERROR`、issue
  「Batch with given sender_batch_id already exists」，原批次在 `details[0].link[].href`（頂層 `links` 是空的）。

## 本票要回答的六個問題

| # | 問題 | 實測結果（2026-10-29） |
| --- | --- | --- |
| 1 | 同一 `sender_batch_id` 再 POST 回什麼（狀態碼、`name`、`message` 原文） | **HTTP 400**，`name` = `USER_BUSINESS_ERROR`，`message` = `User business error.`，`details[0].issue` = `Batch with given sender_batch_id already exists`；原批次鏈接在 `details[0].link[0].href`。逐字見下方〈重複鍵的原始回應〉。 |
| 2 | 同一 `PayPal-Request-Id` 重放回什麼（是否回原批次） | **HTTP 201，建立新批次**（`W86ZKU326FW4C`），不是原本那一批。`PayPal-Request-Id` 單獨不防重、也不重放；防重只靠 `sender_batch_id`（SPEC §6.5.2 v1.7 已照此改寫）。 |
| 3 | `sender_batch_id` 與 `PayPal-Request-Id` 的長度與字元限制 | 我們 32 字元、`[a-z0-9-]`（含 `-`）的鍵被接受（(b) 成功即證）。257 字元 → **HTTP 400 `VALIDATION_ERROR`**，`details[0].issue` = `size must be between 0 and 256`。官方 schema 的上限：`sender_batch_id` 256、`PayPal-Request-Id` 1000。 |
| 4 | 付給沒有沙箱帳號的電郵：狀態是什麼、多久出現 | **`UNCLAIMED`，17 秒**（5 次讀取，每 3 秒一次）。回應帶 `errors.RECEIVER_UNREGISTERED`，**而且仍有 transaction id**——所以 `UNCLAIMED` 絕不能當 proven。 |
| 5 | cancel 之後狀態是什麼 | **PayPal 拒絕取消**：批次處理中 → 400 `BATCH_NOT_COMPLETED`；批次完成後 → 500 `INTERNAL_SERVICE_ERROR`。之後 GET 仍是 `UNCLAIMED`。依 SPEC v1.7，這就是 (d) 要證的拒絕分支；成功分支沙箱沒有實證。詳見 §(d)。 |
| 6 | 用戶照 SPEC §9 建的 `.example` 電郵沙箱帳號，付款是否 SUCCESS | `.example` 電郵建不了沙箱帳號（主控 10-29 的沙箱帳號用的是 PayPal 生成的 `…@personal.example.com`），所以照 §6.5.5 用 `PBP_RECEIVER_MAP`。改送 `priya11111@personal.example.com` → **`SUCCESS`，17 秒**，transaction `6X640657JH710842D`。 |

## AC-7 逐條

| 條 | 要證的事 | 結果 | 證據 |
| --- | --- | --- | --- |
| (a) | 取得 OAuth token 並在到期前重用 | **PASS** | token 200，`expires_in` 31917；rail 兩次呼叫只換一次 token（`tokenRequests == 1`） |
| (b) | 對沙箱個人帳號付 1 筆，GET 回 `SUCCESS` 與 transaction id | **PASS** | batch `RNE4UZNTDPL9G`，17 秒後 `SUCCESS`，transaction `6X640657JH710842D` |
| (c) | 對沒有沙箱帳號的電郵付 1 筆，GET 回 `UNCLAIMED`，對照 awaiting | **PASS** | batch `S9V2P4VFPZJTG`，17 秒後 `UNCLAIMED`，對照 `pending`（Awaiting proof） |
| (d) | 對 (c) 那筆發官方取消請求，逐字記錄回應與之後 GET；PayPal 接受 → cancelled，拒絕 → `cancel()` 拋錯、意圖留在 awaiting（v1.7） | **PASS（拒絕分支）** | 三筆的 400 `BATCH_NOT_COMPLETED`／500 `INTERNAL_SERVICE_ERROR` 實錄 + 主控 13:20 UTC 獨立重現；之後 GET 仍 `UNCLAIMED`；兩支以真錄音為夾具的測試斷言「拒絕不會變 cancelled」。**成功分支只有官方範例，沙箱沒有實證** |
| (e) | 同一 `sender_batch_id` 再 POST 一次，PayPal 不產生第二筆（原始回應逐字記錄） | **PASS** | 400 重複；rail 跟 `details[0].link[0].href` GET 回原批次 `RNE4UZNTDPL9G`，與 (b) 同一批 |
| (f) | `PBP_FAULT=drop_after_submit` 下重試，該意圖在 PayPal 只有一筆（GET 批次證明） | **PASS** | 第一答被丟掉（`lost_response`），同鍵重送回 400 重複 → 找回 batch `7ZCAX9A2R4CJN`；GET 批次 `items.length == 1` |

## 逐步證據

### (a) OAuth2 token 在到期前重用

- 請求：`POST /v1/oauth2/token`（client credentials），然後對一個不存在的 item 連兩次 `GET /v1/payments/payouts-item/NO-SUCH-ITEM`。
- HTTP：token 200；兩次 GET 都是 404（刻意挑不存在的 item，不影響錢）。
- 關鍵欄位：`expires_in` = 31917 秒；rail 為這兩次呼叫換的 token 次數 = 1；token 值不記錄。
- 結論：快取有效；`fetchToken` 只在過期前 60 秒之外才會再打。

### (b) 付一筆給真的沙箱個人帳號

- 請求：`POST /v1/payments/payouts` · receiver `priya11111@personal.example.com` · `$1.00` · 32 字元鍵。
- HTTP：201（POST 不是回執）。
- 關鍵欄位：`payout_batch_id` = `RNE4UZNTDPL9G`；回執 `transaction_status` = `SUCCESS`；`proof` = `proven`；`transaction_id` = `6X640657JH710842D`；17 秒（5 次讀取）到帳。
- 結論：`SUCCESS` + transaction id 才算 proven，與 §6.5.3 一致。

### (c) 付一筆給沒有沙箱帳號的電郵

- 請求：`POST /v1/payments/payouts` · receiver `pbp-spike-unclaimed-mvtjhwsib5aq@example.com` · `$1.00`。
- HTTP：201；GET 到狀態 17 秒。
- 關鍵欄位：batch `S9V2P4VFPZJTG`、item `L6ULZKAKC8H6U`；`transaction_status` = `UNCLAIMED`；`proof` = `pending`；`errors.name` = `RECEIVER_UNREGISTERED`；`transaction_id` = `7E053935NX891504E`。
- 結論：`UNCLAIMED` → awaiting，不是已付。**注意 UNCLAIMED 也帶 transaction id**，所以「有 transaction id」本身不是充分條件，必須同時 `SUCCESS`。

### (d) 取消那筆 UNCLAIMED —— PayPal 拒絕（依 SPEC v1.7 判 PASS）

第一次（spike 內，item `L6ULZKAKC8H6U`）：`POST /v1/payments/payouts-item/L6ULZKAKC8H6U/cancel` → **400**。當時沒有把 body 記進報告，事後補測拿到兩種答案：

| 嘗試 | 時機 | HTTP | `name` / `message` / issue |
| --- | --- | --- | --- |
| 1 | item 剛變 `UNCLAIMED`、batch 尚未完成（`time_completed` 還沒出現） | 400 | `BATCH_NOT_COMPLETED` / `Only item belonging to a batch in Processed status can be cancelled.` |
| 2 | 同一筆，batch 已完成（`batch_status: SUCCESS`, `time_completed: 2026-10-29T12:49:37Z`） | 500 | `INTERNAL_SERVICE_ERROR` / `An internal service error has occurred` |
| 3 | 另一筆全新的 UNCLAIMED（batch `BWGNMV653PQDA`, item `8SZCC3PCRRBP6`），剛變 UNCLAIMED | 400 | `BATCH_NOT_COMPLETED`（同上） |
| 4 | 同一筆，batch `SUCCESS` 後重試 | 500 | `INTERNAL_SERVICE_ERROR` |
| 5 | 同一筆，四種標頭／body：無 body 無 Content-Type、`Content-Length: 0`、`{}`、`{"payout_item_id": …}` | 500 ×4 | `INTERNAL_SERVICE_ERROR`（四種都一樣） |
| 6 | 另一筆 `L6ULZKAKC8H6U` 間隔兩分鐘再試 | 500 | `INTERNAL_SERVICE_ERROR` |
| 7 | capture 腳本第三次獨立重現（item `W5VDA3RB56CVG`, batch `2AKF25ZTS3B9S`） | 400 → 500 | 先 `BATCH_NOT_COMPLETED`，批次完成後 `INTERNAL_SERVICE_ERROR` |
| 8 | **主控**，另一台機器，同一筆 `L6ULZKAKC8H6U`（batch `S9V2P4VFPZJTG` 已 `SUCCESS`） | 500 | `INTERNAL_SERVICE_ERROR` / `An internal service error has occurred`；之後 GET 仍 `UNCLAIMED` |

每次失敗後 `GET /v1/payments/payouts-item/{id}` 都還是 `UNCLAIMED`——**錢沒有動，但也沒有取消**。

官方文件（`/api/payments.payouts-batch/v1/payouts-item-cancel`）只說「You can cancel payout items with a
`transaction_status` of `UNCLAIMED`」，沒有提到批次要先完成；`BATCH_NOT_COMPLETED` 這個 issue 在
`schema.json` 裡查不到。也就是說：文件承諾的條件我們都滿足了，沙箱仍回 500。

**主控 2026-10-29 在另一台機器獨立重現**（請求形狀與官方範例相同：body `{}`、JSON、Bearer；輸出只節錄狀態）：

```text
token: 200
GET item (before): 200 {'transaction_status': 'UNCLAIMED', 'payout_batch_id': 'S9V2P4VFPZJTG', 'errors.name': 'RECEIVER_UNREGISTERED'}
GET batch: 200 {'batch_status': 'SUCCESS', 'time_completed': '2026-10-29T12:49:37Z'}
cancel at (UTC): 2026-10-29T13:20:07Z
POST cancel: 500 {'name': 'INTERNAL_SERVICE_ERROR', 'message': 'An internal service error has occurred', 'debug_id_present': True, 'transaction_status': None}
GET item (after): 200 {'transaction_status': 'UNCLAIMED', 'payout_batch_id': 'S9V2P4VFPZJTG', 'errors.name': 'RECEIVER_UNREGISTERED'}
```

**依 SPEC v1.7（PR #32，merge `fa2c9b3`）的裁定**，這就是 AC-7 (d) 要證的「拒絕分支」：官方取消請求照送，
PayPal 沒確認就不說已取消。rail 的實作（先 GET 確認 `UNCLAIMED` → POST cancel → 只有 200 才記
`cancelling`）對任何非 200 都拋 `rejected`，意圖留在 awaiting；`test/cancel.test.ts` 用這兩種真錄音斷言
「拒絕不會變 cancelled」與「之後 GET 仍是 `UNCLAIMED`」。

**成功分支在沙箱沒有實證**：`payout-item-cancel-returned.json` 仍是官方範例（`_source.kind =
official-doc-sample-retained`）；沙箱若恢復，用 `npm run capture-fixtures` 重錄。

**停手與裁定的經過**：在主控重現之前，本票曾依停手線置 `blocked`；裁定後不再阻擋——v1.7 已把取消被拒的
處理寫進 §6.3.3（由 T7 的 server 實作，T8 補整合測試）。

### (e) 同一個 `sender_batch_id` 再送一次

- 請求：`POST /v1/payments/payouts`，`sender_batch_id` 與 `PayPal-Request-Id` 都等於 (b) 的鍵。
- HTTP：400。
- 關鍵欄位：`name` = `USER_BUSINESS_ERROR`、`message` = `User business error.`、`details[0].issue` =
  `Batch with given sender_batch_id already exists`、`details[0].link[0].href` =
  `https://api.sandbox.paypal.com/v1/payments/payouts/RNE4UZNTDPL9G`、頂層 `links` = `[]`。
- rail 行為：跟鏈接 GET 回原批次 `RNE4UZNTDPL9G`，與 (b) 相同 → **沒有第二筆**。
- 結論：與 SPEC §6.5.2 一致；`details[].link[]` 就是真的位置（schema 的 `links` 沒有出現）。

### (f) 回應被丟掉之後同鍵重試

- 請求：`PBP_FAULT=drop_after_submit`，第一次 POST 拿 201 後丟掉回應（拋 `lost_response`），同鍵再送。
- 關鍵欄位：第一次 `lost_response`（batch 已建立）；重試找回 `payout_batch_id` = `7ZCAX9A2R4CJN`；
  `GET /v1/payments/payouts/7ZCAX9A2R4CJN` 的 `items.length` = 1。
- 結論：PayPal 裡恰好一筆，重試沒有多付。

## 附加探針：同一 `PayPal-Request-Id`、不同 `sender_batch_id`

- 請求：`POST /v1/payments/payouts`，`PayPal-Request-Id` = (b) 的鍵，`sender_batch_id` 換一個新的。
- HTTP：**201**，建立了新批次 `W86ZKU326FW4C`（沙箱多付一筆 $1.00；沙箱餘額，不是真錢）。
- 結論：官方文件說 `PayPal-Request-Id` 重複時「returns the current state of the payout」，第三方實測說仍回 400；
  這個沙箱兩者都不是——它直接接受並建立新批次。**`PayPal-Request-Id` 在 Payouts 上不提供防重**，
  我們的鍵同時放進 `sender_batch_id` 才是對的（§6.5.2 的設計不變，但這條說明要改）。

## 附加探針：超長 `sender_batch_id`

- 請求：`sender_batch_id` = 257 個 `k`（schema 上限 256）。
- HTTP：400 `VALIDATION_ERROR` / `Invalid request - see details`，`details[0]`：
  `field` = `sender_batch_header.sender_batch_id`、`issue` = `size must be between 0 and 256`。
- 結論：官方上限屬實；我們的 32 字元鍵有充足餘裕。

## 重複鍵的原始回應（去敏，逐字）

```json
{
  "name": "USER_BUSINESS_ERROR",
  "message": "User business error.",
  "debug_id": "f30027972c1f6",
  "information_link": "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  "details": [
    {
      "field": "SENDER_BATCH_ID",
      "location": "body",
      "issue": "Batch with given sender_batch_id already exists",
      "link": [
        {
          "href": "https://api.sandbox.paypal.com/v1/payments/payouts/YKMLRQVEET9KC",
          "rel": "self",
          "method": "GET",
          "encType": "application/json"
        }
      ]
    }
  ],
  "links": []
}
```

（這是 capture 腳本第三次獨立重現時錄的；spike 那次除了 batch id 不同，`name`／`message`／`issue` 逐字相同。）

## 取消失敗的原始回應（去敏，逐字）

批次還沒完成：

```json
{
  "name": "BATCH_NOT_COMPLETED",
  "message": "Only item belonging to a batch in Processed status can be cancelled.",
  "debug_id": "f6654664c9374",
  "information_link": "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  "links": []
}
```

批次完成之後：

```json
{
  "name": "INTERNAL_SERVICE_ERROR",
  "message": "An internal service error has occurred",
  "debug_id": "f2608298ecda0",
  "information_link": "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  "details": [],
  "links": []
}
```

## 狀態對照表（SPEC §6.5.3）的覆蓋範圍

| PayPal item 狀態 | 這次有沒有真的看到 | 對照 |
| --- | --- | --- |
| `SUCCESS` | **有**（(b)、§(f) 找回的批次） | proven |
| `UNCLAIMED` | **有**（(c)） | pending |
| `PENDING` | **有**（create 後、批次完成前的批次／item 讀取） | pending |
| `RETURNED` | **沒有**——cancel 拿不到 200 | 文件：我方取消 → cancelled |
| `FAILED` / `BLOCKED` / `REFUNDED` / `REVERSED` / `ONHOLD` | **沒有** | 只依官方文件，不假裝測過 |

`batch_status` 這次看到 `PENDING` 與 `SUCCESS`；`SUCCESS` 的批次裡有 `UNCLAIMED` 的 item（(c)），
再次證明批次狀態不能當付款證明。

## 第一段的假設逐條核對

| # | 第一段的假設 | 這次的結果 |
| --- | --- | --- |
| 1 | 同一 `sender_batch_id` → 400 `USER_BUSINESS_ERROR`「Batch with given sender_batch_id already exists」，原批次在 `details[].link[].href` | **相符**（三處都讀的實作裡，`details[0].link[]` 命中了） |
| 2 | 同一 `PayPal-Request-Id` 會回原批次或 400 重複 | **不符**：201 新批次。不影響防重（我們不靠它）；SPEC §6.5.2 已照實測改寫（v1.7） |
| 3 | 32 字元 `[a-z0-9-]` 可用；`sender_batch_id` ≤ 256、`Request-Id` ≤ 1000 | **相符**（257 字元被 400 擋下） |
| 4 | 沒有沙箱帳號的電郵 → `UNCLAIMED`，出現時間未知 | **相符**：17 秒 |
| 5 | cancel 只對 `UNCLAIMED`，成功 200、item 變 `RETURNED`；被搶先領取時 `ITEM_INCORRECT_STATUS` | **不符**：連 `UNCLAIMED` 都取消不了（400 `BATCH_NOT_COMPLETED` / 500 `INTERNAL_SERVICE_ERROR`）。`ITEM_INCORRECT_STATUS` 這次沒看到。SPEC v1.7 已把 AC-7 (d) 改成驗「拒絕時不說已取消」 |
| 6 | 情境 `.example` 電郵能不能收款未知 | **不能**（沙箱帳號用 `…@personal.example.com`）；`PBP_RECEIVER_MAP` 生效，`priya11111` 17 秒 `SUCCESS` |
| 7 | 9 個 item 狀態對照全表 | **部分**：真的看到 `SUCCESS` / `UNCLAIMED` / `PENDING`，其餘只有文件依據 |
| 8 | token `expires_in` 約 31668 秒，到期前 60 秒換新 | **相符**：這次 31917 秒（每次簽發略有不同） |
| 9 | 5xx 同鍵退避 2/4/8 秒最多 3 次 | **沒有在真沙箱製造 5xx**（cancel 的 500 不是 submit 路徑）；由單元測試的官方 schema 範例覆蓋 |
| 10 | 欄位上限 `sender_item_id` 63、`note` 4000 | **沒有一一實測**；這次只實測了 `sender_batch_id` 的 256 |

## 沒有測到／不假裝測過

- `RETURNED`、`FAILED`、`BLOCKED`、`REFUNDED`、`REVERSED`、`ONHOLD` 的真實回應（沙箱沒有按需造這些狀態的手段；Negative Testing 依主控指示保持關閉）。
- submit 路徑的 5xx 與 401 重試（401 只用假 token 看過回應形狀，沒有讓真 app 打到 401）。
- `sender_item_id` / `note` 的上限（只依官方 schema）。
- 取消成功（200 → `RETURNED` → cancelled）：沙箱一律拒絕，只有官方範例；依 SPEC v1.7 不算缺口，但文件照實寫「沙箱沒有實證」。

## 憑證與去敏

- 只從倉庫根 `.env` 讀 `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_ENV` / `PBP_RECEIVER_MAP`；`.env` 不進 Git。
- spike 報告與夾具都由腳本自動去敏：`access_token` 換成佔位值，`client_secret` / `Authorization` 從不寫入。
- 本檔貼出的回應是去敏後的原文；批次／項目／交易號是沙箱物件，不是憑證。
