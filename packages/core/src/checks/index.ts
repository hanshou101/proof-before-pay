// The nine checks, in the order SPEC §6.2.2 lists them.
// Each one reads what it needs from `CheckDeps` and returns a `CheckResult`; nothing here
// mutates context or depends on wall-clock time (`context.now` is the only clock).

import type { CheckId, CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { checkO1, resolveVendor } from './o1.js';
import { checkO2 } from './o2.js';
import { checkO3 } from './o3.js';
import { checkO4 } from './o4.js';
import { checkP1 } from './p1.js';
import { checkP2 } from './p2.js';
import { checkL1 } from './l1.js';
import { checkL2 } from './l2.js';
import { checkL3 } from './l3.js';

export type CheckFn = (deps: CheckDeps) => CheckResult;

export const CHECK_ORDER: readonly CheckFn[] = [
  checkO1,
  checkO2,
  checkO3,
  checkO4,
  checkP1,
  checkP2,
  checkL1,
  checkL2,
  checkL3,
];

export const CHECK_IDS: readonly CheckId[] = ['O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'L1', 'L2', 'L3'];

export { checkO1, checkO2, checkO3, checkO4, checkP1, checkP2, checkL1, checkL2, checkL3, resolveVendor };
export type { VendorResolution, VendorMatchedBy } from './o1.js';
