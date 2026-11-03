/**
 * "No bare values" scan for apps/web/src (T4 acceptance).
 *
 * The UI may only use design/tokens.css variables for colour, type and spacing:
 *   - no literal colours (#rgb / #rrggbb / #rrggbbaa) in .css/.ts/.tsx
 *   - no px font sizes in .css and no numeric fontSize in .tsx
 *   - no px values in the spacing properties go through --sp-* (checked by hand
 *     in docs/process/T4.md; this script covers the two machine-checkable rules)
 *
 * Anything that has to break the rule must be listed in ALLOW below with the
 * reason, so the next reader knows why it is there.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../src');

/**
 * Each entry exempts one file from one rule, with the reason. Empty today: the
 * app has no bare values. If one is ever needed, add { file, rule, reason }.
 */
const ALLOW = [];

const RULES = [
  {
    name: 'hex-colour',
    files: /\.(css|ts|tsx)$/,
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: 'px-font-size',
    files: /\.css$/,
    pattern: /font-size\s*:\s*[\d.]+px/g,
  },
  {
    name: 'numeric-font-size',
    files: /\.tsx$/,
    pattern: /fontSize\s*:\s*['"]?[\d.]+(px)?['"]?/g,
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(srcDir);
const violations = [];

for (const file of files) {
  const relative = path.relative(path.resolve(here, '..'), file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(relative)) continue;
    const allowed = ALLOW.some((entry) => entry.file === relative && entry.rule === rule.name);
    if (allowed) continue;
    for (const [index, line] of lines.entries()) {
      const matches = line.match(rule.pattern);
      if (!matches) continue;
      for (const match of matches) {
        violations.push(`${relative}:${index + 1}  ${rule.name}  ${match.trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Bare values found (use design/tokens.css variables):');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`scan-tokens: ${files.length} files clean (no hex colours, no px font sizes)`);
