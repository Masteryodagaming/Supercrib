/**
 * Best-of-3 playoff helpers after Club Night RR.
 * Top 8: quarters (1v8/4v5/2v7/3v6) → semis → final.
 * Top 6: play-in quarters (3v6/4v5); seeds 1–2 bye → semis → final.
 * Top 4: semis (1v4/2v3) → final.
 * Top 2: final only.
 */
import { pointsForScores, type StandingRow } from './scoring';
import type { PlayoffBracket, PlayoffGame, PlayoffSeries, TournamentVariant } from './types';

export const PLAYOFF_BEST_OF = 3;
export const PLAYOFF_WINS_NEEDED = 2;

export function rrComplete(
  currentRound: number,
  totalRounds: number,
  rounds: Record<string, { status: string; pairings: Array<{ result: string }> }>,
): boolean {
  if (currentRound < totalRounds || totalRounds < 1) return false;
  const last = rounds[String(totalRounds)];
  if (!last || last.status !== 'complete') return false;
  return last.pairings.every((p) => p.result !== 'pending');
}

function emptyGames(): PlayoffGame[] {
  return [1, 2, 3].map((gameIndex) => ({
    gameIndex,
    scoreA: null,
    scoreB: null,
    result: 'pending' as const,
    matchRoomCode: null,
  }));
}

function makeSeries(opts: {
  id: string;
  label: string;
  seedA: number;
  seedB: number;
  playerAId: string;
  playerBId: string;
}): PlayoffSeries {
  return {
    id: opts.id,
    label: opts.label,
    seedA: opts.seedA,
    seedB: opts.seedB,
    playerAId: opts.playerAId,
    playerBId: opts.playerBId,
    bestOf: PLAYOFF_BEST_OF,
    winsA: 0,
    winsB: 0,
    games: emptyGames(),
    status: 'live',
    winnerId: null,
  };
}

/** Quarterfinals from RR Top 8: 1v8, 4v5, 2v7, 3v6. */
export function buildQuartersFromStandings(standings: StandingRow[]): PlayoffBracket {
  if (standings.length < 8) {
    throw new Error('Need at least 8 players for Top 8 playoffs');
  }
  const [s1, s2, s3, s4, s5, s6, s7, s8] = standings;
  const qf1v8 = makeSeries({
    id: 'qf-1v8',
    label: 'Playoffs · QF 1 vs 8',
    seedA: 1,
    seedB: 8,
    playerAId: s1.userId,
    playerBId: s8.userId,
  });
  const qf4v5 = makeSeries({
    id: 'qf-4v5',
    label: 'Playoffs · QF 4 vs 5',
    seedA: 4,
    seedB: 5,
    playerAId: s4.userId,
    playerBId: s5.userId,
  });
  const qf2v7 = makeSeries({
    id: 'qf-2v7',
    label: 'Playoffs · QF 2 vs 7',
    seedA: 2,
    seedB: 7,
    playerAId: s2.userId,
    playerBId: s7.userId,
  });
  const qf3v6 = makeSeries({
    id: 'qf-3v6',
    label: 'Playoffs · QF 3 vs 6',
    seedA: 3,
    seedB: 6,
    playerAId: s3.userId,
    playerBId: s6.userId,
  });
  return {
    status: 'quarters',
    series: {
      [qf1v8.id]: qf1v8,
      [qf4v5.id]: qf4v5,
      [qf2v7.id]: qf2v7,
      [qf3v6.id]: qf3v6,
    },
  };
}

/**
 * Top 6 opening (play-in): only QF 3v6 and 4v5.
 * Seeds 1 and 2 get byes into semis. Reuses status 'quarters' so Live tabs work.
 */
