import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InboxContent, Scenario } from './schema.js';
import { loadFontBytes } from './pdf/common.js';
import { buildInvoicePdf } from './pdf/index.js';

/** `demo/generator/fonts/` — the bundled IBM Plex TTFs, resolved from this module. */
export const FONTS_DIR = fileURLToPath(new URL('../fonts', import.meta.url));

/** The invoice whose PDF doubles as the historical, already-paid original (SPEC §6.4). */
export const HISTORY_SOURCE = 'kenji-INV-0142.pdf';
export const HISTORY_PATH = `demo/history/${HISTORY_SOURCE}`;

export interface GeneratedFile {
  /** Path relative to the dataset root, POSIX separators. */
  relPath: string;
  sha256: string;
  bytes: number;
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function loadInputs(root: string): Promise<{ scenario: Scenario; content: InboxContent }> {
  const dir = join(root, 'demo', 'scenario');
  const scenario = JSON.parse(await readFile(join(dir, 'scenario.json'), 'utf8')) as Scenario;
  const content = JSON.parse(await readFile(join(dir, 'inbox-content.json'), 'utf8')) as InboxContent;
  return { scenario, content };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkInputs(scenario: Scenario, content: InboxContent): void {
  assert(scenario.inbox.length === 9, `scenario.inbox has ${scenario.inbox.length} items, expected 9`);
  const invoiceNames = Object.keys(content.invoices);
  assert(invoiceNames.length === 7, `inbox-content.invoices has ${invoiceNames.length} files, expected 7`);

  for (const item of scenario.inbox) {
    assert(content.emails[item.id] !== undefined, `no body text for ${item.id}`);
    for (const name of item.attachments) {
      assert(content.invoices[name] !== undefined, `${item.id} references unknown invoice ${name}`);
      assert(
        content.invoices[name]!.layout === item.layout,
        `${item.id} layout ${item.layout} disagrees with ${name}`,
      );
    }
  }
  const attached = new Set(scenario.inbox.flatMap((item) => item.attachments));
  for (const name of invoiceNames) {
    assert(attached.has(name), `${name} is not attached to any inbox item`);
  }
}

/**
 * Writes the whole demo dataset under `outDir` (the repository root, or a temp dir
 * when verifying determinism). Returns the sha256 of every file it wrote.
 */
export async function generateDataset(options: {
  root: string;
  outDir: string;
}): Promise<GeneratedFile[]> {
  const { root, outDir } = options;
  const { scenario, content } = await loadInputs(root);
  checkInputs(scenario, content);

  const fontBytes = await loadFontBytes(FONTS_DIR);
  const stamp = scenario.testClock;
  const to = `${content.billTo.attn} <${content.billTo.email}>`;

  const files: GeneratedFile[] = [];
  const pdfBytes = new Map<string, Uint8Array>();

  const record = async (relPath: string, bytes: Uint8Array | string): Promise<void> => {
    const target = join(outDir, relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    files.push({
      relPath,
      sha256: sha256(bytes),
      bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength,
    });
  };

  // 1. The seven invoice PDFs, one per file named in inbox-content.invoices.
  for (const name of Object.keys(content.invoices).sort()) {
    const invoice = content.invoices[name]!;
    const bytes = await buildInvoicePdf(invoice, content.billTo, fontBytes, stamp);
    pdfBytes.set(name, bytes);
    await record(`demo/inbox/files/${name}`, bytes);
  }

  // 2. The historical original is the very same bytes as the in_03 attachment —
  //    the duplicate check in the demo depends on it (SPEC §6.4, AC-6).
  const history = pdfBytes.get(HISTORY_SOURCE);
  assert(history, `missing ${HISTORY_SOURCE} for the history copy`);
  await record(HISTORY_PATH, history);

  // 3. The nine inbox messages, body text verbatim from inbox-content.emails.
  for (const item of [...scenario.inbox].sort((a, b) => a.id.localeCompare(b.id))) {
    const attachments = item.attachments.map((name) => {
      const bytes = pdfBytes.get(name);
      assert(bytes, `missing rendered bytes for ${name}`);
      return {
        name,
        path: `demo/inbox/files/${name}`,
        sha256: sha256(bytes),
      };
    });

    const email = {
      id: item.id,
      from: item.from,
      to,
      subject: item.subject,
      receivedAt: item.receivedAt,
      bodyText: content.emails[item.id]!,
      attachments,
    };
    await record(`demo/inbox/${item.id}.json`, JSON.stringify(email, null, 2) + '\n');
  }

  return files;
}

/** Resolves the repository root from the package location (`demo/generator` → root). */
export function repositoryRoot(): string {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)));
}
