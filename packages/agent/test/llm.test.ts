// The client contract from SPEC §6.6.1: which env vars, which request shape, and what gets
// written to the raw-output directory. Tested through an injected fake SDK client, so the
// assertions are about the body we send, not about a mock of our own wrapper.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import { LlmConfigError, OpenAiChatModel, rawFileName, readLlmConfig } from '../src/llm.js';

interface SentBody {
  model: string;
  temperature: number;
  messages: { role: string; content: string }[];
  response_format?: { type: string };
  tools?: unknown[];
}

function fakeClient(reply: { content?: string; model?: string }): { client: OpenAI; sent: SentBody[] } {
  const sent: SentBody[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: SentBody) => {
          sent.push(body);
          return {
            model: reply.model ?? 'deepseek-flash',
            choices: [{ message: { content: reply.content ?? '{}', tool_calls: [] } }],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
            _request_id: 'req_test_1',
          };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, sent };
}

const config = { apiBase: 'https://llm.example/v1', apiKey: 'test-key', model: 'deepseek-chat' };

describe('readLlmConfig', () => {
  it('names every missing variable and says nothing was sent', () => {
    expect(() => readLlmConfig({})).toThrowError(LlmConfigError);
    expect(() => readLlmConfig({})).toThrowError(/LLM_API_BASE, LLM_API_KEY, LLM_MODEL/);
    expect(() => readLlmConfig({})).toThrowError(/nothing was sent/);
  });

  it('treats an empty string as unset (SPEC §6.9)', () => {
    expect(() =>
      readLlmConfig({ LLM_API_BASE: '  ', LLM_API_KEY: '', LLM_MODEL: 'deepseek-chat' }),
    ).toThrowError(/LLM_API_BASE, LLM_API_KEY/);
  });

  it('trims the values it returns', () => {
    expect(
      readLlmConfig({ LLM_API_BASE: ' https://llm.example/v1 ', LLM_API_KEY: ' k ', LLM_MODEL: ' m ' }),
    ).toEqual({ apiBase: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  });
});

describe('OpenAiChatModel', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('sends temperature 0 and a json_object response format', async () => {
    const { client, sent } = fakeClient({ content: '{"ok":true}' });
    const model = new OpenAiChatModel(config, { client, now: () => new Date('2026-11-06T12:00:00Z') });

    const response = await model.chat({ step: 'extract', itemId: 'in_01', system: 'SYS', user: 'USER', json: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.model).toBe('deepseek-chat');
    expect(sent[0]?.temperature).toBe(0);
    expect(sent[0]?.response_format).toEqual({ type: 'json_object' });
    expect(sent[0]?.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
    // The endpoint may report a different model name than the one requested; evidence keeps both.
    expect(response.model).toBe('deepseek-flash');
    expect(response.content).toBe('{"ok":true}');
    expect(response.requestId).toBe('req_test_1');
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
  });

  it('does not set response_format for tool-calling turns', async () => {
    const { client, sent } = fakeClient({ content: 'done' });
    const model = new OpenAiChatModel(config, { client });
    await model.chat({ step: 'comparison', system: 'SYS', messages: [{ role: 'user', content: 'GO' }] });
    expect(sent[0]?.response_format).toBeUndefined();
    expect(sent[0]?.temperature).toBe(0);
  });

  it('writes the full request and answer to the caller-supplied directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pbp-agent-'));
    const { client } = fakeClient({ content: '{"note":"x"}', model: 'deepseek-flash' });
    const model = new OpenAiChatModel(config, { client, rawDir: dir });

    const response = await model.chat({ step: 'risk', itemId: 'in_04', system: 'SYS', user: 'USER', json: true, suffix: 'retry' });
    expect(response.rawFile).toBe(join(dir, 'in_04-risk-retry.json'));

    const written = JSON.parse(readFileSync(response.rawFile as string, 'utf8')) as {
      requestedModel: string;
      model: string;
      suffix: string;
      request: { json: boolean; messages: { content: string }[] };
      response: { content: string };
    };
    expect(written.requestedModel).toBe('deepseek-chat');
    expect(written.model).toBe('deepseek-flash');
    expect(written.suffix).toBe('retry');
    expect(written.request.json).toBe(true);
    expect(written.response.content).toBe('{"note":"x"}');
  });

  it('names raw files from item, step and suffix', () => {
    expect(rawFileName('in_04', 'extract')).toBe('in_04-extract.json');
    expect(rawFileName('in_04', 'extract', 'retry')).toBe('in_04-extract-retry.json');
    expect(rawFileName(null, 'comparison', 'round-2')).toBe('run-comparison-round-2.json');
    expect(rawFileName('in 04/../x', 'risk')).toBe('in-04-..-x-risk.json');
  });
});
