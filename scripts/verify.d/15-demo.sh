# T3（AME-911）演示資料集：9 封郵件 JSON、7 張三種版式 PDF、1 張歷史原件。
# 全部可在 CI 跑：缺依賴時自己 npm ci；重生成到臨時目錄後與倉庫逐一比 sha256。
demo_generator_dir="demo/generator"

demo_deps() {
  if [ ! -d "$demo_generator_dir/node_modules" ]; then
    ( cd "$demo_generator_dir" && npm ci --no-audit --no-fund )
  fi
}

demo_gate() {
  ( cd "$demo_generator_dir" && ./node_modules/.bin/tsx src/check.ts "$1" )
}

check "T3 生成器依賴可用（缺 node_modules 就 npm ci）" demo_deps
check "T3 生成器確定性：連跑兩次全部 sha256 相同、且與倉庫一致" demo_gate regen
check "T3 PDF 文字層：發票號、總額、PO、PayPal 收款電郵齊全；字體內嵌" demo_gate text
check "T3 in_03 附件與 demo/history 原件位元組相同" demo_gate history
check "T3 9 封郵件 JSON 與 scenario 一致、bodyText 逐字相同" demo_gate emails

check "T3 proof/dataset 7 張 PNG 寬 1240px" python3 -c '
import struct, sys
names = [
    "Nair-Words-INV-2026-118",
    "kenji-INV-0153",
    "kenji-INV-0142",
    "StudioNorth-INV-2207",
    "Polyform3D-INV-031",
    "BergAudio-INV-001",
    "HerreraWeb-INV-77",
]
bad = []
for name in names:
    path = "proof/dataset/%s.png" % name
    try:
        with open(path, "rb") as handle:
            head = handle.read(24)
    except FileNotFoundError:
        bad.append("%s missing" % path)
        continue
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        bad.append("%s is not a PNG" % path)
        continue
    width, height = struct.unpack(">II", head[16:24])
    if width != 1240:
        bad.append("%s is %dpx wide" % (path, width))
    else:
        print("%s %dx%d" % (path, width, height))
if bad:
    print("\n".join(bad))
    sys.exit(1)
'
