// AC-5 — portability.
//
// `packages/core` must stay liftable into another payment project: no runtime dependencies,
// `node:crypto` as the only builtin, an exported RailAdapter contract, a language-neutral
// vector file that a rewrite can replay, and a README that explains the contract plus the two
// next rails.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.ts';
import type { CheckResult, Decision, GateContext, Proposal } from '../src/index.ts';
import { proposalOf, scenario } from './fixtures.ts';

interface VectorCase {
  itemId: string;
  proposal: Proposal;
  checks: CheckResult[];
  decision: Decision;
}

interface VectorFile {
  testClock: string;
  epoch: string;
  policy: GateContext['policy'];
  vendors: GateContext['vendors'];
  agreements: GateContext['agreements'];
  deliveries: GateContext['deliveries'];
  changeRequests: GateContext['changeRequests'];
  intents: GateContext['intents'];
  history: GateContext['intents'];
  cases: VectorCase[];
}

const VECTORS_URL = new URL('../vectors/golden.json', import.meta.url);
const vectors = JSON.parse(readFileSync(VECTORS_URL, 'utf8')) as VectorFile;

describe('AC-5 vectors/golden.json replays', () => {
  it('holds every golden invoice case', () => {
    expect(vectors.cases.map((entry) => entry.itemId)).toEqual([
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

  for (const entry of vectors.cases) {
    it(`${entry.itemId} replays to the stored checks and decision`, () => {
      const context: GateContext = {
        vendors: vectors.vendors,
        agreements: vectors.agreements,
        deliveries: vectors.deliveries,
        changeRequests: vectors.changeRequests,
        intents: vectors.intents,
        history: vectors.history,
        policy: vectors.policy,
        now: vectors.testClock,
        epoch: vectors.epoch,
      };
      const actual = evaluate(entry.proposal, context);
      expect(actual.decision).toBe(entry.decision);
      expect(actual.checks).toEqual(entry.checks);
    });
  }

  it('agrees with the scenario golden values it was generated from', () => {
    for (const entry of vectors.cases) {
      const golden = scenario.golden.items.find((item) => item.itemId === entry.itemId);
      expect(golden?.decision).toBe(entry.decision);
      for (const check of entry.checks) {
        const expected = golden?.checks?.[check.id] ?? '';
        const [status, code] = expected.split(':');
        expect(check.status, `${entry.itemId} ${check.id}`).toBe(status);
        if (code) expect(check.code, `${entry.itemId} ${check.id}`).toBe(code);
      }
    }
  });

  it('carries the seeded history so a port can detect the duplicate', () => {
    expect(vectors.intents.map((intent) => intent.id)).toContain('hist_kenji_0142');
    expect(vectors.intents[0]?.state).toBe('proven');
  });
});

describe('AC-5 zero runtime dependencies', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string>; type?: string };

  it('declares no dependencies at all', () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  it('is an ES module', () => {
    expect(packageJson.type).toBe('module');
  });

  it('imports nothing but node:crypto and its own files', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(new URL('../src', import.meta.url).pathname)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        if (specifier.startsWith('.') || specifier.startsWith('node:')) {
          if (specifier.startsWith('node:') && specifier !== 'node:crypto') {
            violations.push(`${file}: ${specifier}`);
          }
          continue;
        }
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('AC-5 the RailAdapter contract is exported', () => {
  const distDir = new URL('../dist', import.meta.url).pathname;
  const declaration = sourceFiles(distDir)
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('exports the adapter and its four methods', () => {
    expect(declaration).toContain('interface RailAdapter');
    expect(declaration).toContain('submit(');
    expect(declaration).toContain('fetchReceipt(');
    expect(declaration).toContain('cancel(');
    expect(declaration).toContain('mapStatus(');
  });

  it('exports the portability-critical functions', () => {
    for (const name of ['evaluate', 'sealOf', 'idempotencyKey', 'verifyChain', 'replay', 'detectRisk']) {
      expect(declaration, name).toContain(name);
    }
  });
});

describe('AC-5 README documents the contract', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  it('has the API, contract, new-rail and checklist sections', () => {
    for (const heading of ['## API', '## RailAdapter 契約', '## 怎麼加一條新軌道', '## 對照清單']) {
      expect(readme, heading).toContain(heading);
    }
  });

  it('answers the three questions for both next rails', () => {
    for (const marker of ['Airwallex', '支付寶 Machine Pay', 'HTTP 402', '待該賽道核實']) {
      expect(readme, marker).toContain(marker);
    }
    expect(readme.split('冪等鍵放哪').length - 1).toBeGreaterThanOrEqual(2);
    expect(readme.split('哪個狀態才算證實').length - 1).toBeGreaterThanOrEqual(2);
    expect(readme.split('怎麼取消或退回').length - 1).toBeGreaterThanOrEqual(2);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}
