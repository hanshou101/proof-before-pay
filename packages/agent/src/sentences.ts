// Sentence counting for the two length rules the SPEC puts on model prose:
//   - risk note: 1–2 sentences, ≤ 140 characters (SPEC v1.2 §6.6.2 step 4)
//   - explanation: ≤ 2 sentences (AC-10)
//
// A sentence ends at `.`, `!` or `?` followed by whitespace and an opening character.
// `$1,150.00` must not count as a sentence break, hence the "followed by whitespace" rule;
// "e.g." in the middle of a clause does break, which is fine — the model is told to write
// plain sentences.

export function sentencesOf(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  const parts = trimmed.split(/(?<=[.!?])["')\]]?\s+/);
  return parts.map((part) => part.trim()).filter((part) => /[A-Za-z0-9]/.test(part));
}

export function sentenceCount(text: string): number {
  return sentencesOf(text).length;
}

/** Character count as a human reads it (code points, not UTF-16 units). */
export function charCount(text: string): number {
  return [...text.trim()].length;
}
