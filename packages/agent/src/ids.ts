// Internal record ids — the strings that must never reach the screen.
//
// SPEC v1.4 §6.6.2 steps 6–7: an explanation or highlight that says "cr_in_04" or "del_leo_02"
// is a developer string in the reviewer's face. The ids still exist in `CheckResult.facts`
// (they are the gate's evidence), so both the prompt assembly (which hides them) and the fact
// check (which rejects them) need one definition of what an internal id looks like.

export const INTERNAL_ID_SOURCE = '\\b(?:cr|del|hist|agr|ven|int|in)_[a-z0-9_]+\\b';

const INTERNAL_ID_ALL = new RegExp(INTERNAL_ID_SOURCE, 'gi');

export function isInternalId(value: string): boolean {
  return new RegExp(`^${INTERNAL_ID_SOURCE}$`, 'i').test(value.trim());
}

/** Every internal id a sentence uses, de-duplicated and in the order they appear. */
export function internalIdsIn(text: string): string[] {
  return [...new Set((text.match(INTERNAL_ID_ALL) ?? []).map((id) => id.toLowerCase()))];
}
