#!/usr/bin/env bash
# T4 (AME-912) — apps/web checks. Loaded by scripts/verify.sh; safe in CI.
# CI has no node_modules: install with npm ci first (the repo does not ship deps).
set -uo pipefail

WEB=apps/web

if [ ! -d "$WEB/node_modules" ]; then
  check "web: npm ci" bash -c "cd $WEB && npm ci --no-audit --no-fund"
fi

check "web: typecheck (tsc --noEmit)" bash -c "cd $WEB && npm run --silent typecheck"
check "web: unit tests (vitest, projection)" bash -c "cd $WEB && npm test --silent"
check "web: build (vite)" bash -c "cd $WEB && npx vite build"
check "web: no bare colour / px font-size values" bash -c "cd $WEB && node scripts/scan-tokens.mjs"

# The screenshots themselves are evidence, not a CI check, and they photograph a *real* run — so
# they live in 70-screenshots.sh, which loads after 60-e2e.sh has produced the data. Running them
# here (before the E2E) made a fresh clone fail with "no real run at data/e2e/ac13b"
# (2026-10-30, T8 第 3 輪驗收第 5 項).
