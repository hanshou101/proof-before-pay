# T1 偵察票的檢查：BRIEF §6、問題數據出處、沙箱步驟、參考截圖。
# 只用 check（純檔案檢查，不需要網路與密鑰）。

t1_refs() {
  python3 - <<'PY'
import os, re, sys

fail = []

# 1) BRIEF §6：5 行、每行有鏈接與截圖
brief = open('docs/00-BRIEF.md', encoding='utf-8').read()
m = re.search(r'^## 6\. .*?(?=^## 7\.)', brief, re.S | re.M)
if not m:
    fail.append('BRIEF 找不到 §6')
    sec = ''
else:
    sec = m.group(0)
rows = [l for l in sec.splitlines() if l.startswith('| ') and 'https://' in l and 'proof/refs/' in l]
if len(rows) < 5:
    fail.append(f'BRIEF §6 只有 {len(rows)} 行帶鏈接與截圖（要 5 行）')
slugs = re.findall(r'proof/refs/([a-z0-9-]+)\.png', sec)
if len(slugs) < 5:
    fail.append(f'BRIEF §6 只引用 {len(slugs)} 張截圖（要 5 張）')

# 2) proof/refs：每張存在、是 PNG、1280x800、不是空圖
for s in slugs:
    p = f'proof/refs/{s}.png'
    if not os.path.exists(p):
        fail.append(f'缺截圖 {p}')
        continue
    d = open(p, 'rb').read(33)
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        fail.append(f'{p} 不是 PNG')
        continue
    w = int.from_bytes(d[16:20], 'big'); h = int.from_bytes(d[20:24], 'big')
    if (w, h) != (1280, 800):
        fail.append(f'{p} 尺寸 {w}x{h}，要 1280x800')
    if os.path.getsize(p) < 5000:
        fail.append(f'{p} 檔案太小（{os.path.getsize(p)} bytes），可能是空白頁')

# 3) problem-stats：(a)–(e) 每節有 URL 與引文
try:
    ps = open('docs/research/problem-stats.md', encoding='utf-8').read()
except FileNotFoundError:
    ps = ''
    fail.append('缺 docs/research/problem-stats.md')
for k in 'abcde':
    sec = re.search(rf'^## \({k}\).*?(?=^## |\Z)', ps, re.S | re.M)
    if not sec:
        fail.append(f'problem-stats 缺 ({k}) 小節')
        continue
    body = sec.group(0)
    if 'https://' not in body:
        fail.append(f'problem-stats ({k}) 沒有 URL')
    if not re.search(r'^\s*> ', body, re.M):
        fail.append(f'problem-stats ({k}) 沒有原文引文')

# 4) sandbox-setup：三問有答案、有官方出處
try:
    sb = open('docs/research/sandbox-setup.md', encoding='utf-8').read()
except FileNotFoundError:
    sb = ''
    fail.append('缺 docs/research/sandbox-setup.md')
for needle, label in [
    ('primary_email_alias', '能否自訂電郵'),
    ('0-100000', 'balance 上限'),
    ('Transaction search', 'Transaction search 在哪勾'),
]:
    if needle not in sb:
        fail.append(f'sandbox-setup 沒回答「{label}」')
if len(re.findall(r'https://developer\.paypal\.com/', sb)) < 8:
    fail.append('sandbox-setup 的官方出處少於 8 條')

if fail:
    print('\n'.join(fail))
    sys.exit(1)
print(f'BRIEF §6 {len(rows)} 行、{len(slugs)} 張 1280x800 截圖；(a)–(e) 有引文與 URL；沙箱三問有答案')
PY
}

check "T1 BRIEF §6 五行、5 張 1280x800 截圖、問題數據 (a)–(e) 有引文與 URL、沙箱三問有答案" t1_refs
