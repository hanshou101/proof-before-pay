# 問題數據與出處（T1 偵察，2026-10-22）

> 每條格式：數字或結論 → 原文引文 → URL → 發布機構與年份 →「適合放哪」。
> 規矩：只引原始報告／原始頁面的原文；沒有可靠出處就寫「沒找到」，不用二手轉述代替原文。影片時間碼照 `docs/01-SPEC.md` §3。
> 讀取日期：2026-10-22（PDF 下載後用 `pdftotext -layout` 抽文字核對）。

## 摘要

| 條 | 一句話 | 關鍵數字 | 出處（機構，年份） | 適合放哪 |
| --- | --- | --- | --- | --- |
| (a) | 企業電郵詐騙（BEC）是損失第二大的網路犯罪類型 | 2025 年 24,768 件、$3,046,598,558 | FBI IC3《2025 Internet Crime Report》，2026 | 影片 0:18–0:32 的問題數字；README「解決什麼問題」 |
| (b) | 「冒充供應商、改收款帳戶」的付款轉向詐騙有明確定義與年度損失 | 2025 年英國 2,305 件、£41.3m，68% 在企業帳戶 | UK Finance《Annual Fraud Report 2026》，2026-06 | 影片 0:18–0:32、1:05 記憶點；README |
| (c) | 應付帳款連頂尖組織都有 0.8% 的付款是重複或錯誤付款 | 頂尖 0.8%、落後 2%（占年度付款筆數） | APQC 基準（CFO.com 2020-03-03 刊出；Oversight 2023 轉引） | 影片 1:00–1:05「Paid once. Never twice.」；README |
| (d) | 自由工作者被遲付、被欠款是普遍現象 | 54% 職涯中遇過；平均被欠 £5,230；18% 等超過 3 個月 | IPSE（英國），2024-07-24 | 影片 0:18–0:32；README「這是給誰的」 |
| (e) | 提示注入是 LLM 應用的第一號風險，能讓模型做未授權的事 | OWASP LLM01:2025 條目 | OWASP GenAI Security Project，2025 | 影片 1:05–1:15（郵件指令被忽略）；README「為什麼 AI 不能自己決定付款」 |

---

## (a) 企業電郵詐騙（BEC）的年度損失

**結論**：2025 年 FBI IC3 收到 BEC 投訴 **24,768 件**、報損 **$3,046,598,558**；BEC 是當年損失第二大的犯罪類型，僅次於投資詐騙。全年全部投訴 1,008,597 件、報損超過 $20 billion（$20.877 billion），較 2024 年增加 26%。

**原文引文**：

1. 年報開頭（p.3）：
   > "In 2025, losses reported to IC3 continued to climb, surpassing the $20 billion mark. Investment-related fraud was once again the largest component of these losses, followed by business email compromises and tech support scams."
2. 三年比較表（p.25–26，`By Complaint Count` / `By Complaint Loss`）：
   > "BEC 24,768 21,442 21,489"
   > "BEC $3,046,598,558 $2,770,151,146 $2,946,830,270"
   （欄位順序：2025、2024、2023）
3. 附錄 B 定義（p.59）：
   > "Business Email Compromise (BEC): BEC is a scam targeting businesses or individuals working with suppliers and/or businesses regularly performing wire transfer payments. These sophisticated scams are carried out by fraudsters by compromising email accounts and other forms of communication such as phone numbers and virtual meeting applications, through social engineering or computer intrusion techniques to conduct unauthorized transfer of funds."

**URL**：https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf

**機構與年份**：FBI Internet Crime Complaint Center（IC3），*2025 Internet Crime Report*（檔案 Last-Modified：2026-04-16；本次讀取 2026-10-22）。

**適合放哪**：影片 0:18–0:32（Maya 出場後的「一句問題數字」）；README 的「解決什麼問題」第一段。

**限制**：這是「向 IC3 報案的損失」，不是全部實際損失；未報案的不在內。

---

## (b) 「改收款帳戶 / 冒充供應商」類詐騙（vendor email compromise、payment redirection）

**結論**：英國 2025 年的 invoice & mandate scam（發票與收款指令詐騙）共 **2,305 件、損失 £41.3m**；其中 **68%（£28m）發生在企業（non-personal）帳戶**，48% 的損失被追回。作案手法正是「冒充供應商、聲稱銀行帳戶變了」。

**原文引文**（p.41–42）：

> "In an invoice or mandate scam, the victim attempts to pay an invoice to a legitimate payee, but the criminal intervenes to convince the victim to redirect the payment to an account they control."
>
> "It includes criminals targeting consumers posing as conveyancing solicitors, builders, and other tradespeople, or targeting businesses posing as a supplier, and claiming that the bank account details have changed. This type of fraud often involves the criminal either intercepting emails or compromising an email account."
>
> "68 per cent (£28 million) of invoice and mandate scam losses occurred on a non-personal or business account. Typically, businesses make genuine higher-value payments more regularly, making it harder to spot and stop a fraudulent one."

**URL**：https://www.ukfinance.org.uk/system/files/2026-06/UK%20Finance%20Fraud%20Report%202026.pdf

**機構與年份**：UK Finance，*Annual Fraud Report 2026*（2026-06 發布，數據年度 2025；p.41–42）。

