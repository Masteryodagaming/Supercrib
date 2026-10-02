import { describe, it, expect } from 'vitest';
import {
  createDealAnimGuard,
  simulateStrictModeRemount,
} from '../dealAnimGuard';

describe('dealAnimGuard (Strict Mode safe)', () => {
  it('allows restart after abort when markComplete was NOT called on start', () => {
    const { secondStartAllowed } = simulateStrictModeRemount(false, 1);
    expect(secondStartAllowed).toBe(true);
  });

  it('BLOCKS restart if markComplete is called prematurely (the old bug)', () => {
    const { secondStartAllowed } = simulateStrictModeRemount(true, 1);
    expect(secondStartAllowed).toBe(false);
  });

  it('after a finished animation, same dealNumber does not re-run', () => {
    const guard = createDealAnimGuard();
    expect(guard.shouldStart(1)).toBe(true);
    guard.markComplete(1);
    expect(guard.shouldStart(1)).toBe(false);
    expect(guard.shouldStart(2)).toBe(true);
  });

  it('reset allows the same dealNumber to animate again', () => {
    const guard = createDealAnimGuard();
    guard.markComplete(3);
    expect(guard.shouldStart(3)).toBe(false);
    guard.reset();
    expect(guard.shouldStart(3)).toBe(true);
  });

  it('full deal→complete→new deal cycle', () => {
    const deal = createDealAnimGuard();
    const crib = createDealAnimGuard();

    // Deal #1: Strict Mode double mount then finish
    expect(deal.shouldStart(1)).toBe(true);
    // cleanup aborts — no markComplete
    expect(deal.shouldStart(1)).toBe(true);
    deal.markComplete(1);
    expect(deal.shouldStart(1)).toBe(false);

    // Crib gather for deal #1
    expect(crib.shouldStart(1)).toBe(true);
    crib.markComplete(1);
    expect(crib.shouldStart(1)).toBe(false);

    // New deal #2 resets crib guard (as Table does at deal start)
    crib.reset();
    expect(deal.shouldStart(2)).toBe(true);
    deal.markComplete(2);
    expect(crib.shouldStart(2)).toBe(true);
  });
});
