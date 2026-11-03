# PayPal 沙箱開戶圖文步驟（T1 偵察，2026-10-22）

> 給用戶照著做。界面路徑照抄英文原文（PayPal 後台是英文介面）；每一步都附官方出處。
> **本票沒有代任何人註冊或登入**（AGENTS §3 第 9 條停手線）；下面的按鈕名稱與順序全部取自官方文檔，實際畫面若與文檔不同，以畫面為準並在評論裡回報。
> 全程只要一個能收信的電郵；沙箱帳號都是假錢，不要用真實銀行資料。

## 0. 整體流程（4 步，約 15–25 分鐘）

| 步 | 做什麼 | 產出 |
| --- | --- | --- |
| 1 | 註冊 / 登入 PayPal Developer | 一個開發者帳號（沙箱會自動送 1 個 Business + 1 個 Personal） |
| 2 | 建一個 Business 沙箱帳號（United States、balance 50,000、Negative Testing 關） | 付款方（Payouts 的 sender） |
| 3 | 用這個 Business 帳號建 REST app「Proof Before Pay」（Merchant；Features 有 Transaction search 就勾） | Client ID + Secret |
| 4 | 建 5 個 Personal 沙箱帳號（United States、指定電郵） | 5 組收款人電郵（+ 密碼） |

---

## 1. 註冊 / 登入 PayPal Developer

1. 打開 https://developer.paypal.com/ ，右上角按 **Sign Up**（已有 PayPal 帳號就按 **Log In**）。
   - 官方登入入口（文檔用的就是這條）：https://www.paypal.com/signin?returnUri=https%3A%2F%2Fdeveloper.paypal.com%2Fdashboard%2F&intent=developer
   - 註冊入口（developer.paypal.com 的 Sign Up 連到）：https://www.paypal.com/webapps/mpp/account-selection?intent=developer&country.x=US&locale.x=en_US
2. 照畫面填資料、收驗證信並點信裡的連結開通。
   - 官方原文："When you create your developer account, PayPal does a verification check by sending an email to the address you specified. Enable your account by responding to PayPal's email. If you don't receive the verification email within a few minutes after signing up, check to see that it hasn't been blocked or diverted to a spam folder."
   - 出處：https://developer.paypal.com/tools/sandbox/
3. 官方建議：開發者帳號可以另外開一個，「consider creating an account that you don't mind sharing with others on your development team. This way, you can share your sandbox accounts without compromising the security of your personal PayPal account.」（同上）

**做完的判斷**：能進 https://developer.paypal.com/dashboard/ ，左側看到 **Sandbox** 區塊。

---

## 2. 建 Business 沙箱帳號（付款方）

> 註冊完，PayPal 已經自動給了 1 個 Business 與 1 個 Personal 沙箱帳號；這一步是**額外建一個乾淨的 Business**，專門給本作品用。
> 官方原文："When you register as a PayPal developer on the developer site, the PayPal sandbox creates these sandbox accounts: A business account and associated API test credentials. For example, `sb-4i2nn47000072@business.example.com`. A default personal account. For example, `sb-gypf446000721@personal.example.com`."
> 出處：https://developer.paypal.com/sandbox-testing/accounts

1. 進 **Dashboard → Sandbox → Accounts**（直接開：https://developer.paypal.com/developer/accounts ）。
2. 按 **Create Account**。
3. **Account Type** 選 **Business**。
4. **Country** 選 **United States**。
5. 按 **Create Account**。
   - 官方步驟原文（第 1–5 步）："Log in to the Developer Dashboard and navigate to the Sandbox>>Accounts page. Click **Create Account**. Set the **Account Type** to **Business**. Select a **Country**. Click **Create Account**."
   - 若要改 balance、姓名等測試值：在 **Create Sandbox Account** 對話框按 **Create Custom Account**（同上：「If you need more customization of the test values, click **Create Custom Account** in the **Create Sandbox Account** dialog.」）。

### 2.1 PayPal balance 設多少（上限查證）

