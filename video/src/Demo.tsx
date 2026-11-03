/**
 * The demo video: real-run footage cut by video/src/generated/plan.json (scripts/video/plan.mjs),
 * with the zooms, boxes, cursor and captions drawn on top. Colours and type come from
 * design/tokens.css (`fintech-precise`), the same preset as the product.
 */
import '../../design/tokens.css';
import React from 'react';
import { AbsoluteFill, Audio, Easing, Freeze, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import planJson from './generated/plan.json';
import faultJson from './generated/fault.json';

type Box4 = [number, number, number, number];
interface Shot { file: string; from: number; duration: number; trimBefore: number; rate: number }
interface Section {
  id: string;
  kind: 'footage' | 'title' | 'architecture' | 'fault' | 'end';
  from: number;
  duration: number;
  tag: string | null;
  narration: { file: string; from: number; sentences: { text: string; from: number; to: number }[] };
  shots: Shot[];
  hold?: { from: number; duration: number; file: string; frame: number };
  zoom: { at: number; box: Box4; scale: number }[];
  boxes: { at: number; until: number; box: Box4; label: string; tone: string; pad: number; style: 'box' | 'marker'; labelAt: string; labelX: number; labelPos: [number, number] | null }[];
  columns: { at: number; until: number; box: Box4; label: string }[];
  cursor: { moveAt: number; clickAt: number; x: number; y: number }[];
  source: { at: number; until: number; text: string } | null;
  jumps: { at: number; text: string }[];
  inset?: Shot;
  keyAt?: number;
  crop?: Box4;
  title?: string;
}
interface Plan { fps: number; width: number; height: number; cssScale: number; repositoryUrl: string; durationInFrames: number; sections: Section[] }

export const plan = planJson as unknown as Plan;
const fault = faultJson as { lines: { kind: string; text: string }[] };
const W = plan.width;
const H = plan.height;
const K = plan.cssScale;
export const FONT = '"Plus Jakarta Sans", sans-serif';
export const MONO = '"IBM Plex Mono", monospace';
const TONE: Record<string, string> = { danger: 'var(--danger)', warning: 'var(--warning)', success: 'var(--success)', neutral: 'var(--text)' };
const ease = Easing.bezier(0.45, 0, 0.2, 1);

// ------------------------------------------------------------------------------------ fonts
const FONTS: [string, string, string][] = [
  ['Plus Jakarta Sans', 'plus-jakarta-sans-latin-400-normal.woff2', '400'],
  ['Plus Jakarta Sans', 'plus-jakarta-sans-latin-500-normal.woff2', '500'],
  ['Plus Jakarta Sans', 'plus-jakarta-sans-latin-600-normal.woff2', '600'],
  ['Plus Jakarta Sans', 'plus-jakarta-sans-latin-700-normal.woff2', '700'],
  ['Plus Jakarta Sans', 'plus-jakarta-sans-latin-800-normal.woff2', '800'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', '400'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', '500'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-600-normal.woff2', '600'],
];
const fontHandle = typeof document !== 'undefined' ? delayRender('bundled fonts') : null;
if (typeof document !== 'undefined') {
  Promise.all(
    FONTS.map(([family, file, weight]) => new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight }).load().then((face) => (document.fonts as unknown as { add(f: FontFace): void }).add(face))),
  ).then(() => fontHandle !== null && continueRender(fontHandle));
}

