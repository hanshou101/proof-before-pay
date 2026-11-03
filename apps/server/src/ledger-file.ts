// The ledger file (SPEC §6.3.1). Every line is appended and flushed before the caller acts on it
// ("先寫事件再做事"), and the whole chain is verified on load before anything is replayed.
//
// Crash safety: a `kill -9` in the middle of one `write()` can leave a partial last line. That
// line was never a durable event, so `load()` drops it (and rewrites the file without it) instead
// of declaring the ledger corrupt. Any *other* broken line is corruption and throws.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  verifyChain,
  type ChainCheck,
  type EventType,
  type LedgerEvent,
} from '@pbp/core';

export interface AppendInput {
  type: EventType;
  data: unknown;
  at: string;
}

export interface LedgerLoad {
  events: LedgerEvent[];
  chain: ChainCheck;
  head: LedgerEvent | null;
  /** A partial final line from a crash was dropped. */
  droppedTornTail: boolean;
}

export class LedgerFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  load(): LedgerLoad {
    if (!existsSync(this.path)) {
      return { events: [], chain: { ok: true }, head: null, droppedTornTail: false };
    }

    const text = readFileSync(this.path, 'utf8');
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const events: LedgerEvent[] = [];
    let droppedTornTail = false;

    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line) as LedgerEvent);
      } catch {
        if (index === lines.length - 1) {
          droppedTornTail = true;
          break;
        }
        throw new Error(`Ledger line ${index + 1} in ${this.path} is not valid JSON — the ledger is corrupt.`);
      }
    }

    if (droppedTornTail) {
      const kept = events.map((event) => JSON.stringify(event)).join('\n');
      writeFileSync(this.path, kept === '' ? '' : `${kept}\n`, 'utf8');
    }

    const chain = verifyChain(events);
    return { events, chain, head: events.length > 0 ? (events[events.length - 1] ?? null) : null, droppedTornTail };
  }

  /** Write one already-hashed event. `Runtime` hashes first so it can validate before persisting. */
  write(event: LedgerEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, 'utf8');
  }

  reset(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, '', 'utf8');
  }
}
