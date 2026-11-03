// O2 — is there a contract and does the amount match it? SPEC §6.2.2.
//
// fixed:            total == fee
// hourly/per_word:  every line unitPrice == rate, Σquantity ≤ capUnits, total == Σquantity × rate
//
// Amounts are integer cents throughout; `Σquantity × rate` is an integer multiply.
// A human `approve` may lower the amount (SPEC §6.2.2, last paragraph): O2 is then judged
// against `context.approvedAmount`, still reports `AMOUNT_MATCHES`, and carries `approvedBy`.

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { na, result, statusOf } from './util.js';

export function checkO2(deps: CheckDeps): CheckResult {
  const { proposal, context, agreement, vendor } = deps;
  const claim = proposal.claim;
  const billed = claim.total;

  if (statusOf(deps.results, 'O1') !== 'pass') return na('O2');

  if (!agreement || !vendor || agreement.vendorId !== vendor.id) {
    return result('O2', 'hold', 'NO_AGREEMENT', {
      kind: agreement?.kind ?? null,
      billed,
      agreementId: agreement?.id ?? null,
    });
  }

  if (agreement.currency !== claim.currency) {
    return result('O2', 'hold', 'CURRENCY_MISMATCH', {
      kind: agreement.kind,
      billed,
      currency: claim.currency,
      agreementCurrency: agreement.currency,
    });
  }

  if (agreement.kind === 'fixed') {
    const fee = agreement.fee ?? null;
    return fee !== null && billed === fee
      ? result('O2', 'pass', 'AMOUNT_MATCHES', { kind: 'fixed', billed, expected: fee })
      : result('O2', 'hold', 'AMOUNT_MISMATCH', { kind: 'fixed', billed, expected: fee });
  }

  const rate = agreement.rate ?? null;
  const capUnits = agreement.capUnits ?? null;
  const billedUnits = claim.lines.reduce((sum, line) => sum + line.quantity, 0);
  const expected = rate === null ? null : billedUnits * rate;
  const cap = rate === null || capUnits === null ? null : capUnits * rate;

  const baseFacts: CheckResult['facts'] = {
    kind: agreement.kind,
    billed,
    expected,
    billedUnits,
    capUnits,
    rate,
  };

  const approved = context.approvedAmount;
  if (approved !== null && approved !== undefined) {
    if (cap !== null && approved > cap) {
      return result('O2', 'hold', 'OVER_CAP', { ...baseFacts, cap, approvedAmount: approved });
    }
    if (approved < 0 || approved > billed) {
      return result('O2', 'hold', 'AMOUNT_MISMATCH', { ...baseFacts, approvedAmount: approved });
    }
    return result('O2', 'pass', 'AMOUNT_MATCHES', {
      ...baseFacts,
      approvedAmount: approved,
      approvedBy: context.approvedBy ?? null,
    });
  }

  const unitPriceOk = claim.lines.every((line) => rate !== null && line.unitPrice === rate);
  const productOk = claim.lines.every((line) => line.amount === line.unitPrice * line.quantity);
  if (!unitPriceOk || !productOk || expected === null || billed !== expected) {
    return result('O2', 'hold', 'AMOUNT_MISMATCH', baseFacts);
  }

  if (capUnits !== null && billedUnits > capUnits) {
    return result('O2', 'hold', 'OVER_CAP', { ...baseFacts, cap });
  }

  return result('O2', 'pass', 'AMOUNT_MATCHES', baseFacts);
}
