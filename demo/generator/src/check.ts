import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { generateDataset, loadInputs, repositoryRoot, sha256 } from './dataset.js';

type Mode = 'regen' | 'text' | 'history' | 'emails';

const mode = process.argv[2] as Mode | undefined;

if (!mode || !['regen', 'text', 'history', 'emails'].includes(mode)) {
  console.error('usage: tsx src/check.ts <regen|text|history|emails>');
  process.exit(2);
}

const root = repositoryRoot();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function listFiles(dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort();
}

async function checkRegen(): Promise<void> {
  const first = await mkdtemp(join(tmpdir(), 'pbp-demo-a-'));
  const second = await mkdtemp(join(tmpdir(), 'pbp-demo-b-'));
  try {
    const a = await generateDataset({ root, outDir: first });
    const b = await generateDataset({ root, outDir: second });
    assert(a.length === 17, `generator wrote ${a.length} files, expected 17`);
    assert(a.length === b.length, 'two runs wrote a different number of files');

    for (let i = 0; i < a.length; i += 1) {
      const left = a[i]!;
      const right = b[i]!;
      assert(left.relPath === right.relPath, `run order differs at ${i}: ${left.relPath} vs ${right.relPath}`);
      assert(
        left.sha256 === right.sha256,
        `two runs differ for ${left.relPath}: ${left.sha256} vs ${right.sha256}`,
      );
      const committed = await readFile(join(root, left.relPath));
      assert(
        sha256(committed) === left.sha256,
        `${left.relPath} in the repository is not what the generator produces (run npm run generate)`,
      );
    }

    const json = await listFiles(join(root, 'demo', 'inbox'), '.json');
    const pdfs = await listFiles(join(root, 'demo', 'inbox', 'files'), '.pdf');
    const history = await listFiles(join(root, 'demo', 'history'), '.pdf');
    assert(json.length === 9, `demo/inbox has ${json.length} JSON files, expected 9`);
    assert(pdfs.length === 7, `demo/inbox/files has ${pdfs.length} PDFs, expected 7`);
    assert(history.length === 1, `demo/history has ${history.length} PDFs, expected 1`);

    console.log(`ok regen: ${a.length} files byte-identical across two runs and the repository`);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
}

async function checkText(): Promise<void> {
  const { content } = await loadInputs(root);
  let checked = 0;

  for (const name of Object.keys(content.invoices).sort()) {
    const invoice = content.invoices[name]!;
    const bytes = new Uint8Array(await readFile(join(root, 'demo', 'inbox', 'files', name)));
    const baseFonts: string[] = [];
    for (const [, object] of (await PDFDocument.load(bytes)).context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      if (object.get(PDFName.of('Type'))?.toString() !== '/Font') continue;
      const baseFont = object.get(PDFName.of('BaseFont'));
      if (baseFont) baseFonts.push(baseFont.toString());
    }
    assert(baseFonts.length > 0, `${name}: no font objects in the PDF`);
    for (const baseFont of baseFonts) {
      assert(
        /IBMPlex(Sans|Mono|Serif)/.test(baseFont),
        `${name}: font ${baseFont} is not an embedded IBM Plex face`,
      );
    }

    const doc = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(doc, { mergePages: true });
    assert(totalPages === 1, `${name}: ${totalPages} pages, expected 1`);
    const flat = normalize(text);

    assert(flat.includes(invoice.invoiceNumber), `${name}: text layer is missing ${invoice.invoiceNumber}`);
    assert(flat.includes(invoice.total), `${name}: text layer is missing the total ${invoice.total}`);
    if (invoice.po) assert(flat.includes(invoice.po), `${name}: text layer is missing ${invoice.po}`);
    const paypal = /[\w.+-]+@[\w.-]+\.example/.exec(invoice.payment)?.[0];
    assert(paypal, `${name}: no PayPal address in the payment line`);
    assert(flat.includes(paypal), `${name}: text layer is missing ${paypal}`);
    assert(flat.includes(invoice.issuer.business), `${name}: text layer is missing the issuer`);

    for (const line of invoice.lines) {
      assert(flat.includes(normalize(line.description)), `${name}: text layer is missing "${line.description}"`);
    }
    checked += 1;
  }

  const herrera = await extractText(
    await getDocumentProxy(new Uint8Array(await readFile(join(root, 'demo', 'inbox', 'files', 'HerreraWeb-INV-77.pdf')))),
    { mergePages: true },
  );
  assert(normalize(herrera.text).includes('Tomás'), 'HerreraWeb-INV-77.pdf: the accented name did not survive extraction');
  const nair = await extractText(
    await getDocumentProxy(new Uint8Array(await readFile(join(root, 'demo', 'inbox', 'files', 'Nair-Words-INV-2026-118.pdf')))),
    { mergePages: true },
  );
  assert(normalize(nair.text).includes('—'), 'Nair-Words-INV-2026-118.pdf: the em dash did not survive extraction');

  console.log(`ok text: ${checked} PDFs carry invoice number, total, PO, PayPal address and line items`);
}

async function checkHistory(): Promise<void> {
  const attachment = await readFile(join(root, 'demo', 'inbox', 'files', 'kenji-INV-0142.pdf'));
  const history = await readFile(join(root, 'demo', 'history', 'kenji-INV-0142.pdf'));
  assert(
    sha256(attachment) === sha256(history),
    `history copy differs: ${sha256(attachment)} vs ${sha256(history)}`,
  );
  console.log(`ok history: kenji-INV-0142.pdf is byte-identical (${sha256(history)})`);
}

async function checkEmails(): Promise<void> {
  const { scenario, content } = await loadInputs(root);
  const expectedKeys = ['id', 'from', 'to', 'subject', 'receivedAt', 'bodyText', 'attachments'];
  let checked = 0;

  for (const item of scenario.inbox) {
    const raw = await readFile(join(root, 'demo', 'inbox', `${item.id}.json`), 'utf8');
    const email = JSON.parse(raw) as Record<string, unknown>;
    assert(
      JSON.stringify(Object.keys(email)) === JSON.stringify(expectedKeys),
      `${item.id}: expected keys ${expectedKeys.join(', ')}`,
    );
    assert(email.id === item.id, `${item.id}: id mismatch`);
    assert(email.from === item.from, `${item.id}: from mismatch`);
    assert(
      email.to === `${content.billTo.attn} <${content.billTo.email}>`,
      `${item.id}: to mismatch`,
    );
    assert(email.subject === item.subject, `${item.id}: subject mismatch`);
    assert(email.receivedAt === item.receivedAt, `${item.id}: receivedAt mismatch`);
    assert(
      JSON.stringify(email.bodyText) === JSON.stringify(content.emails[item.id]),
      `${item.id}: bodyText is not verbatim from inbox-content.emails`,
    );

    const attachments = email.attachments as { name: string; path: string; sha256: string }[];
    assert(Array.isArray(attachments), `${item.id}: attachments must be an array`);
    assert(
      attachments.length === item.attachments.length,
      `${item.id}: ${attachments.length} attachments, expected ${item.attachments.length}`,
    );
    for (let i = 0; i < attachments.length; i += 1) {
      const attachment = attachments[i]!;
      const name = item.attachments[i]!;
      assert(attachment.name === name, `${item.id}: attachment ${i} is ${attachment.name}, expected ${name}`);
      assert(attachment.path === `demo/inbox/files/${name}`, `${item.id}: bad attachment path ${attachment.path}`);
      const bytes = await readFile(join(root, attachment.path));
      assert(sha256(bytes) === attachment.sha256, `${item.id}: sha256 for ${name} does not match the file`);
    }
    checked += 1;
  }

  console.log(`ok emails: ${checked} messages match scenario.inbox and inbox-content.emails verbatim`);
}

try {
  if (mode === 'regen') await checkRegen();
  else if (mode === 'text') await checkText();
  else if (mode === 'history') await checkHistory();
  else await checkEmails();
} catch (error) {
  console.error(`FAIL ${mode}: ${(error as Error).message}`);
  process.exit(1);
}
