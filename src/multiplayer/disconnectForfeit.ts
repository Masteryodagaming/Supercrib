import type { GameState, PlayerId } from '../engine/supercrib';

/** Grace period before a disconnect becomes a forfeit win for the remaining player. */
export const DISCONNECT_FORFEIT_MS = 120_000;

export function applyDisconnectForfeit(
  state: GameState,
  winner: PlayerId,
): GameState {
  if (state.winner !== null || state.phase === 'gameOver') return state;
  const loser = (1 - winner) as PlayerId;
  return {
    ...state,
    winner,
    phase: 'gameOver',
    showResult: null,
    showReady: [false, false],
    trapEscapeWin: false,
    message: `Opponent disconnected over 2 minutes — seat ${winner} wins by forfeit (seat ${loser} forfeits).`,
  };
}

export function isForfeitWin(state: GameState): boolean {
  return /forfeit/i.test(state.message ?? '');
}
