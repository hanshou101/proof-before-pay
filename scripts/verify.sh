#!/usr/bin/env bash
# 确定性复验：把 SPEC 里每条能脚本化的验收条件写成一个 check。全部通过退出 0。
# 用法：bash scripts/verify.sh          本地完整复验
#       bash scripts/verify.sh --ci     CI 模式：need_local 标记的检查（要密钥、要本地服务）跳过并注明
#
# 一次完整复验在真沙箱上要跑 20 分钟以上（四段端到端），超过单条命令 10 分钟的上限，所以支持
# 按检查名字拆分：PBP_VERIFY_ONLY / PBP_VERIFY_SKIP 是正则，匹配到的检查名才跑 / 不跑。
# 分段跑与一次跑执行的是同一组命令；被跳过的检查会印 SKIP，不会被算成 PASS。
set -uo pipefail
cd "$(dirname "$0")/.."

CI_MODE=0
[ "${1:-}" = "--ci" ] && CI_MODE=1
fail=0
filtered=0        # 被 PBP_VERIFY_ONLY / PBP_VERIFY_SKIP 过滤掉的
ci_skipped=0      # --ci 模式下跳过 need_local 的
ran=0
VERIFY_ONLY="${PBP_VERIFY_ONLY:-}"
VERIFY_SKIP="${PBP_VERIFY_SKIP:-}"

selected() {         # selected "<名称>"：过滤掉不在本次范围内的检查
  if [ -n "$VERIFY_ONLY" ] && ! printf '%s' "$1" | grep -Eq "$VERIFY_ONLY"; then return 1; fi
  if [ -n "$VERIFY_SKIP" ] && printf '%s' "$1" | grep -Eq "$VERIFY_SKIP"; then return 1; fi
  return 0
}

check() {            # check "<名称>" <命令...>
  local name="$1"; shift
  if ! selected "$name"; then
    echo "SKIP  ${name}（PBP_VERIFY_ONLY/SKIP 未选中）"
    filtered=$((filtered + 1))
    return
  fi
  ran=$((ran + 1))
  if "$@" >/tmp/verify.$$.log 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"; sed 's/^/      /' /tmp/verify.$$.log | tail -20; fail=1
  fi
}
need_local() {       # need_local "<名称>" <命令...>：CI 模式跳过
  if [ "$CI_MODE" = 1 ]; then
    echo "SKIP  $1（CI 模式，需本地环境）"
    ci_skipped=$((ci_skipped + 1))
  else check "$@"; fi
}

# ---- 作战文档齐全（模板自带，别删）----
for f in docs/00-BRIEF.md docs/01-SPEC.md docs/02-TICKETS.md docs/03-PROCESS.md docs/04-PROOF.md docs/05-SUBMISSION.md docs/07-UI.md; do
  check "文档存在 $f" test -s "$f"
done
check "没有提交 .env" bash -c '! git ls-files --error-unmatch .env >/dev/null 2>&1'
check "设计变量对比度达标（design/tokens.css）" python3 scripts/check_tokens.py

# ---- 验收条件（举证票按 SPEC 的 AC 编号往下加）----
# check      "AC-1 单元测试"   npm test --silent
# need_local "AC-2 健康检查"   curl -fsS http://localhost:8080/health
check "规范资料是合法 JSON（demo/scenario）" python3 -c 'import json,sys; [json.load(open(f, encoding="utf-8")) for f in sys.argv[1:]]' demo/scenario/scenario.json demo/scenario/inbox-content.json
# 並行票各自把檢查寫進 scripts/verify.d/NN-<名字>.sh（只用上面的 check / need_local），這裡按文件名順序載入。
for vf in scripts/verify.d/*.sh; do
  [ -e "$vf" ] || continue
  # shellcheck source=/dev/null
  . "$vf"
done

rm -f /tmp/verify.$$.log
# 只有"每条都真的跑过且全部通过"才叫 ALL PASS（2026-10-30，T8 第 3 轮验收）。
# 用 PBP_VERIFY_ONLY / PBP_VERIFY_SKIP 分段跑时，被过滤掉的不是 PASS，而是没跑；
# 全部被过滤的段落曾经也印 ALL PASS，那是假的。
if [ "$fail" != 0 ]; then
  echo "HAS FAIL（$ran 条执行，$((filtered + ci_skipped)) 条跳过）"
elif [ "$filtered" -gt 0 ] || [ "$ci_skipped" -gt 0 ]; then
  echo "PASS（$ran 条通过，$((filtered + ci_skipped)) 条被过滤跳过——这不是完整复验）"
else
  echo "ALL PASS"
fi
exit $fail
