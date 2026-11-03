# 00-BRIEF：比賽規則拆解

> 角色：主控代寫 §1–5、§7、§8（賽道單 AME-900）；§6 由偵察票 T1 補。只寫事實與出處，不寫「打不打」。原文用引號，換算的時間注明「北京時間」。
> 核實日期：2026-10-22（北京時間）。`/rules` 有 Cloudflare 驗證，用第二台 Mac Mini 有頭 Chrome（Playwright `channel:'chrome'`）讀到全文。各頁原文快照留在私有工作倉庫，公開快照不帶這個目錄。

## 1. 基本信息

| 項 | 內容 | 出處（URL） |
| --- | --- | --- |
| 比賽名稱 | PayPal AI Hackathon: "Build what's next with PayPal and AI" | https://paypalaihackathon.devpost.com/ |
| 主辦 / 賽道 | Sponsor：PayPal Inc.；Administrator：Devpost。**不分賽道**："There are no prescribed problem statements and no set of tracks." | `/rules` §2；首頁 |
| 官方頁 / 規則頁 | 首頁、`/rules`、`/details/faqs`、`/resources`、`/updates`、`/details/dates`、贊助商頁 `/details/<aggrid、apimatic、render…>` | 同上 |
| 報名截止（北京時間） | 無單獨報名截止；提交期內點「Join hackathon」並建 Devpost 帳號即可 | `/rules` §4 "How To Enter" |
| 提交期（北京時間） | "Thursday Oct 1, 2026 (9:15 am Pacific Time) – Thursday Nov 12, 2026 (12:00 pm Pacific Time)" = 10-02 00:15 → **11-13 04:00**（`/details/dates`："November 13 at 4:00AM GMT+8"）。11-01 起美西已是冬令時（UTC−8），換算無誤 | `/rules` §1；`/details/dates` |
| 評審 / 公布 | 評審 "Tuesday Dec 1, 2026 (2:00 pm Pacific Time) – Tuesday Dec 15, 2026 (8:00 am Pacific Time)" = 北京 12-02 06:00 → 12-16 00:00；公布 "On or around Monday, Dec 21, 2026 (2:00 pm Pacific Time)" = 北京 12-22 06:00（`/details/dates` 寫 12-22 01:00，兩處不一致；規則 §11 寫明以 Official Rules 為準） | `/rules` §1、§11 |
| 獎項 | 總計 "$67,500 in cash"（首頁另寫 "$69,750 in total prizes"，差額是 Render credits）。Grand：1st $12,000、2nd $8,000、3rd $5,000。Honorable Mention 各 $5,000：Most Creative、Most Impactful、Best Demo Delivery、Best Use of PayPal + AI、Best Use of Agentic Commerce。Sponsor：AG Grid 1st $5,000 / 2nd $2,000 / 3rd $1,000×3；APIMatic $1,000×3 + 6 個月 Business 訂閱；Bryntum $1,000×3；Channel3 $1,500×1；Render credits $1,000 / $750 / $500 | `/rules` §8；首頁 PRIZES |
| 兼得規則 | "A project can only win up to one (1) Grand Prize and one (1) Sponsor Prize OR one (1) Honorable Mention Prize and one (1) Sponsor Prize." | `/rules` §8 |
| 資格原文（中國大陸、個人） | "Individuals who are at least the age of majority where they reside as of the time of entry"；Teams、Organizations 也可；排除 "Brazil, Quebec, Russia, Crimea, Cuba, Iran, and North Korea and any other country which is comprehensively sanctioned by the U.S. Treasury's Office of Foreign Assets Control" → **中國大陸未被排除；個人可參賽** | `/rules` §3 |
| PayPal 帳號與資格是兩回事 | FAQ："PayPal account sign-up options vary by country, so if you can't complete sign-up from where you live (for example, your country or phone number isn't offered), please ask the PayPal team in the PayPal Discord. Being able to open a PayPal account is separate from hackathon eligibility" | `/details/faqs` |
| 參賽規模 | Participants 18,461（2026-10-22 讀取；10-13 為 13,174） | 首頁導航欄 |

## 2. 提交物清單（逐項；包裝票按這張表打勾）

