#!/usr/bin/env node
// `npm run demo:reset` — SPEC §6.7.
//
// Starts a new epoch, empties the ledger and pays `hist_kenji_0142` through the real sandbox so
// the Friday run has a genuinely-paid history to catch as a duplicate. Runs *before* the server
// is started (AC-11's order), so it builds its own runtime and exits.
//
// Needs the real PayPal rail (`@pbp/paypal`, T5) and a `.env` with PayPal credentials. Until that
// package is merged this exits with a clear message instead of pretending to have paid anything.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const entry = join(PACKAGE_ROOT, 'dist', 'index.js');
if (!existsSync(entry)) {
  fail('The server is not built yet — run `npm run setup` from the repository root first.');
}

const server = await import(pathToFileURL(entry).href);
const {
  anchoredClock,
  credentialMessage,
  loadConfig,
  loadDemo,
  missingCredentials,
  readDotEnvFile,
  REPO_ROOT,
  Runtime,
  resetDemo,
} = server;

const dotenv = readDotEnvFile(join(REPO_ROOT, '.env'));
const env = { ...dotenv, ...process.env };
const config = loadConfig({ env });

const missing = missingCredentials(env);
if (missing.length > 0) fail(credentialMessage(missing));

let paypal;
try {
  paypal = await import('@pbp/paypal');
} catch {
  fail(
    [
      'The PayPal rail (@pbp/paypal, ticket T5) is not installed, so demo:reset cannot pay the',
      'seeded history yet. Nothing was sent. T8 wires this script to the real rail; the reset',
      'logic itself is implemented and covered by the server integration tests.',
    ].join('\n'),
    2,
  );
}

const factory = paypal.createPayPalRail ?? paypal.createRail ?? paypal.default?.createRail;
if (typeof factory !== 'function') {
  fail(
    `@pbp/paypal does not export a rail factory yet (exports: ${Object.keys(paypal).join(', ') || 'none'}). Nothing was sent.`,
    2,
  );
}

const rail = factory(env);
const demo = loadDemo(config.demoDir);
const runtime = new Runtime({ config, demo, clock: anchoredClock(demo.scenario.testClock) }).open();

try {
  const result = await resetDemo({ runtime, demo, rail, config });
  console.log('Demo reset.');
  console.log(`  epoch          ${result.epoch}`);
  console.log(`  history        ${result.history.historyId} (${result.history.amount / 100} USD)`);
  console.log(`  payout batch   ${result.history.payoutBatchId ?? '(unknown)'}`);
  console.log(`  transaction id ${result.history.transactionId}`);
  console.log(`  status         ${result.history.railStatus}`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
