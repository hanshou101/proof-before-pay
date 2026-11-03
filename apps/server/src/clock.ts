// The clock. SPEC §6.2.1 says the gate never reads the wall clock — the caller passes `now`.
//
// The demo scenario is a fictional Friday in November 2026 (`scenario.testClock`) and ships
// deliveries accepted on those dates. Running the fictional scenario on the wall clock would
// make every accepted delivery "accepted in the future" and hold every payment (O3), so the
// server anchors its clock to the scenario and lets it advance in real time: the first event
// lands at the scenario's Friday 17:30, the next ones a few seconds later. Same UTC day
// throughout, so L2/P2/O3 all judge the scenario as written.
//
// One ledger, one clock: every process that opens an existing ledger continues *after* its last
// row (`continueAfter`). Without that, each restart replayed the scenario from 17:30:00 and the
// ledger's timestamps went backwards — the Ledger screen and every timeline showed a run that
// ended before it began.

export interface Clock {
  (): string;
  /**
   * Make sure the next reading is later than `iso`. Called once the ledger is loaded, so a
   * restarted process continues the story instead of starting it again.
   */
  continueAfter?(iso: string | null): void;
  /**
   * Back to the scenario's own instant. Called by `demo:reset`, which starts a brand-new epoch:
   * a new story may begin at Friday 17:30 again, and without this every reset pushed the demo day
   * a few minutes later until it crossed midnight and the day-based limits changed meaning.
   */
  restart?(): void;
}

/** Scenario time, advancing with real time from process start. */
export function anchoredClock(baseIso: string, wallNow: () => number = Date.now): Clock {
  const scenarioBase = Date.parse(baseIso);
  if (Number.isNaN(scenarioBase)) throw new RangeError(`scenario.testClock is not a date: ${baseIso}`);
  let base = scenarioBase;
  let started = wallNow();

  const read = (): string => new Date(base + (wallNow() - started)).toISOString();

  read.continueAfter = (iso: string | null): void => {
    if (!iso) return;
    const previous = Date.parse(iso);
    if (Number.isNaN(previous)) return;
    // One second after the last recorded row: strictly later, and visibly a new moment.
    const resumed = previous + 1000;
    if (resumed > base + (wallNow() - started)) {
      base = resumed;
      started = wallNow();
    }
  };

  read.restart = (): void => {
    base = scenarioBase;
    started = wallNow();
  };

  return read;
}

/** A clock frozen at one instant — what the tests use so two runs are comparable. */
export function fixedClock(iso: string): Clock {
  return () => iso;
}

/** Wall clock. Kept for deployments whose data is dated in the past. */
export function wallClock(): Clock {
  return () => new Date().toISOString();
}
