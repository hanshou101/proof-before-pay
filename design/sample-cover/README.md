# 封面樣板（主控打樣，2026-11-03）

> Public snapshot note: the reference thumbnails (`ruler/`), the blind-ranking artefacts (`rank/`) and the internal ticket-by-ticket build logs (`docs/process/`, `docs/friction/`) are not published in this repository. Everything else in this file is as written.


> 品類：**作品封面**（Devpost 圖庫縮圖，3:2，評委在作品列表裡看到的第一眼）。第一份是 Proof Before Pay（AME-900 PayPal；打樣單 AME-1152）。
> 做法出自 skill「带队-旗舰主控」：主控打樣一次 → 盲排過線就停 → 提煉成本目錄 → 派執行方照做。
> **它是示例，不是模板**：換作品，就從新作品的記憶點裡找那一張圖、那一句話；照抄的是做法與檢查。

## 0. 先看結果

| 版本 | 檔案 | 是什麼 |
| --- | --- | --- |
| story（交件用） | `submission/cover-1500x1000.png` | 名字 + 口號 + 真實運行的一張面板（Ana 的付款被攔下，`studi0` 的 0 框起來）+ 一句結論 |
| stamps（備選） | `variants/cover-stamps.png` | 名字 + 口號 + 四枚印章（Owed／Payee／Policy／PayPal）+ 一句說明 |

盲排第 1 輪（主控校準，2026-11-03）：兩版和 8 件得獎作的縮圖一起（3:2 灰底，另附 300px 圖庫圖），隨機字母、只看圖。

| 評委 | story | stamps | 排在 story 之下的得獎作 |
| --- | --- | --- | --- |
| Sonnet 5.5 | 1／10（8） | 2／10（7.5） | 8／8 |
| Fable 5.1 | 3／10（8） | 2／10（8） | 7／8（只輸 Fire Drill） |

兩版都過線（兩位評委都排在 ≥ 3 件得獎作之上；用戶點頭前不算定案）。交件用 story：兩位都說它是全場最好的故事；它的弱點（300px 下細節看不清）記在第 6 節。要換成 stamps，把 `variants/cover-stamps.png` 拷成 `submission/cover-1500x1000.png` 即可。字母對照與評委原話在 `rank/r1/`。

## 1. 樣板本身與出圖命令

| 東西 | 在哪 |
| --- | --- |
| 版式 | `video/src/Cover.tsx`（Remotion still；`variant` 是 `story` 或 `stamps`） |
| 素材 | `assets/panel-ana@2x.png`、`assets/payee-ana@2x.png`：真實運行的面板截圖（DPR 2），由 `apps/web/e2e/record-demo.ts` 在錄影時一起拍 |
| 字體、顏色 | `design/fonts/`（Plus Jakarta Sans、IBM Plex Mono）、`design/tokens.css` 的 `fintech-precise` |
| 出圖與自檢 | `scripts/video/cover.mjs` |

```bash
(cd video && npm install)                         # 和影片共用
node scripts/video/cover.mjs                      # → submission/cover-1500x1000.png ＋ -300w.png（圖庫大小）
node scripts/video/cover.mjs --variant stamps     # → proof/video/test/cover-stamps.png
```

`cover.mjs` 檢查 1500×1000、≤ 5 MB，並出一張 300px 寬的小圖：交件前看小圖，名字要讀得出來。

## 2. 尺子：每件學哪一點

縮圖（縮到 360px 寬，只作參考，公開倉庫不帶）在 `ruler/`。

