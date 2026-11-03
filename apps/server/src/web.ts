// Serving the web app from the API's own origin (SPEC §6.7: "GET / 由 server 代理或同源提供 web").
//
// Two callers:
//   - development: Vite on 5173 is the UI and proxies /api here, so `GET /` on 8787 is only used
//     by the readiness probe and by anyone poking the API directly;
//   - a single-origin run (`npm --prefix apps/web run build` first): this serves `apps/web/dist`
//     and the whole product lives on one port.
//
// When the bundle has not been built we must not pretend: `GET /` answers with the API's own
// description, which is honest and still 200 (AC-17 checks the status code).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { REPO_ROOT } from './config.js';

export const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

export function webBuilt(): boolean {
  return existsSync(join(WEB_DIST, 'index.html'));
}

/** `index.html`, for the `/` route in `app.ts`. */
export const serveIndex = serveStatic({ root: WEB_DIST, path: 'index.html' });

/**
 * Static assets for a built bundle. Registered *after* the API routes: a request that is not a
 * file falls through to the API, which is why `/api/*` still works with this mounted.
 */
export function mountWebAssets(app: Hono): void {
  if (!webBuilt()) return;
  app.use('*', serveStatic({ root: WEB_DIST }));
}
