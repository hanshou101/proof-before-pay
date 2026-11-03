// "Out of money" and "PayPal did not answer" are different problems with different fixes.
// The rail cannot tell them apart in its one human sentence, because both arrive as a rejected
// submit; PayPal's own error name can (see `apps/server/src/rail-errors.ts`).

import { describe, expect, it } from 'vitest';
import { PayPalRailError } from '@pbp/paypal';
import { OUT_OF_FUNDS_MESSAGE, humanRailMessage, outOfFunds } from '../src/rail-errors.js';

describe('rail errors in human words', () => {
  it('reads INSUFFICIENT_FUNDS out of the rail detail and says what to do', () => {
    const error = new PayPalRailError(
      'rejected',
      'PayPal rejected this payout — nothing was sent. The details are in the developer log.',
      {
        status: 422,
        detail: 'INSUFFICIENT_FUNDS · Sender does not have sufficient funds. Please add funds and retry. · f613760afa780',
      },
    );

    expect(outOfFunds(error)).toBe(true);
    expect(humanRailMessage(error, 'fallback')).toBe(OUT_OF_FUNDS_MESSAGE);
    expect(OUT_OF_FUNDS_MESSAGE).toMatch(/run out of payout funds/);
    expect(OUT_OF_FUNDS_MESSAGE).toMatch(/nothing was sent/i);
    // It must not read like the connection problem, which has a different fix.
    expect(OUT_OF_FUNDS_MESSAGE).not.toMatch(/did not answer|couldn't reach/i);
  });

  it('leaves every other failure with the sentence the rail already wrote', () => {
    const unavailable = new PayPalRailError('unavailable', 'PayPal is not answering right now. Nothing was sent.', {
      status: 503,
      detail: 'INTERNAL_SERVICE_ERROR',
    });
    expect(outOfFunds(unavailable)).toBe(false);
    expect(humanRailMessage(unavailable, 'fallback')).toBe('PayPal is not answering right now. Nothing was sent.');
  });

  it('falls back when the thing thrown is not an error', () => {
    expect(humanRailMessage('boom', 'fallback sentence')).toBe('fallback sentence');
  });
});
