// Reading the inbox the way SPEC §4 says: email JSON + the PDF text layer (no OCR).
//
// `readInbox()` is the convenience the eval and the demo reset use; the server may build
// `InboxItem`s itself (e.g. from an uploaded file) and call `processItem` directly. Either way
// the agent only ever receives plain text plus the sha256 of the bytes it came from, which is
// what the proof bundle shows next to the extracted fields.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import type { InboxItem } from './types.js';

interface InboxJson {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: { name: string; path: string; sha256: string }[];
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const result = (await extractText(doc, { mergePages: true })) as { text: string; totalPages: number };
  return result.text;
}

export async function readInboxItem(repoRoot: string, id: string): Promise<InboxItem> {
  const raw = await readFile(join(repoRoot, 'demo', 'inbox', `${id}.json`), 'utf8');
  const email = JSON.parse(raw) as InboxJson;

  const attachments = [];
  for (const attachment of email.attachments) {
    const bytes = new Uint8Array(await readFile(join(repoRoot, attachment.path)));
    const actual = sha256OfBytes(bytes);
    if (actual !== attachment.sha256) {
      throw new Error(
        `${attachment.path}: sha256 in ${id}.json is ${attachment.sha256}, file is ${actual} — regenerate the demo dataset`,
      );
    }
    attachments.push({
      name: attachment.name,
      sha256: actual,
      text: await extractPdfText(bytes),
    });
  }

  return {
    id: email.id,
    from: email.from,
    to: email.to,
    subject: email.subject,
    receivedAt: email.receivedAt,
    bodyText: email.bodyText,
    attachments,
  };
}

/** All nine emails, sorted by id (in_01 … in_09). */
export async function readInbox(repoRoot: string): Promise<InboxItem[]> {
  const dir = join(repoRoot, 'demo', 'inbox');
  const names = (await readdir(dir)).filter((name) => /^in_\d+\.json$/.test(name)).sort();
  const items: InboxItem[] = [];
  for (const name of names) {
    items.push(await readInboxItem(repoRoot, name.replace(/\.json$/, '')));
  }
  return items;
}
