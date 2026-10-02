import { describe, expect, it } from 'vitest';
import {
  CLAIM_MAX,
  appendClaimDigit,
  backspaceClaim,
} from '../claimKeypad';

describe('claimKeypad', () => {
  it('appends digits calculator-style', () => {
    expect(appendClaimDigit(0, 2)).toBe(2);
    expect(appendClaimDigit(2, 4)).toBe(24);
    expect(appendClaimDigit(24, 0)).toBe(CLAIM_MAX); // 240 capped
  });

  it('caps at CLAIM_MAX', () => {
    expect(appendClaimDigit(12, 0)).toBe(120);
    expect(appendClaimDigit(120, 5)).toBe(CLAIM_MAX);
    expect(appendClaimDigit(99, 9)).toBe(CLAIM_MAX);
  });

  it('backspaces last digit', () => {
    expect(backspaceClaim(24)).toBe(2);
    expect(backspaceClaim(2)).toBe(0);
    expect(backspaceClaim(0)).toBe(0);
    expect(backspaceClaim(120)).toBe(12);
  });

  it('empty start (0): first digit replaces, does not concat claimed seed', () => {
    // Adjust must init claim to 0 — seeding claimed (e.g. 12) then typing 14 concatenates.
    expect(appendClaimDigit(appendClaimDigit(12, 1), 4)).toBe(CLAIM_MAX); // 121→120 cap
    expect(appendClaimDigit(2, 4)).toBe(24); // classic seed-bug: intended 4 becomes 24
    expect(appendClaimDigit(0, 1)).toBe(1);
    expect(appendClaimDigit(appendClaimDigit(0, 1), 4)).toBe(14);
  });
});
