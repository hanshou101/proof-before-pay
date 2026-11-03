// The one place that talks to a model.
//
// SPEC §6.6.1: any OpenAI-compatible Chat Completions endpoint, `temperature: 0`, structured
// output via `response_format: { type: "json_object" }`, every call recorded with its model and
// time, and the raw answer written to a caller-provided directory (`data/ai/<runId>/`).
//
// Two deliberate choices:
//   - `maxRetries: 0` on the SDK. The only retry in this package is the one the SPEC describes
//     (validation failed → send the error back once). A hidden SDK retry would make "attempts"
//     in the evidence a lie.
//   - The HTTP layer is injected (`client`). Tests never touch the network; they hand in a
//     recorded model that replays frozen responses.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

export interface LlmConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

/** A configuration problem the human can fix in `.env` (SPEC §6.9, AC-17). */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

function pick(env: NodeJS.ProcessEnv, key: string): string {
  // SPEC §6.9: an empty string is the same as unset.
  return (env[key] ?? '').trim();
}

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiBase = pick(env, 'LLM_API_BASE');
  const apiKey = pick(env, 'LLM_API_KEY');
  const model = pick(env, 'LLM_MODEL');

  const missing: string[] = [];
  if (apiBase === '') missing.push('LLM_API_BASE');
  if (apiKey === '') missing.push('LLM_API_KEY');
  if (model === '') missing.push('LLM_MODEL');
  if (missing.length > 0) {
    throw new LlmConfigError(`Add ${missing.join(', ')} to .env — nothing was sent.`);
  }

  return { apiBase, apiKey, model };
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  /** The raw JSON string the model produced; parsing is the caller's job. */
  arguments: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ChatRequest {
  /** Short step name; also the file-name suffix (`<itemId>-<step>.json`). */
  step: string;
  itemId?: string | null;
  system: string;
  /** Single-shot user message. Ignored when `messages` is given. */
  user?: string;
  /** Full conversation (tool-calling loops). Must start after the system message. */
  messages?: ChatTurn[];
  /** Ask the endpoint for a JSON object (`response_format: json_object`). */
  json?: boolean;
  tools?: ToolSpec[];
  /** Defaults to 0 (SPEC §6.6.1). */
  temperature?: number;
  /** Extra file-name suffix, e.g. `retry`. */
  suffix?: string;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  /** The model name the endpoint reports (`deepseek-flash` for `deepseek-chat`). */
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
  requestId: string | null;
  /** Where the raw answer was persisted, or null when no `rawDir` was configured. */
  rawFile: string | null;
}

/** The seam tests replace with recorded answers. */
export interface ChatModel {
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface ChatModelOptions {
  rawDir?: string | null;
  now?: () => Date;
  /** Injected in tests; production builds the real client. */
  client?: OpenAI;
  timeoutMs?: number;
}

function isoNow(now: () => Date): string {
  return now().toISOString();
}

function toSdkMessages(request: ChatRequest): ChatCompletionCreateParamsNonStreaming['messages'] {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: request.system }];

  const turns: ChatTurn[] =
    request.messages ??
    (typeof request.user === 'string' ? [{ role: 'user', content: request.user }] : []);

  for (const turn of turns) {
    if (turn.role === 'assistant') {
      const message: Record<string, unknown> = { role: 'assistant', content: turn.content ?? '' };
      if (turn.toolCalls && turn.toolCalls.length > 0) {
        message.tool_calls = turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }));
      }
      messages.push(message);
    } else if (turn.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: turn.toolCallId ?? '', content: turn.content ?? '' });
    } else {
      messages.push({ role: turn.role, content: turn.content ?? '' });
    }
  }

  return messages as unknown as ChatCompletionCreateParamsNonStreaming['messages'];
}

/** `in_04` + `extract` + `retry` → `in_04-extract-retry.json`. */
export function rawFileName(itemId: string | null | undefined, step: string, suffix?: string): string {
  const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/g, '-');
  const parts = [safe(itemId && itemId !== '' ? itemId : 'run'), safe(step)];
  if (suffix && suffix !== '') parts.push(safe(suffix));
  return `${parts.join('-')}.json`;
}

export class OpenAiChatModel implements ChatModel {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly rawDir: string | null;
  private readonly now: () => Date;

  constructor(config: LlmConfig, options: ChatModelOptions = {}) {
    this.model = config.model;
    this.rawDir = options.rawDir ?? null;
    this.now = options.now ?? (() => new Date());
    this.client =
      options.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBase,
        maxRetries: 0,
        timeout: options.timeoutMs ?? 90_000,
      });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startedAt = isoNow(this.now);
    const startedMs = Date.now();

    const body: ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      temperature: request.temperature ?? 0,
      messages: toSdkMessages(request),
    };
    if (request.json === true) body.response_format = { type: 'json_object' };
    if (request.tools && request.tools.length > 0) body.tools = request.tools;

    const completion = (await this.client.chat.completions.create(body)) as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      _request_id?: string | null;
    };

    const finishedAt = isoNow(this.now);
    const message = completion.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '',
    }));

    const response: ChatResponse = {
      content: message.content ?? null,
      toolCalls,
      model: completion.model ?? this.model,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      usage:
        completion.usage && typeof completion.usage.prompt_tokens === 'number'
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens ?? 0,
            }
          : null,
      requestId: completion._request_id ?? null,
      rawFile: null,
    };

    if (this.rawDir) {
      mkdirSync(this.rawDir, { recursive: true });
      const file = join(this.rawDir, rawFileName(request.itemId, request.step, request.suffix));
      const record = {
        step: request.step,
        itemId: request.itemId ?? null,
        suffix: request.suffix ?? null,
        model: response.model,
        requestedModel: this.model,
        startedAt,
        finishedAt,
        durationMs: response.durationMs,
        usage: response.usage,
        requestId: response.requestId,
        request: {
          system: request.system,
          messages: request.messages ?? (request.user === undefined ? [] : [{ role: 'user', content: request.user }]),
          json: request.json === true,
          tools: request.tools?.map((tool) => tool.function.name) ?? [],
        },
        response: { content: response.content, toolCalls: response.toolCalls },
      };
      writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      response.rawFile = file;
    }

    return response;
  }
}

/** Production entry point: read `.env`, build the client. */
export function createChatModel(
  options: ChatModelOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): OpenAiChatModel {
  return new OpenAiChatModel(readLlmConfig(env), options);
}
