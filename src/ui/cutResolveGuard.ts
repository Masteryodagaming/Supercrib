/**
 * Cut-for-deal resolve scheduling must survive React 18 Strict Mode.
 *
 * BUG (freeze after cut): scheduling onResolved inside the reveal→winner
 * transition effect, then clearing that timeout in cleanup, leaves
 * stage==='winner' so the effect early-returns and never re-arms → stuck on
 * "…deals / Dealing…" forever (same class as dealAnimGuard premature mark).
 *
 * FIX: set stage to 'winner'/'tie' in the reveal effect only; schedule
 * onResolved / resetRound from dedicated effects that depend on those stages
 * so cleanup + remount re-arms while stage is still winner/tie.
 */

export type CutResolveScheduleMode = 'on-reveal-transition' | 'on-winner-stage';

/**
 * Simulate Strict Mode: effect → cleanup (clear timer) → effect again.
 * Returns whether resolve is still armed after remount.
 */
export function simulateCutResolveStrictMode(
  mode: CutResolveScheduleMode,
): { remountReschedulesResolve: boolean } {
  let stage: 'reveal' | 'winner' = 'reveal';
  let resolveArmed = false;

  const revealEffect = () => {
    if (stage !== 'reveal') return;
    stage = 'winner';
    if (mode === 'on-reveal-transition') {
      resolveArmed = true;
    }
  };

  const winnerEffect = () => {
    if (stage !== 'winner') return;
    if (mode === 'on-winner-stage') {
      resolveArmed = true;
    }
  };

  const cleanup = () => {
    resolveArmed = false;
  };

  // First mount
  revealEffect();
  winnerEffect();
  // Strict Mode abort
  cleanup();
  // Remount
  revealEffect();
  winnerEffect();

  return { remountReschedulesResolve: resolveArmed };
}

/**
 * Same pattern for tie → resetRound (must not schedule only on reveal→tie).
 */
export function simulateCutTieStrictMode(
  mode: CutResolveScheduleMode,
): { remountReschedulesReset: boolean } {
  let stage: 'reveal' | 'tie' = 'reveal';
  let resetArmed = false;

  const revealEffect = () => {
    if (stage !== 'reveal') return;
    stage = 'tie';
    if (mode === 'on-reveal-transition') {
      resetArmed = true;
    }
  };

  const tieEffect = () => {
    if (stage !== 'tie') return;
    if (mode === 'on-winner-stage') {
      // "on-winner-stage" here means dedicated post-reveal stage effect
      resetArmed = true;
    }
  };

  const cleanup = () => {
    resetArmed = false;
  };

  revealEffect();
  tieEffect();
  cleanup();
  revealEffect();
  tieEffect();

  return { remountReschedulesReset: resetArmed };
}