- 查到的官方文檔裡，**只有批量上傳文檔寫明數值範圍**：`ppBalance` = "A PayPal balance in the range of 0-100000."（https://developer.paypal.com/sandbox-testing/bulk-accounts ）
- → **上限 100,000**；SPEC §9 要的 **50,000** 在範圍內，填 **50000** 即可。
- 單個帳號的 **Create Custom Account** 對話框，官方文檔沒有寫它的 balance 上限；若畫面不接受 50000，就填它能接受的最大值，並把實際值記下來（交主控）。
- Payouts 是從這個 Business 帳號的 balance 出錢；balance 不夠時沙箱會回 `INSUFFICIENT_FUNDS`（可用 `ERRPYO005` 模擬，見 `docs/research/paypal-facts-2026-10-22.md` 第 5 條）。

### 2.2 確認帳號級 Negative Testing 是關的

1. 在 **Sandbox → Accounts** 頁，找到剛建的 Business 帳號，**Manage Accounts** 欄點 **…**。
2. 點 **View/Edit Account** → **Account Details** 對話框 → **Settings** 分頁。
3. 看 **Negative Testing** 是 **Off**；若是 On，改成 **Off** 再 **Save**。
   - 官方步驟原文（第 1–7 步）："Go to the developer.paypal.com home page. Log into the Dashboard and select the menu below your name to select **Dashboard**. Under the **Sandbox** heading in the left navigation column, select **Accounts**. Locate the sandbox account for which you wish to enable negative testing. Choose a business sandbox account or you won't see the options you need. In the **Manage Accounts** column, select the **...** symbol to display the menu choices. Select **View/Edit Account** … Select the **Settings** tab … Set the **Negative Testing** option to **On**."（文檔示範的是設成 **On**；本作品要 **Off**）
   - 為什麼要關（照官方原文說，不是「開了就全部失敗」）：官方原文："Negative testing lets you force the flows through specific error conditions that you want to test to ensure you handle errors correctly."；"You can force two types of API errors: errors related to the transaction amount, and errors not related to the transaction amount."
   - 也就是說：開著時，**涉及這個商家帳號**的交易會依你指定的測試觸發值（例如某個金額）被強制回錯誤，不是所有交易都失敗；演示用的金額若碰上測試觸發值，會變成假錯誤，干擾 P1 對帳與回執判定，所以保持 **Off**。
   - 同一頁那句官方原文："The sandbox is now in the negative testing state for transactions that include the merchant. Without this configuration, the sandbox does not raise error conditions unless the error occurs through normal transaction processing."——它說的是「開啟後生效的範圍」與「沒開時不會強制報錯」，不能讀成「開了會讓所有交易失敗」。
   - 出處：https://developer.paypal.com/tools/sandbox/negative-testing/ （2026-10-23 經 r.jina.ai 取全文核對原文）

---

## 3. 建 REST app「Proof Before Pay」

1. 在 Dashboard 左上把環境切到 **Sandbox**。
2. 左側 **Apps & Credentials** → 右側 **REST API apps** 區按 **Create App**。
3. **App Name** 填 `Proof Before Pay`；**Type** 選 **Merchant**；sandbox business account 選第 2 步建的 Business 帳號；按 **Create App**。
   - 官方步驟原文："Go to your PayPal developer account and toggle to **Sandbox**. Go to **Apps & Credentials** and select **Create App**. Enter your app name, select **Type** as **Merchant**, select the sandbox business account to test your app, and select **Create App**. The app details page is displayed."
   - 出處：https://developer.paypal.com/payouts/use-payouts/set-up （Set up sandbox account for Payouts API integration）
   - Apps 頁直達：https://developer.paypal.com/dashboard/applications/sandbox
4. 在 app 詳情頁複製 **Client ID** 與 **Client secret**。
   - 官方原文："A client secret authenticates a client ID. To call PayPal APIs, you'll exchange your client ID and client secret for an access token. Keep this secret safe."；取得步驟："Select **Apps & Credentials** … select **Create App**. Copy the client ID and client secret for your app."
   - 出處：https://developer.paypal.com/api/rest/
   - **Secret 在哪顯示**：就在 app 詳情頁的 Client ID / Client secret 欄位；官方文檔只寫「copy」，沒有說要不要按顯示鍵。若畫面把 Secret 遮住，找 **Show**／眼睛圖示點開再複製；兩者都只貼給主控（見第 5 節），不要貼在公開地方。

### 3.1 「Transaction search」在功能清單的哪裡勾

