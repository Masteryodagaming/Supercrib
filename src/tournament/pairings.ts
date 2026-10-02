/**
 * Club Night Round Robin — circle-method pairings.
 * Even n: fix seat 0, rotate the rest.
 * Odd n: add a virtual BYE seat and use the same method.
 * Never rematch within one event. Regenerate only before Round 1.
 */

export const BYE_ID = '__BYE__';

export interface GeneratedPairing {
  board: number;
  playerAId: string | null;
  playerBId: string | null;
  isBye: boolean;
}

export interface GeneratedRound {
  roundNumber: number;
  pairings: GeneratedPairing[];
}

/**
 * Circle method for n ≥ 2 player ids (order = seats).
 * Returns (n-1) rounds when n even, n rounds when n odd (with bye).
 * Optional `maxRounds` keeps only the first N rounds (partial RR / rrGamesPerPlayer).
 */
export function generateCirclePairings(
  playerIds: string[],
  maxRounds?: number,
): GeneratedRound[] {
  const n = playerIds.length;
  if (n < 2) {
    throw new Error('Need at least 2 players for pairings');
  }

  const odd = n % 2 === 1;
  // Working circle: fixed[0] stays; others rotate. For odd, append BYE.
  const circle: (string | null)[] = odd
    ? [...playerIds, null]
    : [...playerIds];
  const m = circle.length; // even
  const rounds = odd ? n : n - 1;
  const half = m / 2;

  const out: GeneratedRound[] = [];

  for (let r = 0; r < rounds; r++) {
    const pairings: GeneratedPairing[] = [];
    let board = 1;
    for (let i = 0; i < half; i++) {
      const a = circle[i];
      const b = circle[m - 1 - i];
      if (a === null || b === null) {
        const real = a ?? b;
        pairings.push({
          board: board++,
          playerAId: real,
          playerBId: null,
          isBye: true,
        });
      } else {
        pairings.push({
          board: board++,
          playerAId: a,
          playerBId: b,
          isBye: false,
        });
      }
    }
    out.push({ roundNumber: r + 1, pairings });

    // Rotate all except index 0: take last → insert at index 1
    if (r < rounds - 1) {
      const last = circle.pop()!;
      circle.splice(1, 0, last);
    }
  }

  if (
    typeof maxRounds === 'number' &&
    Number.isFinite(maxRounds) &&
    maxRounds > 0 &&
    maxRounds < out.length
  ) {
    return out.slice(0, Math.floor(maxRounds));
  }
  return out;
}

/** Number of RR rounds for a player count (4–20). */
export function roundsForPlayerCount(n: number): number {
  if (n < 2) return 0;
  return n % 2 === 1 ? n : n - 1;
}

/**
 * Assert no rematches across the schedule (unordered pairs unique).
 * Byes ignored.
 */
export function assertNoRematches(rounds: GeneratedRound[]): void {
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const p of round.pairings) {
      if (p.isBye || !p.playerAId || !p.playerBId) continue;
      const key = [p.playerAId, p.playerBId].sort().join('|');
      if (seen.has(key)) {
        throw new Error(`Rematch detected: ${key}`);
      }
      seen.add(key);
    }
  }
}

/**
 * For odd n: each player should receive exactly one bye across the event.
 */
export function byeCounts(rounds: GeneratedRound[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const round of rounds) {
    for (const p of round.pairings) {
      if (!p.isBye) continue;
      const id = p.playerAId ?? p.playerBId;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function regenerateAllowed(currentRound: number, pairingsLocked?: boolean): boolean {
  if (pairingsLocked) return false;
  return currentRound < 1;
}
