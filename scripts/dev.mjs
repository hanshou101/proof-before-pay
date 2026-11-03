#!/usr/bin/env node
// `npm run dev` — one command, one URL (SPEC §6.7 / AC-17).
//
// Starts the API (apps/server, built dist) and the web dev server (Vite on 5173, which proxies
// /api and the SSE stream to 8787). It only prints "ready" after `GET /` on 5173 answers 200:
// a probe that only checked /api/health once told us the API was up while the page was still a
// blank error, which is exactly the failure AGENTS friction A1 is about.
//
// Any failure before that point kills both children and exits non-zero.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const WEB_URL = 'http://localhost:5173';
const READY_TIMEOUT_MS = 90_000;

function fail(message, children = []) {
  console.error(`\n✗ ${message}`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
  process.exit(1);
}

const serverEntry = join(ROOT, 'apps', 'server', 'dist', 'main.js');
if (!existsSync(serverEntry)) {
  fail('apps/server/dist/main.js is missing — run `npm run setup` first.');
}

const children = [];

function start(label, command, args, options) {
  const child = spawn(command, args, { cwd: ROOT, env: process.env, ...options });
  children.push(child);
  const prefix = `[${label}]`;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') console.log(`${prefix} ${line}`);
      }
    });
  }
  child.on('exit', (code, signal) => {
    if (signal === null && code !== 0) {
      fail(`${label} exited with code ${code} — see the lines above.`, children);
    }
  });
  return child;
}

start('api', process.execPath, [serverEntry], { stdio: ['ignore', 'pipe', 'pipe'] });
start('web', NPM, ['--prefix', 'apps/web', 'run', 'dev'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

/** Both the page and the API have to answer before this is a working product. */
async function probe() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const page = await fetch(`${WEB_URL}/`, { signal: controller.signal });
    if (!page.ok) return `GET / answered ${page.status}`;
    const health = await fetch(`${WEB_URL}/api/health`, { signal: controller.signal });
    if (!health.ok) return `GET /api/health answered ${health.status}`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}

const deadline = Date.now() + READY_TIMEOUT_MS;
let lastProblem = 'nothing answered yet';
for (;;) {
  await new Promise((done) => setTimeout(done, 700));
  const problem = await probe();
  if (problem === null) break;
  lastProblem = problem;
  if (Date.now() > deadline) {
    fail(`the app did not become ready within ${READY_TIMEOUT_MS / 1000}s (${lastProblem}).`, children);
  }
}

console.log(`\n✓ Proof Before Pay is ready — open ${WEB_URL}\n`);

const shutdown = () => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
