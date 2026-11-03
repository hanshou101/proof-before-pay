# 演示影片樣板（主控打樣，2026-11-03）

> Public snapshot note: the reference thumbnails (`ruler/`), the blind-ranking artefacts (`rank/`) and the internal ticket-by-ticket build logs (`docs/process/`, `docs/friction/`) are not published in this repository. Everything else in this file is as written.


> 品類：**演示影片**（Devpost 類比賽的 3 分鐘內 demo：真實運行錄屏 + 英文旁白 + 字幕）。第一份是 Proof Before Pay（AME-900 PayPal；打樣單 AME-1152）。
> 做法出自 skill「带队-旗舰主控」：主控打樣一次 → 盲排過線就停 → 提煉成本目錄 → 派執行方照做。
> **它是示例，不是模板**：換比賽、換作品，尺子要重收，旁白與剪輯表從新的作品裡寫。照抄的是做法、工具鏈與檢查，不是 PayPal 的故事。

## 0. 先看結果

- 成片：`proof/video/proof-before-pay-demo.mp4`（不進 Git；公開倉庫 Release 附件）。2:15（135.1 s），1920×1080 H.264 + AAC 192k，響度 −14.1 LUFS（LRA 2.9），Whisper 回聽與旁白稿逐字比對 WER 0.3%（唯一差異：「Sent」聽成同音的「Cent」，字幕寫的是 Sent）。
- 盲排第 1 輪（主控校準，2026-11-03）：成片和 7 件得獎作一起，隨機字母，評委只看分鏡圖（同一組時間點）、前 3 分鐘逐字稿與片長。

| 評委 | 我們的名次 | 排在我們之下的得獎作 | 分數 |
| --- | --- | --- | --- |
| Sonnet 5.5 | 1／8 | 7／7 | 9/10 |
| Fable 5.1 | 1／8 | 7／7 | 9/10 |

兩位都把它排在至少 3 件得獎作之上：過線（用戶點頭前不算定案）。字母對照與評委原話在 `rank/r1/`。

## 1. 樣板本身與出片命令

| 東西 | 在哪 | 做什麼 |
| --- | --- | --- |
| 錄製驅動 | `apps/web/e2e/record-demo.ts` | 真 server、真沙箱、真模型跑一遍演示路線；每頁一路 CDP screencast（JPEG 幀 + 牆鐘時間）；每個故事節點記一筆 beat（時間 + 相關元素的框，CSS px） |
| 幀 → 素材片 | `scripts/video/frames-to-mp4.mjs` | 按每幀的真實時長拼成 CFR 30 fps 的 H.264，旁邊寫 `t0` |
| 旁白稿 | `docs/video/narration.json` | 每段一行英文；只說錄到的事 |
| 旁白合成 | `scripts/video/tts.py` | Kokoro-82M（Apache-2.0，本機跑），逐句合成、句間 0.25 s，所以每句的起點是精確的 |
| 剪輯表 | `docs/video/script.json` | 每段：素材的起訖（「beat±秒」）、速度、變焦、框、標籤、欄位高亮、出處 |
| 計劃 | `scripts/video/plan.mjs` | 把剪輯表對上 beat 與旁白時間，寫出逐幀計劃 `video/src/generated/plan.json` |
| 故障演練卡 | `scripts/video/fault-card.mjs` | 從故障 take 的帳本與 PayPal 回查日誌取原文，寫 `fault.json` |
| 合成 | `video/src/Demo.tsx`（Remotion 4.0.539） | 鏡頭（變焦）、框與標籤、游標、字幕、片名卡、架構卡、故障卡、收尾卡；顏色字體只用 `design/tokens.css` |
| 出片與自檢 | `scripts/video/render.mjs` | `--stills` 先出關鍵幀；全片出完做響度與格式檢查 |