export function buildTop6OpeningFromStandings(standings: StandingRow[]): PlayoffBracket {
  if (standings.length < 6) {
    throw new Error('Need at least 6 players for Top 6 playoffs');
  }
  const [, , s3, s4, s5, s6] = standings;
  const qf4v5 = makeSeries({
    id: 'qf-4v5',
    label: 'Playoffs · QF 4 vs 5',
    seedA: 4,
    seedB: 5,
    playerAId: s4.userId,
    playerBId: s5.userId,
  });
  const qf3v6 = makeSeries({
    id: 'qf-3v6',
    label: 'Playoffs · QF 3 vs 6',
    seedA: 3,
    seedB: 6,
    playerAId: s3.userId,
    playerBId: s6.userId,
  });
  return {
    status: 'quarters',
    series: {
      [qf4v5.id]: qf4v5,
      [qf3v6.id]: qf3v6,
    },
  };
}

export function buildSemisFromStandings(standings: StandingRow[]): PlayoffBracket {
  if (standings.length < 4) {
    throw new Error('Need at least 4 players for playoffs');
  }
  const [s1, s2, s3, s4] = standings;
  const sf14 = makeSeries({
    id: 'sf-1v4',
    label: 'Playoffs · SF 1 vs 4',
    seedA: 1,
    seedB: 4,
    playerAId: s1.userId,
    playerBId: s4.userId,
  });
  const sf23 = makeSeries({
    id: 'sf-2v3',
    label: 'Playoffs · SF 2 vs 3',
    seedA: 2,
    seedB: 3,
    playerAId: s2.userId,
    playerBId: s3.userId,
  });
  return {
    status: 'semis',
    series: {
      [sf14.id]: sf14,
      [sf23.id]: sf23,
    },
  };
}

/** Final-only bracket from RR #1 vs #2 (Top 2 advance — skip semis). */
export function buildFinalFromStandings(standings: StandingRow[]): PlayoffBracket {
  if (standings.length < 2) {
    throw new Error('Need at least 2 players for Top 2 playoffs');
  }
  const [s1, s2] = standings;
  const final = makeSeries({
    id: 'final',
    label: 'Playoffs · Final',
    seedA: 1,
    seedB: 2,
    playerAId: s1.userId,
    playerBId: s2.userId,
  });
  return {
    status: 'final',
    series: {
      final,
    },
  };
}

export function seriesWinsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export interface ApplyPlayoffGameOpts {
  /** Tournament race variant — drives skunk lines. */
  variant?: TournamentVariant;
  /**
   * When true, skunk or double-skunk awards +2 series wins (ends Bo3 in one game).
   * When false/omitted, every win is +1 (legacy behaviour).
   */
  playoffSkunkCountsAsTwo?: boolean;
}

/** Series wins awarded for one playoff game result (1 normal, 2 if skunk flag on). */
export function playoffSeriesWinsForGame(
  scoreA: number,
  scoreB: number,
  opts?: ApplyPlayoffGameOpts,
): number {
  if (!opts?.playoffSkunkCountsAsTwo) return 1;
  const winnerScore = Math.max(scoreA, scoreB);
  const loserScore = Math.min(scoreA, scoreB);
  const pts = pointsForScores(winnerScore, loserScore, opts.variant ?? 'supercrib');
  // skunk or doubleSkunk both count as skunk for this rule
  return pts.skunk || pts.doubleSkunk ? 2 : 1;
}

/** Apply one game result onto a series copy; may mark series complete. */
export function applyPlayoffGameResult(
  series: PlayoffSeries,
  gameIndex: number,
  scoreA: number,
  scoreB: number,
  opts?: ApplyPlayoffGameOpts,
): PlayoffSeries {
  if (series.status === 'complete') throw new Error('Series already complete');
  if (scoreA === scoreB) throw new Error('Playoff games cannot tie — enter a winner');
  const gIdx = series.games.findIndex((g) => g.gameIndex === gameIndex);
  if (gIdx < 0) throw new Error('Game not found');
  const game = series.games[gIdx];
  if (game.result !== 'pending') throw new Error('Game already scored');

  const result: 'a' | 'b' = scoreA > scoreB ? 'a' : 'b';
  const award = playoffSeriesWinsForGame(scoreA, scoreB, opts);
  const games = series.games.map((g, i) =>
    i === gIdx ? { ...g, scoreA, scoreB, result } : g,
  );
  let winsA = series.winsA;
  let winsB = series.winsB;
  if (result === 'a') winsA += award;
  else winsB += award;

  const need = seriesWinsNeeded(series.bestOf);
  let status: PlayoffSeries['status'] = series.status;
  // RTDB rejects `undefined`; missing winnerId after a prior null-delete must be null.
  let winnerId: string | null = series.winnerId ?? null;
  if (winsA >= need || winsB >= need) {
    status = 'complete';
    winnerId = winsA >= need ? series.playerAId : series.playerBId;
    // Remaining games stay pending/unused — nextPendingGameIndex skips when complete.
  }
  return {
    ...series,
    games: games.map((g) => ({
      gameIndex: g.gameIndex,
      scoreA: g.scoreA ?? null,
      scoreB: g.scoreB ?? null,
      result: g.result,
    })),
    winsA,
    winsB,
    status,
    winnerId,
  };
}

