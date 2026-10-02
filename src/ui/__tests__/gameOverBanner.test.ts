import { describe, it, expect } from 'vitest';
import { createGame } from '../../engine/supercrib';
import { clearShowForGameOverBanner, describeGameOver, SKUNK_LINE } from '../GameOverBanner';

describe('describeGameOver', () => {
  it('marks a normal win for the viewer', () => {
    const g = createGame('ai');
    g.phase = 'gameOver';
    g.winner = 0;
    g.players[0].score = 241;
    g.players[1].score = 200;
    const info = describeGameOver(g, 0, ['You', 'AI']);
    expect(info?.youWon).toBe(true);
    expect(info?.tone).toBe('win');
    expect(info?.headline).toContain('WIN');
    expect(info?.winnerScore).toBe(241);
    expect(info?.loserScore).toBe(200);
  });

  it('marks skunk when loser under S-180', () => {
    const g = createGame('ai');
    g.phase = 'gameOver';
    g.winner = 0;
    g.players[0].score = 241;
    g.players[1].score = SKUNK_LINE - 1;
    const info = describeGameOver(g, 1, ['You', 'AI']);
    expect(info?.youWon).toBe(false);
    expect(info?.tone).toBe('skunk');
    expect(info?.headline).toMatch(/SKUNK/i);
  });

  it('marks StinkHole when loser is on 240', () => {
    const g = createGame('ai');
    g.phase = 'gameOver';
    g.winner = 0;
    g.players[0].score = 241;
    g.players[1].score = 240;
    g.trapped = [false, true];
    const info = describeGameOver(g, 1, ['You', 'AI']);
    expect(info?.tone).toBe('stink');
    expect(info?.headline).toMatch(/STINKHOLE/i);
  });

  it('marks StinkHole escape win', () => {
    const g = createGame('ai');
    g.phase = 'gameOver';
    g.winner = 0;
    g.players[0].score = 241;
    g.players[1].score = 180;
    g.trapEscapeWin = true;
    const info = describeGameOver(g, 0, ['You', 'AI']);
    expect(info?.tone).toBe('stink');
    expect(info?.headline).toMatch(/ESCAPE/i);
  });
});

  it('clears showResult so the game-over banner can show (AI/online)', () => {
    const g = createGame('ai');
    g.phase = 'gameOver';
    g.winner = 0;
    g.players[0].score = 241;
    g.players[1].score = 200;
    const emptyBd = {
      fifteens: 0,
      pairs: 0,
      runs: 0,
      flush: 0,
      nobs: 0,
      raw: 0,
      multiplier: 1,
      total: 0,
    };
    g.showResult = {
      pone: { ...emptyBd, total: 10, raw: 10 },
      dealer: { ...emptyBd, total: 12, raw: 12 },
      crib: { ...emptyBd, total: 4, raw: 4 },
      zeroHandRedeal: false,
      zeroCribPenalty: 0,
      scoresAfter: [241, 200],
    };
    const next = clearShowForGameOverBanner(g);
    expect(next.showResult).toBeNull();
    expect(next.phase).toBe('gameOver');
    expect(next.winner).toBe(0);
    expect(describeGameOver(next, 0, ['You', 'AI'])?.headline).toContain('WIN');
  });
