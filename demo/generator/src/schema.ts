/**
 * Shapes of the normative scenario files (SPEC §6.4).
 * Only the fields the dataset needs are modelled here; the JSON stays the source of truth.
 */

export type LayoutId = 'A' | 'B' | 'C';

export interface Issuer {
  name: string;
  business: string;
  city: string;
  email: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  amount: string;
}

export interface Invoice {
  layout: LayoutId;
  issuer: Issuer;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  po: string | null;
  lines: InvoiceLine[];
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  payment: string;
  note: string;
}

export interface BillTo {
  name: string;
  attn: string;
  email: string;
  city: string;
}

export interface InboxContent {
  version: string;
  billTo: BillTo;
  emails: Record<string, string>;
  invoices: Record<string, Invoice>;
}

export interface ScenarioInboxItem {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  attachments: string[];
  layout: string;
}

export interface Scenario {
  version: string;
  scenario: string;
  testClock: string;
  payer: { name: string; operator: string; domain: string; currency: string };
  inbox: ScenarioInboxItem[];
}
