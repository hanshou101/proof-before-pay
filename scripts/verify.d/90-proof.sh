# T9（AME-905）· 舉證票補的檢查：SPEC §5 裡能腳本化、其他 verify.d 沒覆蓋的那幾條。
#
# 這一段被 scripts/verify.sh 以 source 方式載入，只能呼叫 check / need_local。
# 三條都不需要憑證、不需要本地常駐服務，CI 可跑；--ci 不影響它們。

# `@pbp/core` 的 dist 是 AC-2(a) 那條檢查的輸入。CI 從乾淨 checkout 開始，
# 10-core.sh 若被 PBP_VERIFY_ONLY 過濾掉就沒有人建它——這裡自己補。
if [ ! -f packages/core/dist/index.js ]; then
  check "T9 前置：建置 core（AC-2(a) 要讀 dist）" bash -c 'npm --prefix packages/core run build --silent'
fi

# AC-5：可移植。README 要寫明介面契約與「怎麼加一條新軌道」，並附 Airwallex Payouts 與
# 支付寶 Machine Pay（HTTP 402）兩份對照清單；黃金向量要由測試讀它重放。
check "AC-5 core README 有 RailAdapter 契約與 Airwallex／支付寶 402 兩份對照清單，黃金向量有測試重放" python3 - <<'PY'
import re, sys

readme = open('packages/core/README.md', encoding='utf-8').read()
need = {
    'RailAdapter 契約一節': r'^##+\s*RailAdapter\s*契約',
    '怎麼加一條新軌道': r'怎麼加',
    'Airwallex Payouts 對照': r'^##+\s*Airwallex Payouts',
    '支付寶 Machine Pay（HTTP 402）對照': r'^##+\s*支付寶 Machine Pay（HTTP 402）',
}
bad = []
for label, pattern in need.items():
    if not re.search(pattern, readme, re.M):
        bad.append(f'core/README.md 缺「{label}」')
if 'interface RailAdapter' not in readme:
    bad.append('core/README.md 沒有列出 RailAdapter 的介面')

# 兩份清單各自要回答「冪等鍵放哪」「哪個狀態才算證實」「怎麼取消」——SPEC AC-5 的原話。
for name, start, end in [('Airwallex', r'^##+\s*Airwallex Payouts', r'^##+\s*支付寶'),
                         ('支付寶 402', r'^##+\s*支付寶 Machine Pay', r'\Z')]:
    sec = re.search(start + r'(.*?)' + end, readme, re.S | re.M)
    if not sec:
        bad.append(f'{name} 一節找不到')
        continue
    body = sec.group(1)
    for q in ['冪等', '證實', '取消']:
        if q not in body:
            bad.append(f'{name} 對照清單沒有回答「{q}」')

# 向量檔要存在、要有 8 個 case（AC-1 的 in_01…in_08），而且真的有測試讀它。
import json
vectors = json.load(open('packages/core/vectors/golden.json', encoding='utf-8'))
if len(vectors.get('cases', [])) != 8:
    bad.append(f'vectors/golden.json 有 {len(vectors.get("cases", []))} 個 case，要 8 個')

hit = False
import glob
for path in glob.glob('packages/core/test/*.ts'):
    if 'vectors/golden.json' in open(path, encoding='utf-8').read():
        hit = True
        break
if not hit:
    bad.append('沒有任何 core 測試讀 vectors/golden.json 重放')

if bad:
    print('\n'.join(bad))
    sys.exit(1)
print('AC-5 契約、兩份對照清單、8 個黃金向量與重放測試都在')
PY

# AC-2(a)：冪等鍵是確定性函數——兩個獨立進程、同一組輸入，必須得到同一個鍵；
# 鍵的長度與字元集照 SPEC §6.2.4（"pbp-" + 28 個 hex，共 32 字元，[a-z0-9-]）。
check "AC-2(a) 冪等鍵跨進程同結果、格式 pbp-+28 hex" bash -c '
  one=$(node --input-type=module -e "
    const m = await import(\"./packages/core/dist/index.js\");
    process.stdout.write(m.idempotencyKey(\"ep-determinism\", m.fingerprint({vendorId:\"ven_kenji\",invoiceNumber:\"INV-0153\",currency:\"USD\",total:135000})));
  ")
  two=$(node --input-type=module -e "
    const m = await import(\"./packages/core/dist/index.js\");
    process.stdout.write(m.idempotencyKey(\"ep-determinism\", m.fingerprint({vendorId:\"ven_kenji\",invoiceNumber:\"inv 0153\",currency:\"USD\",total:135000})));
  ")
  if [ "$one" != "$two" ]; then
    echo "two processes disagree: $one vs $two"; exit 1
  fi
  if ! printf "%s" "$one" | grep -Eq "^pbp-[a-f0-9]{28}$"; then
    echo "bad shape: $one"; exit 1
  fi
  if [ ${#one} -ne 32 ]; then echo "bad length ${#one}: $one"; exit 1; fi
  echo "both processes: $one"
'

# AC-16：07-UI §5 的截圖清單逐張存在、是 PNG、像素寬等於視口寬的兩倍
# （截圖腳本一律 deviceScaleFactor: 2，見 07-UI §5）。封面那一行屬 T12，不在本條範圍。
check "AC-16 07-UI §5 的 11 張截圖齊全且尺寸正確（2x）" python3 - <<'PY'
import re, struct, sys

ui = open('docs/07-UI.md', encoding='utf-8').read()
sec = re.search(r'^##\s*5\.\s*截圖清單(.*?)(?=^##\s*6\.)', ui, re.S | re.M)
if not sec:
    print('07-UI.md 找不到 §5 截圖清單')
    sys.exit(1)

rows = []
for line in sec.group(1).splitlines():
    m = re.match(r'^\|\s*([^|]+?)\s*\|\s*(\d+)×(\d+)\s*\|\s*`?([^`|]+?)`?\s*\|', line)
    if not m:
        continue
    screen, width, height, path = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).strip()
    if not path.endswith('.png') or not path.startswith('proof/ui/'):
        continue          # 封面（submission/…）屬 T12
    rows.append((screen, width, height, path))

if len(rows) != 11:
    print(f'§5 抽出 {len(rows)} 張要檢查的截圖，預期 11 張')
    sys.exit(1)

bad = []
for screen, width, height, path in rows:
    try:
        head = open(path, 'rb').read(24)
    except FileNotFoundError:
        bad.append(f'缺 {path}（{screen}）')
        continue
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        bad.append(f'{path} 不是 PNG')
        continue
    w, h = struct.unpack('>II', head[16:24])
    if (w, h) != (width * 2, height * 2):
        bad.append(f'{path} 是 {w}x{h}，視口 {width}x{height} @2x 應為 {width*2}x{height*2}')

if bad:
    print('\n'.join(bad))
    sys.exit(1)
print(f'11 張齊全，全部 {rows[0][1]}×{rows[0][2]} @2x（hero-done-1440x900 為 1440×900 @2x）')
PY
