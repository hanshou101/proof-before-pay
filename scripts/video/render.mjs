#!/usr/bin/env node
/**
 * Render the demo video from the plan (scripts/video/plan.mjs) and check it.
 * Usage: node scripts/video/render.mjs [--out proof/video/proof-before-pay-demo.mp4] [--frames 0-299]
 *        node scripts/video/render.mjs --stills cold=331,ana=1772   → proof/video/test/still-<name>.png
 *
 * Check key frames with --stills before every full render (a full render takes minutes; a still
 * takes seconds). A name may be a section id with an offset in seconds: "ana+1.5".
 *
 * Stages only what the composition reads into proof/video/render-public/ (footage clips, the
 * narration WAVs, the bundled fonts), renders with Remotion, normalises loudness to −14 LUFS
 * (YouTube's reference), then asserts: H.264 1920×1080, AAC audio, duration < 180 s.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = resolve(ROOT, opt('--out', 'proof/video/proof-before-pay-demo.mp4'));
const frames = opt('--frames', null);
const plan = JSON.parse(readFileSync(join(ROOT, 'video/src/generated/plan.json'), 'utf8'));
const pub = join(ROOT, 'proof/video/render-public');

rmSync(pub, { recursive: true, force: true });
mkdirSync(join(pub, 'footage'), { recursive: true });
mkdirSync(join(pub, 'narration'), { recursive: true });
mkdirSync(join(pub, 'fonts'), { recursive: true });
for (const [key, { take, page }] of Object.entries(plan.footage)) {
  const src = resolve(ROOT, take, `${page}.mp4`);
  if (!existsSync(src)) throw new Error(`missing footage ${src}: run scripts/video/frames-to-mp4.mjs first`);
  cpSync(src, join(pub, 'footage', `${key}.mp4`));
}
for (const section of plan.sections) {
  const src = join(ROOT, 'proof/video', section.narration.file);
  if (!existsSync(src)) throw new Error(`missing narration ${src}: run scripts/video/tts.py first`);
  cpSync(src, join(pub, section.narration.file));
}
for (const file of readdirSync(join(ROOT, 'design/fonts')).filter((name) => name.endsWith('.woff2'))) {
  cpSync(join(ROOT, 'design/fonts', file), join(pub, 'fonts', file));
}

// Remotion downloads its own Chrome Headless Shell from remotion.media; behind a proxy that fails
// (Node does not use HTTP(S)_PROXY). Playwright's headless shell, already installed for the E2E,
// renders the same; REMOTION_BROWSER overrides the lookup.
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
const stills = opt('--stills', null);
if (stills) {
  const dir = join(ROOT, 'proof/video/test');
  mkdirSync(dir, { recursive: true });
  for (const item of stills.split(',')) {
    const [name, at] = item.split('=');
    let frame = Number(at);
    const ref = /^([a-z0-9-]+)([+-]\d+(?:\.\d+)?)?$/.exec(at ?? '');
    if (Number.isNaN(frame) && ref) {
      const section = plan.sections.find((s) => s.id === ref[1]);
      if (!section) throw new Error(`no section ${ref[1]}`);
      frame = section.from + Math.round(Number(ref[2] ?? 0) * plan.fps);
    }
    execFileSync('npx', ['remotion', 'still', 'src/index.ts', 'Demo', join(dir, `still-${name}.png`), '--frame', String(frame), '--public-dir', pub, '--log', 'error', ...(browser ? ['--browser-executable', browser] : [])], { cwd: join(ROOT, 'video'), stdio: 'inherit' });
    console.log(`still-${name}.png  frame ${frame}`);
  }
  process.exit(0);
}
const raw = out.replace(/\.mp4$/, '.raw.mp4');
mkdirSync(dirname(out), { recursive: true });
execFileSync('npx', ['remotion', 'render', 'src/index.ts', 'Demo', raw, '--public-dir', pub, '--codec', 'h264', '--crf', '16', '--audio-codec', 'aac', '--audio-bitrate', '192k', ...(frames ? ['--frames', frames] : []), ...(browser ? ['--browser-executable', browser] : []), ...(process.env.VIDEO_CONCURRENCY ? ['--concurrency', process.env.VIDEO_CONCURRENCY] : [])], { cwd: join(ROOT, 'video'), stdio: 'inherit' });

if (frames) {
  console.log(`partial render (frames ${frames}): ${raw}`);
  process.exit(0);
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
rmSync(raw, { force: true });
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', out], { encoding: 'utf8' }));
const video = probe.streams.find((s) => s.codec_type === 'video');
const audio = probe.streams.find((s) => s.codec_type === 'audio');
const duration = Number(probe.format.duration);
const problems = [];
if (video?.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080) problems.push(`video stream ${JSON.stringify(video)}`);
if (audio?.codec_name !== 'aac') problems.push(`audio stream ${JSON.stringify(audio)}`);
if (!(duration > 0 && duration < 180)) problems.push(`duration ${duration}`);
const poster = out.replace(/\.mp4$/, '-poster.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String((plan.sections.find((s) => s.id === 'title').from + 40) / plan.fps), '-i', out, '-frames:v', '1', poster]);
console.log(JSON.stringify({ out, poster, duration: Number(duration.toFixed(2)), video: `${video?.codec_name} ${video?.width}x${video?.height}`, audio: audio?.codec_name, problems }, null, 2));
if (problems.length > 0) process.exit(1);
