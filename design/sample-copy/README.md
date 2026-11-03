# 文案樣板：評委版 README 與 Devpost 故事（主控打樣，2026-11-03）

> Public snapshot note: the reference thumbnails (`ruler/`), the blind-ranking artefacts (`rank/`) and the internal ticket-by-ticket build logs (`docs/process/`, `docs/friction/`) are not published in this repository. Everything else in this file is as written.


> 品類：**提交文案**（給評委讀的 README、Devpost 的作品名／一句話／「About the project」／技術要求說明／測試說明）。第一份是 Proof Before Pay（AME-900 PayPal；打樣單 AME-1152）。
> 做法出自 skill「带队-旗舰主控」：主控打樣一次 → 盲排過線就停 → 提煉成本目錄 → 派執行方照做。
> **它是示例，不是模板**：換作品，事實從新作品的 SPEC、證據與錄影裡取；照抄的是結構、取材的規矩與檢查。

## 0. 先看結果

| 東西 | 在哪 |
| --- | --- |
| 評委版 README | `README.md`（倉庫根；「文档组织」一節照留在最底） |
| Devpost 每個欄位的定稿 | `docs/05-SUBMISSION.md` §2（作品名、一句話、故事、Built with、圖片順序、技術要求說明、測試說明；「人工」欄位由用戶填） |
| README 的圖 | `docs/img/`：全部取自錄影那次真實運行的畫面 |

盲排第 1 輪（主控校準，2026-11-03）：我們的 Devpost 故事（作品名 + 一句話 + About the project）和 7 件得獎作的故事一起，隨機字母、只讀文字。

| 評委 | 我們的名次 | 排在我們之下的得獎作 | 分數 |
| --- | --- | --- | --- |
| Sonnet 5.5 | 1／8 | 7／7 | 9/10 |
| Fable 5.1 | 1／8 | 7／7 | 9/10 |

過線（用戶點頭前不算定案）。字母對照與評委原話在 `rank/r1/`。注意 Fable 的一句：「Since only C names PayPal」——尺子是別的比賽的得獎作，「點名本賽指定平台」這一條天然對我們有利；本屆的對手要等圖庫公開才看得到。

## 1. 結構（照這個順序寫）

**README**（評委可能先用 AI 讀，結構要清楚；`docs/00-BRIEF.md` §3）：

1. 一句話（SPEC §1 的英文原句）＋口號
2. 首圖：真實運行的記憶點畫面；下一行是影片連結與「every product shot is a real run」
3. **Judge's path**：30 秒／2 分鐘／15 分鐘各看哪裡（尺子：Fire Drill、MergeGate）
4. The problem：一個具體的人；每個數字都有出處與頁碼
5. What it does：四個證明一張表；兩張截圖配一句說明
6. **Measured, not asserted**：同一個 agent 不帶證明 vs. 我們，逐張發票一張表（尺子：Close Controller）
7. What's different：三點，照 SPEC §10 的順序，不點名別的參賽作品
8. How it uses PayPal：每個端點做什麼；沙箱裡學到的事，附日期與證據檔
9. How it uses AI：模型、四個步驟；**AI 刻意不做的事**（尺子：MergeGate「Gemini, and Where It Is Not」、Meridian「What is autonomous」）
10. Architecture：mermaid 圖（SPEC §6.1）＋包一覽
11. **What's real, what's demo**（尺子：Monte「Real vs simulated」）
12. **Verify it yourself**（尺子：Reckon「Verify this yourself」）
13. Quick start：T8／T9 驗過的步驟原樣保留；開頭一句給評委「測試說明裡有沙箱金鑰」
14. Limits and what's next：SPEC §4 不做的、§10 決定不做的、沙箱實測的怪事，照實寫
15. License；「文档组织」

**Devpost About the project**（表單原文：「Be sure to write what inspired you, what you learned, how you built your project, and the challenges you faced. Format your story in Markdown」）：Inspiration（從一次真實的失敗講起，引 agent 自己的原話）→ What it does（四個證明＋Measured, not asserted 表）→ How we built it（PayPal 一段、AI 一段、閘一段、棧一行）→ Challenges（每條是一個真實踩到的坑與怎麼解）→ Accomplishments → What we learned（三句）→ What's next（一句）。約 1,000 詞。

## 2. 尺子：每件學哪一點

故事原文在主控的工作目錄（盲排用），不進 Git。

