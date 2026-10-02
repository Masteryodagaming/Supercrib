/**
 * One-time Super Coin promos (never real money).
 */
import {
  applyDeltaToProfile,
  normalizeCoins,
  normalizeLedger,
  setBalanceOnProfile,
  type CoinLedgerEntry,
  type CoinProfileSlice,
} from './coins';

/** Sign-up / sign-in bonus (Google or email) — one claim per account. */
export const SIGNIN_PROMO_SC = 200;
/** @deprecated use SIGNIN_PROMO_SC — kept for existing imports */
export const GOOGLE_SIGNIN_PROMO_SC = SIGNIN_PROMO_SC;

/**
 * Canonical claim id. Legacy `google_signin_200` still counts as claimed
 * so early Google claimants are not paid twice.
 */
export const SIGNIN_PROMO_ID = 'signin_200';
export const GOOGLE_SIGNIN_PROMO_ID = 'google_signin_200';

export type PromoProfileSlice = CoinProfileSlice & {
  claimedPromos?: string[];
};

export function normalizeClaimedPromos(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = [
    ...new Set(
      raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()),
    ),
  ];
  return ids.length ? ids : undefined;
}

export function hasClaimedPromo(profile: PromoProfileSlice, promoId: string): boolean {
  return (profile.claimedPromos ?? []).includes(promoId);
}

export function hasClaimedSignInPromo(profile: PromoProfileSlice): boolean {
  const claimed = profile.claimedPromos ?? [];
  return claimed.includes(SIGNIN_PROMO_ID) || claimed.includes(GOOGLE_SIGNIN_PROMO_ID);
}

export function isEligibleSignInPromoProvider(providerId: string | null | undefined): boolean {
  return providerId === 'google.com' || providerId === 'password';
}

/** @deprecated use isEligibleSignInPromoProvider */
export function isGoogleAuthProvider(providerId: string | null | undefined): boolean {
  return providerId === 'google.com';
}

/**
 * Grant sign-in promo once for Google or email/password.
 * Returns unchanged profile if already claimed or provider not eligible.
 */
export function applySignInPromoIfEligible<T extends PromoProfileSlice>(
  profile: T,
  providerId: string | null | undefined,
): T & { coins: number; coinLedger: CoinLedgerEntry[]; claimedPromos: string[] } | T {
  if (!isEligibleSignInPromoProvider(providerId)) return profile;
  if (hasClaimedSignInPromo(profile)) return profile;
  const note =
    providerId === 'password' ? 'Email sign-in promo' : 'Google sign-in promo';
  const withCoins = applyDeltaToProfile(profile, SIGNIN_PROMO_SC, 'bonus', note);
  const claimed = [...(withCoins.claimedPromos ?? []), SIGNIN_PROMO_ID];
  return {
    ...withCoins,
    claimedPromos: claimed,
  };
}

/**
 * Auto-heal wiped sign-in promo: claimed `signin_200` (or legacy) but coins
 * normalize to 0 with no real spends (no ledger delta < 0).
 * Leaves alone if they spent to 0 or still have coins > 0.
 */
export function repairSignInPromoWipe<T extends PromoProfileSlice>(
  profile: T,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } | T {
  if (!hasClaimedSignInPromo(profile)) return profile;
  const coins = normalizeCoins(profile.coins ?? 0);
  if (coins > 0) return profile;
  const ledger = normalizeLedger(profile.coinLedger);
  if (ledger.some((e) => e.delta < 0)) return profile;
  return setBalanceOnProfile(
    profile,
    SIGNIN_PROMO_SC,
    'Repair sign-in promo wipe',
  );
}

/** @deprecated use applySignInPromoIfEligible */
export function applyGoogleSignInPromoIfEligible<T extends PromoProfileSlice>(
  profile: T,
  providerId: string | null | undefined,
): T & { coins: number; coinLedger: CoinLedgerEntry[]; claimedPromos: string[] } | T {
  return applySignInPromoIfEligible(profile, providerId);
}
