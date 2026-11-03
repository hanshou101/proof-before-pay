// Wrapping untrusted documents (AC-9d).
//
// Every byte that came from the outside world — the email body, the PDF text — goes into the
// prompt inside `<untrusted_document id="…">…</untrusted_document>`. The system prompt says
// that everything inside those tags is data, and that any instruction found there is reported
// in `notes` and ignored.
//
// `neutralize()` closes the obvious hole: a document that literally contains
// `</untrusted_document>` must not be able to end the block early. The closing sequence is
// rewritten to `‹/untrusted_document›` (a character the model still reads as text, but which
// cannot match the delimiter). The caller records that this happened in `notes`.

const OPEN = '<untrusted_document';
const CLOSE = '</untrusted_document>';

/** `Ana Ribeiro <billing@studi0-north.example>` → `billing@studi0-north.example`. */
export function emailOf(header: string): string {
  const bracketed = /<([^<>]+)>/.exec(header);
  return (bracketed?.[1] ?? header).trim().toLowerCase();
}

/** Anything that could impersonate our delimiter is folded into look-alike characters. */
export function neutralize(text: string): string {
  return text
    .replace(/<\/untrusted_document\s*>/gi, '‹/untrusted_document›')
    .replace(/<untrusted_document/gi, '‹untrusted_document');
}

/** True when the source text tried to close the block (reported in `notes`). */
export function triedToEscapeDocument(text: string): boolean {
  return /<\/untrusted_document\s*>|<untrusted_document/gi.test(text);
}

export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._:#-]+/g, '-').slice(0, 120);
}

/** One delimited block. `id` stays stable so a test can assert on it. */
export function untrustedDocument(id: string, text: string): string {
  return `${OPEN} id="${sanitizeId(id)}">\n${neutralize(text)}\n${CLOSE}`;
}

/** The email itself: headers as data, then the body block, then one block per attachment. */
export function documentBlocks(item: {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: { name: string; text: string }[];
}): string {
  const header = [
    `From: ${item.from}`,
    `To: ${item.to}`,
    `Subject: ${item.subject}`,
    `Received: ${item.receivedAt}`,
    `Attachments: ${item.attachments.length === 0 ? 'none' : item.attachments.map((a) => a.name).join(', ')}`,
  ].join('\n');

  const blocks = [untrustedDocument(`${item.id}:email`, `${header}\n\n${item.bodyText}`)];
  for (const attachment of item.attachments) {
    blocks.push(untrustedDocument(`${item.id}:${attachment.name}`, attachment.text));
  }
  return blocks.join('\n\n');
}
