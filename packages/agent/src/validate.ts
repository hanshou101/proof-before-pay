// Validation and the one retry SPEC §6.6.1 allows:
//
//   zod fails → send the error back, ask again → still fails → the caller marks the item
//   "needs review" (or falls back to a deterministic sentence). Never invent a value.
//
// The retry is one extra call (`-retry.json` in the raw output), never a loop.

import type { ChatModel } from './llm.js';

/** Thrown by a parser when the model's answer is structurally wrong. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface Validated<T> {
  ok: boolean;
  value: T | null;
  attempts: number;
  error: string | null;
  /** The last assistant answer, verbatim (kept even when invalid). */
  lastContent: string | null;
  model: string | null;
  at: string | null;
  rawFiles: string[];
}

export interface AskArgs<T> {
  model: ChatModel;
  step: string;
  itemId?: string | null;
  system: string;
  user: string;
  /** Parse + cross-check. Throw `ValidationError` with a message the model can act on. */
  parse: (content: string) => T;
  /** Extra instruction appended to the retry, e.g. "delete words, do not add sentences". */
  retryHint?: string;
}

const RETRY_INSTRUCTION =
  '\n\nYour previous reply did not pass validation: {ERROR}\n' +
  'Reply again with a single JSON object that fixes exactly that problem. No prose, no markdown.';

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * One call, then one retry that carries the validation error. Returns the parsed value or the
 * error — never a guessed value.
 */
export async function askJson<T>(args: AskArgs<T>): Promise<Validated<T>> {
  let error: string | null = null;
  let lastContent: string | null = null;
  let model: string | null = null;
  let at: string | null = null;
  const rawFiles: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const hint = args.retryHint ? ` ${args.retryHint}` : '';
    const user =
      attempt === 1
        ? args.user
        : args.user + RETRY_INSTRUCTION.replace('{ERROR}', error ?? '') + hint;
    const response = await args.model.chat({
      step: args.step,
      itemId: args.itemId ?? null,
      system: args.system,
      user,
      json: true,
      suffix: attempt === 1 ? undefined : 'retry',
    });

    lastContent = response.content;
    model = response.model;
    at = response.finishedAt;
    if (response.rawFile) rawFiles.push(response.rawFile);

    try {
      if (response.content === null || response.content.trim() === '') {
        throw new ValidationError('the reply was empty');
      }
      return { ok: true, value: args.parse(response.content), attempts: attempt, error: null, lastContent, model, at, rawFiles };
    } catch (caught) {
      error = describe(caught);
    }
  }

  return { ok: false, value: null, attempts: 2, error, lastContent, model, at, rawFiles };
}

/** JSON.parse with a message that tells the model what was wrong. */
export function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ValidationError(`the reply was not valid JSON (${describe(error)})`);
  }
}