- **有這個開關**：PayPal 官方 boilerplate 的 README 原文："The transactions and balances pages also need the app's **Transaction search** feature enabled."（https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate ）
- **在哪裡**：app 詳情頁的 **Features** 區——Payouts 官方文檔在同一個 Features 區掛 webhook："Go to **Features** > **Sandbox Webhooks**."（https://developer.paypal.com/payouts/use-payouts/set-up ）
- **查不到的**：官方文檔沒有逐項列出 Create App 之後 Features 清單裡的勾選項名稱，也沒有寫「Transaction search」確切在清單第幾項。做法：建好 app 後在 app 詳情頁找 **Features**，清單裡看到 **Transaction search** 就勾上（P1 的隔日對帳要用）；沒看到這一項就先不勾，T5 實測若要權限再回報。
- 用途提醒（官方 boilerplate 同頁）："Transaction Search covers at most 31 days per request … New activity can take up to three hours to appear."

---

## 4. 建 5 個 Personal 沙箱帳號（收款人）

SPEC §9 指定的 5 個電郵（美國帳號、全部 Personal）：

| # | 姓名（情境） | 電郵 |
| --- | --- | --- |
| 1 | Priya Nair | `priya@nairwords.example` |
| 2 | Kenji Watanabe | `kenji@kenjimotion.example` |
| 3 | Leo Martin | `leo@polyform3d.example` |
| 4 | Sofia Rossi | `sofia@linguaviva.example` |
| 5 | Tomás Herrera | `tomas@herreraweb.example` |

> 姓名一律照規範資料 `demo/scenario/scenario.json` 的 `vendors[].name` 抄（`ven_priya` Priya Nair、`ven_kenji` Kenji Watanabe、`ven_leo` Leo Martin、`ven_sofia` Sofia Rossi、`ven_tomas` Tomás Herrera），不要自己改姓；建帳號時 first / last name 填錯，沙箱帳號就和演示資料對不上。

> 不要建 Jonas 與 Ana 的帳號（SPEC §9）。

### 4.1 能不能自訂電郵？有沒有批量建立？

**能自訂，也能批量。** 兩條有官方出處的路：

**方法 A（建議，一次建 5 個）：批量上傳 Bulk Account Upload**

- 官方原文："Use *Bulk Account Upload* to upload up to 40 sandbox accounts at a time by configuring and uploading a file with your sandbox account information."
- 檔案格式：UTF-16 **Little Endian**、`.txt` 或 `.csv`、逗號分隔、≤1 MB、最多 40 行資料；第一行必須是表頭。
- 表頭（全部必填，順序照官方）：`country_code,account_type,primary_email_alias,password,first_name,last_name,ppBalance,addBank,ccType,payment_card`
  - `primary_email_alias`："A unique email address for the sandbox account."
  - `ppBalance`："A PayPal balance in the range of 0-100000."
  - 官方範例（兩行；電郵與密碼是官方文件上的範例值，這裡換成佔位符）：
    ```
    country_code,account_type,primary_email_alias,password,first_name,last_name,ppBalance,addBank,ccType,payment_card
    US,BUSINESS,<official sample email>,<official sample password>,Rick,Novak,1001,Y,VISA,PAYPAL
    GB,PERSONAL,<official sample email>,<official sample password>,Sara,Connor,1002,N,MASTERCARD,DISCOVER
    ```
- 本作品要上傳的 5 行（`ccType`、`payment_card` 是必填欄位，照官方範例填 `VISA` / `PAYPAL`；`addBank` 填 `N`）：
    ```
    country_code,account_type,primary_email_alias,password,first_name,last_name,ppBalance,addBank,ccType,payment_card
    US,PERSONAL,priya@nairwords.example,<自訂密碼>,Priya,Nair,1000,N,VISA,PAYPAL
    US,PERSONAL,kenji@kenjimotion.example,<自訂密碼>,Kenji,Watanabe,1000,N,VISA,PAYPAL
    US,PERSONAL,leo@polyform3d.example,<自訂密碼>,Leo,Martin,1000,N,VISA,PAYPAL
    US,PERSONAL,sofia@linguaviva.example,<自訂密碼>,Sofia,Rossi,1000,N,VISA,PAYPAL
    US,PERSONAL,tomas@herreraweb.example,<自訂密碼>,Tomás,Herrera,1000,N,VISA,PAYPAL
    ```
