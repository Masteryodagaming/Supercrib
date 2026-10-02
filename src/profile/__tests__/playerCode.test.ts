import { describe, it, expect } from 'vitest';
import {
  emailIndexKey,
  generatePlayerCode,
  isValidPlayerCode,
  looksLikeEmail,
  normalizePlayerCode,
  PLAYER_CODE_ALPHABET,
} from '../playerCode';

describe('playerCode', () => {
  it('generates 6-char codes from unambiguous alphabet', () => {
    const code = generatePlayerCode(6, () => 0);
    expect(code).toHaveLength(6);
    expect([...code].every((c) => PLAYER_CODE_ALPHABET.includes(c))).toBe(true);
    expect(code).not.toMatch(/[01IO]/);
  });

  it('normalizes and validates', () => {
    expect(normalizePlayerCode(' ab-cd12 ')).toBe('ABCD12');
    expect(isValidPlayerCode('ABCDEF')).toBe(true);
    expect(isValidPlayerCode('ABC')).toBe(false);
    expect(isValidPlayerCode('ABCD0E')).toBe(false); // 0 not in alphabet
  });

  it('detects email vs code', () => {
    expect(looksLikeEmail('friend@example.com')).toBe(true);
    expect(looksLikeEmail('ABCDEF')).toBe(false);
  });

  it('builds RTDB-safe email keys', () => {
    expect(emailIndexKey('Josh.M@Example.COM')).toBe('josh,m@example,com');
  });
});
