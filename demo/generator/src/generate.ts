import { parseArgs } from 'node:util';
import { generateDataset, repositoryRoot } from './dataset.js';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    root: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const repoRoot = values.root ?? repositoryRoot();
const outDir = values.out ?? repoRoot;

const files = await generateDataset({ root: repoRoot, outDir });

if (!values.quiet) {
  for (const file of files) {
    console.log(`${file.sha256.slice(0, 12)}  ${String(file.bytes).padStart(7)}  ${file.relPath}`);
  }
  const emails = files.filter((f) => f.relPath.endsWith('.json')).length;
  const pdfs = files.filter((f) => f.relPath.endsWith('.pdf')).length;
  console.log(`\n${emails} email JSON + ${pdfs} PDF written under ${outDir}`);
}
