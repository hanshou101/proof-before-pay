# 04-PROOF：你能证明它能用吗？

> 角色：举证。只看实物（运行结果、文件、diff），不看任何人的总结。
> 本次复验：AME-905（T9），2026-11-01 北京时间 13:29–14:40。所有证据在本文件点名，原件在 `proof/t9/`。

## 1. 复验环境

| 项 | 值 |
| --- | --- |
| 全新 clone 的目录 | 执行机工作目录下的一个临时目录（下文称 `t9-fresh`），来自 `git clone https://github.com/hanshou101/hackathon-2026-paypal.git`；跑完不入仓库、不留在仓库里 |
| commit | `a373fb9585098ae284556e8e9bcccf54bb0de398`（`main` 的 HEAD，PR #41 合并之后） |
| 日期（北京时间） | 2026-11-01 13:29 起，14:40 收尾（UTC+8） |
| 机器 / 运行时版本 | macOS（Apple Silicon）· Node **v20.19.4**（fnm）· npm 10.8.2 · zsh · Playwright Chromium headless |
| 模型 | `LLM_MODEL=deepseek-chat`（OpenAI 相容 Chat Completions）。抽取事件里记的是服务端自己回报的模型名 **`deepseek-flash`**（见 §3 数据全链路第 2 段），分类事件里记的是配置里的名字 `deepseek-chat` |
| PayPal | 沙箱（`PAYPAL_ENV=sandbox`），用主控发到执行机的既有凭据。本文件不写凭据的路径与值；`git log -p` 扫描见 §3 AC-17 |
| 依赖版本 | `npm run setup` 按各包 lockfile 装；根 `package.json` 无依赖，六个包各自独立（SPEC §6.0） |

## 2. 只照 README 从零跑通

全新 clone 里第一次执行，**没有改任何源码**。`.env` 由 `.env.example` 复制后按键名填值（11 个键名，7 个有值；脚本按 `.env.example` 的顺序写入，不产生重复键）。

