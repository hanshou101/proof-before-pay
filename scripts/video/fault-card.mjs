#!/usr/bin/env node
/**
 * The terminal card in the architecture section: lines taken verbatim from the fault take's
 * ledger (proof/video/take/<fault take>/fault-ledger.jsonl) and its PayPal crosscheck log.
 * Usage: node scripts/video/fault-card.mjs  → video/src/generated/fault.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = JSON.parse(readFileSync(join(ROOT, 'docs/video/script.json'), 'utf8'));
const dir = resolve(ROOT, script.takes.fault);
const events = readFileSync(join(dir, 'fault-ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const intent = 'int_in_01';
const short = (key) => (key.length > 16 ? `${key.slice(0, 11)}…${key.slice(-4)}` : key);
const lines = [
  { kind: 'cmd', text: '$ PBP_FAULT=drop_after_submit:first' },
  { kind: 'note', text: '# PayPal takes the payout; its answer is dropped' },
];
for (const e of events) {
  const d = e.data;
  if (e.type === 'payment.submitted' && d.intentId === intent && d.payoutBatchId === null) {
    lines.push({ kind: 'out', text: `#${e.seq} payment.submitted  attempt ${d.attempt}  key ${short(d.senderBatchId)}` });
  } else if (e.type === 'payment.submitted' && d.intentId === intent) {
    lines.push({ kind: 'out', text: `#${e.seq} PayPal batch ${d.payoutBatchId}` });
  } else if (e.type === 'error' && d.scope === `payment.submit:${intent}`) {
    lines.push({ kind: 'warn', text: `#${e.seq} ${d.message}` });
  } else if (e.type === 'receipt.updated' && d.intentId === intent && d.railStatus === 'SUCCESS') {
    lines.push({ kind: 'ok', text: `#${e.seq} receipt SUCCESS · ${d.transactionId} · proven` });
  }
}
const cross = readFileSync(join(dir, 'fault-crosscheck.log'), 'utf8').split('\n').filter((line) => /int_in_01|ALL PASS/.test(line));
lines.push({ kind: 'cmd', text: '$ crosscheck-paypal --single-batch' });
lines.push({ kind: 'note', text: '# send the same key again; PayPal answers from its own record' });
for (const line of cross) lines.push({ kind: /PASS/.test(line) ? 'ok' : 'out', text: line.replace(/\s+/g, ' ').trim() });
mkdirSync(join(ROOT, 'video/src/generated'), { recursive: true });
writeFileSync(join(ROOT, 'video/src/generated/fault.json'), `${JSON.stringify({ intent, lines }, null, 1)}\n`);
for (const line of lines) console.log(line.text);