| 尺子 | 出處 | 學這一點 |
| --- | --- | --- |
| Fire Drill | Cal Hacks 13.0，[Apify] 1st Customer Award；devpost.com/software/fire-drill | 一個前後對比的大數字（13/24 → 0/24）就是整個故事；300px 下照樣讀得出（第 1 輪 Sonnet 排第 3、Fable 排第 1） |
| Close Controller | Syndicate by Maximor，Track 2；devpost.com/software/close-controller | 一句主張當主角（「It refuses to pay twice.」）。弱點：作品名太小、右半空白、不是 3:2 |
| Monte | ACM TrojanHacks 2026，Best Project in Finance；devpost.com/software/monte-calygj | 一句有個性的標語。弱點：其實是官網截圖，導覽列是雜訊 |
| MergeGate | Build with Gemini XPRIZE，Agentic Economy Prize；devpost.com/software/mergegate | 一個圖示在縮圖裡很醒目。弱點：沒有作品名，看不出是哪件 |
| Reckon | Syndicate by Maximor，Track 2 第 1 名；devpost.com/software/reckon | 編輯式排版。**反例**：一頁文字縮成縮圖，只剩灰色紋理 |
| LEGR | HackPrinceton Spring '26；devpost.com/software/legr | **反例**：整張儀表板縮小，作品名只剩角落小 logo |
| Meridian | Syndicate by Maximor，Track 2；devpost.com/software/meridian-autonomous-month-end-close | **反例**：瀏覽器截圖，連網址列都在，什麼都讀不出 |
| FundMyCollege | PayPal Hack-ATL 2018，1st Place；devpost.com/software/fundmycollege | 名字最好讀。弱點：通用素材圖，說不出作品做什麼 |
| 宿主與平台 | Devpost 圖庫規格（用戶貼的表單原文）；PayPal 使用者協議 | 「JPG, PNG or GIF format, 5 MB max file size. For best results, use a 3:2 ratio.」；不用 PayPal 標識、字標與按鈕樣式（只在文字裡提 PayPal） |

## 3. 從尺子讀出的做法（檢查表）

1. **3:2 原生**：1500×1000 直接做，不要讓 Devpost 補灰邊。
2. **名字是最大的字**：300px 寬時名字 ≥ 18px 高。
3. **一個記憶點**：一張真實的產品局部（不是整屏）或一個前後對比的數字；兩者擇一，不要都放。
4. **一句口號**，一句結論；其餘不放。
5. **深底白字**：圖庫裡多半是淺色截圖，深底會跳出來；顏色只用 tokens。
6. **不用宿主商標**：不放 PayPal 的標識與字標。

## 4. 步驟（每步怎麼判斷做對了）

| # | 做什麼 | 判斷做對了 |
| --- | --- | --- |
| 1 | 收尺子：得獎作縮圖 ≥ 5 件、Devpost 規格；每件寫「學哪一點」 | 第 2 節那張表每行都有出處 |
| 2 | 從影片的記憶點挑一張真實的產品局部（錄影時用 DPR 2 拍） | 局部放大到封面寬度還是清楚，不是放大的 1x 截圖 |
| 3 | 改 `Cover.tsx`：名字 → 口號 → 記憶點 → 結論 | 1500×1000 看一次，300px 小圖看一次：名字讀得出 |
| 4 | 出兩版（記憶點版、概念版），一起盲排 | `cover.mjs` 的 `problems` 是空的 |
| 5 | 盲排（`design/sample-video/README.md` 第 7 節的工具）：過線就停，弱點寫第 6 節 | 兩位評委都排在 ≥ 3 件得獎作之上 |

## 5. 踩過的坑

1. **框住那個 0 要用頁面座標換算**：面板截圖是 DPR 2，框的位置從錄影時 beat 量到的 CSS 框換算（`Cover.tsx` 的 `PANEL`）；pad 太大會壓到旁邊的字（第一版 pad 5 壓到「i」與「-」，改 3）。
2. **同一個詞別出現兩次**：第一版結論行又放了一顆「Held」，和面板上的重複；改成一句白字。
3. **顏色只用 tokens**：第一版結論用了 tokens 以外的粉紅；改回白字。

## 6. 已知弱點與改法（照抄進下一份任務書；等用戶認可）

1. **story 版在 300px 下記憶點看不清**（Sonnet 5.5：「The card text is tiny at 300 px, so the key detail only reads once you zoom in.」；Fable 5.1：「at 300 px only the title, the Held badge line and the footer survive, the actual trick is lost」）。改法：記憶點只取一行（例：`billing@studi0-north.example` 那一行），放大到 300px 下字高 ≥ 8px（封面上 ≥ 40px 的等寬字），其餘面板內容不放。驗：300px 小圖裡讀得出那個 0。
2. **stamps 版的圖是通用圖案**（Sonnet 5.5：「generic dark-mode startup styling with no distinctive image, and the footer line is too small to read」；Fable 5.1：「the four-checkmark row is a generic motif」）。改法：要用概念版，就把一個印章換成作品專屬的狀態（例：Payee 一枚是紅的「held」），並刪掉底下那行小字。驗：同上。

## 7. 沒做的

- 不同家族的評委：驗收時用子單派。
- Devpost 圖庫的其餘圖片：用 `docs/img/` 的真實運行截圖（`docs/05-SUBMISSION.md` §2 列了順序），沒有另外設計。
