import { PDFPage } from 'pdf-lib';
import { PDFDocument } from 'pdf-lib';
import type { BillTo, Invoice, LayoutId } from '../schema.js';
import {
  embedFonts,
  FontBytes,
  FontKey,
  Fonts,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from './common.js';
import { renderLayoutA } from './layout-a.js';
import { renderLayoutB } from './layout-b.js';
import { renderLayoutC } from './layout-c.js';

const LAYOUT_FONTS: Record<LayoutId, FontKey[]> = {
  A: ['sansRegular', 'sansSemiBold'],
  B: ['monoRegular', 'monoSemiBold'],
  C: ['serifRegular', 'serifSemiBold', 'sansRegular', 'sansSemiBold'],
};

const RENDERERS: Record<
  LayoutId,
  (page: PDFPage, invoice: Invoice, billTo: BillTo, fonts: Fonts) => void
> = {
  A: renderLayoutA,
  B: renderLayoutB,
  C: renderLayoutC,
};

/**
 * Renders one invoice with its layout. Everything that ends up in the file is a
 * function of the inputs: metadata dates come from `createdAt`, no document ID is
 * written, and only embedded IBM Plex subsets are used (no standard fonts).
 */
export async function buildInvoicePdf(
  invoice: Invoice,
  billTo: BillTo,
  fontBytes: FontBytes,
  createdAt: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc, fontBytes, LAYOUT_FONTS[invoice.layout]);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  RENDERERS[invoice.layout](page, invoice, billTo, fonts);

  const stamp = new Date(createdAt);
  doc.setTitle(`${invoice.invoiceNumber} — ${invoice.issuer.business}`);
  doc.setAuthor(invoice.issuer.name);
  doc.setSubject('Invoice');
  doc.setProducer('Proof Before Pay demo generator');
  doc.setCreator('Proof Before Pay demo generator');
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);

  return doc.save();
}
