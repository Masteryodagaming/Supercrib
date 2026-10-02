import { describe, expect, it } from 'vitest';
import {
  assertNoRematches,
  byeCounts,
  generateCirclePairings,
  regenerateAllowed,
  roundsForPlayerCount,
} from '../pairings';
import { scheduleMeta } from '../scheduleMeta';

describe('club_night_rr pairings (circle method)', () => {
  it('4–20: rounds match schedule table and no rematches', () => {
    for (let n = 4; n <= 20; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const rounds = generateCirclePairings(ids);
      const meta = scheduleMeta(n);
      expect(rounds.length).toBe(meta.rounds);
      expect(roundsForPlayerCount(n)).toBe(meta.rounds);
      expect(() => assertNoRematches(rounds)).not.toThrow();
      // Each non-bye round has floor(n/2) boards (bye board counts for odd)
      for (const r of rounds) {
        expect(r.pairings.length).toBe(Math.ceil(n / 2) === Math.floor(n / 2) ? n / 2 : Math.ceil(n / 2));
        // actually for even: n/2 boards; for odd: (n+1)/2 including bye
        expect(r.pairings.length).toBe(n % 2 === 0 ? n / 2 : (n + 1) / 2);
      }
    }
  });

  it('never rematches any pair', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rounds = generateCirclePairings(ids);
    const seen = new Set<string>();
    for (const r of rounds) {
      for (const p of r.pairings) {
        if (!p.playerAId || !p.playerBId) continue;
        const key = [p.playerAId, p.playerBId].sort().join('|');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('7-player: each player gets exactly one bye', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const rounds = generateCirclePairings(ids);
    expect(rounds.length).toBe(7);
    const counts = byeCounts(rounds);
    expect(counts.size).toBe(7);
    for (const id of ids) {
      expect(counts.get(id)).toBe(1);
    }
  });

  it('regenerate only before round 1', () => {
    expect(regenerateAllowed(0, false)).toBe(true);
    expect(regenerateAllowed(1, true)).toBe(false);
    expect(regenerateAllowed(0, true)).toBe(false);
  });

  it('scheduleMeta for 12/16/20', () => {
    expect(scheduleMeta(12)).toMatchObject({
      rounds: 11,
      gamesPerPlayer: 11,
      simultaneousBoards: 6,
    });
    expect(scheduleMeta(16)).toMatchObject({
      rounds: 15,
      gamesPerPlayer: 15,
      simultaneousBoards: 8,
    });
    expect(scheduleMeta(20)).toMatchObject({
      rounds: 19,
      gamesPerPlayer: 19,
      simultaneousBoards: 10,
    });
  });

  it('partial rrGamesPerPlayer truncates circle rounds', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    expect(scheduleMeta(8, 3)).toMatchObject({ rounds: 3, gamesPerPlayer: 3 });
    const rounds = generateCirclePairings(ids, scheduleMeta(8, 3).rounds);
    expect(rounds.length).toBe(3);
    expect(() => assertNoRematches(rounds)).not.toThrow();

    // Odd: full has 7 rounds / 6 games; G=3 → first 3 circle rounds
    expect(scheduleMeta(7, 3)).toMatchObject({ rounds: 3, gamesPerPlayer: 3 });
    expect(scheduleMeta(7, 0).rounds).toBe(7);
    expect(scheduleMeta(7).rounds).toBe(7);
    const odd = generateCirclePairings(
      Array.from({ length: 7 }, (_, i) => `p${i}`),
      3,
    );
    expect(odd.length).toBe(3);
  });

});
