/**
 * Tracks which dealNumber has finished a UI animation (deal fly-in or crib gather).
 *
 * CRITICAL: call markComplete only when the timer/interval finishes — never when
 * starting the effect. Marking on start + clearing the timer in effect cleanup
 * (React 18 Strict Mode double-mount) leaves dealAnimating true forever: remount
 * sees the guard and never restarts the interval → stuck on "Dealing…".
 */
export type DealAnimGuard = {
  /** True if this dealNumber still needs its animation to run (or re-run). */
  shouldStart(dealNumber: number): boolean;
  /** Record that animation for this dealNumber finished successfully. */
  markComplete(dealNumber: number): void;
  /** Clear so the next deal can animate (e.g. when a new deal begins). */
  reset(): void;
  /** Last dealNumber that completed, or null. */
  completedDealNumber(): number | null;
};

export function createDealAnimGuard(
  initialCompleted: number | null = null,
): DealAnimGuard {
  let completed: number | null = initialCompleted;
  return {
    shouldStart(dealNumber: number) {
      return completed !== dealNumber;
    },
    markComplete(dealNumber: number) {
      completed = dealNumber;
    },
    reset() {
      completed = null;
    },
    completedDealNumber() {
      return completed;
    },
  };
}

/**
 * Simulate Strict Mode: start → abort cleanup before finish → start again.
 * Returns whether the second start is allowed (must be true) and whether a
 * premature markComplete would block restart (must be false if marked early).
 */
export function simulateStrictModeRemount(
  markOnStart: boolean,
  dealNumber: number,
): { secondStartAllowed: boolean } {
  const guard = createDealAnimGuard();
  // First mount
  const first = guard.shouldStart(dealNumber);
  if (!first) return { secondStartAllowed: false };
  if (markOnStart) guard.markComplete(dealNumber);
  // Cleanup aborts timer — animation did NOT finish
  // Second mount (Strict Mode)
  const secondStartAllowed = guard.shouldStart(dealNumber);
  return { secondStartAllowed };
}
