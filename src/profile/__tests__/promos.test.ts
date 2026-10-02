import { describe, it, expect } from 'vitest';
import {
  applySignInPromoIfEligible,
  GOOGLE_SIGNIN_PROMO_ID,
  SIGNIN_PROMO_ID,
  SIGNIN_PROMO_SC,
  hasClaimedSignInPromo,
  repairSignInPromoWipe,
} from '../promos';

describe('applySignInPromoIfEligible', () => {
  it('grants 200 SC once for Google provider', () => {
    const start = { coins: 10, coinLedger: [] as [], claimedPromos: [] as string[] };
    const next = applySignInPromoIfEligible(start, 'google.com');
    expect(next).not.toBe(start);
    expect(next.coins).toBe(10 + SIGNIN_PROMO_SC);
    expect(hasClaimedSignInPromo(next)).toBe(true);
    expect(next.coinLedger?.[0]).toMatchObject({
      delta: SIGNIN_PROMO_SC,
      reason: 'bonus',
      note: 'Google sign-in promo',
    });
  });

  it('grants 200 SC once for email/password', () => {
    const start = { coins: 5, coinLedger: [] as [], claimedPromos: [] as string[] };
    const next = applySignInPromoIfEligible(start, 'password');
    expect(next).not.toBe(start);
    expect(next.coins).toBe(5 + SIGNIN_PROMO_SC);
    expect(hasClaimedSignInPromo(next)).toBe(true);
    expect(next.coinLedger?.[0]).toMatchObject({
      note: 'Email sign-in promo',
    });
  });

  it('does not grant for unknown provider', () => {
    const start = { coins: 5, coinLedger: [] as [] };
    const next = applySignInPromoIfEligible(start, 'phone');
    expect(next).toBe(start);
  });

  it('does not double-pay for new id', () => {
    const start = {
      coins: 200,
      coinLedger: [] as [],
      claimedPromos: [SIGNIN_PROMO_ID],
    };
    const next = applySignInPromoIfEligible(start, 'password');
    expect(next).toBe(start);
  });

  it('treats legacy google_signin_200 as already claimed', () => {
    const start = {
      coins: 200,
      coinLedger: [] as [],
      claimedPromos: [GOOGLE_SIGNIN_PROMO_ID],
    };
    const next = applySignInPromoIfEligible(start, 'google.com');
    expect(next).toBe(start);
    expect(next.coins).toBe(200);
  });
});


describe('repairSignInPromoWipe', () => {
  it('restores wiped claimed promo (0 coins, empty ledger) to 200', () => {
    const wiped = {
      coins: 0,
      coinLedger: [] as [],
      claimedPromos: [SIGNIN_PROMO_ID],
    };
    const next = repairSignInPromoWipe(wiped);
    expect(next).not.toBe(wiped);
    expect(next.coins).toBe(SIGNIN_PROMO_SC);
    expect(next.coinLedger?.at(-1)).toMatchObject({
      reason: 'admin_set',
      note: 'Repair sign-in promo wipe',
      delta: SIGNIN_PROMO_SC,
    });
  });

  it('restores wipe with only non-negative ledger (no real spends)', () => {
    const wiped = {
      coins: 0,
      coinLedger: [
        { at: 1, delta: SIGNIN_PROMO_SC, reason: 'bonus' as const, note: 'Google sign-in promo' },
      ],
      claimedPromos: [SIGNIN_PROMO_ID],
    };
    const next = repairSignInPromoWipe(wiped);
    expect(next.coins).toBe(SIGNIN_PROMO_SC);
    expect(next.coinLedger?.at(-1)?.reason).toBe('admin_set');
  });

  it('leaves alone when spent to 0 (any delta < 0)', () => {
    const spent = {
      coins: 0,
      coinLedger: [
        { at: 1, delta: 200, reason: 'bonus' as const },
        { at: 2, delta: -200, reason: 'buy_emoji' as const, note: 'spent all' },
      ],
      claimedPromos: [SIGNIN_PROMO_ID],
    };
    const next = repairSignInPromoWipe(spent);
    expect(next).toBe(spent);
    expect(next.coins).toBe(0);
  });

  it('leaves healthy 200 unchanged', () => {
    const healthy = {
      coins: 200,
      coinLedger: [
        { at: 1, delta: 200, reason: 'bonus' as const, note: 'Google sign-in promo' },
      ],
      claimedPromos: [SIGNIN_PROMO_ID],
    };
    const next = repairSignInPromoWipe(healthy);
    expect(next).toBe(healthy);
    expect(next.coins).toBe(200);
    expect(next.coinLedger).toHaveLength(1);
  });

  it('leaves alone when promo not claimed', () => {
    const never = { coins: 0, coinLedger: [] as [], claimedPromos: [] as string[] };
    expect(repairSignInPromoWipe(never)).toBe(never);
  });

  it('treats legacy google_signin_200 as claimed for repair', () => {
    const wiped = {
      coins: 0,
      coinLedger: [] as [],
      claimedPromos: [GOOGLE_SIGNIN_PROMO_ID],
    };
    const next = repairSignInPromoWipe(wiped);
    expect(next.coins).toBe(SIGNIN_PROMO_SC);
  });
});
