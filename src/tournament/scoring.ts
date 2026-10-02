/**
 * Club Night scoring — ACC-style points.
 * Classic 121: skunk <91, double <61.
 * SuperCrib 241: scaled lines 181 / 122 (same fraction of the race).
 */

import {
  DOUBLE_SKUNK_LINE,
  FORFEIT_LOSS_SCORE,
  FORFEIT_WIN_SCORE,
  SKUNK_LINE,
  SUPERCRIB_DOUBLE_SKUNK_LINE,
  SUPERCRIB_SKUNK_LINE,
  type PairingResult,
  type TournamentVariant,
} from './types';

export function skunkLinesForVariant(variant: TournamentVariant = 'supercrib'): {
  skunk: number;
  doubleSkunk: number;
} {
  if (variant === 'classic_121') {
    return { skunk: SKUNK_LINE, doubleSkunk: DOUBLE_SKUNK_LINE };
  }
  return { skunk: SUPERCRIB_SKUNK_LINE, doubleSkunk: SUPERCRIB_DOUBLE_SKUNK_LINE };
}

export interface GamePointResult {
  gamePointsWinner: number;
  gamePointsLoser: number;
  spreadWinner: number;
  spreadLoser: number;
  skunk: boolean;
  doubleSkunk: boolean;
  /** 'win' | 'split' */
  kind: 'win' | 'split';
}

export function pointsForScores(
  winnerScore: number,
  loserScore: number,
  variant: TournamentVariant = 'supercrib',
): GamePointResult {
  const lines = skunkLinesForVariant(variant);
  const spread = winnerScore - loserScore;
  let gp = 2;
  let skunk = false;
  let doubleSkunk = false;
  if (loserScore < lines.doubleSkunk) {
    gp = 4;
    doubleSkunk = true;
    skunk = true;
  } else if (loserScore < lines.skunk) {
    gp = 3;
    skunk = true;
  }
  return {
    gamePointsWinner: gp,
    gamePointsLoser: 0,
    spreadWinner: spread,
    spreadLoser: -spread,
    skunk,
    doubleSkunk,
    kind: 'win',
  };
}

/** Clock expired with a clear leader. */
export function pointsForClockExpiry(
  scoreA: number,
  scoreB: number,
  variant: TournamentVariant = 'supercrib',
): {
  result: 'a' | 'b' | 'split';
  gamePointsA: number;
  gamePointsB: number;
  spreadA: number;
  spreadB: number;
  skunkA: boolean;
  skunkB: boolean;
} {
  if (scoreA === scoreB) {
    // Spec: play one more deal then call it; if still tied → both 1 GP, spread 0.
    // Callers that already exhausted the tiebreak pass equal scores here.
    return {
      result: 'split',
      gamePointsA: 1,
      gamePointsB: 1,
      spreadA: 0,
      spreadB: 0,
      skunkA: false,
      skunkB: false,
    };
  }
  if (scoreA > scoreB) {
    const pts = pointsForScores(scoreA, scoreB, variant);
    return {
      result: 'a',
      gamePointsA: pts.gamePointsWinner,
      gamePointsB: 0,
      spreadA: pts.spreadWinner,
      spreadB: pts.spreadLoser,
      skunkA: pts.skunk,
      skunkB: false,
    };
  }
  const pts = pointsForScores(scoreB, scoreA, variant);
  return {
    result: 'b',
    gamePointsA: 0,
    gamePointsB: pts.gamePointsWinner,
    spreadA: pts.spreadLoser,
    spreadB: pts.spreadWinner,
    skunkA: false,
    skunkB: pts.skunk,
  };
}

/** Forfeit: 121–90 style (2 pts, spread +31). No skunk unless host marks it. */
export function forfeitScores(winnerIsA: boolean): {
  result: 'forfeit_a' | 'forfeit_b';
  scoreA: number;
  scoreB: number;
  gamePointsA: number;
  gamePointsB: number;
  spreadA: number;
  spreadB: number;
} {
  const spread = FORFEIT_WIN_SCORE - FORFEIT_LOSS_SCORE; // 31
  if (winnerIsA) {
    return {
      result: 'forfeit_a',
      scoreA: FORFEIT_WIN_SCORE,
      scoreB: FORFEIT_LOSS_SCORE,
      gamePointsA: 2,
      gamePointsB: 0,
      spreadA: spread,
      spreadB: -spread,
    };
  }
  return {
    result: 'forfeit_b',
    scoreA: FORFEIT_LOSS_SCORE,
    scoreB: FORFEIT_WIN_SCORE,
    gamePointsA: 0,
    gamePointsB: 2,
    spreadA: -spread,
    spreadB: spread,
  };
}

/** Dual deadline forfeit: neither side locked in → both 0 GP, spread 0. */
export function deadlineForfeitScores(): {
  result: 'deadline';
  scoreA: null;
  scoreB: null;
  gamePointsA: number;
  gamePointsB: number;
  spreadA: number;
  spreadB: number;
} {
  return {
    result: 'deadline',
    scoreA: null,
    scoreB: null,
    gamePointsA: 0,
    gamePointsB: 0,
    spreadA: 0,
    spreadB: 0,
  };
}

