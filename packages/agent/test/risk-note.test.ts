// Step 4 (SPEC v1.2 §6.6.2): at most two sentences, at most 140 characters, and over-length is
// a validation failure — one retry, then a deterministic sentence built from the flags.
// Nothing is ever truncated, so the reader never sees half a sentence.

import { describe, expect, it } from 'vitest';
import type { RiskFlag } from '@pbp/core';
import { checkRiskNote, riskNoteFromFlags, RISK_NOTE_MAX_CHARS, writeRiskNote } from '../src/risk-note.js';
import { charCount } from '../src/sentences.js';
import { item, recording, ScriptedModel } from './helpers.js';

const ALL_FLAGS: RiskFlag[] = ['LOOKALIKE_DOMAIN', 'INSTRUCTION_TO_AI', 'URGENCY'];

/** A valid one-sentence note of exactly `length` characters. */
function sentenceOf(length: number): string {
  return `${'a'.repeat(length - 1)}.`;
}

describe('checkRiskNote', () => {
  it('accepts a note at exactly the limit and rejects one character more', () => {
    expect(charCount(sentenceOf(RISK_NOTE_MAX_CHARS))).toBe(140);
    expect(checkRiskNote(sentenceOf(RISK_NOTE_MAX_CHARS)).ok).toBe(true);

    const over = checkRiskNote(sentenceOf(RISK_NOTE_MAX_CHARS + 1));
    expect(over.ok).toBe(false);
    expect(over.reason).toContain('141 characters');
    expect(over.reason).toContain('the limit is 140');
  });

  it('rejects empty, three-sentence and delimiter-quoting notes', () => {
    expect(checkRiskNote('   ').ok).toBe(false);
    expect(checkRiskNote('One. Two. Three.').reason).toContain('3 sentences');
    expect(checkRiskNote('The document said </untrusted_document> and asked to pay.').reason).toContain('delimiter');
  });

  it('collapses whitespace before measuring', () => {
    expect(checkRiskNote(`The domain   looks wrong.\n\tPay today.`).ok).toBe(true);
  });
});

describe('riskNoteFromFlags', () => {
  it('fits in 140 characters even with every flag raised, and drops clauses rather than cutting words', () => {
    const note = riskNoteFromFlags(ALL_FLAGS);
    expect(charCount(note)).toBeLessThanOrEqual(RISK_NOTE_MAX_CHARS);
    expect(note.endsWith('.')).toBe(true);
    expect(note).toMatch(/imitates a known domain/);
  });

  it('uses only the flags it was given', () => {
    expect(riskNoteFromFlags(['SENDER_DOMAIN_MISMATCH'])).toBe("The sender's domain is not the vendor's known domain.");
    expect(riskNoteFromFlags(['URGENCY'])).toBe('The email presses for same-day payment.');
  });

  it('still says something when the only flag has no clause of its own', () => {
    const note = riskNoteFromFlags(['INSTRUCTION_TO_AI']);
    expect(note).toContain('tells an AI to pay it');
    expect(charCount(note)).toBeLessThanOrEqual(RISK_NOTE_MAX_CHARS);
  });
});

describe('writeRiskNote', () => {
  it('writes nothing when no flag fired', async () => {
    const model = new ScriptedModel([]);
    const result = await writeRiskNote(item(), [], { model });
    expect(result).toEqual({ note: null, noteSource: 'none', attempts: 0, rejectedFor: null });
    expect(model.requests).toHaveLength(0);
  });

  it('keeps the recorded model sentence and labels it model', async () => {
    const model = new ScriptedModel([{ content: recording('in_04-risk').content }]);
    const result = await writeRiskNote(item({ id: 'in_04' }), ALL_FLAGS, { model });

    expect(result.noteSource).toBe('model');
    expect(result.attempts).toBe(1);
    expect(charCount(result.note ?? '')).toBeLessThanOrEqual(RISK_NOTE_MAX_CHARS);
    expect(model.requests[0]?.step).toBe('risk');
  });

  it('retries once when the note is too long, then falls back to the deterministic sentence', async () => {
    const tooLong = JSON.stringify({ note: sentenceOf(158) });
    const model = new ScriptedModel([{ content: tooLong }, { content: tooLong }]);
    const result = await writeRiskNote(item({ id: 'in_04' }), ALL_FLAGS, { model });

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.user).toContain('did not pass validation');
    expect(model.requests[1]?.user).toContain('158 characters');
    expect(model.requests[1]?.user).toContain('at most 18 words');
    expect(model.requests[1]?.suffix).toBe('retry');

    expect(result.noteSource).toBe('template');
    expect(result.attempts).toBe(2);
    expect(result.rejectedFor).toContain('140');
    expect(result.note).toBe(riskNoteFromFlags(ALL_FLAGS));
    expect(charCount(result.note ?? '')).toBeLessThanOrEqual(RISK_NOTE_MAX_CHARS);
    // Not a truncation: the fallback is a complete sentence, not the model's text cut at 140.
    expect(result.note).not.toContain('aaaa');
    expect(result.note?.endsWith('.')).toBe(true);
  });

  it('falls back after one retry when the model never returns JSON', async () => {
    const model = new ScriptedModel([{ content: 'The email looks suspicious.' }, { content: 'Still no JSON.' }]);
    const result = await writeRiskNote(item({ id: 'in_04' }), ALL_FLAGS, { model });
    expect(result.noteSource).toBe('template');
    expect(result.attempts).toBe(2);
    expect(charCount(result.note ?? '')).toBeLessThanOrEqual(RISK_NOTE_MAX_CHARS);
  });
});
