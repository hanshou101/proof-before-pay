// Money at the edge of the model.
//
// The schema asks the model for the number **as printed** on the document ("1,200.00",
// "$738.00", "0.09") and this module turns it into integer cents. Two reasons:
//   - asking for cents invites a silent factor-of-100 error (1,200 → 1200 instead of 120000);
//   - the printed form is what a human can check against the PDF, so a wrong value is
//     visible in the proof bundle instead of hidden behind a conversion.
//
// No floats ever leave this function: the string is split on the decimal point and the
// integer parts are multiplied by 100.

import { assertCents } from '@pbp/core';
import type { Cents } from '@pbp/core';
import { ValidationError } from './validate.js';

/** `"$1,200.00"` → `120000`. Throws `ValidationError` for anything that is not two decimals. */
export function parseMoneyCents(raw: string, what = 'amount'): Cents {
  const value = raw.trim();
  const cleaned = value.replace(/^\$/, '').replace(/,/g, '').trim();
  const match = /^(\d+)\.(\d{2})$/.exec(cleaned);
  if (!match) {
    throw new ValidationError(
      `${what} must be a decimal string with exactly two decimals as printed (e.g. "1,350.00"), got ${JSON.stringify(raw)}`,
    );
  }
  const dollars = Number(match[1]);
  const cents = Number(match[2]);
  if (!Number.isSafeInteger(dollars)) {
    throw new ValidationError(`${what} is too large: ${JSON.stringify(raw)}`);
  }
  return assertCents(dollars * 100 + cents, what);
}

/** The inverse, for prompts and templates: `135000` → `"1,350.00"`. */
export function formatMoney(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(assertCents(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${sign}${groupThousands(String(dollars))}.${String(remainder).padStart(2, '0')}`;
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
