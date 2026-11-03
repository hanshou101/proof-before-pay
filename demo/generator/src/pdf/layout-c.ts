import { PDFPage } from 'pdf-lib';
import type { BillTo, Invoice } from '../schema.js';
import {
  dateLong,
  drawRight,
  drawRule,
  drawText,
  font,
  Fonts,
  ink,
  MARGIN,
  muted,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  paper,
  RIGHT,
  ruleLight,
  withCurrency,
} from './common.js';

/**
 * Layout C — "studio".
 * IBM Plex Serif for the masthead and labels, Plex Sans for body copy, and a warm
 * grey band across the top carrying the trade name. A small studio's letterhead.
 */
export function renderLayoutC(
  page: PDFPage,
  invoice: Invoice,
  billTo: BillTo,
  fonts: Fonts,
): void {
  const serif = font(fonts, 'serifRegular');
  const serifBold = font(fonts, 'serifSemiBold');
  const sans = font(fonts, 'sansRegular');
  const sansBold = font(fonts, 'sansSemiBold');

  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 100,
    width: PAGE_WIDTH,
    height: 100,
    color: paper,
  });

  drawText(page, invoice.issuer.business, { x: MARGIN, y: 790, size: 21, font: serifBold });
  drawText(page, invoice.issuer.city, {
    x: 330,
    y: 792,
    size: 8.5,
    font: sans,
    color: muted,
  });
  drawRight(page, invoice.issuer.email, { right: RIGHT, y: 792, size: 8.5, font: sans, color: muted });

  drawText(page, 'Invoice', { x: MARGIN, y: 688, size: 30, font: serifBold });
  drawRight(page, invoice.invoiceNumber, { right: RIGHT, y: 694, size: 13, font: serifBold });

  const meta: [string, string][] = [
    ['Issued', dateLong(invoice.issueDate)],
    ['Due', dateLong(invoice.dueDate)],
  ];
  if (invoice.po) meta.push(['PO', invoice.po]);

  let metaY = 674;
  for (const [label, value] of meta) {
    drawText(page, label, { x: 400, y: metaY, size: 8.5, font: sans, color: muted });
    drawRight(page, value, { right: RIGHT, y: metaY, size: 9, font: sans });
    metaY -= 14;
  }

  drawText(page, 'FROM', {
    x: MARGIN,
    y: 606,
    size: 7.5,
    font: serifBold,
    tracking: 1.4,
    color: muted,
  });
  drawText(page, 'BILL TO', {
    x: 330,
    y: 606,
    size: 7.5,
    font: serifBold,
    tracking: 1.4,
    color: muted,
  });

  drawText(page, invoice.issuer.business, { x: MARGIN, y: 584, size: 11, font: sansBold });
  drawText(page, invoice.issuer.name, { x: MARGIN, y: 569, size: 9.5, font: sans });
  drawText(page, invoice.issuer.city, { x: MARGIN, y: 555, size: 9.5, font: sans, color: muted });
  drawText(page, invoice.issuer.email, { x: MARGIN, y: 541, size: 9.5, font: sans, color: muted });

  drawText(page, billTo.name, { x: 330, y: 584, size: 11, font: sansBold });
  drawText(page, `Attn: ${billTo.attn}`, { x: 330, y: 569, size: 9.5, font: sans });
  drawText(page, billTo.email, { x: 330, y: 555, size: 9.5, font: sans, color: muted });
  drawText(page, billTo.city, { x: 330, y: 541, size: 9.5, font: sans, color: muted });

  page.drawRectangle({
    x: MARGIN,
    y: 496,
    width: RIGHT - MARGIN,
    height: 24,
    color: paper,
  });

  const headerY = 504;
  drawText(page, 'DESCRIPTION', {
    x: MARGIN + 10,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawRight(page, 'QTY', {
    right: 322,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawText(page, 'UNIT', {
    x: 338,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawRight(page, 'UNIT PRICE', {
    right: 452,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawRight(page, 'AMOUNT', {
    right: RIGHT - 10,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });

  let rowY = 474;
  for (const line of invoice.lines) {
    drawText(page, line.description, { x: MARGIN + 10, y: rowY, size: 10, font: sans });
    drawRight(page, String(line.quantity), { right: 322, y: rowY, size: 10, font: sans });
    drawText(page, line.unit, { x: 338, y: rowY, size: 10, font: sans, color: muted });
    drawRight(page, line.unitPrice, { right: 452, y: rowY, size: 10, font: sans });
    drawRight(page, line.amount, { right: RIGHT - 10, y: rowY, size: 10, font: sansBold });
    drawRule(page, rowY - 9, { thickness: 0.5, color: ruleLight });
    rowY -= 24;
  }

  const totalsTop = Math.min(rowY - 36, 430);
  drawText(page, 'Subtotal', { x: 400, y: totalsTop, size: 10, font: serif });
  drawRight(page, invoice.subtotal, { right: RIGHT, y: totalsTop, size: 10, font: sans });
  drawText(page, 'Tax', { x: 400, y: totalsTop - 18, size: 10, font: serif });
  drawRight(page, invoice.tax, { right: RIGHT, y: totalsTop - 18, size: 10, font: sans });
  drawRule(page, totalsTop - 32, { from: 400, to: RIGHT, thickness: 0.6, color: ruleLight });
  drawRight(page, 'Total due', {
    right: RIGHT,
    y: totalsTop - 50,
    size: 9.5,
    font: serif,
    color: muted,
  });
  drawRight(page, withCurrency(invoice.currency, invoice.total), {
    right: RIGHT,
    y: totalsTop - 76,
    size: 19,
    font: serifBold,
  });

  drawText(page, 'Payment', { x: MARGIN, y: 300, size: 9, font: serifBold });
  drawText(page, invoice.payment, { x: MARGIN, y: 285, size: 9.5, font: sans });

  drawText(page, 'Note', { x: MARGIN, y: 256, size: 9, font: serifBold });
  drawText(page, invoice.note, { x: MARGIN, y: 241, size: 9.5, font: sans, color: muted });

  drawRule(page, 86, { thickness: 0.5, color: ruleLight });
  drawText(page, `${invoice.issuer.business} · ${invoice.issuer.city}`, {
    x: MARGIN,
    y: 70,
    size: 8,
    font: sans,
    color: muted,
  });
  drawRight(page, 'Page 1 / 1', { right: RIGHT, y: 70, size: 8, font: sans, color: muted });
}
