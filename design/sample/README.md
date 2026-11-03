# 網頁儀表板樣板（主控打樣，2026-11-01）

> Public snapshot note: the reference thumbnails (`ruler/`), the blind-ranking artefacts (`rank/`) and the internal ticket-by-ticket build logs (`docs/process/`, `docs/friction/`) are not published in this repository. Everything else in this file is as written.


> 品類：**網頁儀表板**（清台作戰樣板登記，AME-1134）。第一份是 Proof Before Pay 的主屏「Friday payout run」（AME-900 PayPal）。
> 做法出自 skill「带队-旗舰主控」：主控打樣一次 → 盲排過線就停 → 提煉成本目錄 → 派執行方照做。
> **它是示例，不是模板**：換宿主、換題目，尺子要重收，版式從新的尺子裡讀。照抄的是做法、素材與檢查，不是 PayPal 的配色。

## 0. 先看結果

| 圖 | 是什麼 |
| --- | --- |
| `shots/before-hero-done-1280x720.png` | 打樣前（main `a373fb9`，T8 第 3 輪交付） |
| `shots/hero-done-1280x720.png` | 樣板 v1（commit `31a7443`），真實運行 `data/e2e/ac13b`，選中 Ana |
| `shots/hero-done-1440x900.png` | 同上，1440×900 |
| `shots/hero-loading-1280x720.png` | 載入骨架（快照還沒到） |

盲排第 1 輪（主控校準，2026-11-01）：v1、打樣前與 7 件得獎作一起，隨機字母、只看圖。

| 評委 | v1 名次 | 排在 v1 之下的得獎作 | 打樣前 |
| --- | --- | --- | --- |
| Sonnet 5.5 | 1／9（8.8） | 7／7 | 3（7.5） |
| Fable 5.1 | 1／9（8.8） | 7／7 | 5（7.5） |

兩位都把 v1 排在至少 3 件得獎作之上：過線（用戶點頭前不算定案）。完整名次與評委原話在 `docs/07-UI.md` §6。

## 1. 樣板本身

| 東西 | 在哪 |
| --- | --- |
| 預設（色板、字體、圓角、陰影） | `design/tokens.css` 的 `fintech-precise` 區塊 |
| 字體 | `design/fonts/`：Plus Jakarta Sans 400–800（`@fontsource/plus-jakarta-sans` 5.3.0，OFL 在 `OFL-PlusJakartaSans.txt`）、IBM Plex Mono 400／500 |
| 字級階梯 | `apps/web/src/styles.css` 頂部註解：12 標籤｜14 次要｜16 正文｜20 面板標題｜28 總額｜40 主句 |
| 主句與總額 | `apps/web/src/components/RunHero.tsx` |
| 清單 | `apps/web/src/components/RunList.tsx`（表頭、行、`rowNote`） |
| 詳情面板 | `apps/web/src/components/DetailPanel.tsx` |
| 載入骨架 | `apps/web/src/components/HeroSkeleton.tsx` |
| 尺子圖 | `ruler/`（只作參考：不放進產品、視頻、README 首圖） |

出圖（真實運行，需要 `.env` 的沙箱金鑰；`data/e2e/` 已在就只跑最後一行）：

```bash
npx --prefix apps/web tsx apps/web/e2e/ac11.ts        # data/e2e/ac11（運行中那張）
npx --prefix apps/web tsx apps/web/e2e/ac13.ts b      # data/e2e/ac13b（完成態）
npx --prefix apps/web tsx apps/web/e2e/ac14.ts        # data/e2e/ac14（對照模式）
(cd apps/web && npx vite build && npx tsx scripts/screenshots.ts)   # → proof/ui/，並跑適配斷言
git checkout -- proof/                                # 本機跑出的日誌含本機路徑，不提交
```

## 2. 尺子：每件學哪一點 → 樣板裡落在哪

圖在 `ruler/`；得獎作是盲排用的同一張（裁掉外框、1240×790 灰底）。原圖網址見各作品頁。

