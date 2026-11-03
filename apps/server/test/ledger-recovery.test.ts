// The ledger file on disk: a torn tail left by `kill -9` is recovered, corruption in the middle
// is refused, and a tampered line is reported at its own seq (AC-4, server side).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, canonical, verifyChain, type LedgerEvent } from '@pbp/core';
import { afterAll, describe, expect, it } from 'vitest';
import { LedgerFile } from '../src/ledger-file.js';

const dir = mkdtempSync(join(tmpdir(), 'pbp-ledger-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function threeEvents(): LedgerEvent[] {
  const first = appendEvent(null, { type: 'ledger.opened', data: { epoch: 'ep-1' }, at: '2026-11-06T17:30:00Z' });
  const second = appendEvent(first, { type: 'run.started', data: { runId: 'run_1' }, at: '2026-11-06T17:30:01Z' });
  const third = appendEvent(second, { type: 'run.completed', data: { runId: 'run_1' }, at: '2026-11-06T17:30:02Z' });
  return [first, second, third];
}

describe('LedgerFile', () => {
  it('loads a chain it wrote itself', () => {
    const path = join(dir, 'ok.jsonl');
    const events = threeEvents();
    writeFileSync(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

    const load = new LedgerFile(path).load();
    expect(load.events).toHaveLength(3);
    expect(load.chain).toEqual({ ok: true });
    expect(load.droppedTornTail).toBe(false);
    expect(load.head?.seq).toBe(3);
  });

  it('drops a partial last line from a crash and keeps the chain valid', () => {
    const path = join(dir, 'torn.jsonl');
    const events = threeEvents();
    const good = events.map((event) => JSON.stringify(event)).join('\n');
    writeFileSync(path, `${good}\n{"seq":4,"at":"2026-11-06T17:30:0`, 'utf8');

    const load = new LedgerFile(path).load();
    expect(load.events).toHaveLength(3);
    expect(load.chain).toEqual({ ok: true });
    expect(load.droppedTornTail).toBe(true);

    // The torn bytes are gone from the file, so the next append starts from a clean chain.
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(3);
    const again = new LedgerFile(path).load();
    expect(again.droppedTornTail).toBe(false);
  });

  it('refuses a broken line in the middle', () => {
    const path = join(dir, 'broken.jsonl');
    const events = threeEvents();
    const lines = events.map((event) => JSON.stringify(event));
    lines[1] = '{ not json';
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');

    expect(() => new LedgerFile(path).load()).toThrow(/not valid JSON/);
  });

  it('reports the seq of an edited line', () => {
    const path = join(dir, 'edited.jsonl');
    const events = threeEvents();
    const tampered = events.map((event) => ({ ...event }));
    (tampered[1] as LedgerEvent).data = { runId: 'run_2' };
    writeFileSync(path, tampered.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

    const load = new LedgerFile(path).load();
    expect(load.chain).toEqual({ ok: false, seq: 2 });
  });

  it('hashes the canonical form, not the key order it was written in', () => {
    const event = threeEvents()[0] as LedgerEvent;
    const reordered = {
      hash: event.hash,
      prevHash: event.prevHash,
      data: event.data,
      type: event.type,
      at: event.at,
      seq: event.seq,
    };
    expect(canonical(reordered)).toBe(canonical(event));
    expect(verifyChain([reordered as LedgerEvent])).toEqual({ ok: true });
  });
});
