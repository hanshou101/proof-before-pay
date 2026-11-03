# demo/generator：演示資料集生成器（T3 ／ AME-911）

讀 `demo/scenario/scenario.json` 與 `demo/scenario/inbox-content.json`（唯讀，主控所有），寫出：

- `demo/inbox/in_01.json` … `in_09.json`：郵件；`bodyText` 逐字取 `inbox-content.emails`，`from` / `subject` / `receivedAt` 取 `scenario.inbox`，附件帶檔名、相對路徑與 sha256。
- `demo/inbox/files/*.pdf`：`inbox-content.invoices` 的 7 張發票，三種版式（A 經典、B 極簡等寬、C 工作室）。
- `demo/history/kenji-INV-0142.pdf`：與 `demo/inbox/files/kenji-INV-0142.pdf` **同一份位元組**（歷史付款的原件）。
- `proof/dataset/*.png`（可選，`npm run proof`）：每張 PDF 第一頁、寬 1240px，供主控看版式。

## 用法

```bash
npm ci
npm run generate      # 寫回倉庫
npm run typecheck     # tsc --noEmit
npm run proof         # 需要 PATH 上有 pdftoppm（Poppler）
```

`generate` 只讀 `--root`（預設倉庫根）的規範資料，寫到 `--out`（預設同一個根）；`check.ts` 把輸出寫到臨時目錄，用來驗證「確定性」與「倉庫裡的檔案是不是生成器現在會產出的東西」。

## 確定性

- 輸入相同時輸出位元組相同：連跑兩次、換時區（UTC／America/New_York／Asia/Tokyo）都是同一組 sha256。
- PDF 的 `CreationDate` / `ModDate` 固定為 `scenario.testClock`；`Producer` / `Creator` 固定為 `Proof Before Pay demo generator`；不寫隨機文件 ID。
- 版面只用 `fonts/` 裡的 IBM Plex（全部內嵌，含 `—`、`á`），不使用任何標準字體，因此不會出現回落字體。

## 字體授權

`fonts/` 內 6 個 TTF 取自 [IBM/plex](https://github.com/IBM/plex) 的標籤 `v6.4.2`（`IBM-Plex-Sans`／`IBM-Plex-Mono`／`IBM-Plex-Serif` 的 `fonts/complete/ttf/`），授權 SIL Open Font License 1.1，全文見 `fonts/OFL.txt`。字體檔隨倉庫提交，生成時不連網。

## 版本註記

`unpdf` 釘在 `1.7.0`：`1.8.0` 之後要求 Node ≥ 22，而本倉庫的 `engines` 是 `>=20.19`（SPEC §6.0）。`@types/node` 只服務 `typecheck`。
