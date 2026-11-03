// Step 4 in code: the risk note, and the length rule that the UI depends on.
//
// SPEC v1.2 §6.6.2 step 4:
//   1–2 sentences, at most 140 characters in total. Over the limit counts as a validation
//   failure: send the error back once, then use a deterministic sentence built from the flags.
//   Never truncate.
//
// The note only exists when the deterministic detector (§6.2.3) raised at least one flag. The
// fallback is built by `riskNoteFromFlags()` out of the flag names alone, so it cannot state
// anything that is not already known; when even the fallback would exceed 140 characters, the
// least important clause is dropped — the sentence is shortened by removal, not cut mid-word.
//
// `noteSource` is `model` only when the model's own sentence survived validation. A fallback
// sentence is `template`: the UI must not badge it "AI", and the acceptance record has to say
// which of the two the reader is looking at. `none` means no flags fired, so there is no note.

import type { RiskFlag } from '@pbp/core';
import { RISK_SYSTEM, riskUser } from './prompts/risk-note.js';
import { noteSchema } from './schema.js';
import { charCount, sentenceCount } from './sentences.js';
import type { AgentContext, InboxItem } from './types.js';
import { ValidationError, askJson, parseJsonObject } from './validate.js';

export const RISK_NOTE_MAX_CHARS = 140;

const FLAG_MEANINGS: Record<RiskFlag, string> = {
  SENDER_DOMAIN_MISMATCH:
    'SENDER_DOMAIN_MISMATCH — the sender domain is not one of the vendor’s known domains, even though the vendor was recognised.',
  LOOKALIKE_DOMAIN:
    'LOOKALIKE_DOMAIN — the sender domain is unknown everywhere, but its first label looks like a known domain once 0→o, 1→l, 3→e, 5→s, rn→m, vv→w are folded (or it is one edit away).',
  INSTRUCTION_TO_AI:
    'INSTRUCTION_TO_AI — the email body or an attachment contains text addressed to an AI assistant (for example "note for the AI", "ignore previous instructions").',
  URGENCY: 'URGENCY — the text contains a whole word such as "today", "immediately", "urgent", "asap" or "right away".',
};

export function flagsThatFired(flags: RiskFlag[]): string {
  return flags.map((flag) => `- ${FLAG_MEANINGS[flag]}`).join('\n');
}

export interface NoteCheck {
  ok: boolean;
  reason: string | null;
}

export function checkRiskNote(text: string): NoteCheck {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return { ok: false, reason: 'the note was empty' };

  const sentences = sentenceCount(trimmed);
  if (sentences < 1 || sentences > 2) {
    return { ok: false, reason: `the note has ${sentences} sentences; it must be one or two` };
  }

  const chars = charCount(trimmed);
  if (chars > RISK_NOTE_MAX_CHARS) {
    return { ok: false, reason: `the note is ${chars} characters; the limit is ${RISK_NOTE_MAX_CHARS}` };
  }

  if (/<\/?untrusted_document/i.test(trimmed)) {
    return { ok: false, reason: 'the note quoted the document delimiter instead of describing the document' };
  }

  return { ok: true, reason: null };
}

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return '';
  if (clauses.length === 1) return `${clauses[0]}.`;
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}.`;
  return `${clauses[0]}, ${clauses.slice(1, -1).join(', ')}, and ${clauses[clauses.length - 1]}.`;
}

/**
 * Deterministic sentence from the flags. Priority: domain tell > instruction to an AI > urgency;
 * clauses are dropped from the end until the sentence fits in 140 characters.
 */
export function riskNoteFromFlags(flags: RiskFlag[]): string {
  const clauses: string[] = [];

  if (flags.includes('LOOKALIKE_DOMAIN')) {
    clauses.push("The sender's domain imitates a known domain");
  } else if (flags.includes('SENDER_DOMAIN_MISMATCH')) {
    clauses.push("The sender's domain is not the vendor's known domain");
  }
  if (flags.includes('INSTRUCTION_TO_AI')) clauses.push('the document tells an AI to pay it');
  if (flags.includes('URGENCY')) clauses.push('the email presses for same-day payment');

  while (clauses.length > 0 && charCount(joinClauses(clauses)) > RISK_NOTE_MAX_CHARS) {
    clauses.pop();
  }

  if (clauses.length === 0) return 'The deterministic risk check flagged this email for review.';
  // A clause can start lowercase ("the email presses for same-day payment"); the fallback is a
  // sentence the reader will see, so capitalise whatever ended up first.
  const sentence = joinClauses(clauses);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export interface RiskNoteResult {
  note: string | null;
  noteSource: 'model' | 'template' | 'none';
  attempts: number;
  /** Why the model's last answer was rejected; null when the model's note was used. */
  rejectedFor: string | null;
}

export async function writeRiskNote(
  item: InboxItem,
  flags: RiskFlag[],
  ctx: Pick<AgentContext, 'model'>,
): Promise<RiskNoteResult> {
  if (flags.length === 0) {
    return { note: null, noteSource: 'none', attempts: 0, rejectedFor: null };
  }

  const result = await askJson<string>({
    model: ctx.model,
    step: 'risk',
    itemId: item.id,
    system: RISK_SYSTEM,
    retryHint: 'Rewrite shorter: at most 18 words, at most 140 characters; delete words rather than adding sentences.',
    user: riskUser({
      itemId: item.id,
      senderEmail: item.from,
      flags,
      item,
      flagsThatFired: flagsThatFired(flags),
    }),
    parse: (content) => {
      const parsed = noteSchema.safeParse(parseJsonObject(content));
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      const note = parsed.data.note.trim().replace(/\s+/g, ' ');
      const check = checkRiskNote(note);
      if (!check.ok) throw new ValidationError(check.reason ?? 'the note did not pass validation');
      return note;
    },
  });

  if (result.ok && result.value !== null) {
    return { note: result.value, noteSource: 'model', attempts: result.attempts, rejectedFor: null };
  }

  return {
    note: riskNoteFromFlags(flags),
    noteSource: 'template',
    attempts: result.attempts,
    rejectedFor: result.error,
  };
}