| 尺子 | 出處 | 學這一點 | 樣板裡 |
| --- | --- | --- | --- |
| w01 Reckon | Syndicate by Maximor，Track 2 第 1 名；devpost.com/software/reckon | 金額是行與詳情裡最醒目的數字；判斷、理由、證據疊在確認鈕之前 | 金額 16px/700 等寬、發票號在下；面板：狀態＋標題 → 收款人比對 → AI 說明 → 理由 → 按鈕 |
| w03 Close Controller | Syndicate，AI Grants India Credits；devpost.com/software/close-controller | 四格總額各帶一個語義色 | 總額卡每格標籤前一顆語義色點 |
| w04 MergeGate | Build with Gemini XPRIZE，Agentic Economy Prize（Circle）；devpost.com/software/mergegate | 付款證明是看得見的一欄，不是腳註 | 已證實的行，說明寫 PayPal 回執號 |
| w05 LEGR | HackPrinceton Spring '26，Best Business and Enterprise Hack；devpost.com/software/legr | 一個巨大的主角撐起層級，平面、不靠漸層與軟陰影 | 主句 40px/800；陰影只用兩級 |
| w06 FinTerra | Knight Hacks VIII，Prettiest Hack；devpost.com/software/finterra | 每張卡同一套外殼 | 白卡、12px 圓角、`--shadow-1`、同一種標題列 |
| w07 B2B Invoicing | Square Developer Hackathon 2023；devpost.com/software/b2b-invoicing | 大金額配淡色標籤與副行，一屏看完應付全貌 | 總額卡：標籤、金額、「4 payments」；一屏不捲動 |
| w11 Meridian | Syndicate，AI Grants India Credits；devpost.com/software/meridian-autonomous-month-end-close | 擋下的項目用有標籤的理由解釋 | 面板的「Why it's held」條列 |
| 宿主 h01、h02（A1、A6） | 宿主 2025 年產品圖與設計系統 | 中性底、主操作是黑色膠囊、藍只給連結與焦點 | `--accent` 近黑、`--accent-text` 藍；按鈕全是膠囊 |
| 宿主 h03（A7） | 同上 | 總額是一張白卡，格間細線，標籤在上、大數字在下 | `.kpis`／`.kpi` |
| 宿主 h02（A7） | 同上 | 狀態是一顆徽章，行高寬鬆 | `.chip` 26px 膠囊；行高 ≥ 40px |
| 宿主 h07 | 同上 | 步驟清單：走到哪一步看得出來 | 四枚印章用一條細線串成「證明鏈」 |
| 宿主 h08 | 同上 | AI 的聲音很安靜：一個小星號，不用漸層 | 「AI risk note」前一個 `sparkles`＋小「AI」標記 |
| 社區 C1 Mercury | HN Launch 2019 等 | 字與數字的對齊撐起層級，一個克制的強調色 | 等寬數字、金額右對齊 |
| 社區 C2 Stripe | Stripe Apps 徽章文件 | 徽章按「要人做什麼」定義，別的不給顏色 | 只有 Held（要你處理）是實心；Proven 淡綠、Awaiting 描邊 |
| 社區 C3 Ramp／Brex | adminlte 2026 綜述 | 例外優先 | 主句第二行「2 need your review.」用 warning 色 |
| 反例 X2 Robinhood | CNBC 2021-03-31 | 不慶祝錢的移動 | Proven 靜靜地淡綠，不加動效 |
| 反例 X3 宿主新版 App | unstar.app 2026-10-03 | 裝飾不能把錢的狀態推出首屏 | 主句與總額在最上面 |

刻意沒照尺子的三處（記一筆，交用戶定）：

1. **琥珀**：宿主現行識別沒有琥珀或黃（A4）。Held 是這個作品的主角狀態，要和 proven 綠、stopped 紅分開，所以保留 `--warning`，只用在 held 與主句第二行。
2. **字體**：宿主字體是專有的（A5），不模仿。調研推論原是「留 IBM Plex Sans」；主句要 800 的重字面，樣板換成 Plus Jakarta Sans（OFL，幾何無襯線），電郵與雜湊仍是 IBM Plex Mono。
3. **字級**：倉庫內規是「一屏最多 4 級」（AGENTS.md §4.6）。主句與面板標題要再多兩級，樣板用 6 級；改成機器查得了的規矩：字號只來自 styles.css 頂部的階梯（和 Dinner Tower 同一個取捨，用戶 10-31 認可過那一次）。

## 3. 從尺子讀出的做法（網頁儀表板，可當檢查表；每場要重讀）

1. **一句話當主角**：頁面最大的字是一句話，說現在怎樣、要你做什麼（「4 paid with proof. / 2 need your review.」）；不是頁面標題，也不是 logo。
2. **總額一張卡**：四格同一張白卡，格間細線；標籤在上、28px 金額、副行在下。
3. **一行兩層**：左邊名字＋一句說明（這一筆為什麼是這個狀態）；金額＋發票號右對齊成一欄。
4. **證明鏈**：檢查步驟用同一種圖標串成一條線，看得出走到哪一步。
5. **狀態片按要人做什麼上色**：要人處理的才實心；已完成淡色；等待描邊。
6. **一個實心主操作**：黑色膠囊每屏只一顆；藍只給連結與焦點；綠只代表 proven。
7. **詳情面板先結論後證據**：狀態片＋20px 標題同一行；關鍵比對放在一口淺灰「井」裡；理由條列；按鈕在最下面。
8. **一屏裝下**：1280×720 不捲動、不截斷、不疊壓；放不下就減內容，不縮字。