| # | 提交物 | 規則原文 | 格式 / 上限 / 語言 |
| --- | --- | --- | --- |
| 1 | 作品本身 | "Include a Project built with the required developer tools and meets the above Project Requirements." | 見 §4 |
| 2 | 文字說明 | "Include a text description that should explain the features and functionality of your Project." | 英文 |
| 3 | 可運行的演示 | "Provide access to a functional demo of your application. Your project does not need to be publicly hosted or deployed — but judges must be able to actually run or interact with a working build." 二選一："clear, complete setup and run instructions in your code repository … OR A hosted demo URL." "A design mockup, static prototype, or non-functional demo does not meet this requirement." | README 逐步可跑，或線上地址 |
| 4 | 工具說明 | 首頁 WHAT TO SUBMIT："Tools - identify which tools (model or AI service) were used and explain how the tools were used in your project." | 表單欄位，英文 |
| 5 | 公開代碼倉庫 | "Provide a URL to your public code repository for judging and testing on GitHub, Bitbucket, or Gitlab." "must contain all necessary source code, assets, and instructions" "must be public and open source by including an open source license file. This license should be detectable and visible at the top of the repository page (in the About section)." | GitHub 公開倉庫 + LICENSE（GitHub About 欄認得出來） |
| 6 | 演示視頻 | "should be less than three (3) minutes. Judges are not required to watch beyond three minutes"；"should include footage that shows the Project functioning on the device for which it was built"；"must be uploaded to and made publicly visible on YouTube"；"must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission" | **< 3:00**、YouTube 公開、英文、無版權音樂 |
| 7 | 測試權限 | "Access can be provided … by including complete setup and run instructions in your project's code repository …, along with any test account credentials, API keys, or sandbox login details necessary to run and test the Project." "The Entrant must make the Project available free of charge and without any restriction, for testing … until the Judging Period ends." | 評審要的沙箱憑證放測試說明；可用到 12-16 |
| 8 | 既有項目說明（若適用） | "Entrants should explain how their Project was significantly updated during the Submission Period." | 本作品 10-22 起全新建倉，不適用（見 §5） |
| 9 | 語言 | "All Submission materials must be in English or … provide an English translation" | 全英文 |

## 3. 評審標準

兩階段。Stage One："pass/fail whether the ideas meet a baseline level of viability, in that the Project reasonably fits the theme and reasonably applies the required APIs/SDKs featured in the Hackathon." Stage Two 五項**等權**：

| 維度 | 權重 | 規則原文 |
| --- | --- | --- |
| Technological Implementation | 1/5 | "How thoroughly and skillfully does the project use PayPal Developer Platform and AI tool(s)? Does the project reflect genuine effort and a working, non-trivial implementation?" |
| Design | 1/5 | "Does the project deliver a complete, coherent product experience — not just a technical proof of concept?" |
| Potential Impact | 1/5 | "Does the project make a credible, specific case for solving a real problem for a real audience — and does the solution actually address that problem based on what's demonstrated?" |
| Innovation/Idea | 1/5 | "How creative and novel is the concept and does the project differ from existing concepts?" |
| Presentation | 1/5 | "Does the video clearly demonstrate the project working end-to-end? Does the pitch communicate what problem is solved, who it's for, and why it matters? Is the overall presentation easy to follow?" |

- 同分：先比 Technological Implementation，再依序往下比（`/rules` §6 Tie Breaking）。
- 評審方式："This process may utilize expert panels, peer review, automated AI-driven analysis, or any combination thereof"——README 與文字說明可能先被 AI 讀，結構要清楚。
- "Judges are not required to test the Project and may choose to judge based solely on the text description, images, and video provided in the Submission."——封面、視頻、說明決定大部分分數。
- 評委 13 位（首頁 JUDGES）：PayPal 6 位（Developer Advocate ×3、Software Engineer、Engineering Manager、Senior Product Manager），AG Grid、APIMatic、Bryntum、Channel3、Elastic、Postman、Render 各 1 位。

## 4. 技術硬約束（必須用的平台、API、模型、部署位置）

