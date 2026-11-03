// AC-1 — the core golden values.
//
// Input: scenario.json + `golden.items[*].claim` (never an LLM). Clock: `testClock`.
// Expectation: for in_01…in_08 every one of the nine checks reports the golden `status`
// (and `code` where golden names one), the decision matches, in_03 points at
// `hist_kenji_0142`, and two identical runs serialize identically.

import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.ts';
import type { CheckResult, CheckStatus, Proposal } from '../src/index.ts';
import { baseContext, proposalOf, scenario } from './fixtures.ts';

const GOLDEN_ITEMS = scenario.golden.items.filter((item) => item.claim !== null && item.checks !== null);

/** `"hold:OVER_CAP"` → { status: 'hold', code: 'OVER_CAP' }; `"pass"` → { status: 'pass' }` */
function parseGolden(value: string): { status: CheckStatus; code: string | null } {
  const [status, code] = value.split(':');
  return { status: status as CheckStatus, code: code ?? null };
}

describe('AC-1 golden values', () => {
  it('covers all eight invoice items', () => {
    expect(GOLDEN_ITEMS.map((item) => item.itemId)).toEqual([
      'in_01',
      'in_02',
      'in_03',
      'in_04',
      'in_05',
      'in_06',
      'in_07',
      'in_08',
    ]);
  });

  for (const item of GOLDEN_ITEMS) {
    it(`${item.itemId}: nine checks and decision equal golden`, () => {
      const context = baseContext();
      const proposal = proposalOf(item.itemId);
      const { checks, decision } = evaluate(proposal, context);

      expect(checks.map((check) => check.id)).toEqual(['O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'L1', 'L2', 'L3']);
      expect(decision).toBe(item.decision);

      for (const check of checks) {
        const golden = parseGolden(item.checks?.[check.id] ?? '');
        expect(check.status, `${check.id} status`).toBe(golden.status);
        if (golden.code !== null) expect(check.code, `${check.id} code`).toBe(golden.code);
      }
    });
  }

  it('in_03 O4 reports the seeded history as the duplicate', () => {
    const { checks } = evaluate(proposalOf('in_03'), baseContext());
    const o4 = checks.find((check) => check.id === 'O4') as CheckResult;
    expect(o4.status).toBe('fail');
    expect(o4.code).toBe('DUPLICATE');
    expect(o4.facts.duplicateOf).toBe('hist_kenji_0142');
    expect(o4.facts.originalState).toBe('proven');
  });

  it('in_04 is held on payee + change request while the invoice itself is fine', () => {
    const { checks, decision } = evaluate(proposalOf('in_04'), baseContext());
    expect(decision).toBe('held');
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.P1?.code).toBe('PAYEE_MISMATCH');
    expect(byId.P1?.facts.onFile).toBe('ana@studionorth.example');
    expect(byId.P1?.facts.requested).toBe('billing@studi0-north.example');
    expect(byId.P2?.code).toBe('CHANGE_REQUEST_PENDING');
    expect(byId.P2?.facts.sourceItemId).toBe('in_04');
  });

  it('in_05 is held on over-cap hours and an unaccepted delivery', () => {
    const { checks } = evaluate(proposalOf('in_05'), baseContext());
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.O2?.code).toBe('OVER_CAP');
    expect(byId.O2?.facts.cap).toBe(192000);
    expect(byId.O2?.facts.billedUnits).toBe(40);
    expect(byId.O2?.facts.capUnits).toBe(32);
    expect(byId.O3?.code).toBe('NOT_ACCEPTED');
    expect(byId.O3?.facts.deliveryId).toBe('del_leo_02');
  });

  it('in_06 is approved on the AI-matched agreement with no PO', () => {
    const { checks, decision } = evaluate(proposalOf('in_06'), baseContext());
    const o1 = checks.find((check) => check.id === 'O1') as CheckResult;
    expect(o1.facts.vendorId).toBe('ven_sofia');
    expect(o1.facts.matchedBy).toBe('sender');
    expect(decision).toBe('approved');
  });

  it('two runs over the same input serialize identically', () => {
    for (const item of GOLDEN_ITEMS) {
      const proposal: Proposal = proposalOf(item.itemId);
      const first = JSON.stringify(evaluate(proposal, baseContext()));
      const second = JSON.stringify(evaluate(proposal, baseContext()));
      expect(second).toBe(first);
    }
  });
});
