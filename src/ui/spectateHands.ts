/**
 * Tournament Club Night spectate — UI privacy only.
 * Full GameState (including hole cards) still arrives via RTDB; this helper
 * controls what the spectator Table renders face-down vs face-up.
 */
import type { Phase } from '../engine/supercrib';

/** Phases where spectators may see both players' hole cards (show / count). */
const REVEAL_HAND_PHASES: ReadonlySet<Phase> = new Set([
  'show',
  'zeroHandOffer',
  'redeal',
  'gameOver',
]);

/**
 * When true, both hands should render as card backs (count visible).
 * Pegging plays, starter (once cut), and pegboard scores stay visible separately.
 */
export function spectatorHideHoleCards(phase: Phase): boolean {
  return !REVEAL_HAND_PHASES.has(phase);
}

export function isSpectatorRevealPhase(phase: Phase): boolean {
  return REVEAL_HAND_PHASES.has(phase);
}
