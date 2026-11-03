// `apps/server` entry point — the one file that knows about the *real* PayPal rail and the
// *real* model (SPEC §6.7). Everything below it takes these as injected ports, which is why
// the integration tests can swap in fakes without touching a line of business logic.
//
// Boot order matters for AC-17: a fresh clone with an empty `.env` must still start and answer
// `GET /` with 200, showing a human sentence instead of a stack trace. So each port is built
// defensively:
//   - the PayPal rail is only constructed when its credentials are usable; otherwise every rail
//     call fails with the same sentence the UI shows;
//   - the model client is built inside `createAgentPort`, which also defers its error.

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createPayPalRail, PayPalRailError, type PayPalRail } from '@pbp/paypal';
import type { ProofState, RailAdapter, RailIntent, RailRef, ReceiptResult, SubmitResult } from '@pbp/core';
import { mapStatus } from '@pbp/core';
import { createAgentPort } from './agent-port.js';
import { REPO_ROOT, loadConfig, readDotEnvFile } from './config.js';
import { loadDemo } from './scenario.js';
import { startServer, type RunningServer } from './server.js';
import type { ServerConfig } from './config.js';
import { WEB_DIST, mountWebAssets, webBuilt } from './web.js';

/** Where Vite writes the production bundle (`npm --prefix apps/web run build`). */
const hasWeb = (): boolean => webBuilt();

/**
 * A rail that refuses every call with one human sentence. Used when the PayPal credentials are
 * missing or malformed: the server still boots, the UI still loads, and the first run attempt
 * gets "Add PAYPAL_CLIENT_ID to .env — nothing was sent." instead of a crash (AC-17).
 */
function unavailableRail(reason: string): RailAdapter {
  const fail = async (): Promise<never> => {
    throw new PayPalRailError('missing_credentials', reason);
  };
  return {
    submit: (_intent: RailIntent): Promise<SubmitResult> => fail(),
    fetchReceipt: (_ref: RailRef): Promise<ReceiptResult> => fail(),
    cancel: (_ref: RailRef): Promise<void> => fail(),
    mapStatus: (railStatus: string): ProofState => mapStatus(railStatus),
  };
}

function buildRail(env: Record<string, string | undefined>): { rail: RailAdapter; note: string | null } {
  try {
    const rail: PayPalRail = createPayPalRail(env);
    return { rail, note: null };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'The PayPal sandbox is not configured — nothing was sent.';
    return { rail: unavailableRail(reason), note: reason };
  }
}

/** Serve the built web app from the same origin, so one URL shows the whole product. */
function mountWeb(app: RunningServer['app']): void {
  if (!webBuilt()) {
    console.warn(
      '[server] apps/web/dist is missing — `GET /` returns server info. Run `npm run setup` (or `npm --prefix apps/web run build`) to serve the UI from here.',
    );
    return;
  }
  mountWebAssets(app);
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<RunningServer> {
  const config: ServerConfig = loadConfig({ env });
  const demo = loadDemo(config.demoDir);

  const { rail, note } = buildRail(env);
  if (note) console.warn(`[server] PayPal rail unavailable: ${note}`);

  const agent = createAgentPort({ env, dataDir: config.dataDir, demo });
  if (agent.modelName() === null) {
    console.warn('[server] LLM is not configured — runs will report a human sentence instead of sending anything.');
  }

  const server = await startServer({ config, rail, agent, demo });
  mountWeb(server.app);

  console.log(`[server] Proof Before Pay on ${server.url}`);
  console.log(`[server] web: ${existsSync(join(WEB_DIST, 'index.html')) ? relative(REPO_ROOT, WEB_DIST) : '(not built — dev server is the UI)'}`);
  return server;
}

// `tsx src/main.ts` / `node dist/main.js`. Importing this module (tests) does not start anything.
if (process.argv[1] && /main\.(ts|js)$/.test(process.argv[1])) {
  const dotenv = readDotEnvFile(join(REPO_ROOT, '.env'));
  // A real environment variable always wins over `.env`, so CI can override a local file.
  const env = { ...dotenv, ...process.env };
  main(env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