## 4. 步驟（每步怎麼判斷做對了）

| # | 做什麼 | 判斷做對了 |
| --- | --- | --- |
| 1 | 收尺子：得獎作 ≥ 5 件（有畫面、記獎項與網址）、宿主規範與產品圖、社區正反例；每件只寫「學哪一點」 | 第 2 節那張表每行都有出處 |
| 2 | 改 `design/tokens.css` 的預設區塊：中性底、主操作色、連結色、語義色 | `python3 scripts/check_tokens.py` →「对比度全部达标」 |
| 3 | 字體 woff2 放 `design/fonts/`，`styles.css` 用 `@font-face` 本地載入；用到的每個字重都有字面 | `node scripts/measure-ui.mjs`：「字體不回落」「不合成粗體」PASS |
| 4 | `styles.css` 頂部宣告一次字級階梯，其餘只用 `--fs-*`；顏色只用變量 | `node apps/web/scripts/scan-tokens.mjs` 無裸值；measure-ui「字號只來自樣板階梯」PASS |
| 5 | 版式由上而下：主句＋總額卡 → 清單 → 詳情面板（第 3 節八條） | 1280×720、1440×900 截圖和尺子並排看 |
| 6 | 欄位一改，骨架跟著改：`HeroSkeleton.tsx` 用同一套格線與尺寸 | hero-loading 截圖不溢出 |
| 7 | E2E 依賴的選擇器原樣保留（第 5 節第 5 條） | `npm test`、`npx tsc --noEmit`、E2E 全過 |
| 8 | 真系統出圖（第 1 節命令） | `screenshots.ts` 0 problem；`measure-ui.mjs` 全過 |
| 9 | 盲排（skill UI.md 第 3 節）：過線就停，弱點寫進第 6 節 | 兩位評委都排在 ≥ 3 件得獎作之上 |

## 5. 踩過的坑

1. **行內說明的寬度**：說明句擠在彈性的第一欄，太長就被省略號吃掉。長 ID 在代碼裡從中間截（`22X97452UC…923U`），句子寫短；欄寬先給說明句，再分給金額、印章、狀態。原本的 `scrollWidth > clientWidth` 會四捨五入到整數像素，漏掉了一次只差不到 1px 的省略號（「…second invoi…」），`screenshots.ts` 現在直接量文字寬。
2. **骨架照舊格線**：`.skeleton-row` 寫死了舊的 8 欄格線，版式一改，hero-loading 就溢出。骨架和真行共用同一組 class 與尺寸。
3. **面板內容滑到按鈕列底下**：按鈕列是 `margin-top: auto` 貼底，內容一長就從它底下穿過去；沒有元素溢出，被蓋住的字也不在最上層，疊壓檢查看不到。v1 的 hero-done 只剩 1px；hero-running 證據區（Evidence）的最後一行被按鈕列的分隔線劃過、壓住 16.4px（真實運行）；設計夾具的 hero-done 蓋住 20px。`screenshots.ts` 與 `measure-ui.mjs` 現在都量「內文最後一行到按鈕列 ≥ 16px」。
4. **面板按鈕**：448px 寬的面板，三顆按鈕要一行放下，只能用 `btn--sm`（36px 高、14px）；40px 的膠囊只給頁頭。
5. **E2E 選擇器不能動**：`.topbar .btn--primary`；`.kpi-amount` 四個，依序 proven、awaiting、held、stopped，空值顯示「—」；`.run-row[data-item-id]` 裡有 `.chip`；`.run .run-banner`；`.run-foot .ledger`；`.drawer`；截圖腳本等 `.run-row` 出現。
6. **商標**：PayPal 只在文字裡當資料來源出現（「PayPal sandbox」「PayPal receipt …」）；不用它的標識、字標、專有字體與按鈕樣式。代碼註釋寫「宿主」，出處寫在本 README。調研者另提一點 [推測]：「Proven by PayPal」可能被讀成 PayPal 背書，中性寫法是「Proven: PayPal receipt matched」，頁腳加「Not affiliated with or endorsed by PayPal」。這是 SPEC 文案，樣板沒改，交用戶定。
7. **`.env` 裡不要有 `PBP_ALLOW_COMPARISON=1`**：AC-14 要的是對照模式預設拒絕（403），開著它 AC-14 會失敗。
8. **盲排只排了完成態**：其他態只靠共用 CSS 帶過去，沒對尺子看過。hero-running 的兩個問題（第 3 條；主句折成三行，見第 6 節第 4 條）都是這樣漏的。照樣板做時，每一態都要截圖看。

