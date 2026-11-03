#!/usr/bin/env node
/**
 * Resolve docs/video/script.json against the recorded takes and the narration timing, and write
 * the frame-exact plan the Remotion composition renders (video/src/generated/plan.json).
 *
 * Usage: node scripts/video/plan.mjs [--narration proof/video/narration]
 *
 * Every time in the script is "<beat>±<seconds>" on one recorded page; a beat's clip time is
 * beat.t − t0 of that page's clip (scripts/video/frames-to-mp4.mjs). A section lasts as long as
 * its narration (lead + speech + tail) or its shots, whichever is longer; a "fit" shot takes the
 * time that is left, and the last shot holds its final frame if the narration runs longer.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const narrationDir = resolve(ROOT, args.includes('--narration') ? args[args.indexOf('--narration') + 1] : 'proof/video/narration');
const script = JSON.parse(readFileSync(join(ROOT, 'docs/video/script.json'), 'utf8'));
const timing = JSON.parse(readFileSync(join(narrationDir, 'timing.json'), 'utf8'));
const FPS = script.fps;
const f = (seconds) => Math.round(seconds * FPS);

const takes = {};
function take(name) {
  if (!takes[name]) {
    const dir = resolve(ROOT, script.takes[name]);
    takes[name] = { dir, beats: JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')).beats, clips: {} };
  }
  return takes[name];
}
function clipMeta(takeName, page) {
  const t = take(takeName);
  if (!t.clips[page]) t.clips[page] = JSON.parse(readFileSync(join(t.dir, `${page}.json`), 'utf8'));
  return t.clips[page];
}
function findBeat(takeName, page, name) {
  const beat = take(takeName).beats.find((b) => b.page === page && b.name === name);
  if (!beat) throw new Error(`no beat "${name}" on ${takeName}:${page}`);
  return beat;
}
/** "<beat>±<seconds>" → clip seconds. The longest beat name that leaves a valid offset wins. */
function clipTime(takeName, page, ref) {
  const names = [...new Set(take(takeName).beats.filter((b) => b.page === page).map((b) => b.name))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (ref === name || (ref.startsWith(name) && /^[+-]\d+(\.\d+)?$/.test(ref.slice(name.length)))) {
      const offset = ref === name ? 0 : Number(ref.slice(name.length));
      return findBeat(takeName, page, name).t - clipMeta(takeName, page).t0 + offset;
    }
  }
  throw new Error(`cannot resolve "${ref}" on ${takeName}:${page}`);
}
/**
 * "<beat>.<key>" → [x, y, w, h] in CSS px, or a literal array. Two derivations:
 * "<beat>.<key>/<n>:<i>" is the i-th of n equal columns of that box (e.g. one KPI cell);
 * "<beat>.<key>@right:<w>" is its rightmost w px (e.g. a row's status cell).
 */
function boxOf(takeName, page, ref) {
  if (Array.isArray(ref)) return ref;
  const match = /^(.*)\.([A-Za-z0-9_]+)(?:\/(\d+):(\d+)|@right:(\d+(?:\.\d+)?))?$/.exec(ref);
  if (!match) throw new Error(`bad box reference "${ref}"`);
  const [, beatName, key, parts, index, right] = match;
  const beat = findBeat(takeName, page, beatName);
  const box = beat.boxes[key];
  if (!box) throw new Error(`beat "${beatName}" has no box "${key}"`);
  if (parts) {
    const w = box.w / Number(parts);
    return [box.x + w * Number(index), box.y, w, box.h];
  }
  if (right) return [box.x + box.w - Number(right), box.y, Number(right), box.h];
  return [box.x, box.y, box.w, box.h];
}

const plan = {
  fps: FPS,
  width: script.width,
  height: script.height,
  cssScale: script.cssScale,
  repositoryUrl: script.repositoryUrl,
  footage: {},
  sections: [],
  durationInFrames: 0,
};

