import { describe, it, expect } from 'vitest';
import { createGame } from '../../engine/supercrib';
import {
  applyDisconnectForfeit,
  DISCONNECT_FORFEIT_MS,
  isForfeitWin,
} from '../disconnectForfeit';

describe('disconnect forfeit', () => {
  it('uses a 2 minute grace period', () => {
    expect(DISCONNECT_FORFEIT_MS).toBe(120_000);
  });

  it('awards the remaining seat and ends the game', () => {
    const g = createGame('online');
    g.phase = 'pegging';
    g.players[0].score = 40;
    g.players[1].score = 55;
    const next = applyDisconnectForfeit(g, 0);
    expect(next.winner).toBe(0);
    expect(next.phase).toBe('gameOver');
    expect(isForfeitWin(next)).toBe(true);
  });

  it('is a no-op if already over', () => {
    const g = createGame('online');
    g.phase = 'gameOver';
    g.winner = 1;
    const next = applyDisconnectForfeit(g, 0);
    expect(next).toBe(g);
  });
});