- "Entrants must build or update an application that integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of their choice"；PayPal 範圍 "includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet …"。
- 首頁："Meaningfully integrate at least one PayPal technology, API, SDK, product, or developer capability"、"Meaningfully incorporate AI into the experience or functionality"、"Demonstrate a working prototype or proof of concept"、"Be sufficiently documented for the judges to understand and evaluate it"。"Any AI tool works, as long as PayPal integration is central to the project."
- "Functionality: The Project must be capable of being successfully installed and running consistently on the platform for which it is intended and must function as depicted in the video and/or expressed in the text description."
- 第三方 SDK / API / 資料要有使用授權（`/rules` §4 Third Party Integrations）。
- 官方資源（`/resources`）：PayPal REST API、JavaScript SDK v6、Payouts、Invoicing、Subscriptions、Disputes、Webhooks、Pay Later；AI：PayPal AI Toolkit（https://github.com/paypal/AI-Toolkit ）、https://docs.paypal.ai/ 的 Agent Toolkit quickstart、MCP server quickstart、Agent tools reference；沙箱入門 https://github.com/paypaldev/getting-started-with-paypal-sandbox 。
  - 查證（`docs/research/paypal-facts-2026-10-22.md`）：`paypal/AI-Toolkit` 是給 AI 編碼工具用的外掛；程式庫是 npm `@paypal/agent-toolkit` 1.11.0 與 `@paypal/mcp` 1.8.1，47 個工具裡**沒有 payouts**。三個 docs.paypal.ai 鏈接已失效（301 → 404），新址 https://developer.paypal.com/ai-tools/agent-tools 等。官方說可用 PayPal Developer 帳號測美國整合：沙箱用 US 帳號與 USD。
- 官方靈感（`/resources` INSPIRATION）原文摘錄："Build autonomous agents or workflows that use PayPal to take action on a user's behalf — not just recommend, but actually transact. Think: … a scheduling assistant that pays contractors automatically when a job is marked complete, or two agents negotiating and settling a payment between themselves"；"a payout tool for gig workers that pays out the moment a task is approved"；"an invoicing tool built for freelancers who bill in multiple currencies"。
- 贊助商工具（選用；FAQ："you'll be considered for the sponsor prize of each tool you use, but a single project can win at most one Sponsor Prize"）：
  - **AG Grid**（`/details/aggrid`）：評的是 **AG Studio**——"This award covers both what your dashboard looks like and how you build it. Show us polish: custom widgets, theming, and layout tools, not just AG Grid or AG Charts on their own. Take Studio Agent Framework for a spin: a custom agent talking to Studio's built-in agents, or a swapped-in harness." 授權："free 45-day trial license"；官方備了 "a boilerplate with AG Studio and PayPal set up"。
  - **APIMatic**（`/details/apimatic`）：Context Plugin for PayPal，給 Claude Code 這類 AI 編碼工具用；"Participants who used the Context Plugin to build their PayPal integration → 1 month of APImatic Basic, free."
  - **Render**（`/details/render`）：$50 credits；部署並用 Render Workflows。獎品只有 credits。
  - 其餘（Astropods、Bryntum、Channel3、Elastic、KERNEL、Postman、Zapier）與本作品無直接關係，頁面原文在快照目錄。

## 5. 知識產權與開源要求

- "All Submissions remain the intellectual property of the individuals or organizations that developed them."；主辦方取得評審用的非獨佔授權，並可在三年內宣傳作品與參賽者姓名肖像（`/rules` §7、§10）。
- 必須是原創、完全由參賽者擁有；可用開源軟體，但要遵守其授權，並且 "creates software that enhances and builds upon the features and functionality included in the underlying open source product"（`/rules` §4 Intellectual Property）。
- 可找第三方做技術協助，前提是 "the Submission components are solely the Entrant's work product and the result of the Entrant's ideas and creativity"。
- 新舊作品："Projects must be either newly created by the Entrant or, if the Entrant's Project existed prior to the Hackathon Submission Period, must have been significantly updated after the start of the Hackathon Submission Period."——比賽道章程寫的「必須新做」寬；本倉庫 10-22 從模板新建，代碼全部在提交期內寫成。同題材的 Airwallex 申請（AME-844）只交了構想文字，沒有代碼。
- 排除："A Project must not have been developed, or derived from a Project developed, with financial or preferential support from the Sponsor or Administrator."
- 同一參賽者可交多件，但 "each Submission must be unique and substantially different"。

## 6. 往屆 / 本屆已公開作品（5 個）

