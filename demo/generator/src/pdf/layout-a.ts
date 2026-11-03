import { PDFPage } from 'pdf-lib';
import type { BillTo, Invoice } from '../schema.js';
import {
  dateCompact,
  drawRight,
  drawRule,
  drawText,
  fitSize,
  font,
  Fonts,
  ink,
  MARGIN,
  muted,
  RIGHT,
  ruleDark,
  ruleLight,
  withCurrency,
} from './common.js';

/**
 * Layout A — "classic".
 * IBM Plex Sans throughout, a large INVOICE masthead, ruled line-item table,
 * boxed total bottom-right. Reads like a small studio that has been invoicing for years.
 */
export function renderLayoutA(
  page: PDFPage,
  invoice: Invoice,
  billTo: BillTo,
  fonts: Fonts,
): void {
  const sans = font(fonts, 'sansRegular');
  const sansBold = font(fonts, 'sansSemiBold');

  drawText(page, 'INVOICE', {
    x: MARGIN,
    y: 750,
    size: 38,
    font: sansBold,
    tracking: 1.2,
    color: ink,
  });

  drawRight(page, 'INVOICE NO.', {
    right: RIGHT,
    y: 792,
    size: 7,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });
  drawRight(page, invoice.invoiceNumber, { right: RIGHT, y: 774, size: 12, font: sansBold });

  const meta: [string, string][] = [
    ['Issued', dateCompact(invoice.issueDate)],
    ['Due', dateCompact(invoice.dueDate)],
  ];
  if (invoice.po) meta.push(['PO', invoice.po]);

  let metaY = 752;
  for (const [label, value] of meta) {
    drawText(page, label, { x: 452, y: metaY, size: 8.5, font: sans, color: muted });
    drawRight(page, value, { right: RIGHT, y: metaY, size: 9.5, font: sans });
    metaY -= 14;
  }

  drawRule(page, 714, { thickness: 1, color: ruleDark });

  // From / Bill to
  drawText(page, 'FROM', {
    x: MARGIN,
    y: 686,
    size: 7.2,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });
  drawText(page, 'BILL TO', {
    x: 330,
    y: 686,
    size: 7.2,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });

  drawText(page, invoice.issuer.business, { x: MARGIN, y: 664, size: 13.5, font: sansBold });
  drawText(page, invoice.issuer.name, { x: MARGIN, y: 648, size: 10, font: sans });
  drawText(page, invoice.issuer.city, { x: MARGIN, y: 634, size: 10, font: sans, color: muted });
  drawText(page, invoice.issuer.email, { x: MARGIN, y: 620, size: 10, font: sans, color: muted });

  drawText(page, billTo.name, { x: 330, y: 664, size: 11, font: sansBold });
  drawText(page, `Attn: ${billTo.attn}`, { x: 330, y: 648, size: 10, font: sans });
  drawText(page, billTo.email, { x: 330, y: 634, size: 10, font: sans, color: muted });
  drawText(page, billTo.city, { x: 330, y: 620, size: 10, font: sans, color: muted });

  // Line items
  const headerY = 556;
  drawText(page, 'DESCRIPTION', {
    x: MARGIN,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawRight(page, 'QTY', { right: 322, y: headerY, size: 7.2, font: sansBold, tracking: 0.9, color: muted });
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
    right: RIGHT,
    y: headerY,
    size: 7.2,
    font: sansBold,
    tracking: 0.9,
    color: muted,
  });
  drawRule(page, 547, { thickness: 0.9, color: ruleDark });

  let rowY = 524;
  for (const line of invoice.lines) {
    const descSize = fitSize(line.description, sans, 10.5, 250);
    drawText(page, line.description, { x: MARGIN, y: rowY, size: descSize, font: sans });
    drawRight(page, String(line.quantity), { right: 322, y: rowY, size: 10.5, font: sans });
    drawText(page, line.unit, { x: 338, y: rowY, size: 10.5, font: sans, color: muted });
    drawRight(page, line.unitPrice, { right: 452, y: rowY, size: 10.5, font: sans });
    drawRight(page, line.amount, { right: RIGHT, y: rowY, size: 10.5, font: sansBold });
    drawRule(page, rowY - 9, { thickness: 0.5, color: ruleLight });
    rowY -= 27;
  }

  // Total panel
  page.drawRectangle({
    x: 319,
    y: 372,
    width: 220,
    height: 78,
    borderColor: ruleDark,
    borderWidth: 0.8,
  });
  drawText(page, 'Subtotal', { x: 331, y: 432, size: 9.5, font: sans, color: muted });
  drawRight(page, invoice.subtotal, { right: 527, y: 432, size: 9.5, font: sans });
  drawText(page, 'Tax', { x: 331, y: 414, size: 9.5, font: sans, color: muted });
  drawRight(page, invoice.tax, { right: 527, y: 414, size: 9.5, font: sans });
  drawRule(page, 402, { from: 331, to: 527, thickness: 0.6, color: ruleLight });
  drawText(page, 'TOTAL DUE', {
    x: 331,
    y: 386,
    size: 7.5,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });
  drawRight(page, withCurrency(invoice.currency, invoice.total), {
    right: 527,
    y: 382,
    size: 14,
    font: sansBold,
  });

  // Payment + note
  drawText(page, 'PAYMENT', {
    x: MARGIN,
    y: 330,
    size: 7.2,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });
  drawText(page, invoice.payment, { x: MARGIN, y: 314, size: 10.5, font: sans });

  drawText(page, 'NOTE', {
    x: MARGIN,
    y: 284,
    size: 7.2,
    font: sansBold,
    tracking: 1.2,
    color: muted,
  });
  drawText(page, invoice.note, { x: MARGIN, y: 268, size: 10.5, font: sans, color: muted });

  // Footer
  drawRule(page, 84, { thickness: 0.6, color: ruleLight });
  drawText(page, `${invoice.issuer.business} · ${invoice.issuer.city} · ${invoice.issuer.email}`, {
    x: MARGIN,
    y: 70,
    size: 8,
    font: sans,
    color: muted,
  });
  drawRight(page, 'Page 1 / 1', { right: RIGHT, y: 70, size: 8, font: sans, color: muted });
}
