// The child process for the restart test: a real HTTP listener on an ephemeral port, the same
// file-backed fake rail, and automatic restart recovery.

import { fixedClock } from '../src/clock.js';
import { REPO_ROOT, loadConfig } from '../src/config.js';
import { loadDemo } from '../src/scenario.js';
import { startServer } from '../src/server.js';
import { FakeAgent, FakeRail, TEST_ENV, railFileFor } from './fakes.js';
import { resolve } from 'node:path';

const dataDir = process.env.PBP_DATA_DIR;
if (!dataDir) throw new Error('PBP_DATA_DIR is required');

const config = loadConfig({
  env: { ...TEST_ENV },
  dataDir,
  demoDir: resolve(REPO_ROOT, 'demo'),
  port: Number.parseInt(process.env.PORT ?? '0', 10),
  clock: fixedClock('2026-11-06T17:30:00Z'),
  poll: {
    intervalMs: 10,
    windowMs: 800,
    backgroundMs: 100,
    submitAttempts: 4,
    submitBackoffMs: [10, 10, 10],
    comparisonSettleMs: 400,
  },
});

const demo = loadDemo(config.demoDir);
const rail = new FakeRail(railFileFor(dataDir), demo.scenario, {
  submitDelayMs: Number.parseInt(process.env.PBP_TEST_RAIL_DELAY ?? '200', 10),
});
const agent = new FakeAgent(demo.scenario, () => new Date().toISOString());

const server = await startServer({ config, demo, agent, rail });

process.stdout.write(`PORT=${server.port}\n`);

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