// ------------------------------------------------------------------------------------ camera
interface Cam { cx: number; cy: number; s: number }
function camOf(box: Box4, s: number): Cam {
  const cx = (box[0] + box[2] / 2) * K;
  const cy = (box[1] + box[3] / 2) * K;
  const halfW = W / (2 * s);
  const halfH = H / (2 * s);
  return { cx: Math.min(Math.max(cx, halfW), W - halfW), cy: Math.min(Math.max(cy, halfH), H - halfH), s };
}
function camAt(section: Section, frame: number): Cam {
  const keys = section.zoom;
  if (keys.length === 0) return { cx: W / 2, cy: H / 2, s: 1 };
  let cam = camOf(keys[0].box, keys[0].scale);
  for (let i = 1; i < keys.length; i += 1) {
    if (frame < keys[i].at) break;
    const p = ease(Math.min(Math.max((frame - keys[i].at) / 20, 0), 1));
    const next = camOf(keys[i].box, keys[i].scale);
    cam = { cx: cam.cx + (next.cx - cam.cx) * p, cy: cam.cy + (next.cy - cam.cy) * p, s: cam.s + (next.s - cam.s) * p };
  }
  return cam;
}
/** CSS-px box on the page → screen rectangle after the camera. */
function onScreen(box: Box4, cam: Cam, pad = 0): { x: number; y: number; w: number; h: number } {
  const x = (box[0] - pad) * K;
  const y = (box[1] - pad) * K;
  return { x: (x - cam.cx) * cam.s + W / 2, y: (y - cam.cy) * cam.s + H / 2, w: (box[2] + pad * 2) * K * cam.s, h: (box[3] + pad * 2) * K * cam.s };
}

// ------------------------------------------------------------------------------------ pieces
function Pill({ children, dark = true, style }: { children: React.ReactNode; dark?: boolean; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        borderRadius: 999,
        background: dark ? 'rgba(10, 14, 23, 0.88)' : 'rgba(255, 255, 255, 0.94)',
        color: dark ? '#FFFFFF' : 'var(--text)',
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: 24,
        letterSpacing: '0.01em',
        boxShadow: 'var(--shadow-2)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Footage({ section, frame }: { section: Section; frame: number }) {
  const cam = camAt(section, frame);
  const transform = `translate(${W / 2}px, ${H / 2}px) scale(${cam.s}) translate(${-cam.cx}px, ${-cam.cy}px)`;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
      <AbsoluteFill style={{ transform, transformOrigin: '0 0' }}>
        {section.shots.map((shot) => (
          <Sequence key={`${shot.from}`} from={shot.from - section.from} durationInFrames={shot.duration} layout="none">
            <OffthreadVideo src={staticFile(shot.file)} trimBefore={shot.trimBefore} playbackRate={shot.rate} muted style={{ width: W, height: H, position: 'absolute' }} />
          </Sequence>
        ))}
        {section.hold ? (
          <Sequence from={section.hold.from - section.from} durationInFrames={section.hold.duration} layout="none">
            <Freeze frame={0}>
              <OffthreadVideo src={staticFile(section.hold.file)} trimBefore={section.hold.frame} muted style={{ width: W, height: H, position: 'absolute' }} />
            </Freeze>
          </Sequence>
        ) : null}
      </AbsoluteFill>
      <Columns section={section} frame={frame} cam={cam} />
      <Boxes section={section} frame={frame} cam={cam} />
      <Cursor section={section} frame={frame} cam={cam} />
    </AbsoluteFill>
  );
}

const LABEL_H = 54;
const labelWidth = (text: string) => Math.round(text.length * 30 * 0.56 + 34);
const MARKER: Record<string, string> = { warning: 'rgba(180, 83, 9, 0.16)', danger: 'rgba(192, 38, 45, 0.14)', success: 'rgba(18, 117, 58, 0.14)', neutral: 'rgba(10, 14, 23, 0.08)' };

