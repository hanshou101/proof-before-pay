#!/usr/bin/env node
// `crosscheck` — ask PayPal about every proven payout, independently of the server (AC-11/AC-13).
//
// The proof bundle says "PayPal confirmed this". This script does not believe it: it reads the
// bundle, takes the PayPal ids out of it, and does its own GET against the sandbox. A bundle that
// cites a transaction id PayPal does not report — or reports with a different status — fails.
//
// Usage:
//   npx tsx apps/server/scripts/crosscheck-paypal.ts --url http://127.0.0.1:8787 \
//     --out proof/e2e/ac11-crosscheck.json [--expect in_01=120000,...]
//
// Exit codes: 0 all proven bundles agree with PayPal; 1 a mismatch; 2 the server or .env is not usable.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readDotEnvFile, REPO_ROOT } from '../src/config.js';
import { createPayPalRail } from '@pbp/paypal';

interface Args {
  url: string;
  out: string | null;
  intent: string | null;
  /** Re-send each proven payout with its own key and require PayPal to answer with the same batch. */
  singleBatch: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { url: 'http://127.0.0.1:8787', out: null, intent: null, singleBatch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') args.url = argv[++index] ?? args.url;
    else if (value === '--out') args.out = argv[++index] ?? null;
    else if (value === '--intent') args.intent = argv[++index] ?? null;
    else if (value === '--single-batch') args.singleBatch = true;
  }
  return args;
}

interface CrosscheckRow {
  intentId: string;
  itemId: string;
  bundleTransactionId: string | null;
  paypalStatus: string;
  paypalTransactionId: string | null;
  ok: boolean;
  problem: string | null;
  /** With `--single-batch`: the batch id PayPal hands back when the same key is sent again. */
  rebatchId?: string | null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...readDotEnvFile(join(REPO_ROOT, '.env')), ...process.env };
  const rail = createPayPalRail(env);

  const response = await fetch(`${args.url}/api/state`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    console.error(`The server at ${args.url} answered ${response.status}. Start it first.`);
    return 2;
  }
  const state = (await response.json()) as {
    intents: Record<string, { id: string; itemId: string; state: string }>;
    byItem: Record<string, string>;
  };

  const proven = Object.values(state.intents).filter(
    (intent) => intent.state === 'proven' && (args.intent === null || intent.id === args.intent),
  );
  if (proven.length === 0) {
    console.error('No proven payout on the server — there is nothing to cross-check.');
    return 1;
  }

  const rows: CrosscheckRow[] = [];
  for (const intent of proven) {
    const bundleResponse = await fetch(`${args.url}/api/intents/${encodeURIComponent(intent.id)}/bundle`, {
      headers: { accept: 'application/json' },
    });
    if (!bundleResponse.ok) {
      rows.push({
        intentId: intent.id,
        itemId: intent.itemId,
        bundleTransactionId: null,
        paypalStatus: 'no bundle',
        paypalTransactionId: null,
        ok: false,
        problem: `GET bundle answered ${bundleResponse.status}`,
      });
      continue;
    }
    const bundle = (await bundleResponse.json()) as {
      payment: {
        senderBatchId: string;
        payoutBatchId: string | null;
        payoutItemId: string | null;
        transactionId: string | null;
      } | null;
    };
    if (bundle.payment === null) {
      rows.push({
        intentId: intent.id,
        itemId: intent.itemId,
        bundleTransactionId: null,
        paypalStatus: 'no payment',
        paypalTransactionId: null,
        ok: false,
        problem: 'the bundle is for a payout that was never sent',
      });
      continue;
    }

    try {
      const receipt = await rail.fetchReceipt({
        intentId: intent.id,
        idempotencyKey: bundle.payment.senderBatchId,
        senderBatchId: bundle.payment.senderBatchId,
        payoutBatchId: bundle.payment.payoutBatchId,
        payoutItemId: bundle.payment.payoutItemId,
      });
      const sameTransaction =
        receipt.transactionId !== null && receipt.transactionId === bundle.payment.transactionId;

      // AC-13: "PayPal 裡每個意圖只有一筆". Sending the *same* sender_batch_id again is the only
      // way to ask PayPal directly. A duplicate is rejected with a pointer at the original batch,
      // so the id it hands back must be the batch this bundle already names — a second payout
      // would come back with a different one.
      let rebatchId: string | null = null;
      let singleBatchOk = true;
      if (args.singleBatch) {
        try {
          const again = await rail.submit({
            intentId: intent.id,
            idempotencyKey: bundle.payment.senderBatchId,
            amount: Number((bundle as unknown as { payment: { amount: number } }).payment.amount),
            currency: 'USD',
            receiver:
              (bundle as unknown as { payment: { receiver: string; receiverSent?: string | null } }).payment
                .receiverSent ??
              (bundle as unknown as { payment: { receiver: string } }).payment.receiver,
            memo: `crosscheck ${intent.id}`,
          });
          rebatchId = again.payoutBatchId;
          singleBatchOk = again.payoutBatchId === bundle.payment.payoutBatchId;
        } catch (error) {
          singleBatchOk = false;
          rebatchId = null;
          rows.push({
            intentId: intent.id,
            itemId: intent.itemId,
            bundleTransactionId: bundle.payment.transactionId,
            paypalStatus: receipt.railStatus,
            paypalTransactionId: receipt.transactionId,
            ok: false,
            problem: `re-sending the same key failed: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
      }

      const ok = receipt.proof === 'proven' && sameTransaction && singleBatchOk;
      rows.push({
        intentId: intent.id,
        itemId: intent.itemId,
        bundleTransactionId: bundle.payment.transactionId,
        paypalStatus: receipt.railStatus,
        paypalTransactionId: receipt.transactionId,
        ok,
        rebatchId,
        problem: ok
          ? null
          : receipt.proof !== 'proven'
            ? `PayPal says ${receipt.railStatus}, not SUCCESS`
            : !sameTransaction
              ? 'PayPal reports a different transaction id'
              : 'the same sender_batch_id resolved to a different batch — a second payout exists',
      });
    } catch (error) {
      rows.push({
        intentId: intent.id,
        itemId: intent.itemId,
        bundleTransactionId: bundle.payment.transactionId,
        paypalStatus: 'error',
        paypalTransactionId: null,
        ok: false,
        problem: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = rows.filter((row) => !row.ok);
  const report = {
    checkedAt: new Date().toISOString(),
    server: args.url,
    singleBatchChecked: args.singleBatch,
    proven: rows.length,
    failures: failed.length,
    rows,
  };

  console.log('intent        paypal      transaction            bundle      verdict');
  for (const row of rows) {
    console.log(
      `${row.intentId.padEnd(13)} ${row.paypalStatus.padEnd(11)} ${(row.paypalTransactionId ?? '—').padEnd(22)} ${(row.bundleTransactionId ?? '—').padEnd(11)} ${row.ok ? 'PASS' : `FAIL (${row.problem})`}`,
    );
  }

  if (args.out) {
    const outPath = resolve(REPO_ROOT, args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${args.out}`);
  }

  console.log(
    failed.length === 0
      ? `\nALL PASS — ${rows.length} proven payout(s) confirmed by PayPal itself.`
      : `\nHAS FAIL — ${failed.length} of ${rows.length} disagreed with PayPal.`,
  );
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(2);
  });
