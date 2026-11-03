// O1 — do we recognise this vendor? SPEC §6.2.2.
//
// Resolution order is fixed: sender email exactly equal → the agreement's PO → vendor
// name (case-insensitive). `claim.vendorId` is NOT trusted: it may come from an LLM that
// was fed a forged invoice. When the resolved vendor differs from the claim, the resolved
// one wins and the claim's value is recorded as `claimedVendorId`.

import type { Claim, CheckResult, Vendor } from '../types.js';
import type { CheckDeps, GateContext } from '../context.js';
import { normalizeEmail } from '../normalize.js';
import { result } from './util.js';

export type VendorMatchedBy = 'sender' | 'po' | 'name';

export interface VendorResolution {
  vendor: Vendor | null;
  matchedBy: VendorMatchedBy | null;
}

export function resolveVendor(claim: Claim, context: GateContext): VendorResolution {
  const sender = normalizeEmail(claim.senderEmail);
  if (sender !== '') {
    const bySender = context.vendors.find((v) => normalizeEmail(v.payee.receiver) === sender);
    if (bySender) return { vendor: bySender, matchedBy: 'sender' };
  }

  const po = (claim.po ?? '').trim();
  if (po !== '') {
    const agreement = context.agreements.find((a) => (a.po ?? '').trim() === po);
    if (agreement) {
      const vendor = context.vendors.find((v) => v.id === agreement.vendorId);
      if (vendor) return { vendor, matchedBy: 'po' };
    }
  }

  const name = claim.vendorName.trim().toLowerCase();
  if (name !== '') {
    const byName = context.vendors.find((v) => v.name.trim().toLowerCase() === name);
    if (byName) return { vendor: byName, matchedBy: 'name' };
  }

  return { vendor: null, matchedBy: null };
}

export function checkO1(deps: CheckDeps): CheckResult {
  const { vendor, vendorMatchedBy, proposal } = deps;
  if (!vendor) {
    return result('O1', 'hold', 'UNKNOWN_VENDOR', {
      vendorId: null,
      matchedBy: null,
      claimedVendorId: proposal.claim.vendorId ?? null,
    });
  }

  const facts: CheckResult['facts'] = {
    vendorId: vendor.id,
    matchedBy: vendorMatchedBy,
  };
  const claimed = proposal.claim.vendorId ?? null;
  if (claimed !== null && claimed !== vendor.id) facts.claimedVendorId = claimed;

  return result('O1', 'pass', 'VENDOR_MATCHED', facts);
}
