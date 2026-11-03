#!/usr/bin/env node
/**
 * Render the Devpost cover (3:2, 1500×1000 PNG, under 5 MB) from video/src/Cover.tsx.
 * Usage: node scripts/video/cover.mjs [--variant story|stamps] [--out submission/cover-1500x1000.png]
 *
 * Stages the bundled fonts and design/sample-cover/assets/ (DPR-2 captures of the real app,
 * taken by apps/web/e2e/record-demo.ts) into proof/video/cover-public/, renders one still, then
 * checks the size and writes a 300 px wide copy to proof/video/test/: that is how big the cover is
 * in the Devpost gallery, so the name has to be readable there.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const variant = opt('--variant', 'story');
const out = resolve(ROOT, opt('--out', variant === 'story' ? 'submission/cover-1500x1000.png' : `proof/video/test/cover-${variant}.png`));
const pub = join(ROOT, 'proof/video/cover-public');

rmSync(pub, { recursive: true, force: true });
mkdirSync(join(pub, 'fonts'), { recursive: true });
mkdirSync(join(pub, 'cover'), { recursive: true });
for (const file of readdirSync(join(ROOT, 'design/fonts')).filter((name) => name.endsWith('.woff2'))) cpSync(join(ROOT, 'design/fonts', file), join(pub, 'fonts', file));
for (const file of readdirSync(join(ROOT, 'design/sample-cover/assets'))) cpSync(join(ROOT, 'design/sample-cover/assets', file), join(pub, 'cover', file));

// Same browser lookup as scripts/video/render.mjs (Remotion's own download fails behind a proxy).
function browserExecutable() {
  if (process.env.REMOTION_BROWSER) return process.env.REMOTION_BROWSER;
  for (const base of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const exe = join(base, dir, sub, 'chrome-headless-shell');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}
const browser = browserExecutable();
mkdirSync(dirname(out), { recursive: true });
const id = variant === 'story' ? 'Cover' : 'CoverStamps';
execFileSync('npx', ['remotion', 'still', 'src/index.ts', id, out, '--public-dir', pub, '--log', 'error', ...(browser ? ['--browser-executable', browser] : [])], { cwd: join(ROOT, 'video'), stdio: 'inherit' });
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
const bytes = statSync(out).size;
mkdirSync(join(ROOT, 'proof/video/test'), { recursive: true });
const small = join(ROOT, 'proof/video/test', `${out.split('/').pop().replace(/\.png$/, '')}-300w.png`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-vf', 'scale=300:-1:flags=lanczos', small]);
const problems = [];
if (probe !== '1500,1000') problems.push(`size ${probe}`);
if (bytes > 5 * 1024 * 1024) problems.push(`${bytes} bytes > 5 MB`);
console.log(JSON.stringify({ out, small, size: probe, bytes, problems }, null, 2));
if (problems.length > 0) process.exit(1);
