# design/ — 设计变量与资源

- `tokens.css`：六套风格预设（主控定稿）。页面在 `<html data-theme="…">` 选一套，只用这里的变量：不写裸色值、不写裸字号、间距只用 `--sp-*`。
- `fonts/`：预设用到的字体 woff2，随仓库自带（`npm i @fontsource/<字体名>` 后拷 woff2，或下载官方发布包）。不走 Google Fonts CDN。
- `sample/`：网页仪表板样板（主控打样，2026-11-01）。`sample/README.md` 写怎么做、尺子、踩过的坑与已知弱点；照样板做的票先读它。
- 换主办方品牌色：只换 `--accent`、`--accent-contrast`、`--accent-text`，写进 `docs/07-UI.md` 第 1 节，跑 `python3 scripts/check_tokens.py`。

| 预设 | 适合 | 气质 | 参考 |
| --- | --- | --- | --- |
| `fintech-precise` | 支付、银行、对账 | 浅底、墨色字、一个沉稳的强调色、等宽数字、细分隔线 | Stripe Dashboard、Mercury、Linear |
| `mission-control` | agent 运维、看板、开发者工具 | 近黑底、琥珀 / 青色信号、等宽数字、机场出发看板 | Vercel、Raycast、航站楼出发屏 |
| `editorial-warm` | 面向消费者、讲故事、助手 | 纸色底、衬线标题、留白大 | Arc、Notion |
| `playful-bold` | 游戏、教育、年轻用户 | 饱和色、2px 黑描边、硬投影、大圆角 | Duolingo、Gumroad |
| `public-clear` | 公共服务、应急科普、政务 | 白底高对比、大字号、预警四色只表达等级 | GOV.UK Design System、气象预警信号图标 |
| `tech-blueprint` | 国内企业技术、开源基础设施 | 冷白底、海军蓝字、泳道配色、蓝图网格 | HarmonyOS 设计规范、Material 3 |
