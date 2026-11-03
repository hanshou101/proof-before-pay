/**
 * Devpost cover (3:2, 1500×1000): the product name, the promise, and one real moment from the
 * recorded run. The panel image is a DPR-2 capture of the real app (scripts/video/cover.mjs
 * stages it from design/sample-cover/assets/). Colours and type come from design/tokens.css.
 *
 * variant "story": Ana's held payment, the zero boxed. variant "stamps": the four proofs.
 */
import '../../design/tokens.css';
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { FONT, Mark, StampRow } from './Demo';

// Ana's panel at the sel-in04 beat, in CSS px of the panel (448 × 507). Crop: head + payee check.
const PANEL = { w: 448, cropH: 215, zero: [185, 175, 10, 21] as const, addressEnd: 329 };

function Story() {
  const width = 1180;
  const k = width / PANEL.w;
  const pad = 3;
  const [zx, zy, zw, zh] = PANEL.zero;
  return (
    <AbsoluteFill style={{ background: 'var(--accent)', alignItems: 'center' }}>
      <div style={{ position: 'absolute', top: 70, display: 'flex', alignItems: 'center', gap: 28 }}>
        <Mark size={88} inverted />
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 104, color: '#FFFFFF', letterSpacing: '-0.035em', lineHeight: 1 }}>Proof Before Pay</div>
      </div>
      <div style={{ position: 'absolute', top: 196, fontFamily: FONT, fontWeight: 600, fontSize: 50, color: 'rgba(255,255,255,0.78)', letterSpacing: '-0.01em' }}>No proof, no payout.</div>
      <div style={{ position: 'absolute', top: 300, left: (1500 - width) / 2, width, height: PANEL.cropH * k, borderRadius: 26, overflow: 'hidden', background: '#FFFFFF', boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }}>
        <Img src={staticFile('cover/panel-ana@2x.png')} style={{ position: 'absolute', left: 0, top: 0, width }} />
        <div style={{ position: 'absolute', left: (zx - pad) * k, top: (zy - pad) * k, width: (zw + pad * 2) * k, height: (zh + pad * 2) * k, border: '6px solid var(--danger)', borderRadius: 14, boxShadow: '0 0 0 5px rgba(255,255,255,0.8)' }} />
        <div style={{ position: 'absolute', left: (PANEL.addressEnd + 10) * k, top: (zy + zh / 2) * k - 32, height: 64, display: 'flex', alignItems: 'center', padding: '0 22px', borderRadius: 12, background: 'var(--danger)', color: '#FFFFFF', fontFamily: FONT, fontWeight: 800, fontSize: 38 }}>0, not o</div>
      </div>
      <div style={{ position: 'absolute', top: 896, fontFamily: FONT, fontWeight: 700, fontSize: 42, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
        One character, $2,400 — held before a cent moved.
      </div>
    </AbsoluteFill>
  );
}

function Stamps() {
  return (
    <AbsoluteFill style={{ background: 'var(--accent)', justifyContent: 'center', alignItems: 'center', gap: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
        <Mark size={120} inverted />
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 136, color: '#FFFFFF', letterSpacing: '-0.035em', lineHeight: 1 }}>Proof Before Pay</div>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 64, color: 'rgba(255,255,255,0.8)', letterSpacing: '-0.01em' }}>No proof, no payout.</div>
      <div style={{ marginTop: 40 }}>
        <StampRow local={999} start={0} size={112} />
      </div>
      <div style={{ marginTop: 54, fontFamily: FONT, fontWeight: 600, fontSize: 36, color: 'rgba(255,255,255,0.7)' }}>An AI drafts every payout. Code checks four proofs before money moves.</div>
    </AbsoluteFill>
  );
}

export function Cover({ variant }: { variant: 'story' | 'stamps' }) {
  return (
    <AbsoluteFill data-theme="fintech-precise" style={{ fontFamily: FONT }}>
      {variant === 'stamps' ? <Stamps /> : <Story />}
    </AbsoluteFill>
  );
}
