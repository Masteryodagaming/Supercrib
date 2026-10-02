import { describe, it, expect } from 'vitest';
import {
  simulateCutResolveStrictMode,
  simulateCutTieStrictMode,
} from '../cutResolveGuard';

describe('cutResolveGuard (Strict Mode safe)', () => {
  it('BLOCKS resolve remount if timer was armed only on reveal→winner (old bug)', () => {
    const { remountReschedulesResolve } = simulateCutResolveStrictMode(
      'on-reveal-transition',
    );
    expect(remountReschedulesResolve).toBe(false);
  });

  it('allows resolve remount when timer is armed on winner stage (fix)', () => {
    const { remountReschedulesResolve } = simulateCutResolveStrictMode(
      'on-winner-stage',
    );
    expect(remountReschedulesResolve).toBe(true);
  });

  it('BLOCKS tie remount if reset was armed only on reveal→tie (old bug)', () => {
    const { remountReschedulesReset } = simulateCutTieStrictMode(
      'on-reveal-transition',
    );
    expect(remountReschedulesReset).toBe(false);
  });

  it('allows tie remount when reset is armed on tie stage (fix)', () => {
    const { remountReschedulesReset } = simulateCutTieStrictMode(
      'on-winner-stage',
    );
    expect(remountReschedulesReset).toBe(true);
  });
});
