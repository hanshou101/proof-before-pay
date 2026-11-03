# T12（AME-908）· 提交包：封面比例、圖片上限、表單欄位、公開快照網址、金鑰佔位符
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# 全部是純檔案檢查：不需要網路、不需要憑證，CI 可跑。
# 影片本身不進 Git（Release 附件），所以時長與 sha256 在 docs/process/T12.md 記 ffprobe 輸出，
# 這裡只驗倉庫裡拿得到、且每次提交都會看的那幾樣。

t12_submission_package() {
  python3 - <<'PY'
import re
import struct
import sys
from pathlib import Path

fail = []
PUBLIC = "https://github.com/hanshou101/proof-before-pay"

# 1) 封面：PNG、正好 1500x1000（3:2）
cover = Path("submission/cover-1500x1000.png")
if not cover.exists():
    fail.append("缺 submission/cover-1500x1000.png")
else:
    d = cover.read_bytes()[:33]
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        fail.append("封面不是 PNG")
    else:
        w = int.from_bytes(d[16:20], "big"); h = int.from_bytes(d[20:24], "big")
        if (w, h) != (1500, 1000):
            fail.append(f"封面 {w}x{h}，要 1500x1000")
    if cover.stat().st_size > 5 * 1024 * 1024:
        fail.append(f"封面 {cover.stat().st_size} bytes，超過 Devpost 的 5 MB")

# 2) 圖庫：檔案存在、是 PNG/JPG/GIF、單張 ≤ 5 MB
gallery = [
    "docs/img/run-done-ana.png",
    "docs/img/comparison.png",
    "docs/img/proof-bundle.png",
    "docs/img/verify-payee.png",
    "docs/img/ledger.png",
]
for g in gallery:
    p = Path(g)
    if not p.exists():
        fail.append(f"缺圖庫圖 {g}")
        continue
    if p.read_bytes()[:8] not in (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff\xe0", b"GIF89a"):
        fail.append(f"{g} 不是 PNG/JPG/GIF")
    if p.stat().st_size > 5 * 1024 * 1024:
        fail.append(f"{g} {p.stat().st_size} bytes，超過 5 MB")

# 3) 05-SUBMISSION：每個表單欄位都在，且測試說明的五個 <…> 沒有被填成真值
sub = Path("docs/05-SUBMISSION.md").read_text(encoding="utf-8")
for needle in [
    "字段：Project name",
    "字段：Elevator pitch",
    "字段：About the project",
    "字段：Built with",
    "字段：Image gallery",
    "字段：Video demo link",
    "字段：Explain how your project meets the main technology requirement",
    "字段：Provide a URL to your public code repository",
    "字段：Testing instructions or credentials",
]:
    if needle not in sub:
        fail.append(f"05-SUBMISSION 缺「{needle}」")
placeholders = [
    "<sandbox client id>",
    "<sandbox secret>",
    "<receiver map JSON>",
    "<model key>",
]
for ph in placeholders:
    if ph not in sub:
        fail.append(f"測試說明少了佔位符 {ph}（金鑰只能由主控提交當天另交）")
if "LLM_MODEL=deepseek-chat" not in sub:
    fail.append("測試說明少了 LLM_MODEL=deepseek-chat 這一行")

# 4) 字數上限（Devpost 的表單限制）
m = re.search(r"字段：Elevator pitch[^\n]*\n\n```text\n(.*?)\n```", sub, re.S)
if not m:
    fail.append("找不到 Elevator pitch 的 ```text 區塊")
elif len(m.group(1)) > 154:
    fail.append(f"Elevator pitch {len(m.group(1))} 字元，超過 154")
m = re.search(r"字段：Built with[^\n]*\n\n```text\n(.*?)\n```", sub, re.S)
if not m:
    fail.append("找不到 Built with 的 ```text 區塊")
else:
    tags = [t for t in m.group(1).splitlines() if t.strip()]
    if not 1 <= len(tags) <= 25:
        fail.append(f"Built with {len(tags)} 個標籤，要 1–25")

# 5) 公開快照網址：README 與 05 都指向同一個倉庫
readme = Path("README.md").read_text(encoding="utf-8")
for name, body in (("README.md", readme), ("docs/05-SUBMISSION.md", sub)):
    if PUBLIC not in body:
        fail.append(f"{name} 找不到公開倉庫網址 {PUBLIC}")
if f"{PUBLIC}/releases/download/v1.0/proof-before-pay-demo.mp4" not in readme:
    fail.append("README 的影片連結不是公開 Release v1.0 的附件")

# 6) LICENSE 是 MIT
lic = Path("LICENSE").read_text(encoding="utf-8")
if not lic.startswith("MIT License"):
    fail.append("LICENSE 首行不是 MIT License")

if fail:
    print("\n".join(fail))
    sys.exit(1)
print(f"封面 1500x1000；圖庫 {len(gallery)} 張；表單欄位齊、{len(placeholders)} 個金鑰佔位符未填；網址一致；LICENSE MIT")
PY
}

check "T12 提交包：封面 1500x1000、圖庫 ≤5 MB、表單欄位齊、金鑰佔位符未填、公開網址一致、LICENSE MIT" t12_submission_package