- 上傳位置：**Sandbox → Accounts** 頁（https://developer.paypal.com/developer/accounts ）。
- 密碼欄位自己定（官方只要求是「A password」，沒有寫複雜度規則；建議 ≥8 位、含大小寫與符號）。沙箱密碼不用交給主控。
- 驗證規則官方原文："Each sandbox account email ID must be unique across the file, and it must be an available email address within the sandbox environment."
- 出處：https://developer.paypal.com/sandbox-testing/bulk-accounts （含範例檔下載：https://developer.paypal.com/sandbox-bulk-headers.csv ）

**方法 B（逐個建，再複製改電郵）**

1. **Sandbox → Accounts → Create Account** → **Account Type** = **Personal** → **Country** = **United States** → **Create Account**。
2. 在該帳號的 **Manage Accounts** 欄點 **…** → **Duplicate Account**。
3. 在彈出的視窗改 **email**、**PayPal balance**、**first/last name**，並**設定新密碼**（密碼不會被複製）→ **Create Account**。
   - 官方原文："After you clone an account, you can edit the PayPal balance, first name, last name, and email address. You must also set a password for the new account, the password is not cloned."
   - 出處：https://developer.paypal.com/sandbox-testing/accounts

> **注意（`.example` 域）**：官方只要求電郵在沙箱內唯一、可用，沒有保證接受 `.example` 這種保留域名。若批量上傳或改電郵時被拒，改成系統生成的電郵（格式 `sb-[random-string]@personal.example.com`），把實際電郵記進第 5 節的表格交主控填 `PBP_RECEIVER_MAP`；不要為了讓電郵好看而卡住。

---

## 5. 交給主控的東西

做完把下面這張表填好，貼在賽道單 **AME-900** 的評論裡（主控收進保管庫後會遮掉原文）：

| 項目 | 值 | 從哪裡拿 |
| --- | --- | --- |
| Client ID | `_______` | app 詳情頁 → Client ID |
| Client secret | `_______` | app 詳情頁 → Client secret |
| Business 沙箱帳號電郵 | `_______` | Sandbox → Accounts（系統生成，`sb-...@business.example.com`） |
| Personal 1 電郵 | `_______`（預期 `priya@nairwords.example`） | Sandbox → Accounts |
| Personal 2 電郵 | `_______`（預期 `kenji@kenjimotion.example`） | 同上 |
| Personal 3 電郵 | `_______`（預期 `leo@polyform3d.example`） | 同上 |
| Personal 4 電郵 | `_______`（預期 `sofia@linguaviva.example`） | 同上 |
| Personal 5 電郵 | `_______`（預期 `tomas@herreraweb.example`） | 同上 |
| Business balance 實際值 | `_______` | 帳號 View/Edit → Profile |
| Negative Testing | Off / On | 帳號 View/Edit → Settings |
| Transaction search | 有勾 / 清單沒有這項 | app 詳情頁 → Features |

**規矩**：Client ID / Secret 只貼在 AME-900 那條評論（主控會遮），不進 GitHub、不進截圖、不進日誌。沙箱密碼不用交（T5 的 Payouts 只用 API 憑證；要登入沙箱看餘額時由用戶自己登入）。

---

## 6. 三個問題的速答

| 問題 | 答案 | 出處 |
| --- | --- | --- |
| 建 Personal 帳號能不能自訂電郵？ | 能。批量上傳用 `primary_email_alias` 指定；或建好後 **Duplicate Account** 再改 email。建立單個帳號時系統默認生成 `sb-[random-string]@personal.example.com`，官方文檔沒有說單個建立對話框可直接填自訂電郵 | https://developer.paypal.com/sandbox-testing/bulk-accounts ；https://developer.paypal.com/sandbox-testing/accounts |
| 有沒有批量建立？ | 有，Bulk Account Upload，一次最多 **40 個**（UTF-16LE、≤1MB、`.csv`/`.txt`） | https://developer.paypal.com/sandbox-testing/bulk-accounts |
| Business 帳號的 PayPal balance 上限？ | 官方寫明的範圍是 **0–100000**；SPEC 要的 50000 在範圍內 | https://developer.paypal.com/sandbox-testing/bulk-accounts （`ppBalance`） |
| 「Transaction search」在哪勾？ | app 詳情頁的 **Features** 區；官方 boilerplate 明說要開，但官方文檔沒有列出這個勾選項的精確名稱/位置 | https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate ；https://developer.paypal.com/payouts/use-payouts/set-up |
