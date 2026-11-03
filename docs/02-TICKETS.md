# 02-TICKETS：票據清單

> 作者：主控。每張票是一個縱向切片，帶可判定的驗收條件（引用 SPEC §5 的 AC 編號）。
> 階段 = Multica 子單的 stage：同階段並行，下一階段等上一階段全部驗收後由主控放行。
> AFK = agent 可獨立完成；HITL = 需要人做一步。執行 = 💻🏠【家用|CB-ds41f-1017】日用·MacMini（按票戴角色帽）。
> 審美閘：T4 交付時主控做 D1（定方向、出必改清單，寫進 07-UI §6）；T11 交付後主控做 D2（終審），D2 不過不放行 T12。
> 截止：北京時間 11-13 04:00；用戶最晚 11-11（週三）18:00 提交（SPEC §9；比官方早一天以上、放白天）。
> 賽道單：AME-900（主控）。子單編號依建立順序：stage 2–5 先建（AME-901～908，backlog），stage 1 後建（AME-909～912，todo）。

| 票 | 標題 | 角色 | 階段 | 依賴 | 驗收條件 | AFK / HITL | 時間盒 | Multica 子單 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 參考作品（BRIEF §6）、問題數據出處、沙箱開戶圖文步驟 | 偵察 | 1 | — | 任務書四項；每條數據有原文引文與 URL | AFK | 3h || AME-909 |
| T2 | 證明閘核心 `packages/core`：九項檢查、狀態機、冪等鍵、雜湊鏈帳本、風險偵測、RailAdapter；根 `setup` | 施工 | 1 | — | AC-1～AC-5、AC-9(a)(b) | AFK | 6h || AME-910 |
| T3 | 演示資料集 `demo/`：9 封郵件、三種版式 PDF、歷史原件，確定性生成 | 施工 | 1 | — | AC-6 | AFK | 4h || AME-911 |
| T4 | 界面骨架與主屏 `apps/web`（設計夾具）：主屏四態、證明包抽屜、Verify payee 對話框 | 施工 | 1 | — | AC-16（T4 負責的 7 張截圖）；**交付即 D1** | AFK | 6h || AME-912 |
| T5 | PayPal 軌道 `packages/paypal` ＋沙箱實測 | 施工 | 2 | T2；用戶的沙箱憑證 | AC-7、AC-13(a) 的軌道部分 | HITL（憑證） | 5h || AME-901 |
| T6 | AI agent `packages/agent`：分類抽取、合約匹配、風險說明、解釋、對照模式 | 施工 | 2 | T2、T3 | AC-8、AC-9(c)(d)、AC-10、AC-14（agent 部分） | AFK | 6h || AME-902 |
| T7 | Server `apps/server`：帳本檔、運行器、SSE、人工操作、`demo:reset`、重啟恢復 | 施工 | 2 | T2 | AC-12、AC-13、AC-15 的 server 部分（整合測試，假軌道） | AFK | 6h || AME-903 |
| T8 | 接通真 server 與全部屏幕＋端到端（真沙箱＋真模型）＋一鍵啟動 | 施工 | 3 | T4–T7 | AC-10（真種子複核）、AC-11～AC-17 | AFK | 8h || AME-904 |
| T9 | 全新 clone 只照 README 逐條驗收；`verify.sh`；`04-PROOF` | 舉證 | 4 | T8 | AC-1～AC-17 | AFK | 4h || AME-905 |
| T10 | 過程稽核表（AGENTS §4.5，T2–T8 逐票） | 稽核 | 4 | T8 | AGENTS §4.5 全部 | AFK | 1.5h || AME-906 |
| T11 | 美工：D1 必改清單＋全部屏幕打磨，重出截圖 → D2 | 美工 | 4 | T8、D1 清單 | 07-UI §4、§5（封面除外）＋ AGENTS §4.6 | AFK | 6h || AME-907 |
| T12 | 包裝：演示視頻、封面、評委版 README、提交包、公開快照倉庫 | 包裝 | 5 | T9、T10、T11（D2 通過） | AC-18；BRIEF §2 全部提交物 | HITL（用戶上傳 YouTube、點提交） | 6h || AME-908 |

## 放行規則

- 每張子單進 `in_review` 時主控被喚醒驗收（賽道單上替每張子單掛了 `--until-issue … --until-issue-state in_review` 的喚醒）：看實物（PR diff、測試輸出、截圖、全新 clone 照 README 走），不看總結。通過 → 置 `done`；不通過 → 在子單評論寫失敗項、退回 `todo` 並 `multica issue rerun`，重掛那條喚醒。
- 一個階段全部 `done` → 平台喚醒主控 → 主控放行下一階段（`backlog → todo`）。
- T5 分兩段（10-27 檢查點憑證未到，主控裁定）：第一段不用憑證——軌道程式碼、單元測試（夾具先用 PayPal 官方文件的範例回應，標明出處）、實測腳本，開 draft PR、不合併，10-27 放行；第二段——AC-7 沙箱實測、夾具換成真回應、`verify.sh` 含 need_local 全過、合併——在主控把沙箱憑證發到執行機之後放行。其餘 stage 2 的票不等它。
- P1（AG Studio、線上演示、Reconciled）：10-30 T8 驗收時按 SPEC §10 決策點定了**三項都不做**（SPEC v1.8），寫進 README「限制與後續」（T12）。

## 排期（北京時間）

```mermaid
gantt
    title PayPal AI Hackathon · Proof Before Pay（北京時間）
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    section 閘 A
    BRIEF / SPEC / UI / 拆票         :done, a, 2026-10-22, 1d
    section Stage 1
    T1 偵察 ∥ T2 核心 ∥ T3 資料集 ∥ T4 主屏（D1） :s1, 2026-10-23, 3d
    section Stage 2
    用戶交沙箱憑證（原定 10-26，延到 10-29 白天） :milestone, m1, 2026-10-29, 0d
    T5 PayPal ∥ T6 agent ∥ T7 server   :s2, 2026-10-26, 4d
    section Stage 3
    T8 端到端 + 全部屏幕              :s3, 2026-10-30, 4d
    決策點：P1 不做（10-30 已定）      :milestone, m2, 2026-10-30, 0d
    section Stage 4
    T9 舉證 ∥ T10 稽核 ∥ T11 美工（D2） :s4, 2026-11-03, 4d
    section Stage 5
    T12 包裝（視頻、封面、提交包）      :s5, 2026-11-07, 4d
    用戶上傳 YouTube 並提交（最晚 11-11 18:00） :milestone, m3, 2026-11-11, 0d
```

檢查點（賽道單上的定時喚醒）：10-27 21:00、10-29 21:00（沙箱憑證到了沒）、11-10 10:00（提交包定版就發提交步驟）、11-12 12:00（用戶還沒交就最後提醒）、11-13 09:00（收口與回流）。11-10、11-12 兩個點 10-24 從 20:00 提前。