/** True when deadlineAt is set and now is at/after it. */
export function isDeadlineExpired(
  deadlineAt: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && nowMs >= deadlineAt;
}

/** Ms remaining until lock-in deadline (0 if expired / missing). */
export function remainingLockInMs(
  deadlineAt: number | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt)) return 0;
  return Math.max(0, deadlineAt - nowMs);
}

/** Short countdown label, e.g. "59m" or "4m 12s" or "Expired". */
export function formatLockInCountdown(remainMs: number): string {
  if (remainMs <= 0) return 'Expired';
  const totalSec = Math.ceil(remainMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  if (m > 0 && s === 0) return `${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export interface StandingRow {
  userId: string;
  displayName: string;
  gamePoints: number;
  wins: number;
  losses: number;
  skunksGiven: number;
  skunksReceived: number;
  spread: number;
  joinedAt: number;
  place?: number;
}

export interface HeadToHeadMap {
  /** key = sorted uidA|uidB → winner uid (or 'split') */
  [pairKey: string]: string;
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Sort standings:
 * 1 GP desc, 2 spread desc, 3 wins desc, 4 skunks given desc,
 * 5 head-to-head, 6 join time asc (last resort).
 */
export function sortStandings(
  rows: StandingRow[],
  h2h: HeadToHeadMap = {},
): StandingRow[] {
  const sorted = [...rows].sort((x, y) => {
    if (y.gamePoints !== x.gamePoints) return y.gamePoints - x.gamePoints;
    if (y.spread !== x.spread) return y.spread - x.spread;
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.skunksGiven !== x.skunksGiven) return y.skunksGiven - x.skunksGiven;
    const key = pairKey(x.userId, y.userId);
    const winner = h2h[key];
    if (winner === x.userId) return -1;
    if (winner === y.userId) return 1;
    return x.joinedAt - y.joinedAt;
  });
  return sorted.map((r, i) => ({ ...r, place: i + 1 }));
}

export function applyResultToPlayers(
  players: Record<
    string,
    {
      gamePoints: number;
      wins: number;
      losses: number;
      skunksGiven: number;
      skunksReceived: number;
      spread: number;
    }
  >,
  playerAId: string | null,
  playerBId: string | null,
  result: PairingResult,
  gamePointsA: number,
  gamePointsB: number,
  spreadA: number,
  spreadB: number,
  skunkForA: boolean,
  skunkForB: boolean,
): void {
  if (result === 'bye') return;
  if (playerAId && players[playerAId]) {
    const p = players[playerAId];
    p.gamePoints += gamePointsA;
    p.spread += spreadA;
    if (result === 'a' || result === 'forfeit_a') p.wins += 1;
    else if (result === 'b' || result === 'forfeit_b') p.losses += 1;
    else if (result === 'deadline') p.losses += 1;
    else if (result === 'split') {
      /* both get 1 GP already in gamePoints */
    }
    if (skunkForA) p.skunksGiven += 1;
    if (skunkForB) p.skunksReceived += 1;
  }
  if (playerBId && players[playerBId]) {
    const p = players[playerBId];
    p.gamePoints += gamePointsB;
    p.spread += spreadB;
    if (result === 'b' || result === 'forfeit_b') p.wins += 1;
    else if (result === 'a' || result === 'forfeit_a') p.losses += 1;
    else if (result === 'deadline') p.losses += 1;
    if (skunkForB) p.skunksGiven += 1;
    if (skunkForA) p.skunksReceived += 1;
  }
}

/** Resolve submitted final pegs into pairing fields. */
export function resolveSubmittedScores(
  scoreA: number,
  scoreB: number,
  variant: TournamentVariant = 'supercrib',
): {
  result: PairingResult;
  gamePointsA: number;
  gamePointsB: number;
  spreadA: number;
  spreadB: number;
  skunkA: boolean;
  skunkB: boolean;
} {
  if (scoreA === scoreB) {
    return {
      result: 'split',
      gamePointsA: 1,
      gamePointsB: 1,
      spreadA: 0,
      spreadB: 0,
      skunkA: false,
      skunkB: false,
    };
  }
  if (scoreA > scoreB) {
    const pts = pointsForScores(scoreA, scoreB, variant);
    return {
      result: 'a',
      gamePointsA: pts.gamePointsWinner,
      gamePointsB: 0,
      spreadA: pts.spreadWinner,
      spreadB: pts.spreadLoser,
      skunkA: pts.skunk,
      skunkB: false,
    };
  }
  const pts = pointsForScores(scoreB, scoreA, variant);
  return {
    result: 'b',
    gamePointsA: 0,
    gamePointsB: pts.gamePointsWinner,
    spreadA: pts.spreadLoser,
    spreadB: pts.spreadWinner,
    skunkA: false,
    skunkB: pts.skunk,
  };
}
