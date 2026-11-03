// The comparison agent (SPEC §6.6.4) — the only code in this package that can move money.
//
// It is intentionally not reachable from `processItem()`: the caller has to ask for it by name
// and hand in a `sender`. In production the server injects the PayPal rail; in the T6 evaluation
// it injects a recorder, which is how `proof/ai/comparison-dry-run.json` is produced without
// sending anything.
//
// Everything the model asks for is recorded verbatim (raw arguments), parsed, and — only when
// the arguments are valid — passed to the sender. Invalid arguments go back to the model as a
// tool error, exactly as a real tool-calling agent would experience them. A model that skips an
// invoice simply never calls the tool for it; nothing is filled in afterwards (AC-14).

import { z } from 'zod';
import type { ChatTurn, ChatModel, ToolCall } from './llm.js';
import { COMPARISON_SYSTEM, COMPARISON_TOOL, COMPARISON_TOOL_NAME, comparisonUser } from './prompts/comparison.js';
import type { InboxItem } from './types.js';

export const MAX_COMPARISON_ROUNDS = 12;

export interface ComparisonPayout {
  receiverEmail: string;
  /** Dollars as the model said them. */
  amountUsd: number;
  /** The same amount in integer cents — what a rail takes (SPEC §6.5). */
  amountCents: number;
  memo: string;
}

export type PayoutSender = (payout: ComparisonPayout) => Promise<{
  senderBatchId: string;
  payoutBatchId: string;
}>;

export interface ComparisonToolCall {
  id: string;
  name: string;
  /** Raw JSON the model produced, kept for the video and the dry-run artifact. */
  arguments: string;
  payout: ComparisonPayout | null;
  error: string | null;
  result: { senderBatchId: string; payoutBatchId: string } | null;
}

export interface ComparisonResult {
  model: string;
  rounds: number;
  toolCalls: ComparisonToolCall[];
  /** The agent's own closing message, verbatim. Nothing rewrites it. */
  summary: string;
  messages: ChatTurn[];
}

const payoutArgsSchema = z.object({
  receiver_email: z.string().min(3),
  amount_usd: z.union([z.number(), z.string()]),
  memo: z.string().optional(),
});

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** Parse the model's tool arguments into a payout, or say exactly what is wrong. */
export function parsePayoutArguments(raw: string): { ok: true; payout: ComparisonPayout } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `arguments were not valid JSON: ${(error as Error).message}` };
  }

  const parsed = payoutArgsSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    };
  }

  const { receiver_email: receiverEmail, amount_usd: amountRaw } = parsed.data;
  if (!EMAIL.test(receiverEmail.trim())) {
    return { ok: false, error: `receiver_email is not an email address: ${JSON.stringify(receiverEmail)}` };
  }

  const amountText = typeof amountRaw === 'number' ? String(amountRaw) : amountRaw.trim().replace(/^\$/, '').replace(/,/g, '');
  const amountUsd = Number(amountText);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return { ok: false, error: `amount_usd must be a positive number of US dollars, got ${JSON.stringify(amountRaw)}` };
  }

  const amountCents = Math.round(amountUsd * 100);
  if (Math.abs(amountUsd * 100 - amountCents) > 0.001) {
    return { ok: false, error: `amount_usd has more than two decimals: ${JSON.stringify(amountRaw)}` };
  }

  return {
    ok: true,
    payout: {
      receiverEmail: receiverEmail.trim().toLowerCase(),
      amountUsd: Number((amountCents / 100).toFixed(2)),
      amountCents,
      memo: (parsed.data.memo ?? '').trim(),
    },
  };
}

function toolMessage(toolCallId: string, payload: Record<string, unknown>): ChatTurn {
  return { role: 'tool', toolCallId, content: JSON.stringify(payload) };
}

/**
 * One payout attempt, with the failure turned into a tool result instead of an exception.
 *
 * A rail that refuses one payment (funds, a bad address, a timeout) must not end the comparison:
 * the ungated agent is supposed to make a mess, and the run is the evidence of what it did. The
 * model gets the refusal back the way a real tool would give it, and the record keeps it.
 */
async function settle(
  payout: ComparisonPayout,
  sender: PayoutSender,
  record: ComparisonToolCall,
): Promise<{ ok: true; value: { senderBatchId: string; payoutBatchId: string } } | { ok: false }> {
  try {
    const value = await sender(payout);
    return { ok: true, value };
  } catch (error) {
    record.error = `the payout did not go through: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false };
  }
}

/**
 * Run the ungated agent over the whole inbox. The model decides which invoices to pay; every
 * payment goes through `sender` (the injected rail).
 */
export async function runComparison(
  inbox: InboxItem[],
  sender: PayoutSender,
  model: ChatModel,
): Promise<ComparisonResult> {
  const messages: ChatTurn[] = [{ role: 'user', content: comparisonUser(inbox) }];
  const toolCalls: ComparisonToolCall[] = [];
  let summary = '';
  let lastModel = model.model;
  let rounds = 0;

  for (let round = 1; round <= MAX_COMPARISON_ROUNDS; round += 1) {
    rounds = round;
    const response = await model.chat({
      step: 'comparison',
      itemId: 'run',
      system: COMPARISON_SYSTEM,
      messages,
      tools: [COMPARISON_TOOL],
      suffix: `round-${round}`,
    });
    lastModel = response.model;

    const calls: ToolCall[] = response.toolCalls;
    if (calls.length === 0) {
      summary = (response.content ?? '').trim();
      break;
    }

    messages.push({ role: 'assistant', content: response.content ?? null, toolCalls: calls });

    for (const call of calls) {
      const record: ComparisonToolCall = {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        payout: null,
        error: null,
        result: null,
      };

      if (call.name !== COMPARISON_TOOL_NAME) {
        record.error = `unknown tool ${JSON.stringify(call.name)}`;
        toolCalls.push(record);
        messages.push(toolMessage(call.id, { error: record.error }));
        continue;
      }

      const parsed = parsePayoutArguments(call.arguments);
      if (!parsed.ok) {
        record.error = parsed.error;
        toolCalls.push(record);
        messages.push(toolMessage(call.id, { error: record.error }));
        continue;
      }

      const sent = await settle(parsed.payout, sender, record);
      record.payout = parsed.payout;
      if (!sent.ok) {
        toolCalls.push(record);
        messages.push(toolMessage(call.id, { error: record.error }));
        continue;
      }
      record.result = sent.value;
      toolCalls.push(record);
      messages.push(
        toolMessage(call.id, {
          status: 'sent',
          senderBatchId: sent.value.senderBatchId,
          payoutBatchId: sent.value.payoutBatchId,
        }),
      );
    }
  }

  if (summary === '') {
    throw new Error(`the comparison agent did not finish within ${MAX_COMPARISON_ROUNDS} rounds`);
  }

  return { model: lastModel, rounds, toolCalls, summary, messages };
}
