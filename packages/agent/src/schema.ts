// The model's output contract.
//
// Every answer arrives as JSON (`response_format: json_object`), gets parsed by zod, and only
// then becomes a `Claim`. A schema failure is a validation failure — the caller retries once
// with the error attached and otherwise marks the item `needs_review`. Nothing here repairs,
// coerces or "fixes" a value toward the expected answer.
//
// Money: the model returns the number **as printed** ("1,350.00"). `parseMoneyCents` turns it
// into integer cents. This is the contract the README documents; changing it is a schema change.

import { z } from 'zod';
import type { Cents, ClaimLine } from '@pbp/core';
import { parseMoneyCents } from './money.js';
import { CLASSIFICATIONS, type Classification, type InboxItem } from './types.js';
import { ValidationError, parseJsonObject } from './validate.js';

const moneyString = z
  .string()
  .regex(
    /^\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/,
    'money must be a decimal string with two decimals exactly as printed, e.g. "1,350.00" or "0.09"',
  );

const emailString = z
  .string()
  .regex(/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/, 'must be an email address, e.g. "sofia@linguaviva.example"');

const lineSchema = z.object({
  description: z.string().min(1, 'line description is required'),
  quantity: z.number().int().positive('quantity must be a positive integer'),
  unit: z.enum(['item', 'hour', 'word'], { error: 'unit must be one of item / hour / word' }),
  unitPrice: moneyString,
  amount: moneyString,
});

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attachment'), name: z.string().min(1) }),
  z.object({ kind: z.literal('email_body'), name: z.null() }),
]);

const claimSchema = z.object({
  vendorName: z.string().min(1),
  invoiceNumber: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD'),
  currency: z.literal('USD'),
  total: moneyString,
  po: z.union([z.string().min(1), z.null()]),
  requestedPayee: z.union([emailString, z.null()]),
  lines: z.array(lineSchema).min(1, 'an invoice has at least one line'),
  source: sourceSchema,
});

const extractionSchema = z.object({
  classification: z.enum(CLASSIFICATIONS, { error: 'classification must be one of the four values' }),
  claim: z.union([claimSchema, z.null()]),
  changeRequest: z.union([z.object({ requestedPayee: emailString }), z.null()]),
  notes: z.array(z.string()),
});

export interface ClaimDraft {
  vendorName: string;
  invoiceNumber: string;
  issueDate: string;
  currency: 'USD';
  total: Cents;
  po: string | null;
  requestedPayee: string | null;
  lines: ClaimLine[];
  source: { kind: 'attachment'; name: string } | { kind: 'email_body'; name: null };
}

export interface Extraction {
  classification: Classification;
  claim: ClaimDraft | null;
  changeRequest: { requestedPayee: string } | null;
  notes: string[];
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

function foldSource(source: { kind: string; name: string | null }): string {
  return source.name === null ? source.kind : `${source.kind}:${source.name}`;
}

/**
 * Parse one extraction answer and cross-check it against the item that produced it.
 * Throws `ValidationError` with a message the retry prompt can quote.
 */
export function parseExtraction(content: string, item: InboxItem): Extraction {
  const parsed = extractionSchema.safeParse(parseJsonObject(content));
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const raw = parsed.data;

  if (raw.classification === 'invoice' || raw.classification === 'invoice+payee_change_request') {
    if (raw.claim === null) throw new ValidationError('classification is an invoice but claim is null');
  }
  if (
    raw.classification === 'payee_change_request' ||
    raw.classification === 'invoice+payee_change_request'
  ) {
    if (raw.changeRequest === null) {
      throw new ValidationError(`classification is ${raw.classification} but changeRequest is null`);
    }
  }
  if (raw.classification === 'other' && (raw.claim !== null || raw.changeRequest !== null)) {
    throw new ValidationError('classification is "other" so claim and changeRequest must both be null');
  }

  const claim: ClaimDraft | null = raw.claim
    ? {
        vendorName: raw.claim.vendorName,
        invoiceNumber: raw.claim.invoiceNumber,
        issueDate: raw.claim.issueDate,
        currency: 'USD',
        total: parseMoneyCents(raw.claim.total, 'claim.total'),
        po: raw.claim.po,
        requestedPayee: raw.claim.requestedPayee,
        lines: raw.claim.lines.map((line, index) => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: parseMoneyCents(line.unitPrice, `claim.lines[${index}].unitPrice`),
          amount: parseMoneyCents(line.amount, `claim.lines[${index}].amount`),
        })),
        source: raw.claim.source,
      }
    : null;

  if (claim && claim.source.kind === 'attachment') {
    const names = item.attachments.map((attachment) => attachment.name);
    if (!names.includes(claim.source.name)) {
      throw new ValidationError(
        `claim.source.name ${JSON.stringify(claim.source.name)} is not one of the attachments: ${names.join(', ') || '(none)'}`,
      );
    }
  }

  if (
    claim &&
    claim.requestedPayee !== null &&
    raw.changeRequest !== null &&
    claim.requestedPayee.toLowerCase() !== raw.changeRequest.requestedPayee.toLowerCase()
  ) {
    throw new ValidationError(
      'claim.requestedPayee and changeRequest.requestedPayee disagree; they must be the same address',
    );
  }

  return {
    classification: raw.classification,
    claim,
    changeRequest: raw.changeRequest,
    notes: raw.notes,
  };
}

export const matchSchema = z.object({
  agreementId: z.string().min(1),
  reason: z.string().min(1),
});

export const noteSchema = z.object({
  note: z.string().min(1),
});

export const explanationSchema = z.object({
  text: z.string().min(1),
});

export const highlightSchema = z.object({
  highlight: z.string().min(1),
});

export { foldSource, zodMessage };
