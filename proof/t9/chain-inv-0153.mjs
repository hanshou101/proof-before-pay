/**
 * T9 · 数据全链路抽查：Kenji INV-0153（in_02）从原件到帐本行，每一段打印真实的值。
 *
 * 不用任何人的总结：PDF 文字层自己抽、提議/九项检查/送出/回执/帐本行直接读
 * `data/e2e/ac11/ledger.jsonl`，PayPal 那一段自己向沙箱 GET，證明包用 HTTP 打真 server。
 *
 * 用法（在仓库根跑；server 必須已用同一個 PBP_DATA_DIR 起在 BUNDLE_URL 上）：
 *   node proof/t9/chain-inv-0153.mjs
 * 環境變數：PBP_DATA_DIR（預設 data/e2e/ac11）、BUNDLE_URL（預設 http://127.0.0.1:8799）
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// unpdf 只在 packages/agent 里（根目录没有依赖），直接按文件路径載入。
const unpdf = await import(
  pathToFileURL(join(process.cwd(), 'packages/agent/node_modules/unpdf/dist/index.mjs')).href
);
const { extractText, getDocumentProxy } = unpdf;

const DATA_DIR = process.env.PBP_DATA_DIR || 'data/e2e/ac11';
const BUNDLE_URL = process.env.BUNDLE_URL || 'http://127.0.0.1:8799';
const ITEM = 'in_02';
const PDF = 'demo/inbox/files/kenji-INV-0153.pdf';

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Read KEY=VALUE pairs without printing anything secret. */
function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const rows = readFileSync(join(DATA_DIR, 'ledger.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

section('1. 原件：PDF 文字层');
const bytes = readFileSync(PDF);
console.log(`file            ${PDF}`);
console.log(`sha256          ${createHash('sha256').update(bytes).digest('hex')}`);
console.log(`bytes           ${bytes.length}`);
const doc = await getDocumentProxy(new Uint8Array(bytes));
const { text, totalPages } = await extractText(doc, { mergePages: true });
console.log(`pages           ${totalPages}`);
console.log('--- text layer (verbatim) ---');
console.log(text.trim());

section('2. 抽取（claim.extracted，真模型）');
const extracted = rows.find((r) => r.type === 'claim.extracted' && r.data.itemId === ITEM);
const claim = extracted.data.claim;
console.log(`ledger seq      ${extracted.seq}  at ${extracted.at}`);
console.log(`extractedBy     ${JSON.stringify(claim.extractedBy)}`);
console.log(
  JSON.stringify(
    {
      vendorId: claim.vendorId,
      vendorName: claim.vendorName,
      senderEmail: claim.senderEmail,
      invoiceNumber: claim.invoiceNumber,
      issueDate: claim.issueDate,
      currency: claim.currency,
      total: claim.total,
      po: claim.po,
      requestedPayee: claim.requestedPayee,
      lines: claim.lines,
    },
    null,
    2,
  ),
);
const classified = rows.find((r) => r.type === 'item.classified' && r.data.itemId === ITEM);
console.log(`classified      ${classified.data.classification} (${classified.data.model})`);

section('3. 提議（intent.proposed）');
const proposed = rows.find((r) => r.type === 'intent.proposed' && r.data.itemId === ITEM);
const intentId = proposed.data.intentId;
console.log(`intentId        ${intentId}`);
console.log(`agreementId     ${proposed.data.agreementId} (matched by ${proposed.data.agreementMatchedBy})`);
console.log(`amount          ${proposed.data.amount} cents`);
console.log(`payee           ${proposed.data.payee.receiver}`);
console.log(`fingerprint     ${proposed.data.fingerprint}`);
console.log(`idempotencyKey  ${proposed.data.idempotencyKey}`);

section('4. 九项检查（intent.checked）');
const checked = rows.find((r) => r.type === 'intent.checked' && r.data.intentId === intentId);
for (const c of checked.data.checks) {
  console.log(`${c.id}  ${c.status.padEnd(5)} ${c.code.padEnd(22)} ${JSON.stringify(c.facts)}`);
}
console.log(`decision        ${checked.data.decision}`);

section('5. 送出（payment.submitted）');
for (const r of rows.filter((x) => x.type === 'payment.submitted' && x.data.intentId === intentId)) {
  console.log(`seq ${String(r.seq).padStart(3)}  at ${r.at}  attempt ${r.data.attempt}  senderBatchId ${r.data.senderBatchId}  payoutBatchId ${r.data.payoutBatchId}`);
}

section('6. PayPal GET（独立脚本，直打沙箱）');
const env = readEnv('.env');
const base = 'https://api-m.sandbox.paypal.com';
const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
  method: 'POST',
  headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const token = (await tokenRes.json()).access_token;
const receipt = rows.find(
  (r) => r.type === 'receipt.updated' && r.data.intentId === intentId && r.data.proof === 'proven',
);
const itemRes = await fetch(`${base}/v1/payments/payouts-item/${receipt.data.payoutItemId}`, {
  headers: { authorization: `Bearer ${token}` },
});
const item = await itemRes.json();
console.log(`GET /v1/payments/payouts-item/${receipt.data.payoutItemId} → HTTP ${itemRes.status}`);
console.log(
  JSON.stringify(
    {
      transaction_status: item.transaction_status,
      transaction_id: item.transaction_id,
      payout_item_id: item.payout_item_id,
      payout_batch_id: item.payout_batch_id,
      amount: item.payout_item?.amount,
      receiver: item.payout_item?.receiver,
      time_processed: item.time_processed,
    },
    null,
    2,
  ),
);
const batchRes = await fetch(`${base}/v1/payments/payouts/${item.payout_batch_id}`, {
  headers: { authorization: `Bearer ${token}` },
});
const batch = await batchRes.json();
console.log(`GET /v1/payments/payouts/${item.payout_batch_id} → HTTP ${batchRes.status}`);
console.log(
  JSON.stringify(
    {
      batch_status: batch.batch_header?.batch_status,
      sender_batch_id: batch.batch_header?.sender_batch_id,
      amount: batch.batch_header?.amount,
      items: (batch.items || []).map((i) => ({
        payout_item_id: i.payout_item_id,
        transaction_status: i.transaction_status,
        transaction_id: i.transaction_id,
      })),
    },
    null,
    2,
  ),
);

section('7. 證明包（GET /api/intents/:id/bundle）');
const bundleRes = await fetch(`${BUNDLE_URL}/api/intents/${intentId}/bundle`);
const bundle = await bundleRes.json();
console.log(`HTTP ${bundleRes.status}`);
console.log(
  JSON.stringify(
    {
      source: bundle.source,
      extraction: bundle.extraction,
      amountRule: bundle.amountRule,
      delivery: bundle.delivery,
      payee: bundle.payee,
      checks: bundle.checks?.map((c) => `${c.id}:${c.status}:${c.code}`),
      payment: bundle.payment,
      ledger: bundle.ledger,
    },
    null,
    2,
  ),
);

section('8. 帳本行（receipt.updated → proven）');
console.log(`seq ${receipt.seq}  at ${receipt.at}`);
console.log(`prevHash ${receipt.prevHash}`);
console.log(`hash     ${receipt.hash}`);
console.log(`data     ${JSON.stringify(receipt.data)}`);
const last = rows[rows.length - 1];
console.log(`\nledger head: seq ${last.seq} · hash ${last.hash}`);
