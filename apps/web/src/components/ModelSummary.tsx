/**
 * The comparison agent's closing note, printed **verbatim** (SPEC AC-14) but laid out as a quote
 * (07-UI §4.7). The model answers in Markdown — headings, bullets, a table, **bold** — and the
 * screen used to print the asterisks and pipes raw. Nothing here rewrites a word: the same text
 * is parsed into blocks so the reader sees a quote, not source code.
 */
import type { ReactNode } from 'react';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

/** Markdown in, blocks out. Only the constructs this one model actually writes. */
export function parseSummary(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list });
    list = [];
  };
  const flushTable = () => {
    if (table.length === 0) return;
    const [head, ...rows] = table;
    blocks.push({ kind: 'table', head: head ?? [], rows });
    table = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
      continue;
    }
    if (/^\|/.test(line.trim())) {
      flushParagraph();
      flushList();
      const cells = splitRow(line);
      // The `| --- | --- |` rule under the header is layout, not content.
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      table.push(cells);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushTable();
      list.push(bullet[1] ?? "");
      continue;
    }
    flushList();
    flushTable();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** **bold** and `code` only; everything else is printed as written. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) out.push(text.slice(index, start));
    const token = match[0];
    if (token.startsWith('**')) out.push(<strong key={start}>{token.slice(2, -2)}</strong>);
    else out.push(<code key={start}>{token.slice(1, -1)}</code>);
    index = start + token.length;
  }
  if (index < text.length) out.push(text.slice(index));
  return out;
}

export function ModelSummary({ text }: { text: string }) {
  return (
    <blockquote className="quote">
      {parseSummary(text).map((block, index) => {
        if (block.kind === 'heading') {
          const Tag = block.level <= 2 ? 'h3' : 'h4';
          return (
            <Tag className={`quote-heading quote-heading--${block.level <= 2 ? 'major' : 'minor'}`} key={index}>
              {inline(block.text)}
            </Tag>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul className="quote-list" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'table') {
          return (
            <table className="quote-table" key={index}>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex}>{inline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return (
          <p className="quote-text" key={index}>
            {inline(block.text)}
          </p>
        );
      })}
    </blockquote>
  );
}
