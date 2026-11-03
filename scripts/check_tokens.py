#!/usr/bin/env python3
"""检查 design/tokens.css 每套预设的文字对比度（WCAG AA ≥ 4.5:1）。换了主办方品牌色以后必须重跑。"""
import re, sys, pathlib

css = pathlib.Path(__file__).resolve().parent.parent.joinpath("design/tokens.css").read_text(encoding="utf-8")
PAIRS = [("text", "bg"), ("text-muted", "bg"), ("text-muted", "surface"), ("text-muted", "surface-2"),
         ("accent-contrast", "accent"), ("accent-text", "bg"), ("accent-text", "surface"),
         ("danger", "bg"), ("success", "bg"), ("info", "bg")]

def lum(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)

fails = 0
for name, body in re.findall(r'\[data-theme="([^"]+)"\]\s*\{(.*?)\n\}', css, re.S):
    v = dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", body))
    for a, b in PAIRS:
        if a in v and b in v and ratio(v[a], v[b]) < 4.5:
            fails += 1
            print(f"FAIL {name}: {a} on {b} = {ratio(v[a], v[b]):.2f}")
print("对比度全部达标" if not fails else f"{fails} 处对比度不足 4.5:1")
sys.exit(1 if fails else 0)
