# 測試夾具的出處

每一支夾具檔的 `_source` 欄位寫明來源、錄製日期與去敏說明；測試只讀 `.response`。
這個資料夾**沒有任何憑證**：`access_token` 一律是佔位字串，client id / secret / Authorization 標頭從不寫進來。

第二段（2026-10-29）由 `packages/paypal/scripts/capture-fixtures.ts` 對 PayPal 沙箱真實錄製（沙箱餘額，
不是真錢）；批次、項目、交易號都是沙箱物件。官方範例只保留兩支當對照，並在 `_source.kind` 標成
`official-doc-sample-retained`。

| 檔案 | 種類 | 來源 |
| --- | --- | --- |
| `token-response.json` | 沙箱實錄 2026-10-29 | `POST /v1/oauth2/token` 的真實回應；`access_token` 換成 `A21AA-NOT-A-CREDENTIAL`，其餘（scope、expires_in、app_id）照原樣 |
| `payout-created-201.json` | 沙箱實錄 2026-10-29 | `POST /v1/payments/payouts` 201；batch 是 `PENDING`，證明 201 不是回執 |
| `payout-batch-get.json` | 沙箱實錄 2026-10-29 | `GET /v1/payments/payouts/{id}`：`batch_status` 是 `SUCCESS`、唯一 item 是 `UNCLAIMED`——批次狀態不是付款證明 |
| `payout-item-success.json` | 沙箱實錄 2026-10-29 | `GET /v1/payments/payouts-item/{id}` 的 `SUCCESS`，帶 transaction id |
| `payout-item-unclaimed.json` | 沙箱實錄 2026-10-29 | 收款人沒有沙箱帳號：`UNCLAIMED` + `errors.RECEIVER_UNREGISTERED`，**仍有 transaction id** |
| `duplicate-sender-batch-id-400.json` | 沙箱實錄 2026-10-29 | 同一 `sender_batch_id` 再 POST：400 `USER_BUSINESS_ERROR`，原批次在 `details[0].link[].href`、頂層 `links` 空 |
| `validation-error-400.json` | 沙箱實錄 2026-10-29 | `items[0].receiver` 空白的 400 `VALIDATION_ERROR`（沙箱不接受空收款人） |
| `error-401.json` | 沙箱實錄 2026-10-29 | 假 token 打 payouts：`{"error":"invalid_token","error_description":…}`（沒有 name/message/details） |
| `cancel-batch-not-completed-400.json` | 沙箱實錄 2026-10-29 | cancel 太早：400 `BATCH_NOT_COMPLETED`「Only item belonging to a batch in Processed status can be cancelled」 |
| `cancel-internal-service-error-500.json` | 沙箱實錄 2026-10-29 | 批次完成後 cancel 同一筆 `UNCLAIMED`：500 `INTERNAL_SERVICE_ERROR`（文件沒列這個結果） |
| `payout-item-cancel-returned.json` | 官方範例（保留對照） | `developer.paypal.com/payouts/use-payouts/cancel-reverse-payouts` → Sample response。沙箱在 2026-10-29 產不出 200 cancel，這支只代表文件上的成功形狀 |
| `error-500.json` | 官方 schema 範例（保留對照） | `api/payments.payouts-batch/v1/schema.json` → `error_500.examples[0]`；沙箱不會按需回 500，重試測試需要一個 5xx |

已移除：舊的 `error-422.json`（無人引用）。2026-10-29 實測沙箱對 `amount.value: "0"` 與 `currency: "EUR"`
都回 201，做不出 422；真實的 4xx 用 `validation-error-400.json`。

## 重錄

```bash
cd packages/paypal && npm run capture-fixtures   # 會向沙箱付 2 筆 $1.00
```

腳本會覆寫上表前 10 支；官方範例那兩支不動。跑完看 `git diff`：只該出現新的去敏回應與新的
`_source.captured`。
