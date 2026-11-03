import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb, RGB } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A4, portrait. One page size for every invoice (SPEC §6.4 / AC-6). */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 56;
export const RIGHT = PAGE_WIDTH - MARGIN;

export const ink = rgb(0.075, 0.075, 0.075);
export const muted = rgb(0.36, 0.36, 0.36);
export const faint = rgb(0.55, 0.55, 0.55);
export const ruleDark = rgb(0.13, 0.13, 0.13);
export const ruleLight = rgb(0.82, 0.82, 0.82);
/** Neutral light grey for the layout C letterhead band. The dataset stays greyscale + ink. */
export const paper = rgb(0.941, 0.941, 0.941);

export type FontKey =
  | 'sansRegular'
  | 'sansSemiBold'
  | 'monoRegular'
  | 'monoSemiBold'
  | 'serifRegular'
  | 'serifSemiBold';

const FONT_FILES: Record<FontKey, string> = {
  sansRegular: 'IBMPlexSans-Regular.ttf',
  sansSemiBold: 'IBMPlexSans-SemiBold.ttf',
  monoRegular: 'IBMPlexMono-Regular.ttf',
  monoSemiBold: 'IBMPlexMono-SemiBold.ttf',
  serifRegular: 'IBMPlexSerif-Regular.ttf',
  serifSemiBold: 'IBMPlexSerif-SemiBold.ttf',
};

export type FontBytes = Record<FontKey, Uint8Array>;
export type Fonts = Partial<Record<FontKey, PDFFont>>;

/** Reads the bundled IBM Plex files once per run. They ship in `fonts/` with the OFL licence. */
export async function loadFontBytes(fontsDir: string): Promise<FontBytes> {
  const entries = await Promise.all(
    (Object.keys(FONT_FILES) as FontKey[]).map(async (key) => {
      const bytes = await readFile(join(fontsDir, FONT_FILES[key]));
      return [key, new Uint8Array(bytes)] as const;
    }),
  );
  return Object.fromEntries(entries) as FontBytes;
}

/** Embeds only the faces a layout actually draws with — every glyph in the PDF is an embedded subset. */
export async function embedFonts(
  doc: PDFDocument,
  bytes: FontBytes,
  keys: FontKey[],
): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {};
  for (const key of keys) {
    fonts[key] = await doc.embedFont(bytes[key], { subset: true });
  }
  return fonts;
}

export function font(fonts: Fonts, key: FontKey): PDFFont {
  const found = fonts[key];
  if (!found) throw new Error(`font ${key} was not embedded`);
  return found;
}

export interface TextOptions {
  x: number;
  y: number;
  size: number;
  font: PDFFont;
  color?: RGB;
  /** Extra space between characters, in points. Used for small uppercase labels. */
  tracking?: number;
}

export function drawText(page: PDFPage, text: string, options: TextOptions): void {
  const { x, y, size, color = ink, tracking = 0 } = options;
  if (tracking === 0) {
    page.drawText(text, { x, y, size, font: options.font, color });
    return;
  }
  let cursor = x;
  for (const char of Array.from(text)) {
    page.drawText(char, { x: cursor, y, size, font: options.font, color });
    cursor += options.font.widthOfTextAtSize(char, size) + tracking;
  }
}

export function trackedWidth(text: string, f: PDFFont, size: number, tracking: number): number {
  const chars = Array.from(text);
  const glyphs = chars.reduce((sum, char) => sum + f.widthOfTextAtSize(char, size), 0);
  return glyphs + tracking * Math.max(0, chars.length - 1);
}

export interface RightTextOptions extends Omit<TextOptions, 'x'> {
  right: number;
}

export function drawRight(page: PDFPage, text: string, options: RightTextOptions): void {
  const { right, size, tracking = 0 } = options;
  const width =
    tracking === 0 ? options.font.widthOfTextAtSize(text, size) : trackedWidth(text, options.font, size, tracking);
  drawText(page, text, { ...options, x: right - width });
}

export function drawRule(
  page: PDFPage,
  y: number,
  options: { from?: number; to?: number; thickness?: number; color?: RGB } = {},
): void {
  const { from = MARGIN, to = RIGHT, thickness = 0.75, color = ruleLight } = options;
  page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness, color });
}

/** Shrinks the type just enough to stay inside the column; never below `minSize`. */
export function fitSize(
  text: string,
  f: PDFFont,
  size: number,
  maxWidth: number,
  minSize = 8,
): number {
  let current = size;
  while (current > minSize && f.widthOfTextAtSize(text, current) > maxWidth) {
    current -= 0.25;
  }
  return current;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parts(isoDate: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`not an ISO date: ${isoDate}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** `2026-11-03` → `03 Nov 2026` (layout A). */
export function dateCompact(isoDate: string): string {
  const { y, m, d } = parts(isoDate);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]!.slice(0, 3)} ${y}`;
}

/** `2026-11-04` → `2026-11-04` (layout B keeps the engineer's spelling). */
export function dateIso(isoDate: string): string {
  return isoDate;
}

/** `2026-11-04` → `4 November 2026` (layout C). */
export function dateLong(isoDate: string): string {
  const { y, m, d } = parts(isoDate);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Prints the verbatim amount with the currency code, e.g. `USD 1,200.00`. */
export function withCurrency(currency: string, amount: string): string {
  return `${currency} ${amount}`;
}
