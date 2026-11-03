import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repositoryRoot } from './dataset.js';

/**
 * Renders page 1 of every invoice PDF to a 1240px-wide PNG for the design review
 * (proof/dataset/). Needs `pdftoppm` from Poppler on PATH; this is a local proof
 * helper, not part of the deterministic dataset, so it is not run by verify.sh.
 */
const run = promisify(execFile);
const root = repositoryRoot();
const pdfDir = join(root, 'demo', 'inbox', 'files');
const outDir = join(root, 'proof', 'dataset');

const PDFS = [
  'Nair-Words-INV-2026-118.pdf',
  'kenji-INV-0153.pdf',
  'kenji-INV-0142.pdf',
  'StudioNorth-INV-2207.pdf',
  'Polyform3D-INV-031.pdf',
  'BergAudio-INV-001.pdf',
  'HerreraWeb-INV-77.pdf',
];

function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

await mkdir(outDir, { recursive: true });

try {
  await run('pdftoppm', ['-v'], { timeout: 30_000 });
} catch {
  throw new Error('pdftoppm not found on PATH — install Poppler (e.g. `brew install poppler`) to render proof PNGs');
}

const present = new Set(await readdir(pdfDir));
for (const name of PDFS) {
  if (!present.has(name)) throw new Error(`${name} is missing from demo/inbox/files`);
}

for (const name of PDFS) {
  const stem = name.replace(/\.pdf$/, '');
  const target = join(outDir, stem);
  await run(
    'pdftoppm',
    ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', '1240', '-scale-to-y', '-1', join(pdfDir, name), target],
    { timeout: 120_000 },
  );
  const png = await readFile(`${target}.png`);
  const { width, height } = pngSize(png);
  if (width !== 1240) throw new Error(`${stem}.png is ${width}px wide, expected 1240`);
  console.log(`${String(width).padStart(5)}x${String(height).padEnd(5)} ${(png.byteLength / 1024).toFixed(0)}kB  proof/dataset/${stem}.png`);
}
