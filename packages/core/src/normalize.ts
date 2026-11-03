// Invoice-number normalisation. SPEC §6.2.4:
//   NFKC → uppercase → strip whitespace and every kind of hyphen
//   (U+002D, U+2010–U+2015, U+2212) → strip leading zeros from the numeric field.
//
// `INV-0142`, `inv 0142`, `INV-142`, `INV‑0142` (U+2011) all become `INV142`.

const HYPHENS = /[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const WHITESPACE = /\s+/g;

export function normalizeInvoiceNumber(raw: string): string {
  const folded = raw.normalize('NFKC').toUpperCase().replace(WHITESPACE, '').replace(HYPHENS, '');
  return folded.replace(/\d+/g, stripLeadingZeros);
}

function stripLeadingZeros(run: string): string {
  const stripped = run.replace(/^0+/, '');
  return stripped.length === 0 ? '0' : stripped;
}

/** Lowercase, trimmed email. Empty / whitespace-only input becomes `''`. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}