function Boxes({ section, frame, cam }: { section: Section; frame: number; cam: Cam }) {
  return (
    <>
      {section.boxes.map((b, i) => {
        if (frame < b.at || frame >= b.until) return null;
        const appear = ease(Math.min((frame - b.at) / 8, 1));
        const r = onScreen(b.box, cam, b.pad);
        const color = TONE[b.tone] ?? 'var(--danger)';
        if (b.style === 'marker') {
          // A highlighter stroke that wipes in from the left, with an underline in the tone colour.
          return (
            <div key={i} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w * appear, height: r.h, borderRadius: 6, background: MARKER[b.tone] ?? MARKER.warning, borderBottom: `5px solid ${color}` }} />
          );
        }
        const lw = labelWidth(b.label);
        let lx = r.x - 2;
        let ly: number;
        let mode = b.labelPos ? 'pos' : b.labelAt;
        if (mode === 'auto') mode = r.y - 12 - LABEL_H >= 100 ? 'above' : r.y + r.h + 12 + LABEL_H <= 900 ? 'below' : 'inside';
        if (mode === 'above') ly = r.y - 12 - LABEL_H;
        else if (mode === 'below') ly = r.y + r.h + 12;
        else if (mode === 'inside-right') {
          lx = r.x + r.w - 16 - lw;
          ly = r.y + 16;
        } else if (mode === 'pos' && b.labelPos) {
          const p = onScreen([b.labelPos[0], b.labelPos[1], 0, 0], cam);
          lx = p.x;
          ly = p.y - LABEL_H / 2;
        } else {
          lx = r.x + 16 + r.w * b.labelX;
          ly = r.h < LABEL_H * 2 ? r.y + (r.h - LABEL_H) / 2 : r.y + 16;
        }
        // Keep every label on screen.
        lx = Math.min(Math.max(lx, 24), W - 24 - lw);
        ly = Math.min(Math.max(ly, 24), H - 24 - LABEL_H);
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, opacity: appear, border: `5px solid ${color}`, borderRadius: 14, boxShadow: '0 0 0 4px rgba(255,255,255,0.65)', transform: `scale(${0.96 + 0.04 * appear})` }} />
            {b.label ? (
              <div
                style={{
                  position: 'absolute',
                  left: lx,
                  top: ly,
                  height: LABEL_H,
                  display: 'flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  padding: '0 17px',
                  borderRadius: 10,
                  background: color,
                  color: '#FFFFFF',
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: 30,
                  boxShadow: 'var(--shadow-2)',
                  opacity: appear,
                }}
              >
                {b.label}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

function Columns({ section, frame, cam }: { section: Section; frame: number; cam: Cam }) {
  const shown = section.columns.filter((c) => frame >= c.at && frame < c.until);
  return (
    <>
      {shown.map((c, i) => {
        const latest = i === shown.length - 1;
        const appear = ease(Math.min((frame - c.at) / 8, 1));
        const r = onScreen(c.box, cam);
        return (
          <div key={c.label} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, opacity: appear }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: 16, border: `4px solid ${latest ? 'var(--success)' : 'rgba(18, 117, 58, 0.45)'}`, background: latest ? 'rgba(18, 117, 58, 0.10)' : 'rgba(18, 117, 58, 0.04)' }} />
            <div style={{ position: 'absolute', top: -58, left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', borderRadius: 999, background: latest ? 'var(--success)' : 'rgba(18, 117, 58, 0.7)', color: '#FFFFFF', fontFamily: FONT, fontWeight: 800, fontSize: 28, whiteSpace: 'nowrap' }}>
              {c.label}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Arrow({ x, y, scale = 1, pressed = 0 }: { x: number; y: number; scale?: number; pressed?: number }) {
  return (
    <svg width={44} height={56} viewBox="0 0 22 28" style={{ position: 'absolute', left: x - 3, top: y - 2, transform: `scale(${scale * (1 - 0.12 * pressed)})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgba(10,14,23,0.35))' }}>
      <path d="M2 1.5 L2 22 L7.4 16.9 L11.2 25.4 L14.6 23.9 L10.9 15.6 L18.2 15.4 Z" fill="#FFFFFF" stroke="#0A0E17" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Cursor({ section, frame, cam }: { section: Section; frame: number; cam: Cam }) {
  const moves = section.cursor;
  if (moves.length === 0 || frame < moves[0].moveAt - 10) return null;
  let px = moves[0].x + 140;
  let py = moves[0].y + 110;
  let ripple: number | null = null;
  let pressed = 0;
  for (const m of moves) {
    if (frame < m.moveAt) break;
    const p = ease(Math.min((frame - m.moveAt) / Math.max(m.clickAt - m.moveAt, 6), 1));
    px += (m.x - px) * p;
    py += (m.y - py) * p;
    if (frame >= m.clickAt && frame < m.clickAt + 16) {
      ripple = (frame - m.clickAt) / 16;
      pressed = frame < m.clickAt + 5 ? 1 : 0;
    }
  }
  const r = onScreen([px, py, 0, 0], cam);
  const appear = Math.min((frame - (moves[0].moveAt - 10)) / 8, 1);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: appear }}>
      {ripple !== null ? (
        <div style={{ position: 'absolute', left: r.x - 36 * (0.4 + ripple), top: r.y - 36 * (0.4 + ripple), width: 72 * (0.4 + ripple), height: 72 * (0.4 + ripple), borderRadius: '50%', border: '5px solid var(--accent-text)', opacity: 1 - ripple }} />
      ) : null}
      <Arrow x={r.x} y={r.y} pressed={pressed} />
    </div>
  );
}

function Overlays({ section, frame }: { section: Section; frame: number }) {
  const shot = section.shots.find((s) => frame >= s.from && frame < s.from + s.duration);
  const speed = shot && shot.rate >= 1.5 ? `${Number.isInteger(shot.rate) ? shot.rate : shot.rate.toFixed(1)}× speed` : null;
  const jump = section.jumps.find((j) => frame >= j.at && frame < j.at + 45);
  const source = section.source && frame >= section.source.at && frame < section.source.until ? section.source : null;
  const isComparison = section.id === 'cold';
  return (
    <>
      <div style={{ position: 'absolute', left: 36, top: 30, display: 'flex', gap: 12, alignItems: 'center' }}>
        {section.tag ? (
          <Pill>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: isComparison ? 'var(--danger)' : 'var(--success)', boxShadow: '0 0 0 4px rgba(255,255,255,0.18)' }} />
            {section.tag}
          </Pill>
        ) : null}
        {speed ? <Pill>{speed}</Pill> : null}
        {jump ? <Pill style={{ opacity: Math.min((frame - jump.at) / 6, 1) }}>{`${jump.text} later`}</Pill> : null}
      </div>
      {source ? (
        <div style={{ position: 'absolute', right: 36, top: 30 }}>
          <Pill dark={false} style={{ maxWidth: 760, fontSize: 22, fontWeight: 600, borderRadius: 16, lineHeight: 1.3, opacity: Math.min((frame - source.at) / 8, 1) }}>
            <span style={{ fontWeight: 800 }}>Source</span>
            <span>{source.text}</span>
          </Pill>
        </div>
      ) : null}
    </>
  );
}

function Captions({ frame }: { frame: number }) {
  for (const section of plan.sections) {
    if (section.kind === 'title' || section.kind === 'end') continue;
    const list = section.narration.sentences;
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      const until = Math.min(i + 1 < list.length ? list[i + 1].from : s.to + 18, section.from + section.duration);
      if (frame >= s.from && frame < until) {
        return (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 52, display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 1480, padding: '16px 30px 18px', borderRadius: 16, background: 'rgba(10, 14, 23, 0.86)', color: '#FFFFFF', fontFamily: FONT, fontWeight: 600, fontSize: 42, lineHeight: 1.28, textAlign: 'center', letterSpacing: '-0.005em' }}>
              {s.text}
            </div>
          </div>
        );
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------ cards
export function Mark({ size, inverted = false }: { size: number; inverted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill={inverted ? '#FFFFFF' : '#0A0E17'} />
      <path d="M9.5 16.6l4.2 4.2 8.8-9.6" fill="none" stroke={inverted ? '#0A0E17' : '#FFFFFF'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STAMPS = ['Owed', 'Payee', 'Policy', 'PayPal'];
export function StampRow({ local, start, size = 64, dark = true }: { local: number; start: number; size?: number; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {STAMPS.map((label, i) => {
        const on = local >= start + i * 9;
        const pop = on ? ease(Math.min((local - start - i * 9) / 7, 1)) : 0;
        return (
          <React.Fragment key={label}>
            {i > 0 ? <div style={{ width: size * 1.6, height: 3, marginTop: size / 2 - 1.5, background: on ? 'var(--success)' : dark ? 'rgba(255,255,255,0.25)' : 'var(--border)' }} /> : null}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `scale(${0.9 + 0.1 * pop})` }}>
                {on ? (
                  <>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="var(--success)" strokeWidth="1.8" />
                    <path d="M7.5 12.3l3 3 6-6.4" fill="none" stroke="var(--success)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                ) : (
                  <circle cx="12" cy="12" r="10" fill="none" stroke={dark ? 'rgba(255,255,255,0.45)' : 'var(--text-muted)'} strokeWidth="1.6" strokeDasharray="3 3" />
                )}
              </svg>
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: size * 0.42, color: dark ? (on ? '#FFFFFF' : 'rgba(255,255,255,0.55)') : 'var(--text)' }}>{label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Fade({ section, frame, children }: { section: Section; frame: number; children: React.ReactNode }) {
  const local = frame - section.from;
  const opacity = interpolate(local, [0, 8, section.duration - 8, section.duration], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function TitleCard({ section, frame }: { section: Section; frame: number }) {
  const local = frame - section.from;
  return (
    <AbsoluteFill style={{ background: 'var(--accent)', justifyContent: 'center', alignItems: 'center' }}>
      <Fade section={section} frame={frame}>
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <Mark size={128} inverted />
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 150, color: '#FFFFFF', letterSpacing: '-0.035em', lineHeight: 1 }}>Proof Before Pay</div>
          </div>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 64, color: 'rgba(255,255,255,0.78)', letterSpacing: '-0.01em' }}>No proof, no payout.</div>
          <div style={{ marginTop: 40 }}>
            <StampRow local={local} start={20} />
          </div>
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
}

function EndCard({ section, frame }: { section: Section; frame: number }) {
  const local = frame - section.from;
  const url = plan.repositoryUrl.replace(/^https?:\/\//, '');
  return (
    <AbsoluteFill style={{ background: 'var(--accent)' }}>
      <Fade section={section} frame={frame}>
        <AbsoluteFill style={{ justifyContent: 'center', padding: '0 180px', gap: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <Mark size={104} inverted />
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 124, color: '#FFFFFF', letterSpacing: '-0.035em', lineHeight: 1 }}>Proof Before Pay</div>
          </div>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 58, color: 'rgba(255,255,255,0.8)' }}>No proof, no payout.</div>
          <div style={{ marginTop: 28 }}>
            <StampRow local={local} start={8} size={52} />
          </div>
          <div style={{ marginTop: 40, display: 'inline-flex', alignSelf: 'flex-start', padding: '18px 28px', borderRadius: 16, background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.18)', fontFamily: MONO, fontWeight: 500, fontSize: 44, color: '#FFFFFF' }}>{url}</div>
          <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 32, color: 'rgba(255,255,255,0.66)', lineHeight: 1.45 }}>
            Built on the PayPal Payouts API (sandbox) and any OpenAI-compatible model.
            <br />
            Every product shot in this video is a real run in the PayPal sandbox. MIT licensed.
          </div>
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
}

function Node({ title, lines, dark = false, ai = false, delay, local, w = 300, highlight = 0 }: { title: string; lines: string[]; dark?: boolean; ai?: boolean; delay: number; local: number; w?: number; highlight?: number }) {
  const appear = ease(Math.min(Math.max((local - delay) / 10, 0), 1));
  return (
    <div style={{ width: w, padding: '26px 28px', borderRadius: 20, background: dark ? 'var(--accent)' : 'var(--surface)', color: dark ? '#FFFFFF' : 'var(--text)', boxShadow: highlight > 0 ? `0 0 0 ${5 * highlight}px var(--success), var(--shadow-2)` : 'var(--shadow-2)', border: dark ? 'none' : '2px solid var(--border)', opacity: appear, transform: `translateY(${(1 - appear) * 16}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT, fontWeight: 800, fontSize: 36, letterSpacing: '-0.01em' }}>
        {title}
        {ai ? <span style={{ fontSize: 20, fontWeight: 700, padding: '3px 10px', borderRadius: 8, border: '2px solid var(--border)', color: 'var(--text-muted)' }}>AI</span> : null}
      </div>
      {lines.map((line) => (
        <div key={line} style={{ marginTop: 8, fontFamily: FONT, fontWeight: 500, fontSize: 25, lineHeight: 1.3, color: dark ? 'rgba(255,255,255,0.78)' : 'var(--text-muted)' }}>{line}</div>
      ))}
    </div>
  );
}

function Link({ label, local, delay }: { label: string; local: number; delay: number }) {
  const appear = ease(Math.min(Math.max((local - delay) / 10, 0), 1));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 96, opacity: appear }}>
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: 'var(--text-muted)', marginBottom: 6, whiteSpace: 'nowrap' }}>{label}</span>
      <svg width="76" height="20" viewBox="0 0 76 20"><path d="M2 10 H66 M58 3 L70 10 L58 17" fill="none" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}

function ArchitectureCard({ section, frame }: { section: Section; frame: number }) {
  const local = frame - section.from;
  const keyLocal = section.keyAt !== undefined ? section.keyAt - section.from : Infinity;
  const keyIn = ease(Math.min(Math.max((local - keyLocal) / 12, 0), 1));
  const keyLine = fault.lines.find((line) => /attempt 1/.test(line.text));
  const key = keyLine ? (/key (\S+)/.exec(keyLine.text)?.[1] ?? '') : '';
  return (
    <AbsoluteFill style={{ background: 'var(--bg)' }}>
      <Fade section={section} frame={frame}>
        <div style={{ position: 'absolute', left: 120, top: 92, fontFamily: FONT, fontWeight: 800, fontSize: 68, letterSpacing: '-0.03em', color: 'var(--text)' }}>
          The LLM proposes. The gate disposes.
        </div>
        <div style={{ position: 'absolute', left: 120, top: 250 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Node title="Inbox" lines={['emails + PDF invoices']} delay={4} local={local} w={250} />
            <Link label="read" local={local} delay={10} />
            <Node title="AI" ai lines={['reads, matches,', 'explains', 'any OpenAI-compatible model']} delay={12} local={local} w={310} />
            <Link label="proposal" local={local} delay={18} />
            <Node title="Proof gate" dark lines={['deterministic code', 'Owed · Payee · Policy']} delay={20} local={local} w={320} />
            <Link label="approved" local={local} delay={26} />
            <Node title="PayPal Payouts" lines={['sandbox', 'one batch per invoice key']} delay={28} local={local} w={330} highlight={keyIn} />
          </div>
          <div style={{ display: 'flex', marginTop: 54, marginLeft: 346, gap: 60, alignItems: 'flex-start' }}>
            <Node title="Human review" lines={['held → verified', 'or rejected']} delay={34} local={local} w={340} />
            <Node title="Receipt check" lines={['GET status: SUCCESS', '+ transaction id = proven']} delay={38} local={local} w={360} />
            <Node title="Ledger" lines={['append-only,', 'hash-chained']} delay={42} local={local} w={260} />
          </div>
        </div>
        {keyIn > 0 ? (
          <div style={{ position: 'absolute', left: 120, top: 836, display: 'flex', alignItems: 'center', gap: 20, opacity: keyIn, transform: `translateY(${(1 - keyIn) * 12}px)` }}>
            <Pill dark={false} style={{ fontSize: 30, padding: '14px 26px', border: '2px solid var(--border)', boxShadow: 'none' }}>Same invoice</Pill>
            <Arrowhead />
            <Pill dark={false} style={{ fontSize: 30, padding: '14px 26px', border: '2px solid var(--border)', boxShadow: 'none' }}>
              same key <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 28 }}>{key}</span>
            </Pill>
            <Arrowhead />
            <Pill style={{ fontSize: 30, padding: '14px 26px', background: 'var(--success)' }}>PayPal pays once</Pill>
          </div>
        ) : null}
      </Fade>
    </AbsoluteFill>
  );
}

function Arrowhead() {
  return (
    <svg width="56" height="20" viewBox="0 0 56 20">
      <path d="M2 10 H46 M38 3 L50 10 L38 17" fill="none" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The fault drill: the real run (cropped) next to the ledger trace and PayPal's own answer. */
function FaultCard({ section, frame }: { section: Section; frame: number }) {
  const local = frame - section.from;
  const inset = section.inset;
  const crop = section.crop ?? [0, 0, W / K, H / K];
  const insetW = 740;
  const s = insetW / (crop[2] * K);
  const insetH = Math.round(crop[3] * K * s);
  const video = { width: W, height: H, position: 'absolute' as const, left: 0, top: 0 };
  const rate = inset ? inset.rate : 1;
  const step = Math.max(Math.floor((section.duration * 0.55) / Math.max(fault.lines.length, 1)), 4);
  return (
    <AbsoluteFill style={{ background: 'var(--bg)' }}>
      <Fade section={section} frame={frame}>
        <div style={{ position: 'absolute', left: 120, top: 78, fontFamily: FONT, fontWeight: 800, fontSize: 68, letterSpacing: '-0.03em', color: 'var(--text)' }}>{section.title}</div>
        <div style={{ position: 'absolute', left: 120, top: 196, width: insetW, height: insetH, borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow-2)', border: '2px solid var(--border)', background: 'var(--bg)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${s}) translate(${-crop[0] * K}px, ${-crop[1] * K}px)`, transformOrigin: '0 0' }}>
            {inset ? (
              <Sequence from={inset.from - section.from} durationInFrames={inset.duration} layout="none">
                <OffthreadVideo src={staticFile(inset.file)} trimBefore={inset.trimBefore} playbackRate={inset.rate} muted style={video} />
              </Sequence>
            ) : null}
            {section.hold ? (
              <Sequence from={section.hold.from - section.from} durationInFrames={section.hold.duration} layout="none">
                <Freeze frame={0}>
                  <OffthreadVideo src={staticFile(section.hold.file)} trimBefore={section.hold.frame} muted style={video} />
                </Freeze>
              </Sequence>
            ) : null}
          </div>
          <div style={{ position: 'absolute', left: 18, bottom: 18, display: 'flex', gap: 10 }}>
            <Pill style={{ fontSize: 22, padding: '8px 16px' }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: 'var(--success)' }} />
              Real run · PayPal sandbox
            </Pill>
            <Pill style={{ fontSize: 22, padding: '8px 16px' }}>{`${rate.toFixed(1)}× speed`}</Pill>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 900, top: 196, width: 900, padding: '28px 30px', borderRadius: 18, background: '#0A0E17', boxShadow: 'var(--shadow-2)' }}>
          {fault.lines.map((line, i) => {
            const show = local >= 6 + i * step;
            const color = line.kind === 'cmd' ? '#8FB4FF' : line.kind === 'note' ? '#8A93A6' : line.kind === 'warn' ? '#F5B969' : line.kind === 'ok' ? '#6BD69A' : '#E8EDF4';
            return (
              <div key={i} style={{ fontFamily: MONO, fontWeight: line.kind === 'cmd' ? 600 : 400, fontSize: 23, lineHeight: 1.5, color, opacity: show ? 1 : 0, whiteSpace: 'pre-wrap', paddingLeft: '2ch', textIndent: '-2ch' }}>
                {line.text}
              </div>
            );
          })}
        </div>
      </Fade>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------------------------ root
export function Demo() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill data-theme="fintech-precise" style={{ backgroundColor: 'var(--bg)', fontFamily: FONT }}>
      {plan.sections.map((section) => (
        <Sequence key={section.id} from={section.from} durationInFrames={section.duration} name={section.id} layout="none">
          <AbsoluteFill>
            {section.kind === 'footage' ? <Footage section={section} frame={frame} /> : null}
            {section.kind === 'title' ? <TitleCard section={section} frame={frame} /> : null}
            {section.kind === 'end' ? <EndCard section={section} frame={frame} /> : null}
            {section.kind === 'architecture' ? <ArchitectureCard section={section} frame={frame} /> : null}
            {section.kind === 'fault' ? <FaultCard section={section} frame={frame} /> : null}
            {section.kind === 'footage' ? <Overlays section={section} frame={frame} /> : null}
          </AbsoluteFill>
        </Sequence>
      ))}
      {plan.sections.map((section) => (
        <Sequence key={`${section.id}-vo`} from={section.narration.from} name={`${section.id} narration`} layout="none">
          <Audio src={staticFile(section.narration.file)} />
        </Sequence>
      ))}
      <Captions frame={frame} />
    </AbsoluteFill>
  );
}