```bash
# 0. 一次性
(cd video && npm install)                      # Remotion 4.0.539、React 19（版本釘在 video/package.json）
npx --prefix apps/web playwright install chromium   # 連同 chrome-headless-shell；Remotion 也用它出圖
# Kokoro 模型（約 350 MB，不進 Git）放 ~/.cache/kokoro-onnx/：kokoro-v1.0.onnx、voices-v1.0.bin
#   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

# 只改剪輯、不重錄：第 1 輪錄好的素材與旁白在 Release 附件裡（約 26 MB），下載後跳過第 1–3 步
#   gh release download ame-1152-demo-v1 --repo hanshou101/hackathon-2026-paypal --pattern 'pbp-video-footage-r1.tar.gz'
#   shasum -a 256 pbp-video-footage-r1.tar.gz   # 933617f2439edacf788979ec6b2a43e4057062d1025924002d9a8445de62b1db
#   mkdir -p proof/video && tar -xzf pbp-video-footage-r1.tar.gz -C proof/video

# 1. 錄（要 .env 的沙箱與模型金鑰；main 約 $18k、fault 約 $3.7k 沙箱額度）
npx --prefix apps/web tsx apps/web/e2e/record-demo.ts take2 main
npx --prefix apps/web tsx apps/web/e2e/record-demo.ts take1 fault

# 2. 幀 → 素材片
node scripts/video/frames-to-mp4.mjs proof/video/take/take2 comparison inbox run
node scripts/video/frames-to-mp4.mjs proof/video/take/take1 fault

# 3. 旁白
uv run --python 3.12 --with kokoro-onnx==0.4.9 --with soundfile==0.13.1 \
  python -I scripts/video/tts.py docs/video/narration.json proof/video/narration

# 4. 計劃（每改一次剪輯表或旁白就重跑）
node scripts/video/fault-card.mjs && node scripts/video/plan.mjs

# 5. 關鍵幀先看（幾秒一張；名字可以寫「段名±秒」）
node scripts/video/render.mjs --stills cold=cold+13,ana=ana+1.6,arch=arch+5,end=end+3

# 6. 出全片（約 10 分鐘）→ proof/video/proof-before-pay-demo.mp4 與 -poster.png
node scripts/video/render.mjs
```

## 2. 尺子：每件學哪一點 → 樣板裡落在哪

影片不進 Git；網址與獎項在下表，逐字稿與分鏡在主控的工作目錄（盲排用，`rank/blindprep.py` 說明格式）。

| 尺子 | 出處 | 學這一點 | 樣板裡 |
| --- | --- | --- | --- |
| Fire Drill | Cal Hacks 13.0，[Apify] 1st Customer Award；devpost.com/software/fire-drill；181 s | 開場一句主張配一個前後對比的數字；字幕全程燒進畫面；收尾給可以動手的東西 | 0–15 s 先放對照模式的真實失敗；全程字幕；收尾卡寫倉庫網址 |
| Close Controller | Syndicate by Maximor，Track 2 AI Grants India Credits；devpost.com/software/close-controller；267 s | 旁白先講問題；高潮是系統拒絕重付；有基線對比 | 對照模式當基線；Kenji 的重付被擋是第一個攔截 |
| Reckon | Syndicate by Maximor，Track 2 第 1 名；devpost.com/software/reckon；293 s | 用真資料講出最有力的論證 | **反例**：前 60 s 是終端機，評委在這裡就走了。終端只當輔證卡（故障演練） |
| LEGR | HackPrinceton Spring '26，Best Business and Enterprise Hack；devpost.com/software/legr；142 s | 第一幀就是產品 | **反例**：同一個靜止畫面停了一分多鐘。任何畫面超過 5 s 要有變焦、框或標籤的變化 |
| MergeGate | Build with Gemini XPRIZE，Agentic Economy Prize（Circle）；devpost.com/software/mergegate；236 s | 一個具體的失敗案例（碰了受保護的檔就拒絕） | **反例**：沒寫稿的旁白（「as you can see」）。每句先寫進 `narration.json`，再合成 |
| Monte | ACM TrojanHacks 2026，Best Project in Finance；devpost.com/software/monte-calygj；77 s | 動態卡片和品牌一致 | **反例**：只有音樂與卡片，沒有產品在跑 |
| PayPal Teen | PayPal Hack-ATL 2018，2nd Place；devpost.com/software/paypal-teen；117 s | 問題與方案說得清楚 | **反例**：無聲投影片，沒有演示 |
| 宿主 | PayPal 更新 #47306（paypalaihackathon.devpost.com/updates/47306） | 「Open with the problem and who it's for, then show PayPal and AI working end to end.」「Cut loading screens and setup steps. An AI voiceover is fine.」 | 開場是問題，Maya 是「給誰」；等待的段落加速並標出「4× speed」「+2 min later」 |
| Devpost | help.devpost.com/article/84-video-making-best-practices | 「explain what your app does … in the first few seconds」；錄屏加旁白 | 15 s 片名卡：名字 + 一句話 |

## 3. 從尺子讀出的做法（檢查表；每場要重讀尺子）

