// One place to assemble a server with the test doubles, on a throwaway data directory.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixedClock } from '../src/clock.js';
import { REPO_ROOT, loadConfig, type ServerConfig } from '../src/config.js';
import { loadDemo } from '../src/scenario.js';
import { createServer, type BuiltServer } from '../src/server.js';
import { FakeAgent, FakeRail, TEST_ENV, railFileFor } from './fakes.js';

export interface Harness {
  built: BuiltServer;
  rail: FakeRail;
  agent: FakeAgent;
  dataDir: string;
  config: ServerConfig;
  get(path: string): Promise<{ status: number; body: any; response: Response }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: any; response: Response }>;
  /** Start a run over HTTP and wait for it to finish. */
  run(mode?: 'proof' | 'comparison'): Promise<{ status: number; body: any }>;
  close(): void;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  /** Start with no PayPal/LLM credentials at all (AC-17). */
  withoutCredentials?: boolean;
  allowComparison?: boolean;
  railSubmitDelayMs?: number;
  dataDir?: string;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'pbp-server-'));
  const demoDir = resolve(REPO_ROOT, 'demo');
  const baseEnv = options.withoutCredentials ? {} : TEST_ENV;
  const config = loadConfig({
    env: { ...baseEnv, ...(options.env ?? {}) },
    dataDir,
    demoDir,
    allowComparison: options.allowComparison ?? false,
    clock: fixedClock('2026-11-06T17:30:00Z'),
    poll: {
      intervalMs: 5,
      windowMs: 400,
      backgroundMs: 50,
      submitAttempts: 4,
      submitBackoffMs: [1, 1, 1],
      // The fake rail leaves `.example` payouts UNCLAIMED forever; the comparison test must not
      // wait out the real 90-second settle window.
      comparisonSettleMs: 300,
    },
  });

  const demo = loadDemo(demoDir);
  const rail = new FakeRail(railFileFor(dataDir), demo.scenario, { submitDelayMs: options.railSubmitDelayMs });
  const agent = new FakeAgent(demo.scenario, () => new Date().toISOString());

  const built = createServer({ config, demo, agent, rail });

  const call = async (path: string, init?: RequestInit) => {
    const response = await built.app.request(path, init);
    const text = await response.text();
    let body: any = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body, response };
  };

  return {
    built,
    rail,
    agent,
    dataDir,
    config,
    get: (path) => call(path),
    post: (path, body) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    run: async (mode = 'proof') => {
      const response = await call('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (response.status === 200) await built.runner.waitForIdle();
      return { status: response.status, body: response.body };
    },
    close: () => {
      built.runner.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Map a golden `final` value onto the state the projection uses. */
export function stateOfFinal(final: string): string {
  if (final === 'awaiting_proof') return 'awaiting';
  return final;
}

interface Bucket {
  count: number;
  amount: number;
}

/** The four buckets `replay` produces, copied out of a golden totals block (which carries extras). */
export function bucketsOf(totals: {
  proven?: Bucket;
  awaitingProof?: Bucket;
  held?: Bucket;
  stopped?: Bucket;
}): Record<'proven' | 'awaitingProof' | 'held' | 'stopped', Bucket> {
  return {
    proven: { count: totals.proven?.count ?? 0, amount: totals.proven?.amount ?? 0 },
    awaitingProof: { count: totals.awaitingProof?.count ?? 0, amount: totals.awaitingProof?.amount ?? 0 },
    held: { count: totals.held?.count ?? 0, amount: totals.held?.amount ?? 0 },
    stopped: { count: totals.stopped?.count ?? 0, amount: totals.stopped?.amount ?? 0 },
  };
}
