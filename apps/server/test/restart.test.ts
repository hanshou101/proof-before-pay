// AC-13(b), server side: `kill -9` right after the first `payment.submitted`.
//
// The server is a real child process, so the test also covers what a crash really does: a torn
// last ledger line, a payment that PayPal already took but whose answer we never saw, and a run
// that has to finish after the restart without paying anything twice.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChain, type LedgerEvent } from '@pbp/core';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.js';
import { loadDemo } from '../src/scenario.js';
import { bucketsOf } from './harness.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsx');
const DATA_DIR = mkdtempSync(join(tmpdir(), 'pbp-restart-'));
const children: ChildProcess[] = [];
const golden = loadDemo(resolve(REPO_ROOT, 'demo')).scenario.golden;

interface Started {
  child: ChildProcess;
  port: number;
  output: string;
  exited: Promise<void>;
}

function startChild(): Promise<Started> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(TSX, ['test/restart-child.ts'], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        PBP_DATA_DIR: DATA_DIR,
        PBP_TEST_RAIL_DELAY: '200',
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so the kill takes the whole tree down (tsx may run the script in
      // a child of its own; a half-killed server would keep paying while the test watches).
      detached: true,
    });
    children.push(child);

    const exited = new Promise<void>((resolveExit) => child.on('exit', () => resolveExit()));

    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error(`child did not report a port:\n${output}`));
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const match = /PORT=(\d+)/.exec(output);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ child, port: Number(match[1]), output, exited });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`child exited with ${code}:\n${output}`));
      }
    });
  });
}

function killTree(child: ChildProcess): void {
  if (typeof child.pid !== 'number') return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null> | T | null): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
  }
}

function ledgerText(): string {
  try {
    return readFileSync(join(DATA_DIR, 'ledger.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

async function post(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: await response.json() };
}

describe('a restart in the middle of a run', () => {
  it('finishes the run after kill -9 without paying anything twice', { timeout: 120_000 }, async () => {
    const first = await startChild();
    const base = `http://127.0.0.1:${first.port}`;

    const reset = await post(`${base}/api/demo/reset`, {});
    expect(reset.status).toBe(200);

    const started = await post(`${base}/api/runs`, { mode: 'proof' });
    expect(started.status).toBe(200);

    // Kill as soon as the first payment is on the ledger — before any receipt can close it.
    await waitFor('the first payment.submitted', 20_000, () =>
      ledgerText().includes('"payment.submitted"') ? true : null,
    );

    const beforeKill = ledgerText();
    expect(beforeKill).not.toContain('"run.completed"');

    first.child.kill('SIGKILL');
    killTree(first.child);
    await first.exited;

    const second = await startChild();
    const base2 = `http://127.0.0.1:${second.port}`;

    await waitFor('the resumed run to complete', 90_000, async () => {
      const response = await fetch(`${base2}/api/state`);
      const state = (await response.json()) as any;
      return state.run?.phase === 'done' ? state : null;
    });

    const state = (await (await fetch(`${base2}/api/state`)).json()) as any;
    expect(state.totals).toEqual(bucketsOf(golden.totalsAfterRun));

    // The second process really did the rest of the work — not a server that had already finished.
    const afterKillCount = beforeKill.split('\n').filter((line) => line.trim() !== '').length;
    const finalLines = ledgerText().split('\n').filter((line) => line.trim() !== '');
    expect(finalLines.length).toBeGreaterThan(afterKillCount);

    // One run, resumed — not a second run started from scratch.
    const events = ledgerText()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as LedgerEvent);
    const starts = events.filter((event) => event.type === 'run.started');
    const completes = events.filter((event) => event.type === 'run.completed');
    expect(starts).toHaveLength(1);
    expect(completes).toHaveLength(1);
    expect(verifyChain(events)).toEqual({ ok: true });

    const rail = JSON.parse(readFileSync(join(DATA_DIR, 'test-rail.json'), 'utf8')) as {
      batches: Record<string, { payouts: number; receiver: string }>;
      calls: Record<string, number>;
    };
    for (const [key, batch] of Object.entries(rail.batches)) {
      expect(batch.payouts, `${key} (${batch.receiver}) was paid ${batch.payouts} times`).toBe(1);
    }

    second.child.kill('SIGKILL');
    killTree(second.child);
  });
});

afterAll(() => {
  for (const child of children) killTree(child);
  rmSync(DATA_DIR, { recursive: true, force: true });
});
