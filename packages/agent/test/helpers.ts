// Shared fixtures for the unit tests.
//
// The model seam (`ChatModel`) is replaced with `ScriptedModel`, which replays answers recorded
// from the real endpoint under `test/recordings/` (see the `recordedFrom` field in each file).
// Nothing here touches the network: `npm test` runs without a key, which is what lets CI run it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agreement, Vendor } from '@pbp/core';
import type { ChatModel, ChatRequest, ChatResponse, ToolCall } from '../src/llm.js';
import type { InboxItem } from '../src/types.js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..', '..');

export interface Recording {
  recordedFrom: string;
  model: string;
  step: string;
  itemId: string;
  content: string;
}

/** A model answer captured from a real run (proof/ai/…), replayed verbatim. */
export function recording(name: string): Recording {
  const file = join(HERE, 'recordings', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Recording;
}

export interface DemoScenario {
  version: string;
  payer: { name: string; operator: string; domain: string; currency: 'USD' };
  vendors: Vendor[];
  agreements: Agreement[];
}

export const demo = JSON.parse(
  readFileSync(join(ROOT, 'demo', 'scenario', 'scenario.json'), 'utf8'),
) as DemoScenario;

export interface ScriptedAnswer {
  content?: string | null;
  toolCalls?: ToolCall[];
}

/** Replays a fixed list of answers and remembers every request it was given. */
export class ScriptedModel implements ChatModel {
  readonly model = 'recorded-model';
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly answers: ScriptedAnswer[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const answer = this.answers[this.index];
    this.index += 1;
    if (!answer) throw new Error(`the scripted model has no answer #${this.index}`);

    const at = '2026-11-06T12:00:00.000Z';
    return {
      content: answer.content ?? null,
      toolCalls: answer.toolCalls ?? [],
      model: this.model,
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      usage: null,
      requestId: null,
      rawFile: null,
    };
  }
}

/** A tiny inbox item — the prompt-assembly tests only care about the text. */
export function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'in_test',
    to: 'ops@lumenlark.example',
    from: 'Ana Ribeiro <ana@studionorth.example>',
    subject: 'Invoice INV-2207',
    receivedAt: '2026-11-04T21:47:00Z',
    bodyText: 'Hi, invoice attached.',
    attachments: [
      { name: 'invoice.pdf', sha256: 'a'.repeat(64), text: 'Invoice INV-2207 — total $2,400.00' },
    ],
    ...overrides,
  };
}