/** Strip undefined so Firebase update() accepts the payload. */
export function playoffSeriesForRtdb(series: PlayoffSeries): PlayoffSeries {
  return {
    id: series.id,
    label: series.label,
    seedA: series.seedA,
    seedB: series.seedB,
    playerAId: series.playerAId,
    playerBId: series.playerBId,
    bestOf: series.bestOf,
    winsA: series.winsA,
    winsB: series.winsB,
    status: series.status,
    winnerId: series.winnerId ?? null,
    games: (series.games ?? []).map((g) => ({
      gameIndex: g.gameIndex,
      scoreA: g.scoreA ?? null,
      scoreB: g.scoreB ?? null,
      result: g.result ?? 'pending',
      matchRoomCode: g.matchRoomCode ?? null,
    })),
  };
}

export function playoffBracketForRtdb(bracket: PlayoffBracket): PlayoffBracket {
  const series: Record<string, PlayoffSeries> = {};
  for (const [id, s] of Object.entries(bracket.series ?? {})) {
    series[id] = playoffSeriesForRtdb(s);
  }
  return { status: bracket.status, series };
}


export function nextPendingGameIndex(series: PlayoffSeries): number | null {
  if (series.status === 'complete') return null;
  const g = series.games.find((x) => x.result === 'pending');
  return g ? g.gameIndex : null;
}

/** All quarterfinal series (id starts with qf-). */
export function quarterSeriesList(bracket: PlayoffBracket): PlayoffSeries[] {
  return Object.values(bracket.series ?? {}).filter((s) => s.id.startsWith('qf-'));
}

/** All semifinal series (id starts with sf-). */
export function semiSeriesList(bracket: PlayoffBracket): PlayoffSeries[] {
  return Object.values(bracket.series ?? {}).filter((s) => s.id.startsWith('sf-'));
}

export function bothQuartersComplete(bracket: PlayoffBracket): boolean {
  const qfs = quarterSeriesList(bracket);
  if (qfs.length === 0) return false;
  if (!qfs.every((s) => s.status === 'complete' && !!s.winnerId)) return false;
  // Top 8: four QFs
  if (qfs.length >= 4) return true;
  // Top 6 play-in: only 3v6 and 4v5
  return (
    qfs.length === 2 &&
    !!bracket.series['qf-3v6'] &&
    !!bracket.series['qf-4v5']
  );
}

/** True when bracket is Top 6 play-in (2 QFs, no 1v8/2v7). */
export function isTop6PlayInBracket(bracket: PlayoffBracket): boolean {
  return (
    !!bracket.series['qf-3v6'] &&
    !!bracket.series['qf-4v5'] &&
    !bracket.series['qf-1v8'] &&
    !bracket.series['qf-2v7']
  );
}

export function bothSemisComplete(bracket: PlayoffBracket): boolean {
  const sfs = semiSeriesList(bracket);
  // Prefer explicit legacy ids when present; otherwise any two complete sf-* series.
  if (sfs.length >= 2) {
    return sfs.every((s) => s.status === 'complete' && !!s.winnerId);
  }
  const sf14 = bracket.series['sf-1v4'];
  const sf23 = bracket.series['sf-2v3'];
  return !!sf14 && !!sf23 && sf14.status === 'complete' && sf23.status === 'complete';
}

