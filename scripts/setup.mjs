#!/usr/bin/env node
// One-shot install for a fresh clone.
//
// Each package owns its own package.json and lockfile (SPEC §6.0), so there is no root
// workspace to install. This walks the fixed order below, installs every package that
// exists, and builds the ones that have a `build` script (packages that are consumed by
// another package must have their `dist/` before the consumer compiles).
//
//   packages/core → packages/paypal → packages/agent → apps/server → apps/web → demo/generator
//
// A lockfile means `npm ci` (reproducible); without one we fall back to `npm install`.
// Any failure exits non-zero and names the package that broke.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ORDER = [
  'packages/core',
  'packages/paypal',
  'packages/agent',
  'apps/server',
  'apps/web',
  'demo/generator',
];

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const QUIET = ['--no-audit', '--no-fund'];

function run(cwd, args) {
  const result = spawnSync(NPM, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function fail(relative, step, code) {
  console.error(`\n✗ setup failed in ${relative} at "${step}" (exit ${code})`);
  console.error('  Fix the error above, then re-run: npm run setup');
  process.exit(code === 0 ? 1 : code);
}

let handled = 0;

for (const relative of ORDER) {
  const dir = join(ROOT, relative);
  const manifestPath = join(dir, 'package.json');

  if (!existsSync(manifestPath)) {
    console.log(`· ${relative}: not present yet, skipped`);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const hasLock = existsSync(join(dir, 'package-lock.json'));
  const install = hasLock ? ['ci', ...QUIET] : ['install', ...QUIET];

  console.log(`\n▸ ${relative}: npm ${install[0]}`);
  const installCode = run(dir, install);
  if (installCode !== 0) fail(relative, `npm ${install[0]}`, installCode);

  if (manifest.scripts?.build) {
    console.log(`▸ ${relative}: npm run build`);
    const buildCode = run(dir, ['run', 'build']);
    if (buildCode !== 0) fail(relative, 'npm run build', buildCode);
  }

  handled += 1;
}

console.log(`\n✓ setup complete — ${handled} package(s) installed and built`);
