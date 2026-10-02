import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../roomCode';

describe('roomCode', () => {
  it('generates 4–6 char codes from the safe alphabet', () => {
    for (let len = 4; len <= 6; len++) {
      const code = generateRoomCode(len, () => 0);
      expect(code).toHaveLength(len);
      for (const ch of code) {
        expect(ALPHABET).toContain(ch);
      }
    }
  });

  it('omits ambiguous characters (0/O/1/I/L)', () => {
    expect(ALPHABET).not.toMatch(/[01IOL]/);
    // Many samples still stay in alphabet
    for (let i = 0; i < 40; i++) {
      const code = generateRoomCode(5, () => Math.random());
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('normalizes and validates join input', () => {
    expect(normalizeRoomCode(' ab-c12 ')).toBe('ABC12');
    expect(isValidRoomCode('H7K2P')).toBe(true);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('OI01')).toBe(false);
  });
});
