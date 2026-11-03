// SPEC §6.2.1 — 規範型別（docs/01-SPEC.md）。
// 名稱與欄位照抄，不許改名。core 內不許出現浮點金額：所有 Cents 都是整數分。

export type Cents = number;                       // 整數分；core 內不許出現浮點金額
export type Currency = 'USD';
export interface Payee { rail: 'paypal'; recipientType: 'EMAIL'; receiver: string }
export interface Vendor { id: string; name: string; business: string; knownDomains: string[]; payee: Payee;
  payeeVerified: { at: string; method: string; by: string }; priorPayments: number }
export interface Agreement { id: string; vendorId: string; po: string | null; scope: string;
  kind: 'fixed' | 'hourly' | 'per_word'; currency: Currency; fee?: Cents; rate?: Cents; capUnits?: number; deliveryIds: string[] }
export interface Delivery { id: string; agreementId: string; title: string; submittedAt: string;
  acceptedAt: string | null; acceptedBy: string | null; evidence: string }
export interface ClaimLine { description: string; quantity: number; unit: 'item' | 'hour' | 'word'; unitPrice: Cents; amount: Cents }
export interface Claim { itemId: string; vendorId: string | null; vendorName: string; senderEmail: string;
  invoiceNumber: string; issueDate: string; currency: Currency; total: Cents; po: string | null;
  requestedPayee: string | null; lines: ClaimLine[]; sourceSha256: string; extractedBy: { model: string; at: string } | null }
export interface PayeeChangeRequest { id: string; vendorId: string; requestedPayee: string; sourceItemId: string;
  requestedAt: string; status: 'unverified' | 'confirmed' | 'fraudulent' }
export interface Proposal { claim: Claim; agreementId: string | null; agreementMatchedBy: 'po' | 'ai' | null; rationale: string }
export type CheckId = 'O1' | 'O2' | 'O3' | 'O4' | 'P1' | 'P2' | 'L1' | 'L2' | 'L3';
export type CheckStatus = 'pass' | 'hold' | 'fail' | 'na';
export interface CheckResult { id: CheckId; status: CheckStatus; code: string; facts: Record<string, string | number | boolean | null> }
export type Decision = 'approved' | 'held' | 'blocked';
export type RiskFlag = 'SENDER_DOMAIN_MISMATCH' | 'LOOKALIKE_DOMAIN' | 'INSTRUCTION_TO_AI' | 'URGENCY';