## 6. 已知弱點與改法（照抄進下一份任務書；等用戶認可）

第 1、3 條與第 2 條前半，是盲排第 1 輪兩位評委各自點的最弱點；第 2 條後半與第 4 條是真實運行截圖新看到的；第 5 條是 `docs/07-UI.md` §6 舊必改清單裡還沒做的。量測在 commit `31a7443` 上照實不過這幾條，照樣板做的人要讓它們全過。

1. **成句的字太小太密**（Sonnet 5.5）：AI 說明、「Why it's held」、面板說明、出錯橫幅、Verify 指示是 14px。改 16px（07-UI §6 D1-1）；AI 說明 ≤ 140 字元、1280×720 下 ≤ 3 行。放不下就減內容，不縮字。驗：measure-ui「正文 ≥ 16px」。
2. **理由條列貼著按鈕列**（Sonnet 5.5）：hero-done 只剩 1px；hero-running 證據區的最後一行被按鈕列壓住 16.4px。內文最後一行到按鈕列分隔線 ≥ 16px；放不下就減內容（例：運行中的面板，證據只留和這一步有關的幾行，其餘交給「Open proof bundle」），不縮字、不加捲動。驗：`screenshots.ts` 0 problem；measure-ui「按鈕列上方留白 ≥ 16px」。
3. **印章欄頭擠成一串**（Fable 5.1）：「Owed」「Payee」「Policy」「PayPal」幾何上對齊（差 0px），但字與字之間只有 4.2–5.5px。字距 ≥ 8px：證明鏈欄從 164px 加寬（從第一欄拿寬度，行內說明照樣不能被截斷），或換更短的欄頭。驗：measure-ui「表頭對齊 ±1px、印章欄頭字距 ≥ 8px」。
4. **運行中的主句折成三行**（真實運行截圖新看到的）：「Checking 5 of 9 invoices. Nothing is paid until it's proven.」在 40px、約 510px 寬裡折成三行，最後一行只剩「proven.」，總額卡被往下推。每一態的主句 ≤ 2 行；放不下就減字（例：運行中只留「Checking 5 of 9 invoices.」，口號留給空態），不縮字。驗：`screenshots.ts` 與 measure-ui「主句 ≤ 2 行」。
5. **舊必改清單未完成的**：D1-2 卡內空白 ≤ 120px（空態、出錯態、1440 下的面板）、D1-3 `.dialog-amount` 要 Mono 600 字面、D1-4 `0` 的高亮不佔寬、D1-6 進行中狀態片看不見邊、D1-7 選中行的頭像、D1-8 時間線樣式、D1-9「Why it's held」「Why it's blocked」照抄、D1-10 對話框金額加「Held amount」。D1-5 由樣板的新表頭取代，D1-13 已做。

## 7. 盲排工具（主控用，執行方不用）

- `ruler/w*.png`：7 件得獎作，已經裁好、放在同一張 1240×790 灰底上；`rank/winners-r1.json` 記每張的原圖網址、作品頁、取圖日期與裁切框。
- `rank/compose.mjs`：把我們的新截圖放上同一張灰底（`node design/sample/rank/compose.mjs <spec.json> <輸出目錄>`）。
- `rank/shuffle.py`：查 md5、隨機字母命名、key 另存（`python3 -I design/sample/rank/shuffle.py <題目目錄> <key 檔> <圖>...`）。
- `rank/judge_prompt.md`：第 1 輪的評委提示詞；判據是比賽 Design 一條的原文加五個子題，各輪照用，名次才可比。`{{N}}`、`{{IMAGES}}` 換成張數與圖的路徑。

## 8. 沒做的（交給照樣板做的人）

- 空、運行中、出錯三態，證明包抽屜、Verify payee 對話框、Inbox、Ledger、Comparison：只跟著共用 CSS 變了，沒有對尺子逐張看過。
- 封面與視頻（T12，閘 D 通過後）。
- 盲排驗收：照 skill UI.md 第 3 節，由主控另派；至少一位不同家族的評委用子單派。
