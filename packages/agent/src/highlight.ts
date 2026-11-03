// Step 7 in code: the totals line and the one-sentence highlight.
//
// The totals line never touches the model — the KPI strip and the sentence under it must agree
// to the cent, and a judge will compare them. The model writes only the highlight, which may
// talk about held / stopped payments and nothing else: a run that ends "2 held, 1 stopped" must
// never be summarised as a clean sweep (the comparison agent in the demo does exactly that, and
// that contrast is the point of the product).
//
// Fact check: the sentence must name at least one invoice that is actually held or stopped, it
// may not claim that everything was paid, and (SPEC v1.4 §6.6.2 step 7) it may not carry an
// internal record id — the highlight is a headline, not a debug line. Otherwise the
// deterministic sentence is used.

import { formatUSD } from '@pbp/core';
import { HIGHLIGHT_SYSTEM, highlightUser } from './prompts/highlight.js';
import { highlightSchema } from './schema.js';
import { charCount, sentenceCount } from './sentences.js';
import type { AgentContext, RunSummary, SummarizableIntent, Totals } from './types.js';
import { invoicePattern } from './explain.js';
import { internalIdsIn } from './ids.js';
import { ValidationError, askJson, parseJsonObject } from './validate.js';

export const HIGHLIGHT_MAX_CHARS = 160;

export function totalsLine(totals: Totals): string {
  const parts = [
    `${totals.proven.count} proven by PayPal (${formatUSD(totals.proven.amount)})`,
    `${totals.awaitingProof.count} awaiting proof (${formatUSD(totals.awaitingProof.amount)})`,
    `${totals.held.count} held for review (${formatUSD(totals.held.amount)})`,
    `${totals.stopped.count} stopped (${formatUSD(totals.stopped.amount)})`,
  ];
  if (totals.ignored && totals.ignored.count > 0) parts.push(`${totals.ignored.count} not invoices`);
  return `${parts.join(' · ')}.`;
}

export function needsHuman(intents: SummarizableIntent[]): SummarizableIntent[] {
  return intents.filter((intent) => intent.decision !== 'approved');
}

export function templateHighlight(totals: Totals, intents: SummarizableIntent[]): string {
  const pending = needsHuman(intents);
  if (pending.length > 0) {
    const held = totals.held.count;
    const stopped = totals.stopped.count;
    const pieces: string[] = [];
    if (held > 0) pieces.push(`${held} held`);
    if (stopped > 0) pieces.push(`${stopped} stopped`);
    // The same rule the model has to satisfy: name an invoice a reviewer should open first.
    return `${pieces.join(' and ')} — starting with ${pending[0]?.invoiceNumber}, none of them moves without a human.`;
  }
  if (totals.awaitingProof.count > 0) {
    const count = totals.awaitingProof.count;
    return `Nothing needs a human; ${count} payment${count === 1 ? ' is' : 's are'} still waiting for PayPal's receipt.`;
  }
  return 'Every payment in this run is proven by PayPal.';
}

export interface HighlightCheck {
  ok: boolean;
  reason: string | null;
}

export function checkHighlight(text: string, intents: SummarizableIntent[]): HighlightCheck {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return { ok: false, reason: 'the highlight was empty' };
  if (sentenceCount(trimmed) > 1) return { ok: false, reason: 'the highlight must be exactly one sentence' };
  if (charCount(trimmed) > HIGHLIGHT_MAX_CHARS) {
    return { ok: false, reason: `the highlight is ${charCount(trimmed)} characters; the limit is ${HIGHLIGHT_MAX_CHARS}` };
  }
  if (/\ball (invoices|payments) (were |are )?paid\b/i.test(trimmed) || /\beverything (was|is) paid\b/i.test(trimmed)) {
    return { ok: false, reason: 'the highlight says everything was paid, which is not true for this run' };
  }
  const ids = internalIdsIn(trimmed);
  if (ids.length > 0) {
    return {
      ok: false,
      reason: `the highlight names internal record ids (${ids.join(', ')}); refer to records in human words`,
    };
  }

  const pending = needsHuman(intents);
  if (pending.length > 0) {
    const named = pending.some((intent) => invoicePattern(intent.invoiceNumber).test(trimmed));
    if (!named) {
      return {
        ok: false,
        reason: `the highlight must name at least one held or stopped invoice (${pending
          .map((intent) => intent.invoiceNumber)
          .join(', ')})`,
      };
    }
  }

  return { ok: true, reason: null };
}

export async function summarize(
  totals: Totals,
  intents: SummarizableIntent[],
  ctx: Pick<AgentContext, 'model'>,
): Promise<RunSummary> {
  const line = totalsLine(totals);
  const pending = needsHuman(intents);

  if (pending.length === 0) {
    return {
      line,
      highlight: { text: templateHighlight(totals, intents), source: 'template', attempts: 0, model: null },
    };
  }

  const result = await askJson<string>({
    model: ctx.model,
    step: 'highlight',
    itemId: 'run',
    system: HIGHLIGHT_SYSTEM,
    user: highlightUser({ totals, intents }),
    parse: (content) => {
      const parsed = highlightSchema.safeParse(parseJsonObject(content));
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      const text = parsed.data.highlight.trim().replace(/\s+/g, ' ');
      const check = checkHighlight(text, intents);
      if (!check.ok) throw new ValidationError(check.reason ?? 'the highlight did not pass validation');
      return text;
    },
  });

  if (result.ok && result.value !== null) {
    return {
      line,
      highlight: { text: result.value, source: 'model', attempts: result.attempts, model: result.model },
    };
  }

  return {
    line,
    highlight: {
      text: templateHighlight(totals, intents),
      source: 'template',
      attempts: result.attempts,
      model: result.model,
    },
  };
}
