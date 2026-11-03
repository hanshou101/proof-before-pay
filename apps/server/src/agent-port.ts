// The bridge between `@pbp/agent` (T6) and the `AgentPort` the runner (T7) calls.
//
// T6 ships functions, not an object: `processItem`, `explainIntent`, `summarize`,
// `runComparison`. The runner wants one port with four methods. This file is the whole
// difference — it adds no logic of its own, and in particular it never decides anything:
// the gate still decides, and this file only forwards.
//
// Two details are worth naming:
//   - The server's inbox rows (`InboxItem` in `types.ts`) carry attachment *paths*; the agent
//     wants the attachment *text*. The adapter re-reads each item through the agent's own
//     `readInboxItem`, which is also what verifies the recorded sha256 against the bytes.
//   - `summarize` needs the invoice number to name a held invoice in its one-sentence
//     highlight (packages/agent/src/highlight.ts `checkHighlight`), so the runner passes it.

import {
  createChatModel,
  explainIntent as explainWithModel,
  processItem as processWithModel,
  readInboxItem,
  runComparison as runComparisonWithModel,
  summarize as summarizeWithModel,
  type ChatModel,
} from '@pbp/agent';
import type { Claim, CheckResult } from '@pbp/core';
import { join } from 'node:path';
import { REPO_ROOT, type ServerEnv } from './config.js';
import type { LoadedDemo } from './scenario.js';
import type { AgentExplanation, AgentPort, InboxItem, ItemOutcome, RunSummaryInput } from './types.js';

export interface AgentPortOptions {
  /** Merged `.env` + `process.env`; read for `LLM_API_BASE` / `LLM_API_KEY` / `LLM_MODEL`. */
  env: ServerEnv;
  /** Where the raw model answers are written (SPEC §6.6.1: `data/ai/<itemId>-<step>.json`). */
  dataDir: string;
  /** The scenario's vendors and agreements — everything the agent is allowed to see. */
  demo: LoadedDemo;
  /** Overridable for tests; production builds the OpenAI-compatible client from `env`. */
  model?: ChatModel;
}

/** Thrown when the model is unusable; the runner records it as a human-readable `error`. */
export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

export interface AgentPortHandle extends AgentPort {
  /** The model name, once configured (for `/api/state` and the developer switch). */
  modelName(): string | null;
}

export function createAgentPort(options: AgentPortOptions): AgentPortHandle {
  const rawDir = join(options.dataDir, 'ai');
  const { vendors, agreements, payer } = options.demo.scenario;

  // Building the client throws `LlmConfigError` when a key is missing. That must not stop the
  // server from booting (AC-17: a blank `.env` has to give a human sentence, not a stack trace),
  // so it is captured and only surfaces when a run is asked for.
  let model: ChatModel | null = null;
  let modelProblem: string | null = null;
  try {
    model = options.model ?? createChatModel({ rawDir }, options.env as NodeJS.ProcessEnv);
  } catch (error) {
    modelProblem = error instanceof Error ? error.message : String(error);
  }

  const inboxCache = new Map<string, Promise<Awaited<ReturnType<typeof readInboxItem>>>>();

  function requireModel(): ChatModel {
    if (model === null) {
      throw new AgentUnavailableError(
        modelProblem ??
          'The AI model is not configured. Add LLM_API_BASE, LLM_API_KEY and LLM_MODEL to .env — nothing was sent.',
      );
    }
    return model;
  }

  /** The agent's own inbox reader: same JSON, same sha256 check, plus the extracted PDF text. */
  function agentItem(itemId: string): Promise<Awaited<ReturnType<typeof readInboxItem>>> {
    const cached = inboxCache.get(itemId);
    if (cached) return cached;
    const pending = readInboxItem(REPO_ROOT, itemId);
    inboxCache.set(itemId, pending);
    return pending;
  }

  return {
    modelName: () => model?.model ?? null,

    async processItem(input: { item: InboxItem; files: unknown[] }): Promise<ItemOutcome> {
      const item = await agentItem(input.item.id);
      const result = await processWithModel(item, {
        vendors,
        agreements,
        payerDomain: payer.domain,
        model: requireModel(),
        rawDir,
      });

      if (result.classification === null) {
        // Nothing is invented: the runner turns this into "we could not read it, it waits for a
        // human" instead of a guessed classification (SPEC §6.6.1 `needs review`).
        throw new AgentUnavailableError(result.error ?? `The AI could not read ${input.item.subject}.`);
      }

      return {
        classification: result.classification,
        model: requireModel().model,
        claim: result.claim,
        changeRequest: result.changeRequest,
        risk: result.risk
          ? {
              flags: result.risk.flags,
              note: result.risk.note,
              // The UI may only badge a note as "AI" when the model wrote it (SPEC §6.6.2 step 4).
              noteSource: result.risk.noteSource === 'model' ? 'model' : 'none',
            }
          : null,
        proposal: result.proposal
          ? {
              agreementId: result.proposal.agreementId,
              agreementMatchedBy: result.proposal.agreementMatchedBy,
              rationale: result.proposal.rationale,
            }
          : null,
      };
    },

    async explainIntent(input: {
      intentId: string;
      itemId: string;
      claim: Claim;
      checks: CheckResult[];
      decision: 'held' | 'blocked';
      original?: { id: string; transactionId: string | null; paidAt: string | null } | null;
    }): Promise<AgentExplanation> {
      const explanation = await explainWithModel(
        {
          intentId: input.intentId,
          itemId: input.itemId,
          claim: input.claim,
          checks: input.checks,
          decision: input.decision,
          original: input.original ?? null,
        },
        { model: requireModel() },
      );
      return { text: explanation.text, source: explanation.source };
    },

    async summarize(input: RunSummaryInput): Promise<AgentExplanation> {
      const intents = input.items
        .filter((item) => item.decision !== null && item.checks !== null)
        .map((item) => ({
          intentId: item.intentId ?? item.itemId,
          itemId: item.itemId,
          vendorName: item.vendorName,
          invoiceNumber: item.invoiceNumber ?? '',
          amount: item.amount ?? 0,
          decision: item.decision as 'approved' | 'held' | 'blocked',
          checks: item.checks as CheckResult[],
        }));

      const summary = await summarizeWithModel(input.totals, intents, { model: requireModel() });
      return { text: summary.highlight.text, source: summary.highlight.source };
    },

    async runComparison(input: {
      runId: string;
      items: InboxItem[];
      sendPayout: (request: { receiver: string; amount: number; memo: string }) => Promise<{
        senderBatchId: string;
        payoutBatchId: string | null;
        ok: boolean;
      }>;
    }): Promise<AgentExplanation> {
      const inbox = [];
      for (const item of input.items) inbox.push(await agentItem(item.id));

      const result = await runComparisonWithModel(
        inbox,
        async (payout) => {
          const sent = await input.sendPayout({
            receiver: payout.receiverEmail,
            amount: payout.amountCents,
            memo: payout.memo,
          });
          if (!sent.ok || sent.payoutBatchId === null) {
            // Told back to the model exactly like a failing tool call, so the comparison run
            // records "this one did not go through" instead of pretending it paid.
            throw new Error('PayPal did not confirm this payout.');
          }
          return { senderBatchId: sent.senderBatchId, payoutBatchId: sent.payoutBatchId };
        },
        requireModel(),
      );

      // The agent's closing message, verbatim (AC-14: nothing rewrites it).
      return { text: result.summary, source: 'model' };
    },
  };
}
