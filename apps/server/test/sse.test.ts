// SPEC §6.7: `GET /api/events?since=<seq>` streams `event: ledger` with a contiguous `seq`.
// The UI replays exactly this stream, so ordering is part of the contract.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LedgerEvent } from '@pbp/core';
import { fixedClock } from '../src/clock.js';
import { REPO_ROOT, loadConfig } from '../src/config.js';
import { loadDemo } from '../src/scenario.js';
import { startServer, type RunningServer } from '../src/server.js';
import { FakeAgent, FakeRail, TEST_ENV, railFileFor } from './fakes.js';

const dataDir = mkdtempSync(join(tmpdir(), 'pbp-sse-'));
let server: RunningServer | null = null;

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function listen(): Promise<RunningServer> {
  const config = loadConfig({
    env: { ...TEST_ENV },
    dataDir,
    demoDir: resolve(REPO_ROOT, 'demo'),
    port: 0,
    clock: fixedClock('2026-11-06T17:30:00Z'),
    poll: { intervalMs: 5, windowMs: 400, backgroundMs: 50, submitAttempts: 4, submitBackoffMs: [1, 1, 1], comparisonSettleMs: 300 },
  });
  const demo = loadDemo(config.demoDir);
  const rail = new FakeRail(railFileFor(dataDir), demo.scenario);
  const agent = new FakeAgent(demo.scenario, () => new Date().toISOString());
  return startServer({ config, demo, agent, rail, autoResume: false });
}

function sseReader(stream: ReadableStream<Uint8Array>): { events: LedgerEvent[]; done: Promise<void> } {
  const events: LedgerEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = '';

  const done = (async () => {
    const reader = stream.getReader();
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as LedgerEvent);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  })();

  return { events, done };
}

describe('GET /api/events', () => {
  it('streams the ledger in order, with contiguous seq', { timeout: 30_000 }, async () => {
    server = await listen();
    const base = server.url;

    const reset = await fetch(`${base}/api/demo/reset`, { method: 'POST' });
    expect(reset.status).toBe(200);

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events?since=0`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const { events, done } = sseReader(response.body as ReadableStream<Uint8Array>);

    const started = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'proof' }),
    });
    expect(started.status).toBe(200);

    const deadline = Date.now() + 20_000;
    while (!events.some((event) => event.type === 'run.completed')) {
      if (Date.now() > deadline) throw new Error('no run.completed on the stream');
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 20));
    }

    controller.abort();
    await done.catch(() => undefined);

    expect(events[0]?.type).toBe('ledger.opened');
    events.forEach((event, index) => expect(event.seq).toBe(index + 1));

    // Every invoice is read before its intent is proposed — the stream is the UI's story.
    for (const item of ['in_01', 'in_04', 'in_07']) {
      const read = events.findIndex(
        (event) => event.type === 'item.read' && (event.data as { itemId?: string }).itemId === item,
      );
      const proposed = events.findIndex(
        (event) => event.type === 'intent.proposed' && (event.data as { itemId?: string }).itemId === item,
      );
      expect(read).toBeGreaterThan(-1);
      expect(proposed).toBeGreaterThan(read);
    }

    const firstSubmit = events.findIndex((event) => event.type === 'payment.submitted');
    const firstChecked = events.findIndex(
      (event) =>
        event.type === 'intent.checked' && (event.data as { decision?: string }).decision === 'approved',
    );
    expect(firstChecked).toBeGreaterThan(-1);
    expect(firstSubmit).toBeGreaterThan(firstChecked);
  });

  it('honours ?since= so a reconnecting client does not replay history', { timeout: 20_000 }, async () => {
    if (!server) throw new Error('server not started');
    const controller = new AbortController();
    const response = await fetch(`${server.url}/api/events?since=5`, { signal: controller.signal });
    const { events, done } = sseReader(response.body as ReadableStream<Uint8Array>);

    const deadline = Date.now() + 10_000;
    while (events.length === 0) {
      if (Date.now() > deadline) throw new Error('no events after since=5');
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 20));
    }

    controller.abort();
    await done.catch(() => undefined);
    expect(events[0]?.seq).toBe(6);
  });
});
