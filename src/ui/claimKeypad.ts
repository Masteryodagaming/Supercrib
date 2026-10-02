/** Max claim the numeric pad will accept (matches prior ClaimPad cap). */
export const CLAIM_MAX = 120;

/** Append a digit 0–9 onto the current claim (calculator-style). */
export function appendClaimDigit(value: number, digit: number): number {
  const d = Math.max(0, Math.min(9, Math.floor(digit)));
  const base = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return Math.min(CLAIM_MAX, base * 10 + d);
}

/** Remove the last typed digit. */
export function backspaceClaim(value: number): number {
  const base = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return Math.floor(base / 10);
}
