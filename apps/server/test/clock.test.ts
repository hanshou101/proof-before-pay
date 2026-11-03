// One ledger, one clock (07-UI §4.4, D1-11 / T8 round 3, item 4).
//
// Every process used to restart the demo clock at the scenario's 17:30:00, so a restarted server
// wrote timestamps *before* the rows already in the file: the Ledger screen and every timeline
// ran backwards on screen. `continueAfter` is what a restart calls once the ledger is loaded.

import { describe, expect, it } from 'vitest';
import { anchoredClock, fixedClock } from '../src/clock.js';

describe('the demo clock', () => {
  it('anchors at the scenario instant and advances with real time', () => {
    let now = 1_000;
    const clock = anchoredClock('2026-11-06T17:30:00Z', () => now);
    expect(clock()).toBe('2026-11-06T17:30:00.000Z');
    now += 5_000;
    expect(clock()).toBe('2026-11-06T17:30:05.000Z');
  });

  it('continues after the last row a previous process wrote', () => {
    const clock = anchoredClock('2026-11-06T17:30:00Z', () => 0);
    // A previous process ran for a minute and recorded its last event at 17:31:00.
    clock.continueAfter?.('2026-11-06T17:31:00.000Z');
    expect(clock()).toBe('2026-11-06T17:31:01.000Z');
  });

  it('does not jump when the ledger is older than the anchored clock', () => {
    const clock = anchoredClock('2026-11-06T17:30:00Z', () => 0);
    clock.continueAfter?.('2026-11-05T09:00:00.000Z');
    expect(clock()).toBe('2026-11-06T17:30:00.000Z');
  });

  it('restarts at the scenario instant for a new epoch (demo:reset)', () => {
    // Every reset used to inherit the previous run's clock, so a long demo session pushed the
    // fictional Friday later and later until the day-based limits changed meaning.
    const clock = anchoredClock('2026-11-06T17:30:00Z', () => 0);
    clock.continueAfter?.('2026-11-07T02:00:00.000Z');
    expect(clock()).toBe('2026-11-07T02:00:01.000Z');
    clock.restart?.();
    expect(clock()).toBe('2026-11-06T17:30:00.000Z');
  });

  it('ignores a clock that has no anchor to continue from', () => {
    expect(fixedClock('2026-11-06T17:30:00Z').continueAfter).toBeUndefined();
  });
});
