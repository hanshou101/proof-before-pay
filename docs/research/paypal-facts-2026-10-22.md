# PayPal 與 AG Studio 技術事實（閘 A 查證，2026-10-22）

> 主控委託研究子代理查官方文件、OpenAPI 與已發佈套件原始碼（未用沙箱憑證實呼叫）。標籤：[官] 官方文件或 OpenAPI；[碼] 已發佈套件原始碼；[社] 第三方實測，非官方；[探] 當日 curl 探測。**與沙箱實測衝突時以 T5 的 `paypal-sandbox-spike.md` 為準。** developer.paypal.com 的頁面網址加 `.md` 可取純文字。

## Payouts

| # | 事實 | 出處 |
| --- | --- | --- |
| 1 | 30 天內重用 `sender_batch_id` 會被拒，錯誤裡帶指向原批次的 HATEOAS 鏈接 [官]："If you specify a sender_batch_id that was used in the last 30 days, the API rejects the request with an error message that shows the duplicate sender_batch_id and includes a HATEOAS link to the original payout"。[社] 沙箱實錄：HTTP 400 `USER_BUSINESS_ERROR`，`details[0].issue` = "Batch with given sender_batch_id already exists"，原批次鏈接在 `details[0].link[].href` | https://developer.paypal.com/api/payments.payouts-batch/v1/schema.json ；[社] https://github.com/ma-za-kpe/stood/blob/main/docs/guides/paypal-payouts-builder-payouts.md |
| 2 | 支援 `PayPal-Request-Id`，"The server stores keys for 30 days"；"If the payout details already exist, PayPal returns the current state of the payout." [官]。⚠ [社] 實測：同 request id ＋ 同 sender_batch_id 仍回 400 重複，不重放首次回應 | https://developer.paypal.com/api/payouts/customize |
| 3 | item `transaction_status` 共 9 個：SUCCESS、FAILED、PENDING、UNCLAIMED、RETURNED、ONHOLD、BLOCKED、REFUNDED、REVERSED；`batch_status` 5 個：DENIED、PENDING、PROCESSING、SUCCESS、CANCELED。只有 item SUCCESS = "Funds have been credited to the recipient's account."；batch SUCCESS 不代表每筆都付清 [官] | schema.json；https://developer.paypal.com/payouts/use-payouts/track-payout-item-status |
| 4 | 收款人沒有 PayPal 帳號 → UNCLAIMED，30 天未領自動退回；`POST /v1/payments/payouts-item/{id}/cancel` 只對 UNCLAIMED，結果 RETURNED [官]。沙箱不支援 PHONE 收款類型 [官] | https://developer.paypal.com/payouts/use-payouts/cancel-reverse-payouts |
| 5 | Payouts 的失敗模擬不是 `PayPal-Mock-Response`，而是把 `items[0].note` 設成測試值（如 `ERRPYO005` = INSUFFICIENT_FUNDS），區分大小寫，beta [官]。沙箱 business 帳號若開了帳號級 Negative Testing，所有交易都會失敗——要關 | https://developer.paypal.com/api/payouts/test-go-live ；https://developer.paypal.com/negative-testing/overview |
| 6 | 沙箱預設就有 business 與 personal 帳號，business 付、personal 收；官方沒有「勾選 Payouts 功能」的步驟，正式環境才要申請開通 [官]。官方範例 token 的 scope 含 `https://uri.paypal.com/payments/payouts` | https://developer.paypal.com/payouts/use-payouts/set-up |
| 7 | item `note` 上限 4000 ASCII / 1000 非 ASCII；`sender_item_id` ≤ 63 字元，官方未說唯一 [官] | schema.json |
| 8 | 官方 Node SDK：`@paypal/paypal-server-sdk` 2.5.0 沒有 Payouts；`@paypal/payouts-sdk` 最後發佈 2021。→ Payouts 直接打 REST [碼] | npm |

## PayPal AI 工具

| # | 事實 | 出處 |
| --- | --- | --- |
| 9 | 黑客松資源頁的 `github.com/paypal/AI-Toolkit` 是給 Claude Code / Codex / Cursor 用的外掛（skills、commands、hooks，Apache-2.0，v1.1.0），內建 MCP 連 `https://mcp.sandbox.paypal.com/sse`。程式庫是 npm `@paypal/agent-toolkit` 1.11.0、`@paypal/mcp` 1.8.1、PyPI `paypal-agent-toolkit` 1.11.0 [碼] | https://developer.paypal.com/ai-tools/toolkit |
| 10 | Agent toolkit 1.11.0 共 47 個工具：invoices 22、orders（create / get / pay_order＝capture）、refunds、disputes 3、catalog 4、subscriptions 8、shipment 3、`list_transactions`、`get_merchant_insights`；**沒有任何 payouts 工具**，也沒有 authorize / void [碼]。支援框架：Amazon Bedrock、CrewAI（Python）、LangChain、MCP、OpenAI Agents SDK、Vercel AI SDK [官] | https://developer.paypal.com/ai-tools/agent-tools |
| 11 | 資源頁的三個 docs.paypal.ai 鏈接已 301 → 404；新址 developer.paypal.com/ai-tools/{agent-tools,toolkit,mcp-server} [探] | — |
| 12 | 遠端 MCP：沙箱 `https://mcp.sandbox.paypal.com`，OAuth 或 Bearer token [官] | https://developer.paypal.com/ai-tools/mcp-server |
| 13 | Webhook 驗簽 `POST /v1/notifications/verify-webhook-signature`；item 事件名 `PAYMENT.PAYOUTS-ITEM.{BLOCKED,CANCELED,FAILED,HELD,REFUNDED,RETURNED,SUCCEEDED,UNCLAIMED}`（事件叫 SUCCEEDED / HELD，狀態叫 SUCCESS / ONHOLD）[官] | https://developer.paypal.com/payouts/webhooks |
| 14 | Orders v2 `intent` 為 CAPTURE / AUTHORIZE；授權 29 天，前 3 天 honor period [官]（本作品不用） | https://developer.paypal.com/payment-methods/auth-honor |

## AG Grid / AG Studio（贊助商獎）

| # | 事實 | 出處 |
| --- | --- | --- |
| 15 | AG Studio：npm `ag-studio-react` 3.0.0（帶 `ag-studio`，依賴 `ag-grid-enterprise ~36.2.0`），商業授權。無 key 不封鎖：console 報 "License Key Not Found"；**非 localhost** 才出浮水印 "For Trial Use Only" [碼]。45 天試用填表取得 | https://www.ag-grid.com/studio/react/licence-install/ ；https://www.ag-grid.com/studio/license-pricing/?tab=trial |
| 16 | Studio Agent Framework 不綁模型，要自備 `AgLlmAdapter`；AI 模組要 `STUDIO-PRO-AI` 類型的 licence，試用 key 是否含 AI 未寫明 [碼] | https://www.ag-grid.com/studio/react/ai-agents/ |
| 17 | 官方 boilerplate：https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate （Next.js 16、ag-studio 3.0.0；**沒有 LICENSE 檔**，不能照抄代碼）；它的 payouts 表由 Transaction Search 推出，沒呼叫 Payouts API；App 要開 Transaction search [碼] | 同左 |
| 18 | `ag-grid-community`、`ag-grid-react` 36.2.0 為 MIT [官] | https://github.com/ag-grid/ag-grid/blob/latest/LICENSE.txt |
| 19 | 試用期：10-22 申請約 12-06 到期，蓋不到評審期末 12-15；10-31 之後申請才蓋得到（起算點為簽發日屬推測） | 推算 |