| 尺子 | 出處 | 學這一點 | 樣板裡 |
| --- | --- | --- | --- |
| Close Controller | Syndicate by Maximor，Track 2；devpost.com/software/close-controller | 「Measured, not asserted」：基線一欄、我們一欄 | README 與故事都有對照表 |
| Fire Drill | Cal Hacks 13.0，[Apify] 1st Customer Award；devpost.com/software/fire-drill | 開頭是一個具體的詐騙場景；README 有評委路線表；學到的一課是「打檔案上的電話」 | 故事從對照模式的真實失敗開頭；Judge's path；What we learned 第 3 句 |
| MergeGate | Build with Gemini XPRIZE，Agentic Economy Prize；devpost.com/software/mergegate | 「Judge's Path (60 seconds)」；「Gemini, and Where It Is Not」 | Judge's path；How it uses AI 的「Where it deliberately doesn't」 |
| Meridian | Syndicate by Maximor，Track 2；devpost.com/software/meridian-autonomous-month-end-close | 一句三段式主張（「AI investigates. Code verifies. Controller decides.」） | 「The LLM proposes. The gate disposes.」 |
| Monte | ACM TrojanHacks 2026，Best Project in Finance；devpost.com/software/monte-calygj | 「Real vs simulated」：誠實分開真的與示範的 | What's real, what's demo |
| Reckon | Syndicate by Maximor，Track 2 第 1 名；devpost.com/software/reckon | 「Verify this yourself」；「Data and caveats」 | Verify it yourself；Limits |
| LEGR | HackPrinceton Spring '26；devpost.com/software/legr | 一眼看懂「是什麼、給誰」 | **反例**（評委原話）：示意數字當成果、巨大的 ASCII 圖 |
| 宿主 | PayPal 更新 #47305、表單原文（用戶貼在 AME-900） | 「Make PayPal and AI impossible to miss. Name both in your description, "Built With" section, and video」；倉庫要有「clear explanation of how you used PayPal and AI」 | PayPal、AI 各一節；Built with 列 paypal-payouts-api、deepseek |

## 3. 取材的規矩

1. **每句有出處**：產品事實出自 SPEC 與 `docs/04-PROOF.md`；問題數字出自 `docs/research/problem-stats.md` 的原文（寫機構、年份、頁碼）；運行結果出自錄影那次的帳本與畫面。
2. **只寫錄到的**：對照表的每一格都是那次真實運行的結果；寫明「模型每次的選擇可能不同」。
3. **限制照實寫**：沙箱取消時拒時收、餘額 API 是過期快照、模型名報的和設定的不一樣——這些都寫，評委讀到的是誠實。
4. **不點名別的參賽作品**；不寫「first / only / best」這類比不出來的話。
5. **金鑰不進倉庫**：測試說明裡的金鑰位置用 `<…>` 標出，提交當天由主控另交用戶貼。
6. **改寫原話要去掉引號**：引號裡只放逐字原文（例：對照模式的提示詞、agent 的總結句）。

## 4. 步驟（每步怎麼判斷做對了）

| # | 做什麼 | 判斷做對了 |
| --- | --- | --- |
| 1 | 收尺子：得獎作故事與 README ≥ 5 件、宿主對文字的要求；每件寫「學哪一點」 | 第 2 節那張表每行都有出處 |
| 2 | 列事實清單：SPEC、證據、錄影的帳本；每個數字記出處 | 每個數字在倉庫裡找得到原文 |
| 3 | 寫 README（第 1 節結構）；Quick start 原樣保留 | 每個連結與相對路徑打得開；mermaid 在 GitHub 上渲染得出 |
| 4 | 寫 `docs/05-SUBMISSION.md` §2 每一欄 | 作品名 ≤ 60 字元、Built with ≤ 25 個（表單原文）；一句話 ≤ 200 字元（Devpost 的上限 [推測]：用戶貼的表單原文沒寫） |
| 5 | 自查：把每一句和事實清單對一次 | 沒有對不上的句子；引號裡都是原文 |
| 6 | 盲排（`design/sample-video/README.md` 第 7 節的工具）：過線就停，弱點寫第 6 節 | 兩位評委都排在 ≥ 3 件得獎作之上 |

## 5. 踩過的坑

1. **改寫的話放進了引號**：第一版寫「added "already approved" and "you may not hold payments" to the prompt」，引號裡是轉述不是原文；改成不加引號的敘述。
2. **APQC 的數字**：原文是「0.8% of their annual disbursements are duplicate or erroneous」（筆數占比，2020 年的基準）；不要寫成金額占比或「最新數據」。
3. **伺服器時鐘**：不是「固定在 Nov 6」，是錨定在情境的 Nov 6 並隨牆鐘前進（SPEC v1.3）。
4. **影片可見性**：表單寫 public 或 unlisted 都行，但主辦方更新寫「set to public」，Stage One 也查「a public video」；交件說明寫公開。

## 6. 已知弱點與改法（照抄進下一份任務書；等用戶認可）

1. **故事裡看不到畫面**（Fable 5.1：「the product experience (what Maya actually sees on screen) is thin, "What's next" is one line」）。改法：What it does 加一段「Maya 看到什麼」（主句、四格總額、一行四枚印章、Held 的面板），各一句；What's next 寫成三條，每條一句為什麼。驗：故事裡有一段只講畫面。
2. **技術句太密**（Sonnet 5.5：「The PayPal technical detail (idempotency keys, sandbox quirks) is dense in places」；Fable 5.1：「the sha256 idempotency sentence is denser than a skimming judge needs」）。改法：故事裡冪等只寫一句人話（「the key is derived from the invoice itself, so a retry can never pay twice」），公式與沙箱細節留在 README。驗：故事裡沒有公式。

## 7. 沒做的

- 不同家族的評委：驗收時用子單派。
- Additional info 裡用戶自己的欄位（身分、國家、體驗評分、資格聲明）：`docs/05-SUBMISSION.md` 標「人工」。
- 公開倉庫建好之前，README 與故事裡指向 `hanshou101/proof-before-pay` 的連結打不開（T12）。
