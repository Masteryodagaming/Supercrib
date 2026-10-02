/**
 * Offline builder: Practice-20 Club Night → complete Firebase RTDB tournament node.
 * Seed RNG matches prior sim: seededRng(20260914).
 *
 * Run: npx vitest run scripts/build-study-practice-20.test.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCirclePairings } from '../src/tournament/pairings';
import {
  applyResultToPlayers,
  resolveSubmittedScores,
  sortStandings,
  pairKey,
  type StandingRow,
  type HeadToHeadMap,
} from '../src/tournament/scoring';
import {
  applyPlayoffGameResult,
  buildQuartersFromStandings,
  buildSemisFromQuarters,
  buildFinalSeries,
  bothQuartersComplete,
  bothSemisComplete,
  nextPendingGameIndex,
  playoffPodium,
  playoffBracketForRtdb,
} from '../src/tournament/playoffs';
import {
  PRACTICE_AI_ROSTER,
  pickPracticeAiScores,
  makeAiTournamentPlayer,
  makeOwnerTournamentPlayer,
} from '../src/tournament/practiceAi';
import type {
  PlayoffBracket,
  Tournament,
  TournamentDoc,
  TournamentPairing,
  TournamentPlayer,
  TournamentRound,
} from '../src/tournament/types';
import { CURRENT_SCORING_VERSION } from '../src/tournament/types';

export const STUDY_SEED = 20260914;
export const STUDY_OWNER_UID = 'CphdDQWSDQbCf58rAMpo78wtFFm2';
export const STUDY_OWNER_NAME = 'Joshwa Milliea';
export const STUDY_TOURNAMENT_ID = '-STUDY20PRACTICE01';
export const STUDY_JOIN_CODE = 'STUDY1';

export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function advanceBracket(b: PlayoffBracket): PlayoffBracket {
  if (b.status === 'quarters' && bothQuartersComplete(b) && !b.series['sf-a']) {
    const built = buildSemisFromQuarters(b);
    return { status: 'semis', series: { ...b.series, ...built } };
  }
  if (b.status === 'semis' && bothSemisComplete(b) && !b.series['final']) {
    const fin = buildFinalSeries(b);
    return { status: 'final', series: { ...b.series, final: fin } };
  }
  if (b.series['final']?.status === 'complete' && b.status !== 'complete') {
    return { ...b, status: 'complete' };
  }
  return b;
}

function resolveAllPending(bracket: PlayoffBracket, rng: () => number): PlayoffBracket {
  let next = bracket;
  for (let guard = 0; guard < 500; guard++) {
    next = advanceBracket(next);
    if (next.status === 'complete') return next;

    let found: { id: string; gameIndex: number } | null = null;
    for (const series of Object.values(next.series)) {
      if (series.status === 'complete') continue;
      const gi = nextPendingGameIndex(series);
      if (gi === null) continue;
      found = { id: series.id, gameIndex: gi };
      break;
    }
    if (!found) {
      const advanced = advanceBracket(next);
      if (advanced.series['final']?.status === 'complete') {
        return { ...advanced, status: 'complete' };
      }
      if (advanced === next || advanced.status === next.status) {
        return advanced;
      }
      next = advanced;
      continue;
    }

    const series = next.series[found.id];
    const scores = pickPracticeAiScores({ random: true, rng });
    const updated = applyPlayoffGameResult(series, found.gameIndex, scores.scoreA, scores.scoreB, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: false,
    });
    next = {
      ...next,
      series: { ...next.series, [found.id]: updated },
    };
  }
  return next;
}

export interface StudyBuildResult {
  doc: TournamentDoc;
  summary: {
    tournamentId: string;
    joinCode: string;
    seed: number;
    players: number;
    rrRounds: number;
    rrGames: number;
    rrTop8: Array<{
      place: number;
      name: string;
      userId: string;
      pts: number;
      wl: string;
      spread: number;
    }>;
    podium: {
      first: string;
      second: string;
      third: string;
      fourth: string;
      firstId: string;
      secondId: string;
      thirdId: string;
      fourthId: string;
    };
  };
}

export function buildStudyPractice20(opts?: {
  nowMs?: number;
  tournamentId?: string;
  joinCode?: string;
}): StudyBuildResult {
  const nowMs = opts?.nowMs ?? Date.now();
  const tournamentId = opts?.tournamentId ?? STUDY_TOURNAMENT_ID;
  const joinCode = opts?.joinCode ?? STUDY_JOIN_CODE;
  const rng = seededRng(STUDY_SEED);

  const ownerPlayer = makeOwnerTournamentPlayer(
    { uid: STUDY_OWNER_UID, displayName: STUDY_OWNER_NAME },
    0,
    nowMs,
  );

  const players: Record<string, TournamentPlayer> = {
    [STUDY_OWNER_UID]: ownerPlayer,
  };
  PRACTICE_AI_ROSTER.forEach((slot, i) => {
    const p = makeAiTournamentPlayer(slot, i + 1, nowMs + i + 1);
    players[p.userId] = p;
  });

  const seated = Object.values(players).sort((a, b) => a.seat - b.seat);
  const playerIds = seated.map((p) => p.userId);
  const names = Object.fromEntries(seated.map((p) => [p.userId, p.displayName]));

  const stats: Record<
    string,
    {
      gamePoints: number;
      wins: number;
      losses: number;
      skunksGiven: number;
      skunksReceived: number;
      spread: number;
    }
  > = {};
  for (const id of playerIds) {
    stats[id] = {
      gamePoints: 0,
      wins: 0,
      losses: 0,
      skunksGiven: 0,
      skunksReceived: 0,
      spread: 0,
    };
  }
  const h2h: HeadToHeadMap = {};

  const generated = generateCirclePairings(playerIds);
  if (generated.length !== 19) {
    throw new Error(`Expected 19 RR rounds, got ${generated.length}`);
  }

  const rounds: Record<string, TournamentRound> = {};
  let gamesPlayed = 0;
  const lockMs = 60 * 60 * 1000;

  for (const g of generated) {
    const pairings: TournamentPairing[] = [];
    for (const p of g.pairings) {
      if (p.isBye || !p.playerAId || !p.playerBId) {
        pairings.push({
          board: p.board,
          playerAId: p.playerAId,
          playerBId: p.playerBId,
          matchRoomCode: null,
          result: 'bye',
          scoreA: null,
          scoreB: null,
          gamePointsA: 0,
          gamePointsB: 0,
          spreadA: 0,
          spreadB: 0,
        });
        continue;
      }

      const scores = pickPracticeAiScores({ random: true, rng });
      const resolved = resolveSubmittedScores(scores.scoreA, scores.scoreB, 'supercrib');
      applyResultToPlayers(
        stats,
        p.playerAId,
        p.playerBId,
        resolved.result,
        resolved.gamePointsA,
        resolved.gamePointsB,
        resolved.spreadA,
        resolved.spreadB,
        resolved.skunkA,
        resolved.skunkB,
      );
      if (resolved.result === 'a' || resolved.result === 'b') {
        h2h[pairKey(p.playerAId, p.playerBId)] =
          resolved.result === 'a' ? p.playerAId : p.playerBId;
      }
      gamesPlayed += 1;

      pairings.push({
        board: p.board,
        playerAId: p.playerAId,
        playerBId: p.playerBId,
        matchRoomCode: null,
        result: resolved.result,
        scoreA: scores.scoreA,
        scoreB: scores.scoreB,
        gamePointsA: resolved.gamePointsA,
        gamePointsB: resolved.gamePointsB,
        spreadA: resolved.spreadA,
        spreadB: resolved.spreadB,
      });
    }

    const startedAt = nowMs + g.roundNumber * 1000;
    rounds[String(g.roundNumber)] = {
      roundNumber: g.roundNumber,
      status: 'complete',
      pairings,
      roundStartedAt: startedAt,
      deadlineAt: startedAt + lockMs,
    };
  }

  if (gamesPlayed !== 190) {
    throw new Error(`Expected 190 RR games, got ${gamesPlayed}`);
  }

  // Apply RR stats onto players
  for (const id of playerIds) {
    const s = stats[id];
    const p = players[id];
    p.gamePoints = s.gamePoints;
    p.wins = s.wins;
    p.losses = s.losses;
    p.skunksGiven = s.skunksGiven;
    p.skunksReceived = s.skunksReceived;
    p.spread = s.spread;
    p.place = null;
  }

  const standings: StandingRow[] = sortStandings(
    playerIds.map((userId, i) => ({
      userId,
      displayName: names[userId],
      ...stats[userId],
      joinedAt: players[userId].joinedAt ?? i,
    })),
    h2h,
  );

  let bracket: PlayoffBracket = buildQuartersFromStandings(standings);
  bracket = resolveAllPending(bracket, rng);
  if (bracket.status !== 'complete') {
    throw new Error(`Playoffs did not complete (status=${bracket.status})`);
  }
  bracket = playoffBracketForRtdb(bracket);

  const podium = playoffPodium(
    bracket,
    standings.map((s) => s.userId),
  );
  if (!podium) throw new Error('playoffPodium returned null');

  // Places: podium 1–4, others keep RR place (matches completeTournament)
  const placeByUser = new Map<string, number>();
  placeByUser.set(podium.firstId, 1);
  placeByUser.set(podium.secondId, 2);
  placeByUser.set(podium.thirdId, 3);
  placeByUser.set(podium.fourthId, 4);
  for (const row of standings) {
    if (!placeByUser.has(row.userId)) {
      placeByUser.set(row.userId, row.place ?? standings.length);
    }
  }
  for (const [uid, place] of placeByUser) {
    players[uid].place = place;
  }

  const meta: Tournament = {
    id: tournamentId,
    name: 'Study · Practice 20',
    hostUserId: STUDY_OWNER_UID,
    variant: 'supercrib',
    format: 'club_night_rr',
    status: 'complete',
    visibility: 'private',
    joinCode,
    maxSeats: 20,
    gameClockSec: 0,
    currentRound: 19,
    totalRounds: 19,
    createdAt: nowMs,
    updatedAt: nowMs,
    pairingsLocked: true,
    phase: 'complete',
    scoringVersion: CURRENT_SCORING_VERSION,
    playoffAdvanceCount: 8,
    roundLockInMin: 60,
  };

  const doc: TournamentDoc = {
    meta,
    players,
    joinRequests: {},
    rounds,
    playoffs: bracket,
  };

  const label = (id: string) => names[id] ?? id;
  const summary = {
    tournamentId,
    joinCode,
    seed: STUDY_SEED,
    players: 20,
    rrRounds: generated.length,
    rrGames: gamesPlayed,
    rrTop8: standings.slice(0, 8).map((s) => ({
      place: s.place ?? 0,
      name: s.displayName,
      userId: s.userId,
      pts: s.gamePoints,
      wl: `${s.wins}-${s.losses}`,
      spread: s.spread,
    })),
    podium: {
      first: label(podium.firstId),
      second: label(podium.secondId),
      third: label(podium.thirdId),
      fourth: label(podium.fourthId),
      firstId: podium.firstId,
      secondId: podium.secondId,
      thirdId: podium.thirdId,
      fourthId: podium.fourthId,
    },
  };

  return { doc, summary };
}

export function writeStudyPractice20Artifacts(outDir?: string): StudyBuildResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = outDir ?? here;
  mkdirSync(dir, { recursive: true });
  const result = buildStudyPractice20();
  const jsonPath = join(dir, 'study-practice-20.json');
  const summaryPath = join(dir, 'study-practice-20.summary.json');
  writeFileSync(jsonPath, JSON.stringify(result.doc, null, 2) + '\n', 'utf8');
  writeFileSync(summaryPath, JSON.stringify(result.summary, null, 2) + '\n', 'utf8');
  return result;
}