1. **開場講問題，用真實運行**：前 15 s 是作品要解決的失敗真的發生（這裡是對照模式），不是 logo、不是終端、不是投影片。
2. **片名卡在問題之後**：名字 + 一句話，4 s 左右。
3. **一個具體的人、一個有出處的數字**：Maya；FBI IC3 的 BEC 損失（出處掛在畫面右上角）。
4. **一次運行走完主線**：每段一個狀態、一句話、一個畫面重點（變焦 + 框 + 標籤）。
5. **畫面跟著旁白的句子走**：變焦、框、標籤綁在句子起點（`{"sentence": n, "frac": x}`），不是綁在秒數上。
6. **字幕全程**：底部居中、42px/600、深底；框的標籤 30px；任何要讀的字 ≥ 20px。
7. **快轉必標，跳接必標**：「4× speed」「+1 min later」；全部來自真實錄影，不重演、不做假畫面。
8. **技術段 = 一張圖 + 一個證明**：架構圖一句話講完（「The LLM proposes. The gate disposes.」），接著放故障演練的實錄與帳本原文。
9. **收尾卡**：名字、口號、倉庫網址、「Every product shot … is a real run in the PayPal sandbox.」。
10. **長度 ≤ 2:30**：評委只看前 3 分鐘，留餘量。

## 4. 步驟（每步怎麼判斷做對了）

| # | 做什麼 | 判斷做對了 |
| --- | --- | --- |
| 1 | 收尺子：得獎作 ≥ 5 件（有影片、記獎項與網址）、宿主的影片指引；每件只寫「學哪一點」 | 第 2 節那張表每行都有出處 |
| 2 | 先寫旁白稿（`narration.json`），每句只說錄到的事；數字配出處 | 每個數字在 `docs/research/` 找得到原文 |
| 3 | 寫錄製驅動：路線照旁白走，每個要框的元素在 beat 裡記框 | `beats.json` 裡每個 beat 的 `boxes` 沒有 `null`（第 5 節第 3 條） |
| 4 | 錄：smoke 先跑一次確認幀數與解析度，再錄正式 take | 幀是 1920×1080；`frames.json` 的相鄰幀間隔沒有大於 0.5 s 的洞（狀態變化的那幾秒尤其要看） |
| 5 | 幀 → 素材片；旁白合成 | 每頁一支 mp4 + `t0`；`timing.json` 每句有起訖 |
| 6 | 寫剪輯表 → `plan.mjs` | plan 印出的每段長度合理、總長 ≤ 150 s |
| 7 | 關鍵幀：每段至少一張，標籤出現的那一刻各一張 | 框框住的是旁白講的那一個東西；標籤不出畫面、不壓住要讀的字；變焦到位的時刻和那一句的起點差 ≤ 0.5 s |
| 8 | 出全片 | `render.mjs` 印出 `problems: []`（H.264 1920×1080、AAC、< 180 s） |
| 9 | 回聽：Whisper 轉寫成片，和旁白稿逐字比 | WER ≤ 2%；同音字靠字幕消歧 |
| 10 | 盲排（第 7 節）：過線就停，弱點寫進第 6 節 | 兩位評委都排在 ≥ 3 件得獎作之上 |

## 5. 踩過的坑

