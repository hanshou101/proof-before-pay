import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The app consumes the repo-level design system: design/tokens.css is imported
// from src/main.tsx and the IBM Plex woff2 files are referenced from
// design/fonts/ (SPEC §6.0). Both live one level above apps/web, hence fs.allow.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Where the API listens. `PORT` may come from the shell or from the repo's `.env` — the same
 * file the server reads — so a demo that moves the API off 8787 does not leave the proxy pointing
 * at a port nobody is on (T8 round 3).
 */
function apiPort(): number {
  const fromShell = process.env.PORT;
  if (fromShell !== undefined && fromShell.trim() !== '') {
    const parsed = Number.parseInt(fromShell, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*PORT\s*=\s*(\d+)\s*$/.exec(line);
      if (match?.[1]) return Number.parseInt(match[1], 10);
    }
  } catch {
    // No .env yet — the default below is what README tells people to expect.
  }
  return 8787;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    // One URL (SPEC §6.7 + AC-17): the browser only ever talks to :5173, which forwards the API
    // and the SSE stream to the server.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort()}`,
        changeOrigin: true,
        // SSE must not be buffered by the dev proxy.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyResponse) => {
            proxyResponse.headers['cache-control'] = 'no-cache';
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