| README 步骤 | 实际命令 | 结果（输出摘要或截图） | 通过？ |
| --- | --- | --- | --- |
| 前置：Node 版本 | `node -v` | `v20.19.4` | 是 |
| 1. 安装与构建 | `npm run setup` | 依次 core → paypal → agent → server → web → demo/generator，`✓ setup complete — 6 package(s) installed and built`，19.8 s（本机 npm 缓存已热） | 是 |
| 2. 配置 | `cp .env.example .env` 后填值 | 11 个键名齐全、无重复；空值与有值并存不报错 | 是 |
| 3. 种下历史付款 | `npm run demo:reset` | `epoch ep-x7cq7115n0d8gf8g` · `history hist_kenji_0142 (1150 USD)` · `payout batch K4DWPVCT96EZW` · `transaction id 3FU91669CE295522J` · `status SUCCESS`（19.2 s）。原文：`proof/t9/run1/readme-03-demo-reset.log` | 是 |
| 4. 一键启动 | `npm run dev` | `[api] [server] Proof Before Pay on http://127.0.0.1:8787` · `[web] VITE v8.3.5 ready` · `✓ Proof Before Pay is ready — open http://localhost:5173`。原文：`proof/t9/run1/readme-04-dev.log` | 是 |
| 5. 打开页面 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` | `200`；`/api/health` 回 `{"ok":true}`；页面截图（1280×720，headless）`proof/t9/run1/readme-05-home-1280x720.png`：页头产品名、四个导航、四格 KPI 都是「—」、9 行发票全部 `Ready`、右栏「Nothing is paid until it's proven.」、页脚 `Ledger verified · 2 events` | 是 |
| 6. 复验 | `bash scripts/verify.sh` | 见 §4（分九段跑，59 条全 PASS，连续跑两轮结果一致） | 是 |

README 走不通的地方：**没有**。唯一要提前准备的是 README「What you need first」里已经写明的三样（沙箱 REST app、收款人对照表、LLM key），本次都已具备。

> 一处与 README 表述有关的观察：`npm run demo:reset` 直接成功，但 `GET /v1/reporting/balances` 当时回的还是 `-26109.50`、`as_of_time` 停在 `2026-11-01T03:59:59Z` 不动——**余额接口是过期快照，不能拿来当「还有没有钱」的判断依据**，见 §5 O-6。

## 3. 逐条验收

| AC | 操作 / 命令 | 真实输出或截图（`proof/t9/` 下的文件） | 判定 |
| --- | --- | --- | --- |
| AC-1 | `npm --prefix packages/core test`（`N=111`） | 全绿。`AC-1 golden values` 一组：`covers all eight invoice items`（8 项九检查逐条对 golden）、`in_03 O4 reports the seeded history as the duplicate`、`in_04 is held on payee + change request…`、`in_05 is held on over-cap hours…`、`in_06 is approved on the AI-matched agreement with no PO`、`two runs over the same input serialize identically`。日志 `run1|run2/verify-segA-local.log` 第 11 条 PASS | PASS |
| AC-2 | 同上 + `90-proof.sh` 的跨进程检查 | (a) `AC-2(a) idempotency key`：`is 32 characters of [a-z0-9-]`、`is the same key in a separate process`；本轮另加的 `AC-2(a) 冪等鍵跨進程同結果、格式 pbp-+28 hex` 真的起两个 node 进程对拍，输出 `both processes: pbp-…`（32 字符）。(b) `is fail:DUPLICATE while the original is live`、`is allowed again when the original is rejected / failed / cancelled`。(c) `normalises all four spellings to INV142`、`gives all four spellings the same fingerprint` | PASS |
| AC-3 | `npm --prefix packages/core test` | `AC-3 every transition in and outside the table`（`covers the whole matrix`、`carries the from-state and trigger on the error`）、`AC-3 held never leaves held without a human`、`AC-3 proven needs rail proof`（无 transaction id / source 不是 rail_get / 状态不是 SUCCESS 三例全部拒绝） | PASS |
| AC-4 | `npm --prefix packages/core test` | `AC-4 hash chain`：`starts from 64 zeros and numbers from 1`、`verifies an untouched ledger, as array and as JSONL text`、`reports the edited line`、`reports the first line after a deletion`、`reports the first line of a swap`、`reports the duplicated seq of an insertion`、`reports the line number of unparseable JSONL` | PASS |
| AC-5 | `npm --prefix packages/core test` + `90-proof.sh` | 单元测试：`AC-5 zero runtime dependencies`（`declares no dependencies at all`、`imports nothing but node:crypto and its own files`）、`AC-5 the RailAdapter contract is exported`、`AC-5 vectors/golden.json replays`、`AC-5 README documents the contract`；`verify.sh` 另有 `core dependencies 為空`、`黃金向量存在且可解析`。本轮补的 `AC-5 core README…` 逐节读 README：`RailAdapter 契約`、`怎麼加一條新軌道`、`Airwallex Payouts`、`支付寶 Machine Pay（HTTP 402）` 四节都在，两份清单各自回答了「冪等／證實／取消」三问；`vectors/golden.json` 8 个 case，`packages/core/test/ac5-portability.test.ts` 读它重放 | PASS |
| AC-6 | `verify.sh` 的 T3 五条 | `T3 生成器確定性：連跑兩次全部 sha256 相同、且與倉庫一致`、`T3 PDF 文字層：發票號、總額、PO、PayPal 收款電郵齊全；字體內嵌`、`T3 in_03 附件與 demo/history 原件位元組相同`、`T3 9 封郵件 JSON 與 scenario 一致、bodyText 逐字相同`、`T3 proof/dataset 7 張 PNG 寬 1240px` 全部 PASS。版式 A/B/C 的差异看 `proof/dataset/*.png` | PASS |
| AC-7 | `verify.sh` 的 `paypal 沙箱快速實測`（(b)+(e)）＋ 本次加跑的 **完整 spike**（(a)–(f)，每笔 $1.00） | (a) token 复用，`expires_in 31396` 秒，到期前 60 秒换新；(b) 付沙箱个人账号 → `SUCCESS` + `transaction 76Y541519F629554M`；(c) 付无账号电邮 → 17 s 后 `UNCLAIMED`，对照 awaiting；(d) **本轮沙箱接受了取消**：`POST …/cancel` → `200`，body `transaction_status: RETURNED`、`transaction_id 1KE98629L2861621N`，之后 GET 也是 `RETURNED`（`run2/ac7d-cancel-verbatim.txt`；完整 spike 自己那一笔在同一天更早的时候发过同一条取消，被拒，报告只写 `rejected`、没记状态码）；(e) 同一 `sender_batch_id` 再 POST → `HTTP 400 · USER_BUSINESS_ERROR · issue「Batch with given sender_batch_id already exists」`，rail 取回原批次 `ET7HPD5ACTATS`，与 (b) 同一批次；(f) `PBP_FAULT=drop_after_submit` 丢掉第一次回应后同键重试，GET 该批次只有 **1** 笔。报告：`run2/paypal-spike-full.md`（凭据与 Authorization 已去敏） | PASS（附 §5 O-1、(d) 的结论与 SPEC v1.7 不同） |
| AC-8 | `npx tsx scripts/eval.ts extract --run 1|2|3 --out …`（真模型，每轮 9 封） | 三轮都是 `EXTRACT ALL PASS · 9/9 items`；逐栏对 golden：`in_01 Priya INV-2026-118 120000 agr_priya_03`、`in_02 Kenji INV-0153 135000 agr_kenji_12`、`in_03 Kenji INV-0142 115000`、`in_04 invoice+payee_change_request 240000`、`in_05 Leo INV-031 240000`、`in_06 Sofia 1009 73800 → agr_sofia_05`（无 PO，选的是 05 不是 04）、`in_07 Jonas INV-001 64000`、`in_08 Tomás INV-77 180000`、`in_09 other`。三次的原始模型输出：`run2/ai/extract-run-1..3/`，另有 `verify.sh` 的 `agent 真模型抽取評測` PASS | PASS |
| AC-9 | `npm --prefix packages/core test` + `npm --prefix packages/agent test` | (a)(b) 在 core：全被骗的提议仍 `held`（P1 `PAYEE_MISMATCH`、P2 `CHANGE_REQUEST_PENDING`），确定性风险只对 in_04 给四个旗标；(c)(d) 在 agent：`AC-9c` 工具名单里没有任何能动钱的方法、邮件与附件包在 `<untrusted_document>` 里送模型（`verify.sh` 的 `agent 單元測試（AC-9c/9d、AC-10 邏輯、風險說明 140 字元）` PASS）。本轮真实运行里 in_04 的四个旗标原文：`["SENDER_DOMAIN_MISMATCH","LOOKALIKE_DOMAIN","INSTRUCTION_TO_AI","URGENCY"]` | PASS |
| AC-10 | ①真实运行的账本 ②`eval.ts explain --run 1|2|3` | ①本轮 AC-11 的账本（`run2/e2e/ac11-ledger.log`）里三则解释全是 `source: model`、≤2 句：<br>· in_03：`Invoice INV-0142 is blocked because it duplicates an earlier payment to the same vendor, which was paid under PayPal transaction id 79U75907P6594201A on 6 November 2026. …`（交易号来自本次 `demo:reset` 的真种子，见 `data/e2e/ac11/history.json`）<br>· in_04：`… the requested payee billing@studi0-north.example is unverified, while the payee on file ana@studionorth.example was verified by video call …`（两个电邮 + 写对了「未核实的是请求的新收款人」）<br>· in_05：`… billed 40 hours against a 32-hour cap, and the delivery submitted on 5 November is not accepted.`<br>②`EXPLAIN ALL PASS · run 1/2/3`，三次输出存 `run2/ai/explain-run-1..3/` | PASS |
| AC-11 | `npx --prefix apps/web tsx apps/web/e2e/ac11.ts`（真沙箱 + 真模型，两轮） | 第 1 轮：`run finished in 214.4s (limit 240s)`、`totals vs golden.totalsAfterRun: EQUAL`、8 行逐条 `PASS`、屏幕 KPI `$5,088.00 $640.00 $4,800.00 $1,150.00`、`screen banner: none · header button: Review 2 held · Ledger verified · 79 events`；crosscheck 逐笔向 PayPal GET：`int_in_01 SUCCESS 3VH537268D955802L`、`02 0D673575MN058301Y`、`06 7S651744XD7115001`、`08 904470240A098925B`，bundle 里记的交易号与 PayPal 自己说的**逐字一致**，`ALL PASS — 4 proven payout(s) confirmed by PayPal itself.`。第 2 轮同样 EQUAL，耗时 214.3 s，交易号全部换新（`7XU32685UX6938432 / 50793251YJ5280811 / 78J98055857547541 / 2A319991EN183142T`）。原件：`run1/e2e/ac11*`、`run2/e2e/ac11*`；截图 `run2/ui/hero-done-1280x720.png` | PASS |
| AC-12 | `npx --prefix apps/web tsx apps/web/e2e/ac12.ts`（接 AC-11 的账本） | 第 1 轮：`step 1 → in_04 state held · P1 hold:PAYEE_MISMATCH · P2 hold:CHANGE_REQUEST_PENDING`、`step 1 → Approve in the panel is disabled (correct)`、`step 2 → in_04 rejected · payee on file ana@studionorth.example`（mark fraud 之后档案收款人不变）、`step 3 → O3 pass:DELIVERY_ACCEPTED · O2 hold:OVER_CAP`、`step 4 → button says "Approve up to $1,920.00"`、`step 4 → in_05 proven · approvedAmount 192000 · transaction 14202254CP169063G`、`totals vs golden.totalsAfterHumanSteps: EQUAL`（屏幕 `$7,008.00 $640.00 $0.00 $3,550.00`）。第 2 轮同样 PASS。原件 `run1|run2/e2e/ac12*` | PASS |
| AC-13 | (a) `… e2e/ac13.ts a`；(b) `… e2e/ac13.ts b`（两轮各跑一次） | (a) `PBP_FAULT=drop_after_submit:first` 下重试，`totals vs golden: EQUAL`，crosscheck 4 笔全 SUCCESS，另带 `--single-batch`：把同一个 `sender_batch_id` 再送一次，PayPal 回的是**同一个**批次（`run2/e2e/ac13a-crosscheck.{log,json}`）。(b) `kill -9` 在第一笔 `payment.submitted` 之后，重启后续完：`(b) killed the server right after int_in_01 was submitted` → `restarted on the same data directory; recovery replays the ledger and resumes` → `totals vs golden: EQUAL`，4 笔 SUCCESS、无重复（`run2/e2e/ac13b-*`）。两轮都 PASS | PASS |
| AC-14 | `npx --prefix apps/web tsx apps/web/e2e/ac14.ts`（两轮） | 未开 `PBP_ALLOW_COMPARISON` 时 `403 Comparison mode is off. Set PBP_ALLOW_COMPARISON=1 in .env to run it — nothing was sent.`；打开后横幅 `Comparison mode — the same agent with no proofs. For demonstration only.`。两轮结果一致：`the agent paid 7 of 8 invoices`、`total sent: 9278.00 USD`、`unexpected payouts: none`、`not sent by the model (listed, not filled in): in_04 billing@studi0-north.example 240000`、`main ledger after the comparison run: proven 0 · held 0 · stopped 0`。agent 自己的总结原样显示（含 `All 7 payments went through.`——Jonas 那笔其实 `UNCLAIMED`）。原件 `run2/e2e/ac14.log`、截图 `run2/ui/comparison-1280x720.png` | PASS |
| AC-15 | `GET /api/intents/int_in_02/bundle` + `verifyChain` | HTTP 200，`schemas/proof-bundle.schema.json` 由 server 在返回前校验（`verify.sh` 的 `proof-bundle schema 是 2020-12 且列齊 AC-15 的欄位` 也 PASS）。真实内容见 §3 数据全链路第 7 段：原件名与 sha256、抽取模型与时间、合約与金额规则、交付与 acceptedAt/acceptedBy、收款人核验、九项检查、PayPal batch/item/transaction id 与状态与取回时间、账本 seq/hash，`ledger.verified: true`。抽屉截图 `run2/ui/bundle-proven-1280x720.png`（含 Proof trail、Document、Proof of debt、Payee & policy、PayPal 两栏、Verify again / Export JSON） | PASS |
| AC-16 | `npx tsx apps/web/scripts/screenshots.ts`（真运行数据，headless，两轮） | 11 张全部产出、`All shots passed: no scroll, no overflow, no console errors.`；本票另加静态检查 `AC-16 07-UI §5 的 11 張截圖齊全且尺寸正確（2x）`（逐张对 §5 表格的视口，PNG 实际 2560×1440 / 2880×1800）。逐条卫生清单见下方「AC-16 卫生清单逐条观察」。**过不过线由主控判**（AME-1134 规则 2；T11 之后会重出截图，本票不追） | PASS（卫生观察，不判审美） |
| AC-17 | 全新 clone 照 README + 空 `.env` + `git log -p` 扫描 | ①README 五步全通（§2）；②`.env.example` 只有 11 个键名、没有值（`verify.sh` PASS）；③把 `.env` 换成全空的 `.env.example` 启动：`GET /` 仍 `200`，`POST /api/runs` 回 `{"ok":false,"error":"Add PAYPAL_CLIENT_ID to .env — nothing was sent. Also missing: PAYPAL_CLIENT_SECRET, LLM_API_BASE, LLM_API_KEY, LLM_MODEL.", ...}`，`POST /api/demo/reset` 同一句；账本只写了 1 行 `ledger.opened`，**没有任何付款请求**（`run2/empty-env-server.log`）；④`git ls-files .env` 无输出、`git log --all --name-only` 里从来没有 `.env`；⑤密钥扫描见下 | PASS |

### AC-16 卫生清单逐条观察（AGENTS §4.6）

看的是 `proof/t9/run2/ui/` 的 11 张（1280×720 十张、1440×900 一张，均 @2x）：

| 条目 | 观察 |
| --- | --- |
| 没有调试信息（session id、版本串、stub/mock 模型名、本机路径、报错堆栈、原始 JSON） | 11 张里都没有 session id、版本串、本机路径、堆栈、原始 JSON。唯一出现模型名的地方是证明包的 `Read by deepseek-flash · Nov 6 · 17:30`——那是 SPEC §5 AC-15 要求「抽取所用模型」的字段，且是真模型名，不是 stub/mock |
| 没有原生控件 | 看不到原生 `select`、日期时间选择器、文件选择器。**但** `verify-payee-1280x720.png` 的两个选项（`Confirmed by phone` / `Not confirmed — likely fraud`）是原生 radio 圆点在样式里露出来的样子；§4.6 的清单只点了 checkbox / select / 日期时间 / 文件选择，radio 不在字面上，建议主控在 D2 时确认这算不算违规（O-4） |
| 1280×720 与 1440×900 逐屏不溢出、不叠压、不截断 | 截图脚本自带三断言（`no scroll / no overflow / no console errors`）两轮全过；`hero-done-1440x900.png` 与 `hero-done-1280x720.png` 同一屏，两种视口下 KPI、8 行、右栏都在框内 |
| 主屏 1280×720 一屏装下 | 是：KPI 带 + 8 行 + 右栏一屏装完，页脚可见 `Ledger verified · 80 events` |
| 没有大块空舞台；空状态有引导、加载有骨架、出错有一句人话 | 空态有右栏「Nothing is paid until it's proven. / What the gate checks」与 `Run Friday payouts` 按钮；加载态是整屏骨架（`hero-loading-1280x720.png`）；出错态是 `Couldn't reach the PayPal sandbox. Nothing was sent. Check PAYPAL_CLIENT_ID in .env, then retry.` + 右栏 `Approved — PayPal was not reachable` |
| 一屏最多 4 级字号、只用 `--fs-*`、正文 ≥16px | `verify.sh` 的 `web: no bare colour / px font-size values` 通过；截图里 KPI、行名、元信息、脚注四级 |
| 一个强调色；成功/警告/危险只表达语义 | 强调色只有 PayPal 蓝（主按钮）；绿=Proven、橙=Held、红=Blocked/Stopped，其余是中性灰 |
| 间距只用 `--sp-*`、圆角一致、阴影最多两级 | 卡片圆角一致；浅阴影只用在卡片 |
| 一套图标、产品界面不用 emoji | 图标是线条图标（印章、锁、回形针、铅笔）；界面里没有 emoji |
| 数据像真的（不出现 lorem/test/foo/undefined/NaN/null） | 人名、公司、发票号、金额都是演示数据；`Inbox` 屏里 PDF 名、sha 短码、日期都真实。没有 lorem/test/foo/undefined/NaN/null |
| 语言一致（英文赛全英文、中文用全角） | 界面全英文；金额、日期格式统一 |
| 页头有产品名与标识；标签有标题与 favicon | 页头 `Proof Before Pay` + 方形标识；四屏页头一致 |
| 字体自带、截图无系统字体回落 | IBM Plex Sans/Mono 由 `@fontsource` 打进 bundle（`apps/web` 构建产物里有 5 个 woff2） |
| 动效 150–250ms | 截图看不出动效时长，未验（不判） |
| 截图前换演示数据集、清测试残留 | 11 张都来自 `data/e2e/ac13b`、`ac11`、`ac14`、`shots-error` 四份真运行账本，不是夹具 |

### AC-17 密钥扫描（`git log -p`，42 个 commit）

命令与输出：

```text
$ git log -p | grep -inE "api[_-]?key|secret|token|password|Bearer "
594 条命中
按关键词：secret 137 · token 452 · password 8 · Bearer 29 · api[_-]?key 0
```

逐类判读（命中原文存 `proof/t9/run2/secret-scan.txt`）：

| 类别 | 例子 | 判读 |
| --- | --- | --- |
| 键名与文档 | `PAYPAL_CLIENT_SECRET=`、`LLM_API_KEY`、`.env.example` 的键名 | 空值或键名，不是值 |
| 官方文档引文 | `country_code,account_type,primary_email_alias,password,first_name,…`（PayPal 批量建号 CSV 表头）、`A password` | 引用官方字段名 |
| 错误处理与人话 | `PayPal refuses *us*: the token endpoint answers 401 (a wrong PAYPAL_CLIENT_SECRET)`、`故意配錯 PAYPAL_CLIENT_SECRET` | 说明文字 |
| OAuth 代码 | `access_token`、`Bearer ${token}`、`expires_in` | 运行期变量名与请求头模板，不含值 |
| 明说假的夹具 | `` `test-client-secret`、`TOKEN-ONE`、`A21AA-DOC-SAMPLE-TOKEN-NOT-A-CREDENTIAL` `` | 文档里明确标注为非凭据的示例 |

结论：**没有可用的凭据进过仓库**。另用在线凭据做交叉核对——把每个值的「中段 12 个字符」拿去 `git log -p` 全文里找，`PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`LLM_API_KEY`、`PBP_RECEIVER_MAP` 四个都是 **0 次**；`git log --all --name-only` 里从来没有 `.env`；`git ls-files` 也不含 `.env`。

### 数据全链路抽查：Kenji INV-0153（in_02）

脚本 `proof/t9/chain-inv-0153.mjs`（本轮新写，只读帐本与 `.env`、只向 PayPal GET，不改任何东西），输出原文 `proof/t9/run2/chain-inv-0153.txt`。每一段都是真值：

| 段 | 看到的值 |
| --- | --- |
| 1. PDF 文字层 | `demo/inbox/files/kenji-INV-0153.pdf`，15055 字节，sha256 `6203bde68e0df0deadca9d4daf3a3ed6ec26080a14dea397ed454359e0494a84`；逐字抽出 `INV-0153` / `ISSUED 2026-11-04` / `DUE 2026-11-18` / `PO PO-1191` / `Logo animation — 3 variants 1 item 1,350.00 1,350.00` / `TOTAL USD 1,350.00` / `PayPal: kenji@kenjimotion.example` |
| 2. 抽取（真模型） | 帐本 seq 16，`classified invoice (deepseek-chat)`；`claim.extracted` 的 claim：`vendorId ven_kenji`、`invoiceNumber INV-0153`、`total 135000`（分）、`po PO-1191`、`requestedPayee kenji@kenjimotion.example`、`lines[0] 1 item × 135000 = 135000`；`extractedBy {model: deepseek-flash, at: 2026-11-01T05:34:35.911Z}` |
| 3. 提議 | `int_in_02`，`agreementId agr_kenji_12`（`matched by po`），`amount 135000`，`payee kenji@kenjimotion.example`，`fingerprint eaa98376…da5b3`，`idempotencyKey pbp-ef85fc7d7c3316c45b09104b75ad` |
| 4. 九项检查 | `O1 pass VENDOR_MATCHED {vendorId ven_kenji, matchedBy sender}` · `O2 pass AMOUNT_MATCHES {kind fixed, billed 135000, expected 135000}` · `O3 pass DELIVERY_ACCEPTED {del_kenji_12, acceptedAt 2026-11-04T09:05:00Z, by Maya}` · `O4 pass NOT_DUPLICATE` · `P1 pass PAYEE_VERIFIED {onFile/requested 同一电邮, verifiedAt 2025-11-20, method video_call}` · `P2 pass NO_CHANGE_REQUEST` · `L1 pass WITHIN_LIMIT {135000 / 250000}` · `L2 pass WITHIN_DAILY_LIMIT {todayTotal 235000 / 1000000}` · `L3 pass VENDOR_ESTABLISHED {priorPayments 14}`；`decision approved` |
| 5. 送出 | seq 20（调用轨道前）`senderBatchId pbp-ef85fc7d7c3316c45b09104b75ad · payoutBatchId null · attempt 1`；seq 21（拿到批次后补记）同键 `payoutBatchId YL939MKF5XXMY` |
| 6. PayPal GET（独立脚本，直打沙箱） | `GET /v1/payments/payouts-item/CVQA23UYHYC5C` → 200，`transaction_status SUCCESS`、`transaction_id 0D673575MN058301Y`、`amount {USD, "1350.00"}`、`receiver kenji11111@personal.example.com`（沙箱收款人对照，见 SPEC §6.5.5）；`GET /v1/payments/payouts/YL939MKF5XXMY` → 200，`batch_status SUCCESS`，items 只有 1 笔、交易号相同 |
| 7. 证明包 | `GET /api/intents/int_in_02/bundle` → 200。`source {file kenji-INV-0153.pdf, sha256 6203bde6…, from Kenji Watanabe, subject "INV-0153 — logo animation", receivedAt 2026-11-04T10:15:00Z}`；`extraction {model deepseek-flash, at 2026-11-06T17:30:39.884Z}`；`amountRule "fixed fee: the invoice total must equal $1,350.00."`；`delivery {del_kenji_12, acceptedAt 2026-11-04T09:05:00Z, acceptedBy Maya, evidence "Project board · task LL-219 · approved"}`；`payee {onFile, requested, verifiedAt, method video_call, humanVerification null}`；`checks` 九条全 `pass`；`payment {senderBatchId pbp-ef85…, payoutBatchId YL939MKF5XXMY, payoutItemId CVQA23UYHYC5C, transactionId 0D673575MN058301Y, railStatus SUCCESS, fetchedAt 2026-11-06T17:30:57.693Z, receiverSent kenji11111@personal.example.com}`；`ledger {seq 23, eventType receipt.updated, head 90, verified true}` |
| 8. 帐本行 | seq 23 `prevHash 0e6f602d…cd0f7` → `hash 76a2113b4c95f84430f16fcb1e868bd88830b278ca62496987d32cd1913c60fa`，`data {intentId int_in_02, railStatus SUCCESS, proof proven, payoutItemId CVQA23UYHYC5C, transactionId 0D673575MN058301Y, source rail_get}`；账本头 seq 90 `ca52459d…18226` |

八段都对得上：PDF 文字里的金额、PO、收款电邮与抽取结果一致；抽取结果与九项检查的 facts 一致；检查通过后的键与送出时的 `sender_batch_id` 是同一个；PayPal 自己说的交易号与证明包、帐本行三处一模一样。

## 4. `scripts/verify.sh` 运行记录

一次跑完要 20 分钟以上（`demo:reset` + 四段真沙箱端到端），超过单条命令 10 分钟的上限，所以按 `verify.sh` 自带的 `PBP_VERIFY_ONLY` / `PBP_VERIFY_SKIP` 分九段跑。**九段合起来是全部 59 条检查，没有一条被跳过**；每段自己的收尾行都是 `PASS（N 条通过，M 条被过滤跳过——这不是完整复验）`，M 是别的段的检查。段日志在 `proof/t9/run1/`（第 1 轮）与 `proof/t9/run2/`（第 2 轮）。

两次完整复验的 59 条判定如下（第 2 轮，含本轮新增的三条 T9 检查）：

```text
  1. PASS  文档存在 docs/00-BRIEF.md
  2. PASS  文档存在 docs/01-SPEC.md
  3. PASS  文档存在 docs/02-TICKETS.md
  4. PASS  文档存在 docs/03-PROCESS.md
  5. PASS  文档存在 docs/04-PROOF.md
  6. PASS  文档存在 docs/05-SUBMISSION.md
  7. PASS  文档存在 docs/07-UI.md
  8. PASS  没有提交 .env
  9. PASS  设计变量对比度达标（design/tokens.css）
 10. PASS  规范资料是合法 JSON（demo/scenario）
 11. PASS  core 單元測試（AC-1～AC-5、AC-9）
 12. PASS  core 型別檢查（src + test）
 13. PASS  core 建置（dist + .d.ts）
 14. PASS  core dependencies 為空
 15. PASS  黃金向量存在且可解析
 16. PASS  T1 BRIEF §6 五行、5 張 1280x800 截圖、問題數據 (a)–(e) 有引文與 URL、沙箱三問有答案
 17. PASS  T3 生成器依賴可用（缺 node_modules 就 npm ci）
 18. PASS  T3 生成器確定性：連跑兩次全部 sha256 相同、且與倉庫一致
 19. PASS  T3 PDF 文字層：發票號、總額、PO、PayPal 收款電郵齊全；字體內嵌
 20. PASS  T3 in_03 附件與 demo/history 原件位元組相同
 21. PASS  T3 9 封郵件 JSON 與 scenario 一致、bodyText 逐字相同
 22. PASS  T3 proof/dataset 7 張 PNG 寬 1240px
 23. PASS  paypal 單元測試（請求組裝・狀態對照全表・token 快取・同鍵重試・缺憑證不發請求）
 24. PASS  paypal 型別檢查（src + test + scripts/spike.ts）
 25. PASS  paypal 建置（dist + .d.ts）
 26. PASS  paypal 依賴只有 @pbp/core
 27. PASS  agent 單元測試（AC-9c/9d、AC-10 邏輯、風險說明 140 字元）
 28. PASS  agent 型別檢查（src + test）
 29. PASS  agent 建置（dist + .d.ts）
 30. PASS  agent 依賴只有 core / openai / unpdf / zod
 31. PASS  web: typecheck (tsc --noEmit)
 32. PASS  web: unit tests (vitest, projection)
 33. PASS  web: build (vite)
 34. PASS  web: no bare colour / px font-size values
 35. PASS  server 前置：core 已建置（file: 依賴要 dist/）
 36. PASS  server 型別檢查（src + test）
 37. PASS  server 建置（dist + .d.ts）
 38. PASS  proof-bundle schema 是 2020-12 且列齊 AC-15 的欄位
 39. PASS  根 demo:reset 腳本存在（端到端接真軌道在 T8）
 40. PASS  server 有 src/main.ts（組裝入口）
 41. PASS  server 依賴含 @pbp/paypal 與 @pbp/agent（file:）
 42. PASS  web 依賴含 @pbp/core（型別從 core 匯入）
 43. PASS  根 npm run dev 腳本存在
 44. PASS  .env.example 只寫鍵名（SPEC §6.9 的 11 個鍵都在、沒有值）
 45. PASS  e2e: web typecheck（tsc --noEmit，含 e2e 腳本）
 46. PASS  e2e: web unit（投影 reduce）
 47. PASS  e2e: web build（vite）
 48. PASS  AC-5 core README 有 RailAdapter 契約與 Airwallex／支付寶 402 兩份對照清單，黃金向量有測試重放
 49. PASS  AC-2(a) 冪等鍵跨進程同結果、格式 pbp-+28 hex
 50. PASS  AC-16 07-UI §5 的 11 張截圖齊全且尺寸正確（2x）
 51. PASS  server 整合測試（AC-12・AC-13・AC-15・AC-17 的 server 部分）
 52. PASS  agent 真模型抽取評測（9 封逐欄對 golden）
 53. PASS  paypal 沙箱快速實測（(b) 一筆 SUCCESS ＋ (e) 重複鍵不重付）
 54. PASS  AC-11 端到端：demo:reset → Run → golden 對帳 → crosscheck
 55. PASS  AC-12 人工四步（接在 AC-11 的帳本上）
 56. PASS  AC-13 (a) 故障注入：掉回應之後同鍵重試仍只付一次
 57. PASS  AC-13 (b) kill -9：重啟後續完、不重付
 58. PASS  AC-14 對照模式（無閘的 agent，預設關閉）
 59. PASS  web: screenshots + no-overflow assertions（來自真實運行）
```

两轮的一致性：

- 第 1 轮（13:30–13:50）跑的是 56 条（本轮三条新检查那时还没写进去），全部 PASS；
- 第 2 轮（14:00–14:20）跑的是 59 条，全部 PASS；
- 两轮共有的 56 条，判定逐行相同（`diff` 输出为空，只多出第 48–50 三条新检查）；
- 第 2 轮的分段 A 又原样跑了一遍（`run2/segA-repeat.log`），50 条与上一次 `diff` 为空。

单测/整合测试的规模（`npm --prefix <包> test`）：core 111 条·paypal 51 条·agent 89 条·server 65 条·web 20 条，合计 336 条，全绿。

## 5. 失败项与交回

**AC 判定：AC-1～AC-17 全部 PASS，没有 FAIL 项。** 下面是不构成 AC 失败、但主控要知道的观察与建议（按影响排序）：

- **O-1（要主控裁定）沙箱现在会接受取消，和 SPEC v1.7 写的「一律拒絕」不一样。**
  完整 spike 自己那一笔（`Q8PKFA7B4WP7Q` 的 item `5WS349UQ2C7UJ`）在 (d) 那一步被拒（报告只写 `rejected`、没记状态码）；等这一笔的批次到了 `SUCCESS`、`time_completed 2026-11-01T06:17:47Z` 之后我手打同一条取消请求：`POST /v1/payments/payouts-item/5WS349UQ2C7UJ/cancel` → **200**，body `transaction_status: "RETURNED"`、`transaction_id "1KE98629L2861621N"`、`fee $0.25`，之后 `GET` 该 item 也是 `RETURNED`（原文 `run2/ac7d-cancel-verbatim.txt`）。
  这和 SPEC §6.5.1 / AC-7(d)、README「限制與後續」里「取消的成功分支只有官方範例、沙箱沒有實證」的记录相反。**产品代码不用改**（拒绝分支与接受分支都按「回执说了才算」处理，单测两种夹具都在），要改的是 SPEC 与 README 的说法——那是主控与 T12 的活，我没有动。
- **O-2（建议）`packages/agent/scripts/eval.ts explain` 不认 `--out`，会直接覆盖 `proof/ai/explain-run-N/`。**
  本轮按 `… explain --run N --out proof/t9/run2/ai/explain-run-N` 调用，三次都打印 `summary → proof/ai/explain-run-N/summary.json`，把 T6 冻结的证据覆盖成了本轮的新输出。我已经 `git checkout -- proof/ai` 把原文件还原（`git status proof/ai` 干净），本轮的新输出另存在 `proof/t9/run2/ai/explain-run-1..3/`。`extract` 子命令认 `--out`，只有 `explain` 不认——建议施工票补上，否则下一个人还会踩。
- **O-3（观察）`proof/e2e/ac10-explanations-*.json` 不会随 e2e 运行更新。** 这两个文件的时间停在第 1 轮 clone 时的状态（T8 留下的），本轮 AC-11 跑完没有重写它们。AC-10 的证据我改为直接从本轮账本取（§3 AC-10），没有依赖这两个文件。建议把 AC-10 的取证写进 `ac11.ts` 或单独脚本。
- **O-4（交给主控/D2）Verify payee 对话框的两个选项是原生 radio 圆点。** 见 `run2/ui/verify-payee-1280x720.png`。AGENTS §4.6 的「没有原生控件」点了 checkbox / select / 日期时间 / 文件选择，radio 不在字面上；我不判违规，请主控在 D2 定。
- **O-5（观察）同一个「模型名」在不同事件里不一致。** `item.classified.model` 是配置里的 `deepseek-chat`，`claim.extracted.extractedBy.model` 是服务端回报的 `deepseek-flash`。证明包显示的是后者。AC-15 只要求「抽取所用模型」，两处都是真值，但界面上写 `deepseek-flash`、配置里写 `deepseek-chat`，评委若对账会问一句。
- **O-6（风险）`GET /v1/reporting/balances` 是过期快照，不能用于「还有没有钱」的判断。** 13:29 与 13:31（成功付掉 $1,150 之后）两次读到的都是 `-26109.50`、`as_of_time` 都停在 `2026-11-01T03:59:59Z`。README 让人「把 Business 账号余额设成 100,000」，但沙箱自带的余额接口读不出实时值；唯一可信的判断是「真付一笔看回执」。本轮两轮完整复验（各约 3 万美金沙箱额度）都正常付完，没有出现 `INSUFFICIENT_FUNDS`。
- **O-7（观察）对照屏「agent 自己说的话」是一块可滚动文本，底部有淡出。** `run2/ui/comparison-1280x720.png` 里最后一行在框底被淡出截断。它是滚动区、不是裁切错误，但第一眼像被切掉；T11 打磨时可考虑给一个「展开」。
