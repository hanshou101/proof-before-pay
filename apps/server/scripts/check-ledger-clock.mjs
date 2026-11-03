#!/usr/bin/env node
// Does any ledger run backwards? (07-UI §4.4, D1-11 / T8 round 3, item 4.)
//
// The demo clock used to restart at the scenario's 17:30:00 in every process, so a restarted
// server wrote rows *before* the ones already in the file — the Ledger screen and every timeline
// showed a run that ended before it began. `demo:reset` and every E2E write real ledgers; this
// walks them and fails if any event is earlier than the one before it.
//
// Usage: node apps/server/scripts/check-ledger-clock.mjs data/e2e/ac11 data/e2e/ac13a ...

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node apps/server/scripts/check-ledger-clock.mjs <dataDir> [...]');
  process.exit(2);
}

let failures = 0;

for (const dir of dirs) {
  for (const file of ['ledger.jsonl', 'comparison.jsonl']) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const events = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));

    let previous = null;
    let backward = null;
    for (const event of events) {
      const at = Date.parse(event.at);
      if (previous !== null && at < previous) {
        backward = event;
        break;
      }
      previous = at;
    }

    const label = `${dir}/${file}`;
    if (backward !== null) {
      failures += 1;
      console.log(`FAIL  ${label}  ${events.length} events  ${backward.type} #${backward.seq} at ${backward.at} goes backwards`);
    } else {
      const first = events[0]?.at ?? '—';
      const last = events.at(-1)?.at ?? '—';
      console.log(`PASS  ${label}  ${events.length} events  ${first} → ${last}`);
    }
  }
}

console.log(failures === 0 ? '\nALL PASS — no ledger runs backwards.' : `\nHAS FAIL — ${failures} ledger(s) run backwards.`);
process.exit(failures === 0 ? 0 : 1);