1. **screencast 掉幀**：`Page.startScreencast` 設 `everyNthFrame: 2`，狀態一瞬間變化（Held 出現、點擊）的那幾幀會掉，總結頁甚至整段沒錄到。改 1。
2. **1920×1080 的幀**：只設 context 的 `deviceScaleFactor: 1.5`，screencast 的幀還是 1280×720；Chromium 要帶 `--force-device-scale-factor=1.5` 啟動。
3. **beat 的框是 `null`**：第一版把「已經量好的框」當成 locator 再量一次，得到 `null`（take2 的 run-done、run-started、ana-rejected、leo-proven）。現在 `beat()` 認得 `Box`；`plan.mjs` 另外能從整列框推出一格（`kpis/4:0`）或右端（`row@right:170`）。
4. **運行總結偶發「Connection error.」**：模型連線偶發失敗，整次運行停在出錯態。重錄，不為偶發特例改產品（用戶 11-03：「偶发的网络堵塞，是属于【特例情况】…没必要往【特例情况】上长久倾斜」）；驅動在 log 裡寫「RUN HAD ERRORS」，錄完先看 log。
5. **Remotion 下載 Chrome 失敗**：在代理後面 ECONNRESET，`NODE_USE_ENV_PROXY` 也沒用。改用 Playwright 的 chrome-headless-shell（`--browser-executable`；`render.mjs`、`cover.mjs` 自動找，`REMOTION_BROWSER` 可覆寫）。
6. **Whisper 在 SOCKS 代理下**：`mlx-whisper` 要加 `--with socksio --with "httpx[socks]"`。
7. **旁白先於畫面**：「One character.」念完了才變焦到那個 0。變焦綁在點擊之後的 beat，而這一句在點擊之前就開始了。改法：素材從點擊前 0.7 s 開始、旁白 lead 1.1 s，讓這一句落在變焦途中。
8. **變焦之後標籤出畫面、壓字**：標籤一律夾在畫面內；空間不夠用 `labelAt`（`above`／`below`／`inside`／`inside-right`）或 `labelPos`（頁面 CSS 座標，跟著鏡頭走）。對照表的三個框標籤放在列內空白處，不變焦。
9. **縮小的卡片字 < 20px**：架構圖原本縮成 0.64 倍給故障演練讓位，節點說明掉到 16px。改成兩段：架構一段、故障演練一段，不縮放。
10. **同音字**：Kokoro 念「Sent」和「Cent」一樣，Whisper 聽成 Cent。字幕會消歧；關鍵詞別只靠一個同音字承擔。
11. **沙箱額度**：main 一次約 $18k、fault 約 $3.7k；餘額 API（`GET /v1/reporting/balances`）是過期快照，不能拿來判斷夠不夠，看回執。錄之前請用戶把 business 帳號餘額設高（用戶 11-03：「把大部分的 商业账号 余额设置为 10万左右了」）。
12. **金鑰與帳本**：錄影在倉庫的臨時副本（`git archive`）上跑，`.env` 600 權限，錄完連副本一起刪；一個沙箱帳號的帳本只能配同一組金鑰（不同帳號查不到彼此的 batch）。
13. **macOS shell**：zsh 的 `set -- $spec` 不分詞（用 `bash -c`）；沒有 `timeout` 指令。

## 6. 已知弱點與改法（照抄進下一份任務書；等用戶認可）

第 1、2 條是盲排第 1 輪兩位評委點到的最弱點；第 3 條是主控自己看分鏡看到的。

1. **30–75 s 的畫面太密、字太小，靠字幕撐**（Sonnet 5.5：「The screen is dense in places and the small text is hard to read」；Fable 5.1：「the UI frames are dense and small at 30–75 s, so a few moments rely on the captions rather than the screen」）。改法：運行段（四枚印章依次點亮）變焦 ≥ 1.45 並對準旁白正在講的那一欄；任何 1.0 倍的畫面停留不超過 3 s。驗：關鍵幀每 15 s 一張，焦點區的字放到 1920 寬時 ≥ 20px。
2. **收尾沒有再說一次「給誰」**（Fable 5.1：「ends at 135 s without a closing recap of who it is for」）。改法：收尾卡加一行「For studios that pay freelancers with PayPal.」（或該作品的對象），收尾卡 ≤ 6 s。驗：收尾卡關鍵幀。
3. **第 0 幀是一張還空著的對照表**（主控看分鏡）：前 1.5 s 只有表頭與一句說明。改法：素材從第一筆付款出現前 0.2 s 開始，或第 0 幀疊一句主張（Fire Drill 的做法）。驗：第 0 s 與第 3 s 的分鏡格裡看得到「發生了什麼」。

## 7. 盲排工具（主控用，執行方不用）

- `rank/blindprep.py`：一次備好影片、封面、文案三份題目（分鏡圖、逐字稿、片長；3:2 灰底封面與 300px 圖庫圖；文案 Markdown），隨機字母、md5 查重、key 另存。用法寫在檔頭。
- `rank/criteria.md`：三份共用的判據前半——比賽 Stage Two 五條評審標準原文；後半的五個子題寫在 `rank/judge-prompts.md`，各輪照用，名次才可比。
- `rank/r1/`：第 1 輪的 key（字母 → 作品）與兩位評委的原話。

## 8. 沒做的

- 不同家族的評委（GPT-6.1、Grok 等）：skill 規定驗收時要有一位，用子單派；這一輪是主控自己校準。
- YouTube 上傳（用戶，`docs/05-SUBMISSION.md` §5）；公開倉庫 Release 掛片（T12 執行方）。