**適合放哪**：影片 0:18–0:32 的問題鋪陳、1:05–1:15 的記憶點（Ana 的收款帳戶 `studi0` 冒充 `studio`）；README 的「問題」段。

**限制**：只有英國數據；不要寫成「全球」。

---

## (c) 應付帳款重複付款的比例或金額

**結論**：APQC 的應付帳款基準顯示，**連頂尖組織每年也有 0.8% 的付款筆數是重複或錯誤付款**，落後組織是 **2%**——這是「付款筆數占比」，不是金額占比，一筆錯付就可能是數萬美元。

**原文引文**：

1. CFO.com（APQC 的 Metric of the Month 專欄，2020-03-03，作者 Perry D. Wiggins, CPA／APQC 財務長）：
   > "Data from APQC’s Open Standards Benchmarking® Accounts Payable survey shows that on average, even top performers report that nearly a full percentage point (0.8%) of their annual disbursements are duplicate or erroneous. Bottom performers report more than twice that amount at 2% of total annual disbursements."
2. Oversight《Disarming Risk in Accounts Payable》（2023，Duplicate Payments 節）轉引同一個基準：
   > "Data from APQC’s Open Standards Benchmarking® Accounts Payable survey indicates that companies make duplicate or erroneous payments at a rate of 0.8% to 2%."

**URL**：
- https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/656852/
- https://www.oversight.com/hubfs/assets/Resources/Whitepapers-and-Guides/Disarming-Risk-in-AP-2023.pdf

**機構與年份**：APQC（非營利基準與最佳實務研究機構）的 Open Standards Benchmarking 應付帳款調查；CFO.com 於 2020-03-03 刊出；Oversight 2023 年的 AP 風險報告轉引同一數字。

**適合放哪**：影片 1:00–1:05（Kenji INV-0142 被攔下，「Paid once. Never twice.」）；README 的「問題」段。

**限制**：數字出自 APQC 的基準調查，公開可查的最新原始文章是 2020 年、Oversight 2023 年轉引；沒有找到更新的公開原始數字。用的時候說「AP 行業基準」，不要說「最新數據」。

---

## (d) 自由工作者被晚付、付錯的痛點

**結論**：英國 IPSE 的調查：**54%** 的自由工作者職涯中遇過客戶遲付，**35%** 在過去 12 個月遇過；平均被欠 **£5,230**；**18%** 等超過三個月；**31%** 做完工作沒收到錢。

**原文引文**：

> "Over half of freelancers (54%) reported that have experienced a delay in payment from a client in their self-employed career … Of these, over a third (35%) reported that they have experienced a delay in payment from a client in the last 12 months."
>
> "…the average amount that freelancers are currently owed in late payments has remained relatively stable at £5,230 - up from £5,140 in 2020."
>
> "A further 28 per cent stated that they had to wait between a month and three months for payment whilst concerningly, 18 per cent of freelancers reported that they had to wait more than three months for payment."
>
> "…a third of freelancers (31%) reported that they have completed work and not been paid for it, with 16 per cent of these experience an instance of unpaid work in the last 12 months."

**URL**：https://www.ipse.co.uk/campaigns/prompt-payment/late-payment-within-the-self-employed-sector

**機構與年份**：IPSE（Association of Independent Professionals and the Self-Employed，英國），《Late payment within the self employed sector》，頁面 `datePublished` 2024-07-24。

**適合放哪**：影片 0:18–0:32（Maya 付 20 位自由工作者的背景）；README 的「這是給誰的」。

**限制**：英國樣本、自我回報；不要寫成「全球自由工作者」。

---

## (e) AI agent / LLM 被提示注入（prompt injection）的權威說法

**結論**：OWASP 把 **Prompt Injection 列為 LLM 應用的第一號風險（LLM01:2025）**：輸入裡的指令會改變模型行為，可能導致模型把資料傳錯地方、提供未授權的功能存取、在連接的系統執行任意命令。

**原文引文**（OWASP GenAI）：

> "A Prompt Injection Vulnerability occurs when user prompts alter the LLM’s behavior or output in unintended ways. These inputs can affect the model even if they are imperceptible to humans, therefore prompt injections do not need to be human-visible/readable, as long as the content is parsed by the model."
>
> "Prompt Injection vulnerabilities exist in how models process prompts, and how input may force the model to incorrectly pass prompt data to other parts of the model, potentially causing them to violate guidelines, generate harmful content, enable unauthorized access, or influence critical decisions."
>
> "Generally, however, prompt injection can lead to unintended outcomes, including but not limited to: … Providing unauthorized access to functions available to the LLM … Executing arbitrary commands in connected systems … Manipulating critical decision-making processes"

**URL**：https://genai.owasp.org/llmrisk/llm01-prompt-injection/

**機構與年份**：OWASP GenAI Security Project，《OWASP Top 10 for LLM Applications 2025》，條目 **LLM01:2025 Prompt Injection**（2025）。

**適合放哪**：影片 1:05–1:15（Ana 的郵件裡寫給 AI 的指令被忽略）；README「為什麼 AI 只能提議、閘來決定」。

---

## 沒有找到的

- 無。以上 (a)–(e) 都找到原始報告或原始頁面的原文；兩處限制已寫在各自小節（(b) 只有英國、(c) 原始數字較舊）。
