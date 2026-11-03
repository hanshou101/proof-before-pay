// HTTP surface (SPEC §6.7). The app is pure transport: it validates the request, asks the
// runtime/runner, and turns refusals into one human sentence with a status code.

import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { verifyChain, type LedgerEvent } from '@pbp/core';
import { buildBundle } from './bundle.js';
import {
  REPO_ROOT,
  credentialMessage,
  environmentProblem,
  missingCredentials,
  type ServerConfig,
} from './config.js';
import { BadRequestError, ConflictError, NotFoundError, messageOf } from './errors.js';
import type { Runner } from './runner.js';
import type { Runtime } from './runtime.js';
import type { HumanAction, RunMode } from './types.js';
import { serveIndex, webBuilt } from './web.js';

export interface AppDeps {
  runtime: Runtime;
  runner: Runner;
  config: ServerConfig;
}

const ACTIONS: readonly HumanAction[] = [
  'verify_payee',
  'mark_fraud',
  'reject',
  'accept_delivery',
  'approve',
  'cancel_payout',
  'refresh_receipt',
];

export function createApp(deps: AppDeps): Hono {
  const { runtime, runner, config } = deps;
  const app = new Hono();

  // SPEC §6.7: `GET /` serves the web app when it has been built; otherwise it describes the
  // API (still 200 — AC-17 probes this route).
  app.get('/', async (c): Promise<Response> => {
    if (!webBuilt()) {
      return c.json({
        ok: true,
        service: 'Proof Before Pay — server',
        spec: 'docs/01-SPEC.md §6.7',
        health: '/api/health',
        state: '/api/state',
        note: 'The web app is not built. `npm run setup` builds it, or run `npm run dev` (Vite on 5173).',
      });
    }
    const served = await serveIndex(c, async () => undefined);
    return served instanceof Response ? served : c.notFound();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/state', (c) => {
    const verification = runtime.ledgerVerification();
    const lastRun = runner.lastRun();
    const active = runner.current();
    const phase = active ? 'running' : lastRun?.completedAt ? 'done' : 'idle';

    return c.json({
      ok: true,
      epoch: runtime.epoch,
      scenario: runtime.projection.scenario,
      version: runtime.projection.version,
      head: runtime.projection.head,
      ledger: {
        verified: verification.verified,
        brokenAtSeq: verification.seq,
        head: verification.head,
        droppedTornTail: verification.droppedTornTail,
        checkedAt: runtime.now,
      },
      run: active
        ? { phase, runId: active.runId, mode: active.mode, startedAt: active.startedAt, completedAt: null }
        : {
            phase,
            runId: lastRun?.runId ?? null,
            mode: lastRun?.mode ?? null,
            startedAt: lastRun?.startedAt ?? null,
            completedAt: lastRun?.completedAt ?? null,
          },
      inbox: runtime.demo.items.map((item) => {
        const intentId = runtime.projection.byItem[item.id] ?? null;
        const intent = intentId ? runtime.intent(intentId) : undefined;
        return {
          itemId: item.id,
          from: item.from,
          subject: item.subject,
          receivedAt: item.receivedAt,
          layout: item.layout,
          // The Inbox screen previews the original message; for in_06 the body *is* the invoice
          // (SPEC §6.4), so the text has to be here and not only in the PDF.
          bodyText: item.bodyText,
          attachments: item.attachments.map((attachment) => attachment.name),
          files: item.attachments.map((attachment) => ({
            name: attachment.name,
            sha256: attachment.sha256,
            url: `/api/inbox/${item.id}/files/${encodeURIComponent(attachment.name)}`,
          })),
          business: intent?.vendorId
            ? (runtime.demo.scenario.vendors.find((vendor) => vendor.id === intent.vendorId)?.business ?? null)
            : null,
          intentId,
          classification:
            (() => {
              const event = runtime.events.find(
                (entry) =>
                  entry.type === 'item.classified' &&
                  (entry.data as { itemId?: string }).itemId === item.id,
              );
              return event ? (event.data as { classification?: string }).classification ?? null : null;
            })(),
        };
      }),
      vendors: runtime.demo.scenario.vendors,
      intents: runtime.projection.intents,
      byItem: runtime.projection.byItem,
      totals: runtime.projection.totals,
      ignored: {
        count: runtime.demo.items.filter((item) => !runtime.projection.byItem[item.id]).length,
      },
      errors: runtime.projection.errors,
    });
  });

  app.get('/api/events', (c) => {
    const raw = c.req.query('since');
    const since = raw === undefined ? 0 : Number.parseInt(raw, 10);
    if (!Number.isFinite(since) || since < 0) {
      return c.json({ ok: false, error: 'since must be a non-negative integer' }, 400);
    }

    return streamSSE(c, async (stream) => {
      let ready = false;
      const buffered: LedgerEvent[] = [];
      let chain: Promise<void> = Promise.resolve();

      const push = (event: LedgerEvent): void => {
        const payload = { event: 'ledger', id: String(event.seq), data: JSON.stringify(event) };
        chain = chain.then(() => stream.writeSSE(payload)).catch(() => undefined);
      };

      const unsubscribe = runtime.subscribe((event) => {
        if (ready) push(event);
        else buffered.push(event);
      });

      await new Promise<void>((resolveDone) => {
        stream.onAbort(() => {
          unsubscribe();
          resolveDone();
        });

        void (async () => {
          for (const event of runtime.eventsSince(since)) push(event);
          ready = true;
          for (const event of buffered.splice(0)) push(event);
          await chain;
        })();
      });
    });
  });

  app.post('/api/runs', async (c) => {
    const body = await readJson(c.req.raw);
    const mode = (body.mode ?? 'proof') as RunMode;

    if (mode !== 'proof' && mode !== 'comparison') {
      return c.json({ ok: false, error: 'mode must be "proof" or "comparison". Nothing was sent.' }, 400);
    }

    if (mode === 'comparison' && !config.allowComparison) {
      return c.json(
        {
          ok: false,
          error: 'Comparison mode is off. Set PBP_ALLOW_COMPARISON=1 in .env to run it — nothing was sent.',
        },
        403,
      );
    }

    const envProblem = environmentProblem(config.env);
    if (envProblem) return c.json({ ok: false, error: envProblem }, 400);

    const missing = missingCredentials(config.env);
    if (missing.length > 0) {
      return c.json({ ok: false, error: credentialMessage(missing), missing }, 400);
    }

    try {
      const handle = runner.start(mode);
      // The run continues in this process; the client watches it over SSE.
      return c.json({ ok: true, runId: handle.runId, mode: handle.mode });
    } catch (error) {
      if (error instanceof ConflictError) return c.json({ ok: false, error: error.message }, 409);
      throw error;
    }
  });

  app.get('/api/intents/:id/bundle', (c) => {
    const bundle = buildBundle(runtime, c.req.param('id'));
    return c.json(bundle);
  });

  app.post('/api/intents/:id/actions', async (c) => {
    const body = await readJson(c.req.raw);
    const action = String(body.action ?? '') as HumanAction;

    if (!ACTIONS.includes(action)) {
      return c.json(
        {
          ok: false,
          error: `Unknown action "${String(body.action ?? '')}". Use one of: ${ACTIONS.join(', ')}. Nothing was changed.`,
        },
        400,
      );
    }

    const input = isRecord(body.input) ? body.input : {};
    const by = typeof body.by === 'string' && body.by.trim() !== '' ? body.by.trim() : config.operator;

    try {
      const intent = await runner.act(c.req.param('id'), action, input, by);
      return c.json({ ok: true, intent });
    } catch (error) {
      if (error instanceof ConflictError) {
        return c.json({ ok: false, error: error.message, code: error.code, intent: runtime.intent(c.req.param('id')) }, 409);
      }
      if (error instanceof NotFoundError) return c.json({ ok: false, error: error.message }, 404);
      if (error instanceof BadRequestError) return c.json({ ok: false, error: error.message }, 400);
      throw error;
    }
  });

  app.get('/api/inbox/:itemId/files/:name', async (c) => {
    const itemId = c.req.param('itemId');
    const name = decodeURIComponent(c.req.param('name'));
    const item = runtime.demo.byId.get(itemId);
    if (!item) return c.json({ ok: false, error: `No inbox item ${itemId}.` }, 404);

    const attachment = item.attachments.find((entry) => entry.name === name);
    if (!attachment) {
      return c.json({ ok: false, error: `${name} is not attached to ${itemId}.` }, 404);
    }

    const filePath = resolve(REPO_ROOT, attachment.path);
    const allowedRoot = resolve(REPO_ROOT, 'demo', 'inbox', 'files');
    if (!filePath.startsWith(`${allowedRoot}${sep}`)) {
      return c.json({ ok: false, error: 'That path is outside the inbox.' }, 403);
    }

    try {
      const bytes = await readFile(filePath);
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return c.body(body, 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${attachment.name}"`,
        'Cache-Control': 'no-store',
      });
    } catch {
      return c.json({ ok: false, error: `${attachment.name} is missing from the demo inbox.` }, 404);
    }
  });

  app.post('/api/demo/reset', async (c) => {
    try {
      const result = await runner.resetDemo();
      return c.json({ ok: true, epoch: result.epoch, history: result.history });
    } catch (error) {
      if (error instanceof ConflictError) {
        return c.json({ ok: false, error: error.message, code: error.code }, 409);
      }
      if (error instanceof BadRequestError) return c.json({ ok: false, error: error.message }, 400);
      throw error;
    }
  });

  app.get('/api/comparison/state', (c) => {
    const payouts = new Map<
      string,
      {
        toolCallId: string;
        receiver: string;
        receiverSent: string | null;
        amount: number;
        memo: string;
        senderBatchId: string | null;
        payoutBatchId: string | null;
        railStatus: string | null;
        transactionId: string | null;
        fetchedAt: string | null;
      }
    >();

    let summary: { text: string; at: string } | null = null;
    let runId: string | null = null;

    for (const event of runtime.comparisonEvents) {
      if (event.type === 'comparison.payout_sent') {
        const data = event.data as {
          runId: string;
          toolCallId: string;
          receiver: string;
          amount: number;
          memo: string;
          senderBatchId: string;
          payoutBatchId: string | null;
          receiverSent?: string | null;
        };
        runId = data.runId;
        // Two rows per send: the intent row (batch id null) then the resolution row. The screen
        // shows the latest per tool call, which is the one PayPal answered.
        payouts.set(data.toolCallId, {
          toolCallId: data.toolCallId,
          receiver: data.receiver,
          // SPEC §6.5.5: the sandbox account the map swapped in, shown next to the requested
          // address under the developer switch.
          receiverSent: data.receiverSent ?? payouts.get(data.toolCallId)?.receiverSent ?? null,
          amount: data.amount,
          memo: data.memo,
          senderBatchId: data.senderBatchId,
          payoutBatchId: data.payoutBatchId,
          railStatus: payouts.get(data.toolCallId)?.railStatus ?? null,
          transactionId: payouts.get(data.toolCallId)?.transactionId ?? null,
          fetchedAt: payouts.get(data.toolCallId)?.fetchedAt ?? null,
        });
      } else if (event.type === 'comparison.receipt') {
        const data = event.data as {
          toolCallId: string;
          railStatus: string | null;
          transactionId: string | null;
          fetchedAt: string;
        };
        const existing = payouts.get(data.toolCallId);
        if (existing) {
          payouts.set(data.toolCallId, {
            ...existing,
            railStatus: data.railStatus,
            transactionId: data.transactionId,
            fetchedAt: data.fetchedAt,
          });
        }
      } else if (event.type === 'comparison.summary') {
        const data = event.data as { runId: string; text: string };
        runId = data.runId;
        summary = { text: data.text, at: event.at };
      }
    }

    const chain = verifyChain(runtime.comparisonEvents);
    return c.json({
      ok: true,
      epoch: runtime.epoch,
      runId,
      head: runtime.comparisonHead?.seq ?? 0,
      verified: chain.ok,
      payouts: [...payouts.values()],
      summary,
    });
  });

  app.notFound((c) => c.json({ ok: false, error: `No route ${c.req.method} ${c.req.path}.` }, 404));

  app.onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ ok: false, error: error.message }, 404);
    return c.json(
      {
        ok: false,
        error: `The server hit an unexpected problem: ${messageOf(error)}`,
      },
      500,
    );
  });

  return app;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.trim() === '') return {};
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
