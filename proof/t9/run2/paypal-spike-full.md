# PayPal 沙箱實測（T5 第 2 段）

> 由 `packages/paypal/scripts/spike.ts` 產生；所有憑證、token 與 Authorization 標頭已去敏。
> 執行時間 2026-11-01T06:17:51.604Z · 端點 https://api-m.sandbox.paypal.com · 每筆 $1.00 · 收款人 priya11111@personal.example.com
> 第一段（2026-10-27）沒有憑證，本檔的所有數字都必須由這次真實執行產生；沒有跑到的條目寫「not measured」，不補值。

## 本票要回答的六個問題

| # | 問題 | 實測結果 |
| --- | --- | --- |
| 1 | 同一 `sender_batch_id` 再 POST 回什麼 | HTTP 400 · name USER_BUSINESS_ERROR · message User business error. · issue Batch with given sender_batch_id already exists |
| 2 | 同一 `PayPal-Request-Id` 重放回什麼 | HTTP 201 — a new batch GGWDNFNQFMY52 was created. PayPal does not replay from PayPal-Request-Id alone. |
| 3 | 鍵的長度與字元限制 | Our keys are 32 characters of [a-z0-9-] and PayPal accepted them (step b). PayPal's schema allows sender_batch_id up to 256 characters and PayPal-Request-Id up to 1000. The over-length probe was not run (add --probe-limits). |
| 4 | 付給沒有沙箱帳號的電郵 | pbp-spike-unclaimed-mvxftlzvck1w@example.com → UNCLAIMED after 17 s. |
| 5 | cancel 之後的狀態 | (not measured) |
| 6 | 情境電郵的沙箱帳號能否收款 | priya11111@personal.example.com → SUCCESS, proven in 17 s (transaction 76Y541519F629554M). |

Token 壽命（`expires_in`）：31396 秒；rail 在到期前 60 秒換新。

## (a) OAuth2 token is reused (AC-7 a)

**請求**：POST /v1/oauth2/token once, then two GET /v1/payments/payouts-item/<unknown>

**HTTP**：200 for the token; 404 for both GETs (the item does not exist, by design)

| 欄位 | 值 |
| --- | --- |
| expires_in (seconds) | 31396 |
| token requests made by the rail for two calls | 1 |
| token value | not recorded |

**結論**：One token served both calls; the cache works.

## (b) One payout to a sandbox personal account (AC-7 b)

**請求**：POST /v1/payments/payouts · receiver priya11111@personal.example.com · amount $1.00

**HTTP**：201 (POST is not a receipt)

| 欄位 | 值 |
| --- | --- |
| payout_batch_id | ET7HPD5ACTATS |
| receipt railStatus | SUCCESS |
| receipt proof | proven |
| transaction_id | 76Y541519F629554M |
| time to settle | 17 s (5 reads) |

**結論**：SUCCESS with a transaction id — proven.

## (c) A payout to an email with no sandbox account (AC-7 c)

**請求**：POST /v1/payments/payouts · receiver pbp-spike-unclaimed-mvxftlzvck1w@example.com

**HTTP**：201 (POST is not a receipt)

| 欄位 | 值 |
| --- | --- |
| payout_batch_id | Q8PKFA7B4WP7Q |
| receipt railStatus | UNCLAIMED |
| receipt proof | pending |
| time to UNCLAIMED | 17 s (5 reads) |

**結論**：UNCLAIMED, mapped to awaiting — not paid.

## (d) Cancel the unclaimed payout (AC-7 d)

**請求**：POST /v1/payments/payouts-item/<id>/cancel

**HTTP**：error

**結論**：rejected: PayPal would not cancel this payout. The payment is unchanged — check the receipt.

## (e) The same sender_batch_id is sent again (AC-7 e)

**請求**：POST /v1/payments/payouts with sender_batch_id=pbp-a42ab5dc3b2d4d9e952ebb519038 (the same as (b))

**HTTP**：HTTP 400

| 欄位 | 值 |
| --- | --- |
| response name | USER_BUSINESS_ERROR |
| response message | User business error. |
| details[].issue | Batch with given sender_batch_id already exists |
| original batch the rail recovered | ET7HPD5ACTATS |
| same batch as (b) | yes |

**結論**：PayPal refused a second payout and the rail recovered the original batch (HTTP 400).

## (f) The answer is dropped after PayPal took it (AC-7 f)

**請求**：POST /v1/payments/payouts with PBP_FAULT=drop_after_submit, then the same key again

**HTTP**：the first answer was dropped by design

| 欄位 | 值 |
| --- | --- |
| first attempt | lost_response (batch was created) |
| recovered payout_batch_id | CUAGH8JQLVHGJ |
| items in the batch (GET) | 1 |

**結論**：One payment in PayPal after a lost answer and a retry.

## 附加探針：同一 PayPal-Request-Id、不同 sender_batch_id

HTTP 201

> 這次建立了新批次，也就是沙箱多付了一筆（沙箱餘額，不是真錢）。這證明 PayPal-Request-Id 單獨不會重放。

```json
{
  "batch_header": {
    "payout_batch_id": "GGWDNFNQFMY52",
    "batch_status": "PENDING",
    "sender_batch_header": {
      "sender_batch_id": "pbp-b2a7a342e00626dbccc17ba327ef",
      "email_subject": "You have a payout from Lumen &amp; Lark Studio",
      "email_message": "Lumen &amp; Lark · INV-SPIKE · no PO"
    }
  },
  "links": [
    {
      "href": "https://api.sandbox.paypal.com/v1/payments/payouts/GGWDNFNQFMY52",
      "rel": "self",
      "method": "GET",
      "encType": "application/json"
    }
  ]
}
```

## 重複鍵的原始回應（去敏，逐字）

```json
{
  "name": "USER_BUSINESS_ERROR",
  "message": "User business error.",
  "debug_id": "f3632403a7b15",
  "information_link": "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  "details": [
    {
      "field": "SENDER_BATCH_ID",
      "location": "body",
      "issue": "Batch with given sender_batch_id already exists",
      "link": [
        {
          "href": "https://api.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS",
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

## 全部請求摘要（去敏）

| 方法 | URL | HTTP |
| --- | --- | --- |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts-item/NO-SUCH-ITEM | 404 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts-item/NO-SUCH-ITEM | 404 |
| POST | https://api-m.sandbox.paypal.com/v1/payments/payouts | 201 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
| POST | https://api-m.sandbox.paypal.com/v1/payments/payouts | 201 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/Q8PKFA7B4WP7Q | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/Q8PKFA7B4WP7Q | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/Q8PKFA7B4WP7Q | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/Q8PKFA7B4WP7Q | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts/Q8PKFA7B4WP7Q | 200 |
| GET | https://api-m.sandbox.paypal.com/v1/payments/payouts-item/5WS349UQ2C7UJ | 200 |
| POST | https://api-m.sandbox.paypal.com/v1/payments/payouts-item/5WS349UQ2C7UJ/cancel | 400 |
| POST | https://api-m.sandbox.paypal.com/v1/payments/payouts | 400 |
| GET | https://api.sandbox.paypal.com/v1/payments/payouts/ET7HPD5ACTATS | 200 |
