import { describe, expect, it } from 'vitest';
import {
  deadlineForfeitScores,
  forfeitScores,
  formatLockInCountdown,
  isDeadlineExpired,
  pointsForClockExpiry,
  pointsForScores,
  remainingLockInMs,
  resolveSubmittedScores,
  sortStandings,
  applyResultToPlayers,
} from '../scoring';

describe('club night scoring', () => {
  it('classic 121: win=2, skunk=3 (<91), double=4 (<61)', () => {
    expect(pointsForScores(121, 100, 'classic_121').gamePointsWinner).toBe(2);
    expect(pointsForScores(121, 100, 'classic_121').skunk).toBe(false);

    const sk = pointsForScores(121, 90, 'classic_121');
    expect(sk.gamePointsWinner).toBe(3);
    expect(sk.skunk).toBe(true);
    expect(sk.doubleSkunk).toBe(false);

    const dsk = pointsForScores(121, 60, 'classic_121');
    expect(dsk.gamePointsWinner).toBe(4);
    expect(dsk.doubleSkunk).toBe(true);
  });

  it('SuperCrib 241: skunk <181, double <122', () => {
    expect(pointsForScores(241, 200).gamePointsWinner).toBe(2);
    expect(pointsForScores(241, 200).skunk).toBe(false);

    const sk = pointsForScores(241, 180);
    expect(sk.gamePointsWinner).toBe(3);
    expect(sk.skunk).toBe(true);
    expect(sk.doubleSkunk).toBe(false);

    // 241–100 → double skunk (under 122)
    const dsk = pointsForScores(241, 100);
    expect(dsk.gamePointsWinner).toBe(4);
    expect(dsk.doubleSkunk).toBe(true);
  });

  it('spread is winner − loser', () => {
    const r = pointsForScores(241, 180);
    expect(r.spreadWinner).toBe(61);
    expect(r.spreadLoser).toBe(-61);
  });

  it('clock expiry: leader wins; tie → 1 each', () => {
    const a = pointsForClockExpiry(150, 120, 'classic_121');
    expect(a.result).toBe('a');
    expect(a.gamePointsA).toBe(2);

    const sk = pointsForClockExpiry(100, 50, 'classic_121');
    expect(sk.result).toBe('a');
    expect(sk.gamePointsA).toBe(4);

    const tie = pointsForClockExpiry(88, 88);
    expect(tie.result).toBe('split');
    expect(tie.gamePointsA).toBe(1);
    expect(tie.gamePointsB).toBe(1);
  });

  it('forfeit 121-90 style (2 pts, spread 31)', () => {
    const f = forfeitScores(true);
    expect(f.scoreA).toBe(121);
    expect(f.scoreB).toBe(90);
    expect(f.gamePointsA).toBe(2);
    expect(f.spreadA).toBe(31);
  });

  it('standings sort: GP, spread, wins, skunks, join time', () => {
    const rows = sortStandings([
      {
        userId: 'c',
        displayName: 'C',
        gamePoints: 10,
        wins: 5,
        losses: 0,
        skunksGiven: 0,
        skunksReceived: 0,
        spread: 10,
        joinedAt: 3,
      },
      {
        userId: 'a',
        displayName: 'A',
        gamePoints: 14,
        wins: 5,
        losses: 1,
        skunksGiven: 1,
        skunksReceived: 0,
        spread: 40,
        joinedAt: 1,
      },
      {
        userId: 'b',
        displayName: 'B',
        gamePoints: 14,
        wins: 6,
        losses: 0,
        skunksGiven: 0,
        skunksReceived: 0,
        spread: 40,
        joinedAt: 2,
      },
    ]);
    expect(rows.map((r) => r.userId)).toEqual(['b', 'a', 'c']);
    expect(rows[0].place).toBe(1);
  });

  it('resolveSubmittedScores maps correctly', () => {
    const classic = resolveSubmittedScores(200, 80, 'classic_121');
    expect(classic.result).toBe('a');
    expect(classic.gamePointsA).toBe(3);

    const superWin = resolveSubmittedScores(241, 100, 'supercrib');
    expect(superWin.result).toBe('a');
    expect(superWin.gamePointsA).toBe(4); // double skunk under 122
    expect(superWin.skunkA).toBe(true);
  });
});

describe('round lock-in deadline', () => {
  it('isDeadlineExpired / remainingLockInMs', () => {
    expect(isDeadlineExpired(undefined, 1000)).toBe(false);
    expect(isDeadlineExpired(null, 1000)).toBe(false);
    expect(isDeadlineExpired(2000, 1000)).toBe(false);
    expect(isDeadlineExpired(1000, 1000)).toBe(true);
    expect(isDeadlineExpired(500, 1000)).toBe(true);
    expect(remainingLockInMs(1500, 1000)).toBe(500);
    expect(remainingLockInMs(500, 1000)).toBe(0);
  });

  it('formatLockInCountdown', () => {
    expect(formatLockInCountdown(0)).toBe('Expired');
    expect(formatLockInCountdown(59_000)).toMatch(/59s|1m/);
    expect(formatLockInCountdown(5 * 60_000)).toBe('5m');
    expect(formatLockInCountdown(90_000)).toBe('1m 30s');
  });

  it('deadline forfeit: both 0 GP, spread 0, result deadline', () => {
    const d = deadlineForfeitScores();
    expect(d.result).toBe('deadline');
    expect(d.gamePointsA).toBe(0);
    expect(d.gamePointsB).toBe(0);
    expect(d.spreadA).toBe(0);
    expect(d.spreadB).toBe(0);
    expect(d.scoreA).toBeNull();
    expect(d.scoreB).toBeNull();

    const players = {
      a: { gamePoints: 4, wins: 2, losses: 0, skunksGiven: 0, skunksReceived: 0, spread: 10 },
      b: { gamePoints: 2, wins: 1, losses: 1, skunksGiven: 0, skunksReceived: 0, spread: -5 },
    };
    applyResultToPlayers(players, 'a', 'b', d.result, d.gamePointsA, d.gamePointsB, d.spreadA, d.spreadB, false, false);
    expect(players.a.gamePoints).toBe(4);
    expect(players.b.gamePoints).toBe(2);
    expect(players.a.spread).toBe(10);
    expect(players.b.spread).toBe(-5);
    expect(players.a.losses).toBe(1);
    expect(players.b.losses).toBe(2);
    expect(players.a.wins).toBe(2);
    expect(players.b.wins).toBe(1);
  });
});