> 偵察票 T1 補，核實日期 2026-10-22。本屆作品廊尚未發布（"The hackathon managers haven't published this gallery yet"）。
> 選件順序照任務書：Devpost 往屆 PayPal / 支付類黑客松得獎作品 → 其他黑客松得獎作品 → 已上市產品。**往屆查證結果**：PayPal Hack-Chicago（Devpost）與 PayPal Hack-ATL（2018-10-12/13）都有得獎名單，但都是消費理財／金融普惠題材——Chicago：Glim 還債、Fi 儲蓄、Ajo 互助、Sprout 工資透明、SplitIt 分帳、USustain 眾籌、FICY 理財教育、ATU 語音助理；ATL：FundMyCollege、PayPal Teen、$can（AR 數鈔票）。兩份名單都沒有應付帳款或付款防詐題材。故 5 行取第三順位「已上市產品」的產品頁，覆蓋題目的三個面：應付帳款自動化（Ramp、Vic.ai、Tipalti）、付款詐騙防護（Eftsure）、AI agent 付款（Skyfire）。
> 截圖：Playwright headless Chromium 1280×800，2026-10-22 現場載入 `proof/refs/<slug>.png`；Tipalti、Eftsure 的 cookie 橫幅已先按「Reject」關掉。
> 評審評語：這 5 個都不是黑客松作品，沒有評審評語；有用戶評語的引原文，沒有的寫「頁面未說明用戶評語」，另附頁面自述（標明是廠商說法）。

| 作品 | 一句話 | 鏈接 | 評委 / 用戶為什麼喜歡它（原文） | 與 Proof Before Pay 的差異（一句） | 截圖 |
| --- | --- | --- | --- | --- | --- |
| Ramp Bill Pay | 應付帳款自動化：「A month of AP done in minutes.」——AI 讀發票、coding、2/3-way matching、路由核准 | https://ramp.com/bill-pay | 用戶評語（原文）："With the introduction of agents and AI coding, we've eliminated tedious manual work while streamlining internal processes."——Andrew Clarke, VP Finance, Studs（頁面客戶引語）。頁面自述："Ramp’s agent recommends approvals and flags what needs review so teams make faster, fully informed decisions." | Ramp 的 agent 只「推薦、標記」，靠金額與 PO 比對；沒有把「收款人是不是本人」與「PayPal 回執說錢到了」當成付款前後的必要證明。 | `proof/refs/ramp-bill-pay.png` |
| Vic.ai | AI-first 應付帳款：「AP automation, reimagined.」——發票處理、PO 比對、核准、付款一站 | https://www.vic.ai/ | 頁面未說明用戶評語。頁面自述（官網數據）："85% No-touch rate by month 6"、"99% Invoice accuracy rate without coding or setup required" | Vic.ai 量的是「不用人碰的比例」與 coding 準確率；它不證明這張發票真的欠、收款人真的對，也不以支付商的回執作「已付」的判準。 | `proof/refs/vic-ai.png` |
| Tipalti | 應付帳款 + 全球批量付款 + 供應商自助入駐（AP、Mass Payments、Procurement、Expenses、Treasury 一套） | https://tipalti.com/accounts-payable/ | 頁面未說明用戶評語。頁面自述："Self-Service Supplier Management … Multi-language self-service onboarding to boost efficiency and reduce human errors. Complete supplier visibility."；同一頁的 De-risk 段："Increase financial controls, automate reporting and compliance, and dramatically reduce errors and fraud." | Tipalti 在入駐時收集、驗證收款人資料，之後靠批量付款；每筆付款不再逐一證明「這張發票對得上合約與驗收」，也不把 PayPal 的逐筆回執當成結案條件。 | `proof/refs/tipalti-ap.png` |
| Eftsure | B2B 付款防詐：付款前逐筆核驗供應商銀行資料，"Safeguarding $288B annually" | https://www.eftsure.com/ | 頁面未說明用戶評語。頁面原文："And a payment without verification is just an assumption with money attached. Eftsure is the trust layer enterprise finance teams need to ensure money only moves on certainty."、"Every payee re-verified as details change. Not just at onboarding." | Eftsure 只解「收款人那一枚印章」：不讀發票、不判斷該不該付、也不發起付款；Proof Before Pay 是四枚印章（Owed / Payee / Policy / PayPal）一起才放行。 | `proof/refs/eftsure.png` |
| Skyfire | AI agent 付款基礎設施："The Agent Trust Stack"——給 agent 可驗證身分與支付憑證，讓它能在網站完成登入與結帳 | https://www.skyfire.xyz/ | 頁面未說明用戶評語。頁面原文："Skyfire gives agents verified identity and payment credentials that work across the open internet. No 403 errors, captchas or blocked checkouts." | Skyfire 解「agent 有沒有能力付」；不證明這筆錢該不該付、付給誰、付完有沒有到——那正是 Proof Before Pay 的四枚印章。 | `proof/refs/skyfire.png` |

