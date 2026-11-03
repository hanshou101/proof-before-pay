// Integer-cent arithmetic. SPEC §6.2.1: `Cents` is integer minor units; no float money
// anywhere inside core. Formatting to "$1,350.00" happens only at the edge (UI, emails).

import type { Cents } from './types.js';

/** Throws unless `value` is a safe integer number of cents. */
export function assertCents(value: number, what = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be an integer number of cents, got ${String(value)}`);
  }
  return value;
}

/** Sum of integer cents. Each addend is validated so a float can never sneak in. */
export function sumCents(values: readonly number[]): Cents {
  let total = 0;
  for (const value of values) total += assertCents(value, 'line amount');
  return assertCents(total, 'sum');
}

/**
 * `quantity × unitPrice` with integers only.
 * Quantity is a count (items / hours / words), never fractional in this product.
 */
export function multiplyCents(unitPrice: Cents, quantity: number): Cents {
  assertCents(unitPrice, 'unitPrice');
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`quantity must be an integer, got ${String(quantity)}`);
  }
  return assertCents(unitPrice * quantity, 'product');
}

/**
 * `formatUSD(135000) === "$1,350.00"`.
 * Negative values render as `-$1,350.00` (refunds / reversals).
 */
export function formatUSD(cents: Cents): string {
  assertCents(cents, 'formatUSD input');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = groupThousands(String(dollars));
  return `${sign}$${grouped}.${String(remainder).padStart(2, '0')}`;
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}
