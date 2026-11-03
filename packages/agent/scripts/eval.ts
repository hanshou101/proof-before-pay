// The T6 evaluation — real model, real inbox, real gate output, frozen evidence.
//
//   npm run eval -- extract --run 1     9 emails × 1 pass, every AC-8 field against golden
//   npm run eval -- explain --run 1     in_03 / in_04 / in_05 held-or-blocked explanations
//   npm run eval -- comparison          the ungated agent with a recorder instead of PayPal
//
// Raw model answers are written by the client into `proof/ai/<run-name>/` (that is the frozen
// evidence AC-8 asks for). The summary next to them is what the console prints.
//
// Nothing here "fixes" a value toward golden: a mismatch is printed and counted.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate,
  fingerprint,
  idempotencyKey,
  type Agreement,
  type Claim,
  type Delivery,
  type GateContext,
  type PayeeChangeRequest,
  type Policy,
  type Proposal,
  type Vendor,
} from '@pbp/core';
import {
  createChatModel,
  explainIntent,
  processItem,
  readInbox,
  runComparison,
  templateExplanation,
  checkFacts,
  type AgentContext,
  type ComparisonPayout,
  type InboxItem,
} from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');

// ---------------------------------------------------------------- scenario + env ------------

interface GoldenItem {
  itemId: string;
  classification: string;
  claim: {
    vendorId: string | null;
    invoiceNumber: string;
    issueDate: string;
    currency: 'USD';
    total: number;
    po: string | null;
    requestedPayee: string | null;
    lines: { description: string; quantity: number; unit: 'item' | 'hour' | 'word'; unitPrice: number; amount: number }[];
  } | null;
  agreementId: string | null;
  checks: Record<string, string> | null;
  decision: 'approved' | 'held' | 'blocked' | null;
  riskFlags: string[];
  duplicateOf?: string;
}

interface Scenario {
  version: string;
  testClock: string;
  payer: { name: string; operator: string; domain: string; currency: 'USD' };
  policy: Policy;
  vendors: Vendor[];
  agreements: Agreement[];
  deliveries: Delivery[];
  history: { id: string; vendorId: string; invoiceNumber: string; agreementId: string; total: number; currency: 'USD' }[];
  inbox: { id: string; from: string; subject: string; receivedAt: string; attachments: string[] }[];
  golden: {
    items: GoldenItem[];
    comparisonMode: { payouts: { itemId: string; receiver: string; amount: number; paypal: string; problem?: string }[]; totalSent: number };
  };
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if ((process.env[key] ?? '') === '') process.env[key] = value;
  }
}

loadDotEnv(join(ROOT, '.env'));

const scenario = JSON.parse(readFileSync(join(ROOT, 'demo', 'scenario', 'scenario.json'), 'utf8')) as Scenario;

function goldenOf(itemId: string): GoldenItem {
  const item = scenario.golden.items.find((entry) => entry.itemId === itemId);
  if (!item) throw new Error(`no golden entry for ${itemId}`);
  return item;
}

function emailFromHeader(header: string): string {
  const bracketed = /<([^<>]+)>/.exec(header);
  return (bracketed?.[1] ?? header).trim().toLowerCase();
}

/** A Claim built from the golden values — the input to the gate for the explanation eval. */
function claimFromGolden(itemId: string): Claim {
  const item = goldenOf(itemId);
  if (!item.claim) throw new Error(`${itemId} has no golden claim`);
  const inbox = scenario.inbox.find((entry) => entry.id === itemId);
  if (!inbox) throw new Error(`no inbox entry for ${itemId}`);
  const vendor = scenario.vendors.find((entry) => entry.id === item.claim?.vendorId) ?? null;
  return {
    itemId,
    vendorId: item.claim.vendorId,
    vendorName: vendor?.name ?? '',
    senderEmail: emailFromHeader(inbox.from),
    invoiceNumber: item.claim.invoiceNumber,
    issueDate: item.claim.issueDate,
    currency: 'USD',
    total: item.claim.total,
    po: item.claim.po,
    requestedPayee: item.claim.requestedPayee,
    lines: item.claim.lines,
    sourceSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    extractedBy: null,
  };
}

const EPOCH = 'ep_demo_2026_11_06';

/**
 * The transaction id the seeded payment carries in the T6 fixture.
 *
 * The real id is created by the sandbox at `demo:reset`; T6 runs before the sandbox exists
 * (T5/T8 own it), so the evaluation uses an id that is obviously a fixture. It stands in for
 * what the server will read from `data/history.json` — it is not a value the product computes,
 * and it is not tuned to make a sentence pass.
 */