### 6.1 附註：Devpost 上與本題最接近的公開作品頁（不佔上表 5 行）

> 2026-10-22 用 Devpost 專案搜尋（`https://devpost.com/software/search?query=paypal+payouts`）找到的公開頁面，頁面未見得獎標記、也未標註所屬賽事；它們用本屆贊助商工具（PayPal Orders v2 / Payouts、Channel3、AG Studio、Render），[推測] 為本屆同期作品。只列事實與鏈接，供主控判差異化。

| 作品 | 頁面一句話 | 鏈接 |
| --- | --- | --- |
| Writ | "AI agents can buy things now. Writ checks every PayPal charge against limits you signed before any credential exists, pays exactly once, and keeps a tamper-evident record." | https://devpost.com/software/writ |
| PayOnProof | "An accounts-payable agent that pays subcontractors only for work it can prove: NVIDIA Nemotron on Nebius Token Factory reads the papers, rules prove every line, a person approves, PayPal pays." | https://devpost.com/software/payonproof |
| Kassa | "An AI bookkeeper for small companies: it checks each supplier invoice against what was agreed, settles the difference with the supplier's own bookkeeper and pays through PayPal within limits you set." | https://devpost.com/software/kassa |
| Supplora Pay | "An AP agent for independent restaurants: Claude reads each supplier invoice, checks it against the signed delivery note and price history, and pays via PayPal, only after the owner approves." | https://devpost.com/software/supplora-pay |
| ProofPay | "Clients fund milestones with PayPal; an AI agent checks delivered work against the brief and releases payment, or flags issues with evidence, automatically." | https://devpost.com/software/proofpay-ai-verified-escrow-for-freelance-work |

## 7. 人工步驟（HITL：只有人能做的）

| 步驟 | 在哪裡做 | 最晚什麼時候（北京時間） |
| --- | --- | --- |
| 開 PayPal 開發者帳號（免費），建一個沙箱 REST app，把沙箱 Client ID / Secret 交主控；按 SPEC §9 建 5 個沙箱個人帳號（步驟見 `docs/research/sandbox-setup.md`） | https://developer.paypal.com/ （Dashboard → Apps & Credentials；Sandbox accounts） | 10-27 |
| Devpost 帳號並點「Join hackathon」 | https://paypalaihackathon.devpost.com/ | 越早越好（收得到 Updates）；最晚 11-10 |
| 上傳演示視頻到 YouTube（公開） | YouTube | 11-11 |
| 照 `docs/05-SUBMISSION.md` 填表並點提交 | Devpost "Enter a Submission" | 11-12 22:00（留 6 小時餘量） |
| 若得獎：填 affidavit、W-8BEN 等表，"ten (10) business days after the Required Forms are sent" | 郵件 | 公布後（約 12-22） |

## 8. 風險與未知

- **PayPal 開發者帳號能不能在用戶所在地開**：FAQ 承認因國家 / 手機號而異；開不了要去 PayPal Discord 問，會拖慢沙箱聯調。開戶是第一個 HITL，最晚 10-27。
- **評委多半不會自己跑**：18,461 人報名、作品數以千計，評委 "may choose to judge based solely on the text description, images, and video"。封面、視頻前 10 秒、主屏決定大部分分數（閘 D）。
- **評委要跑的話要憑證**：規則要求附 "sandbox login details"。PayPal 沙箱憑證只能動假錢，放進測試說明；LLM key 請評委自備（OpenAI 相容端點），README 寫明。
- **沙箱 Payouts 的實際行為要實測**：狀態流轉、收款人沒有帳號時的 UNCLAIMED、重複 `sender_batch_id` 的回應，以 T4 拿真憑證實測的結果為準。
- **可能有 AI 自動評審**："automated AI-driven analysis"——README 結構清楚、關鍵詞與評審五項對得上。
- **規則可改**："subject to change at any time"。11-10 檢查點重讀 `/rules` 與 Updates。
- **商標與素材**：視頻不放第三方商標與無授權音樂；PayPal 名稱照實寫，不用其 logo 做裝飾。
- **AG Studio 是商業授權**：只有 45 天試用；評審期（12-02 → 12-16）可能超出試用期。用不用、怎麼用，主控在 SPEC 決策記錄裡定。
