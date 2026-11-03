#!/usr/bin/env node
/**
 * Turn one recorded page (CDP screencast JPEGs + their swap timestamps) into a constant-frame-rate
 * H.264 clip the editor can cut. A frame is shown until the next one arrives, exactly as the
 * screen looked: the screencast only emits on repaint, so long still stretches are one frame.
 *
 * Usage: node scripts/video/frames-to-mp4.mjs <take-dir> <page> [<page>...]
 * Writes <take-dir>/<page>.mp4 and <take-dir>/<page>.json ({ t0, duration, fps, frames }).
 * `t0` is the epoch second of the first frame: a beat at epoch t is at clip time t - t0.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FPS = 30;
const [takeDir, ...pages] = process.argv.slice(2);
if (!takeDir || pages.length === 0) {
  console.error('usage: frames-to-mp4.mjs <take-dir> <page> [<page>...]');
  process.exit(2);
}

for (const page of pages) {
  const dir = resolve(takeDir, page);
  const { frames, stoppedAt } = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'));
  if (!Array.isArray(frames) || frames.length === 0) throw new Error(`${page}: no frames`);
  const lines = ['ffconcat version 1.0'];
  for (let index = 0; index < frames.length; index += 1) {
    const next = index + 1 < frames.length ? frames[index + 1].t : Math.max(stoppedAt, frames[index].t + 1 / FPS);
    lines.push(`file 'frames/${frames[index].file}'`);
    lines.push(`duration ${Math.max(next - frames[index].t, 0.001).toFixed(6)}`);
  }
  // The concat demuxer ignores the last duration unless the last file is listed again.
  lines.push(`file 'frames/${frames[frames.length - 1].file}'`);
  const list = join(dir, 'frames.ffconcat');
  writeFileSync(list, `${lines.join('\n')}\n`);
  const out = resolve(takeDir, `${page}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
    '-movflags', '+faststart',
    out,
  ], { stdio: 'inherit' });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', out], { encoding: 'utf8' }));
  const meta = {
    page,
    t0: frames[0].t,
    duration: Number(probe.format.duration),
    width: probe.streams[0].width,
    height: probe.streams[0].height,
    fps: FPS,
    frames: frames.length,
  };
  writeFileSync(resolve(takeDir, `${page}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`${page}.mp4 ${meta.width}x${meta.height} ${meta.duration.toFixed(2)}s from ${meta.frames} frames`);
}
