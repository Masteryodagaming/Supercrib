import { describe, expect, it } from 'vitest';
import {
  clampPlayoffAdvance,
  MAX_SEATS,
  MIN_SEATS,
} from '../types';
import { scheduleMeta } from '../scheduleMeta';

describe('tournament seats + advance limits', () => {
  it('MAX_SEATS is 20 and MIN stays 4', () => {
    expect(MIN_SEATS).toBe(4);
    expect(MAX_SEATS).toBe(20);
  });

  it('createDraft clamp accepts 20 seats and advance 8 / 6', () => {
    const seats = Math.min(MAX_SEATS, Math.max(MIN_SEATS, 20));
    expect(seats).toBe(20);
    expect(clampPlayoffAdvance(8, seats)).toBe(8);
    expect(clampPlayoffAdvance(6, seats)).toBe(6);
    expect(clampPlayoffAdvance(4, seats)).toBe(4);
    expect(clampPlayoffAdvance(2, seats)).toBe(2);
    expect(clampPlayoffAdvance(undefined, seats)).toBe(4);
  });

  it('clamps advance when seats are too low (8→6→4→2)', () => {
    expect(clampPlayoffAdvance(8, 6)).toBe(6);
    expect(clampPlayoffAdvance(8, 5)).toBe(4);
    expect(clampPlayoffAdvance(6, 5)).toBe(4);
    expect(clampPlayoffAdvance(8, 3)).toBe(2);
    expect(clampPlayoffAdvance(4, 3)).toBe(2);
  });

  it('scheduleMeta covers 20', () => {
    expect(scheduleMeta(20).rounds).toBe(19);
    expect(scheduleMeta(20).simultaneousBoards).toBe(10);
  });
});