let cursorFrame = 0;
for (const section of script.sections) {
  const narration = timing.lines[section.narration];
  if (!narration) throw new Error(`no narration timing for ${section.narration}`);
  const speechStart = section.lead ?? 0;
  const target = speechStart + narration.duration + (section.tail ?? 0);
  const sentenceAt = (index, frac = 0) => {
    const s = narration.sentences[index];
    if (!s) throw new Error(`${section.id}: narration ${section.narration} has no sentence ${index}`);
    return speechStart + s.start + (s.end - s.start) * frac;
  };

  const out = {
    id: section.id,
    kind: section.kind,
    from: cursorFrame,
    tag: section.tag ?? null,
    narration: {
      file: `narration/${section.narration}.wav`,
      from: cursorFrame + f(speechStart),
      sentences: narration.sentences.map((s) => ({ text: s.text, from: cursorFrame + f(speechStart + s.start), to: cursorFrame + f(speechStart + s.end) })),
    },
    shots: [],
    zoom: [],
    boxes: [],
    columns: [],
    cursor: [],
    source: null,
    jumps: [],
  };

  let duration = target;
  if (section.kind === 'footage') {
    // 1 · shot timing: fixed rates first, then "fit" shots share what is left.
    const shots = section.shots.map((shot) => {
      const [takeName, page] = shot.src.split(':');
      const from = clipTime(takeName, page, shot.from);
      const to = clipTime(takeName, page, shot.to);
      if (to <= from) throw new Error(`${section.id}: shot ${shot.from} → ${shot.to} is empty`);
      return { ...shot, takeName, page, clipFrom: from, clipTo: to };
    });
    const fixed = shots.filter((s) => s.rate !== 'fit').reduce((sum, s) => sum + (s.clipTo - s.clipFrom) / s.rate, 0);
    const fits = shots.filter((s) => s.rate === 'fit');
    let start = 0;
    for (const shot of shots) {
      if (shot.rate === 'fit') {
        let length;
        if (shot.fitTo) length = Math.max(sentenceAt(shot.fitTo.sentence, shot.fitTo.frac ?? 0) - start, 1);
        else length = Math.max((target - fixed) / fits.length, 1);
        shot.rate = Math.max((shot.clipTo - shot.clipFrom) / length, 1);
      }
      shot.start = start;
      shot.length = (shot.clipTo - shot.clipFrom) / shot.rate;
      start += shot.length;
    }
    duration = Math.max(target, start);
    const toSection = (takeName, page, clipSeconds) => {
      for (const shot of shots) {
        if (shot.takeName === takeName && shot.page === page && clipSeconds >= shot.clipFrom - 1e-6 && clipSeconds <= shot.clipTo + 1e-6) {
          return shot.start + (clipSeconds - shot.clipFrom) / shot.rate;
        }
      }
      return null;
    };
    const when = (w) => {
      if (w.sentence !== undefined) return sentenceAt(w.sentence, w.frac ?? 0);
      if (w.shot !== undefined) return shots[w.shot].start + (w.at ?? 0);
      if (w.clip !== undefined) {
        const s = shots.find((shot) => {
          try {
            const c = clipTime(shot.takeName, shot.page, w.clip);
            return c >= shot.clipFrom - 1e-6 && c <= shot.clipTo + 1e-6;
          } catch {
            return false;
          }
        });
        if (!s) throw new Error(`${section.id}: ${w.clip} is not inside any shot`);
        return toSection(s.takeName, s.page, clipTime(s.takeName, s.page, w.clip));
      }
      throw new Error(`${section.id}: unknown time ${JSON.stringify(w)}`);
    };
    const main = shots[0];

    for (const shot of shots) {
      const key = `${shot.takeName}-${shot.page}`;
      plan.footage[key] = { take: script.takes[shot.takeName], page: shot.page };
      out.shots.push({
        file: `footage/${key}.mp4`,
        from: cursorFrame + f(shot.start),
        duration: Math.max(f(shot.length), 1),
        trimBefore: f(shot.clipFrom),
        rate: Number(shot.rate.toFixed(3)),
      });
      if (shot.jump) out.jumps.push({ at: cursorFrame + f(shot.start), text: shot.jump });
      // Cursor: every click inside this shot, travelling from its "cursor:" beat.
      for (const beat of take(shot.takeName).beats) {
        if (beat.page !== shot.page || !beat.name.startsWith('click:') || !beat.boxes.target) continue;
        const clickClip = beat.t - clipMeta(shot.takeName, shot.page).t0;
        if (clickClip < shot.clipFrom || clickClip > shot.clipTo) continue;
        const label = beat.name.slice('click:'.length);
        const moveBeat = take(shot.takeName).beats.find((b) => b.page === shot.page && b.name === `cursor:${label}`);
        const moveClip = moveBeat ? Math.max(moveBeat.t - clipMeta(shot.takeName, shot.page).t0, shot.clipFrom) : clickClip - 0.6;
        const box = beat.boxes.target;
        out.cursor.push({
          moveAt: cursorFrame + f(shot.start + (moveClip - shot.clipFrom) / shot.rate),
          clickAt: cursorFrame + f(shot.start + (clickClip - shot.clipFrom) / shot.rate),
          x: box.x + box.w / 2,
          y: box.y + box.h / 2,
        });
      }
    }
    // The last shot holds its final frame until the section ends.
    const last = out.shots[out.shots.length - 1];
    const sectionEnd = cursorFrame + f(duration);
    if (last.from + last.duration < sectionEnd) {
      out.hold = { from: last.from + last.duration, duration: sectionEnd - (last.from + last.duration), file: last.file, frame: last.trimBefore + Math.round(last.duration * last.rate) - 1 };
    }
    for (const z of section.zoom ?? []) {
      out.zoom.push({ at: cursorFrame + f(when(z.when)), box: boxOf(main.takeName, main.page, z.focus), scale: z.scale });
    }
    for (const b of section.boxes ?? []) {
      out.boxes.push({
        at: cursorFrame + f(when(b.when)),
        until: b.until ? cursorFrame + f(when(b.until)) : sectionEnd,
        box: boxOf(main.takeName, main.page, b.box),
        label: b.label ?? '',
        tone: b.tone,
        pad: b.pad ?? 8,
        style: b.style ?? 'box',
        // Label placement: "auto" (above, else below, else inside), "above", "below", "inside"
        // (labelX = left offset as a fraction of the box width), "inside-right", or labelPos =
        // [x, y] in CSS px of the page (left edge, vertical centre) when nothing else fits.
        labelAt: b.labelAt ?? 'auto',
        labelX: b.labelX ?? 0,
        labelPos: b.labelPos ?? null,
      });
    }
    if (section.columns) {
      const chain = boxOf(main.takeName, main.page, section.columnsFrom);
      const list = boxOf(main.takeName, main.page, section.columnsList ?? 'run-started.list');
      for (const c of section.columns) {
        const w = chain[2] / 4;
        out.columns.push({ at: cursorFrame + f(when(c.when)), until: sectionEnd, box: [chain[0] + w * c.index - 4, list[1] + 8, w + 8, list[3] - 16], label: c.label });
      }
    }
    if (section.source) out.source = { at: cursorFrame + f(when(section.source.when)), until: sectionEnd, text: section.source.text };
  } else if (section.kind === 'architecture') {
    // The diagram; keyAt is when the idempotency-key note appears.
    if (section.keyAt) out.keyAt = cursorFrame + f(sentenceAt(section.keyAt.sentence, section.keyAt.frac ?? 0));
  } else if (section.kind === 'fault') {
    // The fault take plays in an inset (cropped to `crop`, CSS px) next to the ledger trace;
    // it is sped up to fill the section.
    const s = section.faultShot;
    const [takeName, page] = s.src.split(':');
    const from = clipTime(takeName, page, s.from);
    const to = clipTime(takeName, page, s.to);
    const key = `${takeName}-${page}`;
    plan.footage[key] = { take: script.takes[takeName], page };
    const length = Math.max(duration - 0.4, 1);
    out.inset = { file: `footage/${key}.mp4`, from: cursorFrame, duration: f(length), trimBefore: f(from), rate: Number(Math.max((to - from) / length, 1).toFixed(3)) };
    out.hold = { from: cursorFrame + f(length), duration: f(duration) - f(length), file: `footage/${key}.mp4`, frame: f(from) + Math.round(f(length) * out.inset.rate) - 1 };
    out.crop = section.crop ?? [0, 0, script.width / script.cssScale, script.height / script.cssScale];
    out.title = section.title ?? '';
  }
  out.duration = f(duration);
  plan.sections.push(out);
  cursorFrame += out.duration;
}
plan.durationInFrames = cursorFrame;

const outDir = join(ROOT, 'video', 'src', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 1)}\n`);
for (const s of plan.sections) {
  const rates = s.shots.map((x) => `${x.rate}×`).join(' ');
  console.log(`${s.id.padEnd(9)} ${(s.from / FPS).toFixed(1).padStart(6)}s +${(s.duration / FPS).toFixed(1).padStart(5)}s ${rates}`);
}
console.log(`total ${(plan.durationInFrames / FPS).toFixed(2)}s (${plan.durationInFrames} frames)`);
