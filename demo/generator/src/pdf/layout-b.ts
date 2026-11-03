import { PDFPage } from 'pdf-lib';
import type { BillTo, Invoice } from '../schema.js';
import {
  dateIso,
  drawRight,
  drawText,
  font,
  Fonts,
  ink,
  MARGIN,
  muted,
  RIGHT,
  withCurrency,
} from './common.js';

/**
 * Layout B — "minimal monospaced".
 * IBM Plex Mono only, no rules anywhere: alignment and white space do the work,
 * figures right-aligned in a strict column. A motion designer's plain-text invoice.
 */
export function renderLayoutB(
  page: PDFPage,
  invoice: Invoice,
  billTo: BillTo,
  fonts: Fonts,
): void {
  const mono = font(fonts, 'monoRegular');
  const monoBold = font(fonts, 'monoSemiBold');

  drawText(page, invoice.issuer.business.toUpperCase(), {
    x: MARGIN,
    y: 780,
    size: 12,
    font: monoBold,
    tracking: 3,
    color: ink,
  });
  drawText(page, invoice.issuer.name, { x: MARGIN, y: 760, size: 9, font: mono, color: muted });
  drawText(page, invoice.issuer.city, { x: MARGIN, y: 746, size: 9, font: mono, color: muted });
  drawText(page, invoice.issuer.email, { x: MARGIN, y: 732, size: 9, font: mono, color: muted });

  drawRight(page, 'INVOICE', {
    right: RIGHT,
    y: 780,
    size: 8,
    font: monoBold,
    tracking: 3,
    color: muted,
  });
  drawRight(page, invoice.invoiceNumber, {
    right: RIGHT,
    y: 754,
    size: 19,
    font: monoBold,
  });

  const meta: [string, string][] = [
    ['Issued', dateIso(invoice.issueDate)],
    ['Due', dateIso(invoice.dueDate)],
  ];
  if (invoice.po) meta.push(['PO', invoice.po]);

  let metaY = 722;
  for (const [label, value] of meta) {
    drawRight(page, label.toUpperCase(), {
      right: 470,
      y: metaY,
      size: 8.5,
      font: mono,
      color: muted,
    });
    drawRight(page, value, { right: RIGHT, y: metaY, size: 9.5, font: mono });
    metaY -= 14;
  }

  drawText(page, 'BILL TO', {
    x: MARGIN,
    y: 640,
    size: 7.5,
    font: monoBold,
    tracking: 2,
    color: muted,
  });
  drawText(page, billTo.name, { x: MARGIN, y: 622, size: 9.5, font: mono });
  drawText(page, `Attn: ${billTo.attn}`, { x: MARGIN, y: 608, size: 9.5, font: mono, color: muted });
  drawText(page, billTo.email, { x: MARGIN, y: 594, size: 9.5, font: mono, color: muted });
  drawText(page, billTo.city, { x: MARGIN, y: 580, size: 9.5, font: mono, color: muted });

  const headerY = 520;
  drawText(page, 'DESCRIPTION', {
    x: MARGIN,
    y: headerY,
    size: 7.5,
    font: monoBold,
    tracking: 1.4,
    color: muted,
  });
  drawRight(page, 'QTY', {
    right: 322,
    y: headerY,
    size: 7.5,
    font: monoBold,
    tracking: 1.4,
    color: muted,
  });
  drawText(page, 'UNIT', {
    x: 338,
    y: headerY,
    size: 7.5,
    font: monoBold,
    tracking: 1.4,
    color: muted,
  });
  drawRight(page, 'UNIT PRICE', {
    right: 452,
    y: headerY,
    size: 7.5,
    font: monoBold,
    tracking: 1.4,
    color: muted,
  });
  drawRight(page, 'AMOUNT', {
    right: RIGHT,
    y: headerY,
    size: 7.5,
    font: monoBold,
    tracking: 1.4,
    color: muted,
  });

  let rowY = 492;
  for (const line of invoice.lines) {
    drawText(page, line.description, { x: MARGIN, y: rowY, size: 9.5, font: mono });
    drawRight(page, String(line.quantity), { right: 322, y: rowY, size: 9.5, font: mono, color: muted });
    drawText(page, line.unit, { x: 338, y: rowY, size: 9.5, font: mono, color: muted });
    drawRight(page, line.unitPrice, { right: 452, y: rowY, size: 9.5, font: mono });
    drawRight(page, line.amount, { right: RIGHT, y: rowY, size: 9.5, font: monoBold });
    rowY -= 24;
  }

  const totalsTop = Math.min(rowY - 34, 448);
  drawText(page, 'SUBTOTAL', {
    x: 400,
    y: totalsTop,
    size: 8.5,
    font: mono,
    tracking: 1.2,
    color: muted,
  });
  drawRight(page, invoice.subtotal, { right: RIGHT, y: totalsTop, size: 9.5, font: mono });
  drawText(page, 'TAX', {
    x: 400,
    y: totalsTop - 18,
    size: 8.5,
    font: mono,
    tracking: 1.2,
    color: muted,
  });
  drawRight(page, invoice.tax, { right: RIGHT, y: totalsTop - 18, size: 9.5, font: mono });
  drawText(page, 'TOTAL', {
    x: 400,
    y: totalsTop - 56,
    size: 8.5,
    font: monoBold,
    tracking: 1.2,
    color: muted,
  });
  drawRight(page, withCurrency(invoice.currency, invoice.total), {
    right: RIGHT,
    y: totalsTop - 58,
    size: 13,
    font: monoBold,
  });

  drawText(page, 'PAYMENT', {
    x: MARGIN,
    y: 320,
    size: 7.5,
    font: monoBold,
    tracking: 2,
    color: muted,
  });
  drawText(page, invoice.payment, { x: MARGIN, y: 304, size: 9.5, font: mono });

  drawText(page, 'NOTE', {
    x: MARGIN,
    y: 274,
    size: 7.5,
    font: monoBold,
    tracking: 2,
    color: muted,
  });
  drawText(page, invoice.note, { x: MARGIN, y: 258, size: 9.5, font: mono, color: muted });

  drawText(page, `${invoice.invoiceNumber} · 1 of 1`, {
    x: MARGIN,
    y: 70,
    size: 8,
    font: mono,
    color: muted,
  });
  drawRight(page, `${invoice.issuer.business} · ${invoice.issuer.email}`, {
    right: RIGHT,
    y: 70,
    size: 8,
    font: mono,
    color: muted,
  });
}
