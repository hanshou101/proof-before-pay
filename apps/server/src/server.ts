// Assembly: config → demo → runtime → runner → Hono app → HTTP listener.
//
// `createServer` builds an app with injected ports and does not listen (the tests call it
// directly). `startServer` adds the listener and kicks off restart recovery.

import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import type { RailAdapter } from '@pbp/core';
import { createApp } from './app.js';
import { anchoredClock, type Clock } from './clock.js';
import { loadConfig, type ServerConfig } from './config.js';
import { Runner } from './runner.js';
import { Runtime } from './runtime.js';
import { loadDemo, type LoadedDemo } from './scenario.js';
import type { AgentPort } from './types.js';

export interface ServerDeps {
  config?: ServerConfig;
  agent: AgentPort;
  rail: RailAdapter;
  demo?: LoadedDemo;
  clock?: Clock;
}

export interface BuiltServer {
  app: Hono;
  runtime: Runtime;
  runner: Runner;
  config: ServerConfig;
  demo: LoadedDemo;
}

export function createServer(deps: ServerDeps): BuiltServer {
  const config = deps.config ?? loadConfig();
  const demo = deps.demo ?? loadDemo(config.demoDir);
  const clock = deps.clock ?? config.clock ?? anchoredClock(demo.scenario.testClock);
  const runtime = new Runtime({ config, demo, clock }).open();
  const runner = new Runner({ runtime, demo, agent: deps.agent, rail: deps.rail, config });
  const app = createApp({ runtime, runner, config });
  return { app, runtime, runner, config, demo };
}

export interface RunningServer extends BuiltServer {
  server: ServerType;
  port: number;
  url: string;
  /** Restart recovery (SPEC §6.7). Await it in tests; production lets it run. */
  recovered: Promise<void>;
  close(): Promise<void>;
}

export async function startServer(deps: ServerDeps & { autoResume?: boolean }): Promise<RunningServer> {
  const built = createServer(deps);

  const server = await new Promise<ServerType>((resolvePromise) => {
    const instance = serve({ fetch: built.app.fetch, port: built.config.port, hostname: '127.0.0.1' }, () => {
      resolvePromise(instance);
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : built.config.port;

  const recovered =
    deps.autoResume === false
      ? Promise.resolve()
      : built.runner.recover().catch(() => undefined);

  return {
    ...built,
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    recovered,
    close: async () => {
      built.runner.close();
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}
