/**
 * Club Night schedule metadata from player count (spec table + 4–20 circle method).
 *
 * Optional `gamesPerPlayer` truncates a full round-robin:
 * - Missing / 0 / ≥ full (n−1) → full schedule (even: n−1 rounds; odd: n rounds with byes).
 * - 2 … full−1 → partial: `rounds = gamesPerPlayer`, first G rounds of the circle schedule.
 *   Even n: each plays every round (= G games). Odd n: bye rounds may leave ±1 game variance.
 */

export interface ScheduleMeta {
  players: number;
  rounds: number;
  gamesPerPlayer: number;
  simultaneousBoards: number;
  /** Human-readable target time, e.g. "1.5–2h". */
  estimate: string;
}

const TABLE: Record<number, Omit<ScheduleMeta, 'players'>> = {
  4: { rounds: 3, gamesPerPlayer: 3, simultaneousBoards: 2, estimate: '~1–1.5h' },
  5: { rounds: 5, gamesPerPlayer: 4, simultaneousBoards: 2, estimate: '~1.25–1.75h' },
  6: { rounds: 5, gamesPerPlayer: 5, simultaneousBoards: 3, estimate: '1.5–2h' },
  7: { rounds: 7, gamesPerPlayer: 6, simultaneousBoards: 3, estimate: '2–2.5h' },
  8: { rounds: 7, gamesPerPlayer: 7, simultaneousBoards: 4, estimate: '2–2.75h' },
  9: { rounds: 9, gamesPerPlayer: 8, simultaneousBoards: 4, estimate: '2.5–3.25h' },
  10: { rounds: 9, gamesPerPlayer: 9, simultaneousBoards: 5, estimate: '2.5–3.5h' },
  11: { rounds: 11, gamesPerPlayer: 10, simultaneousBoards: 5, estimate: '~3–4h' },
  12: { rounds: 11, gamesPerPlayer: 11, simultaneousBoards: 6, estimate: '~3–4.25h' },
  13: { rounds: 13, gamesPerPlayer: 12, simultaneousBoards: 6, estimate: '~3.5–4.75h' },
  14: { rounds: 13, gamesPerPlayer: 13, simultaneousBoards: 7, estimate: '~3.75–5h' },
  15: { rounds: 15, gamesPerPlayer: 14, simultaneousBoards: 7, estimate: '~4–5.5h' },
  16: { rounds: 15, gamesPerPlayer: 15, simultaneousBoards: 8, estimate: '~4.25–5.75h' },
  17: { rounds: 17, gamesPerPlayer: 16, simultaneousBoards: 8, estimate: '~4.75–6.5h' },
  18: { rounds: 17, gamesPerPlayer: 17, simultaneousBoards: 9, estimate: '~5–7h' },
  19: { rounds: 19, gamesPerPlayer: 18, simultaneousBoards: 9, estimate: '~5.5–7.5h' },
  20: { rounds: 19, gamesPerPlayer: 19, simultaneousBoards: 10, estimate: '~6–8h' },
};

function fullScheduleMeta(n: number): ScheduleMeta {
  const row = TABLE[n];
  if (row) {
    return { players: n, ...row };
  }
  // Fallback for unexpected counts
  const odd = n % 2 === 1;
  const rounds = odd ? n : Math.max(0, n - 1);
  const gamesPerPlayer = Math.max(0, n - 1);
  const simultaneousBoards = Math.floor(n / 2);
  return {
    players: n,
    rounds,
    gamesPerPlayer,
    simultaneousBoards,
    estimate: '—',
  };
}

/**
 * @param gamesPerPlayer Optional target games each (2 … n−1). Missing/0 = full RR.
 *   Partial schedules take the first `gamesPerPlayer` circle rounds (odd: bye ±1 variance).
 */
export function scheduleMeta(
  playerCount: number,
  gamesPerPlayer?: number,
): ScheduleMeta {
  const n = Math.floor(playerCount);
  const full = fullScheduleMeta(n);
  const requested =
    typeof gamesPerPlayer === 'number' && Number.isFinite(gamesPerPlayer)
      ? Math.floor(gamesPerPlayer)
      : 0;

  // Missing / 0 / at-or-above full → full schedule (odd keeps n rounds with byes).
  if (requested <= 0 || requested >= full.gamesPerPlayer) {
    return full;
  }

  const G = Math.max(2, requested);
  return {
    players: n,
    // Even: each plays every round. Odd: first G rounds of circle (bye may ±1 games).
    rounds: G,
    gamesPerPlayer: G,
    simultaneousBoards: full.simultaneousBoards,
    estimate: '—',
  };
}

export function formatScheduleSummary(
  playerCount: number,
  gamesPerPlayer?: number,
): string {
  const m = scheduleMeta(playerCount, gamesPerPlayer);
  return `${m.rounds} rounds · ${m.gamesPerPlayer} games each · ${m.simultaneousBoards} boards · ${m.estimate}`;
}