const FIXTURE_TXN = 'FIXTURE-TXN-0142';

/**
 * Gate context for the explanation eval. Everything is scenario data except two records the
 * scenario does not carry and the server would:
 *   - the change request the agent records for in_04 (same id the agent generates: `cr_in_04`);
 *   - the seeded payment `hist_kenji_0142` as a history record. `data/history.json` is what
 *     holds the transaction id and the paid-at time (SPEC v1.4 §6.3.2 / AC-10), and T6 has no
 *     sandbox, so the record carries the fixture id and `scenario.testClock` — the moment
 *     `demo:reset` pays the seed on the anchored clock. `summary.json` marks `fixture: true`;
 *     T8 re-runs the same check against the real seed.
 */
function gateContext(): GateContext {
  const inbox = scenario.inbox.find((entry) => entry.id === 'in_04');
  const changeRequests: PayeeChangeRequest[] = [
    {
      id: 'cr_in_04',
      vendorId: 'ven_ana',
      requestedPayee: 'billing@studi0-north.example',
      sourceItemId: 'in_04',
      requestedAt: inbox?.receivedAt ?? '2026-11-04T21:47:00Z',
      status: 'unverified',
    },
  ];

  const history = scenario.history.map((record) => {
    const fp = fingerprint({
      vendorId: record.vendorId,
      invoiceNumber: record.invoiceNumber,
      currency: record.currency,
      total: record.total,
    });
    const vendor = scenario.vendors.find((entry) => entry.id === record.vendorId);
    return {
      id: record.id,
      itemId: record.id,
      vendorId: record.vendorId,
      agreementId: record.agreementId,
      amount: record.total,
      currency: record.currency,
      payee: vendor?.payee ?? { rail: 'paypal' as const, recipientType: 'EMAIL' as const, receiver: '' },
      fingerprint: fp,
      idempotencyKey: idempotencyKey(EPOCH, fp),
      // Paid at the moment demo:reset makes the seed payment on the anchored clock.
      at: scenario.testClock,
      transactionId: FIXTURE_TXN,
    };
  });

  return {
    vendors: scenario.vendors,
    agreements: scenario.agreements,
    deliveries: scenario.deliveries,
    changeRequests,
    intents: [],
    history,
    policy: scenario.policy,
    now: scenario.testClock,
    epoch: EPOCH,
  };
}

// ---------------------------------------------------------------- output helpers ------------

function line(char = '─', width = 108): string {
  return char.repeat(width);
}

function writeSummary(dir: string, name: string, value: unknown): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

function relDir(dir: string): string {
  return dir.startsWith(ROOT) ? dir.slice(ROOT.length + 1) : dir;
}

// ---------------------------------------------------------------- extract -------------------

const AC8_FIELDS = [
  'vendorId',
  'invoiceNumber',
  'currency',
  'total',
  'po',
  'requestedPayee',
] as const;

