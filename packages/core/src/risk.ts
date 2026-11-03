// Deterministic risk detection. SPEC §6.2.3.
//
// Four flags, no model involved, no effect on the decision — the gate decides on its own.
// The flags exist so the UI and the model's risk note can say *why* something smells.
//
//   SENDER_DOMAIN_MISMATCH  vendor recognised, sender domain not in their knownDomains
//   LOOKALIKE_DOMAIN        sender domain unknown everywhere, but a first label matches a
//                           known one after normalisation (0→o 1→l 3→e 5→s rn→m vv→w) or
//                           is within Levenshtein distance 1 of it
//   INSTRUCTION_TO_AI       body or attachment text talks to an AI assistant
//   URGENCY                 whole word today / immediately / urgent / asap / right away

import type { RiskFlag, Vendor } from './types.js';

export interface RiskInput {
  senderEmail: string;
  /** The vendor O1 recognised, or null. */
  vendor: Vendor | null;
  body: string;
  attachmentText: string;
}

export interface RiskContext {
  vendors: Vendor[];
  /** The paying studio's own domain — an internal sender is never a lookalike. */
  payerDomain: string;
}

const INSTRUCTION_PHRASES = [
  'ai assistant',
  'note for the ai',
  'instructions for the ai',
  'ignore previous instructions',
  'ignore all previous',
  'you are an ai',
] as const;

const URGENCY_WORDS = /\b(?:today|immediately|urgent|asap|right away)\b/i;
const HOMOGLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/3/g, 'e'],
  [/5/g, 's'],
];

export function detectRisk(input: RiskInput, context: RiskContext): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const domain = domainOf(input.senderEmail);
  const knownVendorDomains = new Set(
    context.vendors.flatMap((vendor) => vendor.knownDomains).map((d) => d.trim().toLowerCase()),
  );
  const allKnownDomains = new Set([...knownVendorDomains, context.payerDomain.trim().toLowerCase()]);

  if (input.vendor && domain) {
    const own = new Set(input.vendor.knownDomains.map((d) => d.trim().toLowerCase()));
    if (!own.has(domain)) flags.push('SENDER_DOMAIN_MISMATCH');
  }

  if (domain && !allKnownDomains.has(domain)) {
    const label = normalizeLabel(firstLabel(domain));
    const looksAlike = [...allKnownDomains].some((known) => {
      const other = normalizeLabel(firstLabel(known));
      if (other === label) return true;
      return levenshteinWithin(other, label, 1);
    });
    if (looksAlike) flags.push('LOOKALIKE_DOMAIN');
  }

  const text = `${input.body}\n${input.attachmentText}`.toLowerCase();
  if (INSTRUCTION_PHRASES.some((phrase) => text.includes(phrase))) flags.push('INSTRUCTION_TO_AI');
  if (URGENCY_WORDS.test(text)) flags.push('URGENCY');

  return flags;
}

/** `Ana Ribeiro <billing@studi0-north.example>` → `studi0-north.example`. */
export function domainOf(address: string): string {
  const bracketed = /<([^<>]+)>/.exec(address);
  const email = (bracketed?.[1] ?? address).trim();
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

export function firstLabel(domain: string): string {
  const dot = domain.indexOf('.');
  return dot < 0 ? domain : domain.slice(0, dot);
}

/** Lowercase, drop hyphens, then fold the homoglyph pairs the SPEC names. */
export function normalizeLabel(label: string): string {
  let value = label.trim().toLowerCase().replace(/-/g, '');
  for (const [pattern, replacement] of HOMOGLYPHS) value = value.replace(pattern, replacement);
  return value;
}

/** Bounded Levenshtein: true when edit distance ≤ `max`. */
export function levenshteinWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return (previous[b.length] ?? 0) <= max;
}