/**
 * After all QFs complete: semis winner(1v8) vs winner(4v5), winner(2v7) vs winner(3v6).
 * Returns new sf-a / sf-b series (does not mutate bracket).
 */
export function buildSemisFromQuarters(bracket: PlayoffBracket): {
  'sf-a': PlayoffSeries;
  'sf-b': PlayoffSeries;
} {
  const qf1v8 = bracket.series['qf-1v8'];
  const qf4v5 = bracket.series['qf-4v5'];
  const qf2v7 = bracket.series['qf-2v7'];
  const qf3v6 = bracket.series['qf-3v6'];
  if (
    !qf1v8?.winnerId ||
    !qf4v5?.winnerId ||
    !qf2v7?.winnerId ||
    !qf3v6?.winnerId
  ) {
    throw new Error('Quarterfinals not finished');
  }
  // Carry the better (lower) RR seed onto each semi slot for podium ranking.
  const seedOfWinner = (s: PlayoffSeries): number => {
    if (s.winnerId === s.playerAId) return s.seedA;
    if (s.winnerId === s.playerBId) return s.seedB;
    return 0;
  };
  const sfA = makeSeries({
    id: 'sf-a',
    label: 'Playoffs · SF A',
    seedA: seedOfWinner(qf1v8),
    seedB: seedOfWinner(qf4v5),
    playerAId: qf1v8.winnerId,
    playerBId: qf4v5.winnerId,
  });
  const sfB = makeSeries({
    id: 'sf-b',
    label: 'Playoffs · SF B',
    seedA: seedOfWinner(qf2v7),
    seedB: seedOfWinner(qf3v6),
    playerAId: qf2v7.winnerId,
    playerBId: qf3v6.winnerId,
  });
  return { 'sf-a': sfA, 'sf-b': sfB };
}

/**
 * After Top 6 play-in QFs complete: semis are 1 vs winner(4v5), 2 vs winner(3v6).
 * Bye seeds 1 and 2 come from RR standings (same order used to open playoffs).
 */
export function buildSemisFromTop6Quarters(
  bracket: PlayoffBracket,
  standings: StandingRow[],
): {
  'sf-a': PlayoffSeries;
  'sf-b': PlayoffSeries;
} {
  if (standings.length < 6) {
    throw new Error('Need at least 6 players for Top 6 playoffs');
  }
  const qf4v5 = bracket.series['qf-4v5'];
  const qf3v6 = bracket.series['qf-3v6'];
  if (!qf4v5?.winnerId || !qf3v6?.winnerId) {
    throw new Error('Play-in quarters not finished');
  }
  const seedOfWinner = (s: PlayoffSeries): number => {
    if (s.winnerId === s.playerAId) return s.seedA;
    if (s.winnerId === s.playerBId) return s.seedB;
    return 0;
  };
  const s1 = standings[0];
  const s2 = standings[1];
  // Classic 6-team: 1 vs W(4v5), 2 vs W(3v6)
  const sfA = makeSeries({
    id: 'sf-a',
    label: 'Playoffs · SF A',
    seedA: 1,
    seedB: seedOfWinner(qf4v5),
    playerAId: s1.userId,
    playerBId: qf4v5.winnerId,
  });
  const sfB = makeSeries({
    id: 'sf-b',
    label: 'Playoffs · SF B',
    seedA: 2,
    seedB: seedOfWinner(qf3v6),
    playerAId: s2.userId,
    playerBId: qf3v6.winnerId,
  });
  return { 'sf-a': sfA, 'sf-b': sfB };
}