function compareClaim(golden: GoldenItem, claim: Claim | null): string[] {
  const problems: string[] = [];
  if (!golden.claim) {
    if (claim !== null) problems.push(`claim: expected none, got ${claim.invoiceNumber}`);
    return problems;
  }
  if (claim === null) return ['claim: expected one, got none'];

  for (const field of AC8_FIELDS) {
    const expected = golden.claim[field];
    const actual = claim[field];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  if (golden.claim.lines.length !== claim.lines.length) {
    problems.push(`lines: expected ${golden.claim.lines.length}, got ${claim.lines.length}`);
  } else {
    golden.claim.lines.forEach((expectedLine, index) => {
      const actualLine = claim.lines[index];
      if (!actualLine) return;
      for (const field of ['quantity', 'unit', 'unitPrice', 'amount'] as const) {
        if (JSON.stringify(expectedLine[field]) !== JSON.stringify(actualLine[field])) {
          problems.push(
            `lines[${index}].${field}: expected ${JSON.stringify(expectedLine[field])}, got ${JSON.stringify(actualLine[field])}`,
          );
        }
      }
    });
  }

  return problems;
}

async function evalExtract(run: number, outOverride: string | null): Promise<void> {
  const outDir = outOverride === null ? join(ROOT, 'proof', 'ai', `extract-run-${run}`) : resolve(outOverride);
  // One directory = one run. Stale files from an earlier pass would be read as part of this
  // run's evidence (every call writes a fresh file, so leftovers are never overwritten).
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const model = createChatModel({ rawDir: outDir });
  const items = await readInbox(ROOT);
  const ctx: AgentContext = {
    vendors: scenario.vendors,
    agreements: scenario.agreements,
    payerDomain: scenario.payer.domain,
    model,
  };

  console.log(line());
  console.log(`AC-8 extraction · run ${run} · model ${model.model}`);
  console.log(line());
  console.log(
    ['item', 'classification', 'vendor', 'invoice', 'currency', 'total', 'po', 'payee', 'lines', 'match', 'result']
      .map((header) => header.padEnd(10))
      .join(''),
  );

  const rows = [];
  let allPass = true;

  for (const item of items) {
    const golden = goldenOf(item.id);
    const result = await processItem(item, ctx);
    const problems: string[] = [];

    if (result.classification !== golden.classification) {
      problems.push(`classification: expected ${golden.classification}, got ${String(result.classification)}`);
    }
    problems.push(...compareClaim(golden, result.claim));

    // AC-8 names in_06 explicitly: the no-PO invoice must match agr_sofia_05, not agr_sofia_04.
    if (golden.agreementId !== null && result.proposal?.agreementId !== golden.agreementId) {
      problems.push(`agreementId: expected ${golden.agreementId}, got ${String(result.proposal?.agreementId)}`);
    }

    // Acceptance 6: in_04's risk note must fit the SPEC limit in every AC-8 run, and the run has
    // to say whether the sentence came from the model or the deterministic fallback.
    const riskNote = result.risk.note;
    const riskNoteChars = riskNote === null ? 0 : [...riskNote].length;
    const riskNoteSentences =
      riskNote === null ? 0 : riskNote.split(/(?<=[.!?])\s+/).filter((part) => part.trim() !== '').length;
    if (item.id === 'in_04') {
      if (riskNote === null) problems.push('riskNote: expected one, got none');
      else if (riskNoteChars > 140) problems.push(`riskNote: ${riskNoteChars} chars > 140`);
      else if (riskNoteSentences > 2) problems.push(`riskNote: ${riskNoteSentences} sentences > 2`);
    }

    const pass = problems.length === 0 && !result.needsReview;
    if (!pass) allPass = false;

    rows.push({
      itemId: item.id,
      classification: result.classification,
      needsReview: result.needsReview,
      agreementId: result.proposal?.agreementId ?? null,
      agreementMatchedBy: result.proposal?.agreementMatchedBy ?? null,
      issueDate: result.claim?.issueDate ?? null,
      problems,
      pass,
      events: result.events.length,
      riskFlags: result.risk.flags,
      riskNote,
      riskNoteSource: result.risk.noteSource,
      riskNoteChars,
    });

    const cells = [
      item.id,
      String(result.classification ?? '-'),
      result.claim?.vendorId ? result.claim.vendorId.replace('ven_', '') : '-',
      result.claim?.invoiceNumber ?? '-',
      result.claim?.currency ?? '-',
      result.claim ? String(result.claim.total) : '-',
      result.claim?.po ?? '-',
      result.claim?.requestedPayee ? 'yes' : '-',
      result.claim ? String(result.claim.lines.length) : '-',
      result.proposal?.agreementId ?? '-',
      pass ? 'PASS' : 'FAIL',
    ];
    console.log(cells.map((cell) => cell.padEnd(10)).join(''));

    if (item.id === 'in_04') {
      console.log(
        `         └─ risk note [${result.risk.noteSource}, ${riskNoteChars} chars] ${riskNote ?? '(none)'}`,
      );
    }

    for (const problem of problems) console.log(`         └─ ${problem}`);
  }

  console.log(line());
  console.log(`${allPass ? 'EXTRACT ALL PASS' : 'EXTRACT FAIL'} · ${rows.filter((row) => row.pass).length}/${rows.length} items · run ${run}`);

  const summaryFile = writeSummary(outDir, 'summary.json', {
    run,
    at: new Date().toISOString(),
    model: model.model,
    scenarioVersion: scenario.version,
    allPass,
    rows,
  });
  console.log(`summary → ${relDir(summaryFile)}`);

  if (!allPass) process.exitCode = 1;
}

// ---------------------------------------------------------------- explain -------------------

const EXPLAIN_ITEMS = ['in_03', 'in_04', 'in_05'] as const;

/** What the server hands `explainIntent` for the duplicate: the seeded payment's record. */
function originalPaymentFor(itemId: string): { id: string; transactionId: string; paidAt: string } | null {
  if (itemId !== 'in_03') return null;
  return {
    id: goldenOf(itemId).duplicateOf ?? 'hist_kenji_0142',
    transactionId: FIXTURE_TXN,
    paidAt: scenario.testClock,
  };
}

async function evalExplain(run: number): Promise<void> {
  const outDir = join(ROOT, 'proof', 'ai', `explain-run-${run}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const model = createChatModel({ rawDir: outDir });
  const context = gateContext();

  console.log(line());
  console.log(`AC-10 explanations · run ${run} · model ${model.model}`);
  console.log(line());

  const rows = [];
  let allPass = true;

  for (const itemId of EXPLAIN_ITEMS) {
    const golden = goldenOf(itemId);
    if (!golden.claim || !golden.agreementId) throw new Error(`${itemId} is not an explainable item`);
    const claim = claimFromGolden(itemId);
    const proposal: Proposal = {
      claim,
      agreementId: golden.agreementId,
      agreementMatchedBy: golden.agreementId === 'agr_sofia_05' ? 'ai' : 'po',
      rationale: 'eval fixture',
    };
    const { checks, decision } = evaluate(proposal, context);

    const original = originalPaymentFor(itemId);

    const explanation = await explainIntent(
      { intentId: `int_${itemId}`, itemId, decision, claim, checks, original },
      { model },
    );

    const facts = checkFacts(explanation.text, {
      intentId: `int_${itemId}`,
      itemId,
      decision,
      claim,
      checks,
      original,
    });
    const sentences = explanation.text.split(/(?<=[.!?])\s+/).filter((part) => part.trim() !== '').length;
    const pass = facts.ok && sentences <= 2;
    if (!pass) allPass = false;

    rows.push({
      itemId,
      decision,
      failing: checks.filter((check) => check.status !== 'pass' && check.status !== 'na').map((check) => `${check.id}:${check.code}`),
      text: explanation.text,
      source: explanation.source,
      attempts: explanation.attempts,
      sentences,
      chars: [...explanation.text].length,
      missingFacts: facts.missing,
      problems: facts.problems,
      pass,
    });

    console.log(`${itemId}  ${decision.padEnd(8)} ${explanation.source.padEnd(9)} ${pass ? 'PASS' : 'FAIL'}  ${explanation.text}`);
    if (facts.missing.length > 0) console.log(`         └─ missing: ${facts.missing.join('; ')}`);
    if (facts.problems.length > 0) console.log(`         └─ problems: ${facts.problems.join('; ')}`);
  }

  // The deterministic fallback must satisfy the same fact check; if a model answer is ever
  // rejected on stage, the sentence the user sees still has to carry AC-10's facts.
  for (const itemId of EXPLAIN_ITEMS) {
    const golden = goldenOf(itemId);
    if (!golden.claim || !golden.agreementId) continue;
    const claim = claimFromGolden(itemId);
    const { checks, decision } = evaluate(
      { claim, agreementId: golden.agreementId, agreementMatchedBy: 'po', rationale: 'eval fixture' },
      context,
    );
    const original = originalPaymentFor(itemId);
    const template = templateExplanation({ intentId: `int_${itemId}`, itemId, decision, claim, checks, original });
    const facts = checkFacts(template, { intentId: `int_${itemId}`, itemId, decision, claim, checks, original });
    if (!facts.ok) {
      allPass = false;
      console.log(`TEMPLATE ${itemId} FAIL — missing ${facts.missing.join('; ')}`);
    }
  }

  console.log(line());
  console.log(`${allPass ? 'EXPLAIN ALL PASS' : 'EXPLAIN FAIL'} · run ${run}`);

  const summaryFile = writeSummary(outDir, 'summary.json', {
    run,
    at: new Date().toISOString(),
    model: model.model,
    allPass,
    // The duplicate's transaction id is a fixture in T6 (no sandbox yet). It stands in for the
    // value the server reads from data/history.json; T8 re-runs this check against the real seed.
    fixture: true,
    fixtureNote:
      'original.transactionId is FIXTURE-TXN-0142 and original.paidAt is scenario.testClock until the sandbox seed exists (T8); both stand for data/history.json.',
    rows,
  });
  console.log(`summary → ${relDir(summaryFile)}`);

  if (!allPass) process.exitCode = 1;
}

// ---------------------------------------------------------------- comparison ----------------

async function evalComparison(): Promise<void> {
  const outDir = join(ROOT, 'proof', 'ai');
  rmSync(join(outDir, 'comparison-raw'), { recursive: true, force: true });
  const model = createChatModel({ rawDir: join(outDir, 'comparison-raw') });
  const inbox: InboxItem[] = await readInbox(ROOT);

  const recorded: (ComparisonPayout & { toolCallId: string })[] = [];
  let counter = 0;
  const sender = async (payout: ComparisonPayout) => {
    counter += 1;
    recorded.push({ ...payout, toolCallId: `dry_${String(counter).padStart(2, '0')}` });
    return { senderBatchId: `dry-batch-${String(counter).padStart(2, '0')}`, payoutBatchId: `dry-payout-${String(counter).padStart(2, '0')}` };
  };

  console.log(line());
  console.log(`AC-14 comparison mode · dry run, nothing is sent · model ${model.model}`);
  console.log(line());

  const result = await runComparison(inbox, sender, model);

  const golden = scenario.golden.comparisonMode.payouts;
  const matched = new Set<string>();
  const payouts = recorded.map((payout) => {
    const hit = golden.find(
      (entry) =>
        entry.receiver.toLowerCase() === payout.receiverEmail.toLowerCase() && entry.amount === payout.amountCents,
    );
    if (hit) matched.add(hit.itemId);
    return {
      toolCallId: payout.toolCallId,
      receiver: payout.receiverEmail,
      amountUsd: payout.amountUsd,
      amountCents: payout.amountCents,
      memo: payout.memo,
      matchedItemId: hit?.itemId ?? null,
      problem: hit?.problem ?? (hit ? null : 'not in golden.comparisonMode.payouts'),
    };
  });

  const missing = golden.filter((entry) => !matched.has(entry.itemId)).map((entry) => entry.itemId);
  const extra = payouts.filter((payout) => payout.matchedItemId === null);
  const sentTotal = payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
  // AC-14: what the model did not send is reported, not filled in. So "missing" is a fact of
  // this run, not a failure of the evaluation — only a sent payout that matches nothing in the
  // golden list is a defect (the recorder and the golden list would disagree).
  const allSentMatchGolden = extra.length === 0;

  for (const payout of payouts) {
    console.log(
      `${payout.matchedItemId ?? 'EXTRA'}  ${payout.receiver.padEnd(34)} $${payout.amountUsd.toFixed(2).padStart(9)}  ${payout.memo}`,
    );
    if (payout.problem) console.log(`         └─ ${payout.problem}`);
  }
  console.log(line());
  console.log(`tool calls: ${payouts.length} · sent total $${(sentTotal / 100).toFixed(2)} · golden total $${(scenario.golden.comparisonMode.totalSent / 100).toFixed(2)}`);
  console.log(`sent ${golden.length - missing.length} of ${golden.length} golden payouts`);
  if (missing.length > 0) console.log(`NOT SENT (listed as-is, not filled in): ${missing.join(', ')}`);
  console.log(line());
  console.log(`agent summary verbatim: "${result.summary}"`);

  const file = writeSummary(outDir, 'comparison-dry-run.json', {
    at: new Date().toISOString(),
    model: result.model,
    rounds: result.rounds,
    dryRun: true,
    prompt: 'SPEC v1.4 §6.6.4 verbatim; not tuned after this run (AC-14).',
    allSentMatchGolden,
    payouts,
    missing,
    extra,
    sentTotal,
    goldenTotal: scenario.golden.comparisonMode.totalSent,
    summary: result.summary,
    toolCalls: result.toolCalls,
  });
  console.log(`dry run → ${relDir(file)}`);
}

// ---------------------------------------------------------------- cli -----------------------

function usage(): never {
  console.error('usage: tsx scripts/eval.ts <extract|explain|comparison> [--run N] [--out DIR]');
  process.exit(2);
}

const [, , command, ...rest] = process.argv;
const runIndex = (() => {
  const index = rest.indexOf('--run');
  if (index < 0) return 1;
  const value = Number(rest[index + 1]);
  if (![1, 2, 3].includes(value)) usage();
  return value;
})();

// `--out DIR` keeps a verification run out of proof/ai/, so the frozen evidence for a numbered
// run is never overwritten by `scripts/verify.sh`.
const outOverride = (() => {
  const index = rest.indexOf('--out');
  if (index < 0) return null;
  const value = rest[index + 1];
  if (value === undefined || value === '') usage();
  return value;
})();

try {
  if (command === 'extract') await evalExtract(runIndex, outOverride);
  else if (command === 'explain') await evalExplain(runIndex);
  else if (command === 'comparison') await evalComparison();
  else usage();
} catch (error) {
  console.error(`EVAL ERROR: ${(error as Error).message}`);
  process.exitCode = 1;
}