export function buildFinalSeries(bracket: PlayoffBracket): PlayoffSeries {
  const sfs = semiSeriesList(bracket).filter(
    (s) => s.status === 'complete' && !!s.winnerId,
  );
  // Stable order: prefer legacy ids, then sf-a/sf-b, then alphabetical.
  const orderKey = (id: string): number => {
    if (id === 'sf-1v4' || id === 'sf-a') return 0;
    if (id === 'sf-2v3' || id === 'sf-b') return 1;
    return 2;
  };
  sfs.sort((a, b) => {
    const d = orderKey(a.id) - orderKey(b.id);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
  if (sfs.length < 2 || !sfs[0].winnerId || !sfs[1].winnerId) {
    throw new Error('Semifinals not finished');
  }
  return makeSeries({
    id: 'final',
    label: 'Playoffs · Final',
    seedA: 0,
    seedB: 0,
    playerAId: sfs[0].winnerId,
    playerBId: sfs[1].winnerId,
  });
}


export interface PlayoffPodium {
  firstId: string;
  secondId: string;
  thirdId: string;
  /** Remaining semifinal loser (4th). */
  fourthId: string;
}

function seriesLoserId(series: PlayoffSeries): string | null {
  if (!series.winnerId) return null;
  if (series.winnerId === series.playerAId) return series.playerBId;
  if (series.winnerId === series.playerBId) return series.playerAId;
  return null;
}

/** RR seed on the losing side of a series (seedA/seedB). Null if missing or 0. */
function loserSeed(series: PlayoffSeries): number | null {
  const loserId = seriesLoserId(series);
  if (!loserId) return null;
  const seed =
    loserId === series.playerAId ? series.seedA : series.seedB;
  return typeof seed === 'number' && seed > 0 ? seed : null;
}

/**
 * Final places for a completed playoff bracket.
 * 1st = final winner; 2nd = other finalist; 3rd = better (lower) RR seed among
 * the two semifinal losers; 4th = the other semi loser.
 * Top 2 (final-only): 3rd/4th from optional rrOrder.
 * Optional `rrOrder` (userIds best→worst from computeStandings) used when
 * series seeds are missing. Returns null if the bracket is not complete.
 */
export function playoffPodium(
  bracket: PlayoffBracket,
  rrOrder?: string[],
): PlayoffPodium | null {
  if (bracket.status !== 'complete') return null;
  const final = bracket.series['final'];
  if (!final || final.status !== 'complete' || !final.winnerId) return null;

  const firstId = final.winnerId;
  const secondId =
    final.playerAId === firstId ? final.playerBId : final.playerAId;
  if (!secondId || secondId === firstId) return null;

  const sfs = semiSeriesList(bracket).filter((s) => !!s.winnerId);
  // Top 2 advance: final-only bracket — 3rd/4th from RR order (or remaining seats).
  if (sfs.length < 2) {
    const used = new Set([firstId, secondId]);
    const rest = (rrOrder ?? []).filter((id) => id && !used.has(id));
    const thirdId = rest[0] ?? '';
    const fourthId = rest[1] ?? '';
    if (!thirdId || !fourthId) return null;
    return { firstId, secondId, thirdId, fourthId };
  }

  // Prefer legacy pairing when both present for stable 3rd/4th fallback order.
  const sfA =
    bracket.series['sf-1v4'] ??
    bracket.series['sf-a'] ??
    sfs[0];
  const sfB =
    bracket.series['sf-2v3'] ??
    bracket.series['sf-b'] ??
    sfs.find((s) => s.id !== sfA.id) ??
    sfs[1];

  const loserA = seriesLoserId(sfA);
  const loserB = seriesLoserId(sfB);
  if (!loserA || !loserB) return null;

  const seedA = loserSeed(sfA);
  const seedB = loserSeed(sfB);

  let thirdId: string;
  let fourthId: string;

  if (seedA != null && seedB != null && seedA !== seedB) {
    if (seedA < seedB) {
      thirdId = loserA;
      fourthId = loserB;
    } else {
      thirdId = loserB;
      fourthId = loserA;
    }
  } else if (rrOrder && rrOrder.length > 0) {
    const iA = rrOrder.indexOf(loserA);
    const iB = rrOrder.indexOf(loserB);
    if (iA >= 0 && (iB < 0 || iA <= iB)) {
      thirdId = loserA;
      fourthId = loserB;
    } else if (iB >= 0) {
      thirdId = loserB;
      fourthId = loserA;
    } else {
      thirdId = loserA;
      fourthId = loserB;
    }
  } else {
    // No usable seeds / RR order — stable fallback.
    thirdId = loserA;
    fourthId = loserB;
  }

  return { firstId, secondId, thirdId, fourthId };
}
