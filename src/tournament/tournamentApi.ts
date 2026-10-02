/**
 * Client-side Club Night tournament API (Firebase RTDB — no Express).
 * Owner-mutating actions call requireOwner / requireHost first.
 */
import {
  get,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from '../multiplayer/firebase';
import { generateRoomCode, normalizeRoomCode } from '../multiplayer/roomCode';
import {
  createRoom,
  fetchRoom,
  isSeatLive,
  readRoomSeat,
} from '../multiplayer/roomSession';
import type { RoomRecord } from '../multiplayer/types';
import { getTournamentPrizeAvatar } from '../profile/avatars';
import { fetchCloudAvatarId, fetchCloudProfile, lookupByPlayerCode } from '../profile/cloudSync';
import {
  canHostTournaments,
  isOwner,
  requireHost,
  requireOwner,
  type OwnerLike,
} from './isOwner';
import {
  assertNoRematches,
  generateCirclePairings,
  regenerateAllowed,
} from './pairings';
import {
  applyResultToPlayers,
  deadlineForfeitScores,
  forfeitScores,
  isDeadlineExpired,
  pairKey,
  pointsForClockExpiry,
  resolveSubmittedScores,
  sortStandings,
  type HeadToHeadMap,
  type StandingRow,
} from './scoring';
import {
  isAiTournamentPlayer,
  isAiUserId,
  makeAiTournamentPlayer,
  makeOwnerTournamentPlayer,
  pairingInvolvesAi,
  pickPracticeAiScores,
  PRACTICE_AI_ROSTER,
} from './practiceAi';
import { scheduleMeta } from './scheduleMeta';
import {
  applyPlayoffGameResult,
  bothQuartersComplete,
  bothSemisComplete,
  buildFinalFromStandings,
  buildFinalSeries,
  buildQuartersFromStandings,
  buildSemisFromQuarters,
  buildSemisFromStandings,
  buildSemisFromTop6Quarters,
  buildTop6OpeningFromStandings,
  isTop6PlayInBracket,
  nextPendingGameIndex,
  playoffBracketForRtdb,
  playoffPodium,
  playoffSeriesForRtdb,
  rrComplete,
  type PlayoffPodium,
} from './playoffs';
import {
  CURRENT_SCORING_VERSION,
  clampPlayoffAdvance,
  emptyTournamentRecord,
  MAX_SEATS,
  MIN_SEATS,
  roundLockInMsFromMeta,
  type GameClockChoice,
  type PlayoffAdvanceCount,
  type Tournament,
  type TournamentDoc,
  type TournamentJoinRequest,
  type TournamentPairing,
  type TournamentPlayer,
  type TournamentRecord,
  type TournamentRound,
  type TournamentVariant,
  type TournamentVisibility,
  type PlayoffBracket,
  type PlayoffSeries,
} from './types';

function db() {
  return getFirebaseDb();
}

function tournamentPath(id: string): string {
  return `tournaments/${id}`;
}

function codeIndexPath(code: string): string {
  return `tournamentCodes/${normalizeRoomCode(code)}`;
}

function now(): number {
  return Date.now();
}

function generateJoinCode(): string {
  return generateRoomCode(6);
}

function minutesToSec(m: GameClockChoice): number {
  return m <= 0 ? 0 : m * 60;
}

function approvedPlayers(players: Record<string, TournamentPlayer>): TournamentPlayer[] {
  return Object.values(players).filter((p) => p.approved && !p.dropped);
}

function ensureConfigured(): void {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.');
  }
}

export interface CreateDraftInput {
  name: string;
  /** Ignored — create always saves SuperCrib. Kept for call-site compat. */
  variant?: TournamentVariant;
  maxSeats?: number;
  gameClockMin?: GameClockChoice;
  visibility?: TournamentVisibility;
  buyInNote?: string;
  prizeNote?: string;
  /** Default false when omitted. */
  playoffSkunkCountsAsTwo?: boolean;
  /** Top 8 / Top 6 / Top 4 / Top 2. Default 4 when omitted. */
  playoffAdvanceCount?: PlayoffAdvanceCount;
  /** RR round lock-in minutes (default 60). */
  roundLockInMin?: number;
  /** Overall event minutes from Round 1 start; 0 = off. */
  tournamentDurationMin?: number;
  /** Entry fee in SC (default 0 = free). */
  entryFeeSc?: number;
  /** Optional 1st-place prize avatar id (see TOURNAMENT_PRIZE_AVATARS). */
  prizeFirstAvatarId?: string;
  /**
   * Target RR games per player (2 … maxSeats−1). Missing/0 = full RR.
   */
  rrGamesPerPlayer?: number;
}

export async function createDraft(
  user: OwnerLike,
  input: CreateDraftInput,
): Promise<Tournament> {
  ensureConfigured();
  requireHost(user);
  const uid = user!.uid!.trim();
  const maxSeats = Math.min(
    MAX_SEATS,
    Math.max(MIN_SEATS, Math.floor(input.maxSeats ?? 8)),
  );
  const clockMin = (input.gameClockMin ?? 22) as GameClockChoice;
  const joinCode = generateJoinCode();
  const idRef = push(ref(db(), 'tournaments'));
  const id = idRef.key;
  if (!id) throw new Error('Could not allocate tournament id');

  const playoffAdvanceCount = clampPlayoffAdvance(
    input.playoffAdvanceCount,
    maxSeats,
  );

  const roundLockInMin = Math.max(
    1,
    Math.min(24 * 60, Math.floor(input.roundLockInMin ?? 60) || 60),
  );
  const tournamentDurationMin = Math.max(
    0,
    Math.min(7 * 24 * 60, Math.floor(input.tournamentDurationMin ?? 0) || 0),
  );
  const entryFeeSc = Math.max(0, Math.floor(input.entryFeeSc ?? 0) || 0);
  const prizeFirstAvatarId = (input.prizeFirstAvatarId ?? '').trim().slice(0, 80);

  const fullRrGames = scheduleMeta(maxSeats).gamesPerPlayer;
  let rrGamesPerPlayer: number | undefined;
  const rawRr = input.rrGamesPerPlayer;
  if (typeof rawRr === 'number' && Number.isFinite(rawRr) && rawRr > 0) {
    rrGamesPerPlayer = Math.max(2, Math.min(fullRrGames, Math.floor(rawRr)));
  }
  const sched = scheduleMeta(maxSeats, rrGamesPerPlayer);

  const meta: Tournament = {
    id,
    name: (input.name || 'Tournament').trim().slice(0, 60) || 'Tournament',
    hostUserId: uid,
    variant: 'supercrib',
    format: 'club_night_rr',
    status: 'draft',
    visibility: input.visibility === 'public' ? 'public' : 'private',
    joinCode,
    maxSeats,
    gameClockSec: minutesToSec(clockMin),
    currentRound: 0,
    totalRounds: sched.rounds,
    createdAt: now(),
    updatedAt: now(),
    pairingsLocked: false,
    phase: 'rr',
    scoringVersion: CURRENT_SCORING_VERSION,
    playoffAdvanceCount,
    roundLockInMin,
    ...(tournamentDurationMin > 0 ? { tournamentDurationMin } : {}),
    entryFeeSc,
    ...(prizeFirstAvatarId ? { prizeFirstAvatarId } : {}),
    ...(rrGamesPerPlayer != null ? { rrGamesPerPlayer } : {}),
    ...(input.playoffSkunkCountsAsTwo ? { playoffSkunkCountsAsTwo: true } : {}),
    ...(input.buyInNote?.trim() ? { buyInNote: input.buyInNote.trim().slice(0, 120) } : {}),
    ...(input.prizeNote?.trim() ? { prizeNote: input.prizeNote.trim().slice(0, 120) } : {}),
  };

  await set(ref(db(), tournamentPath(id)), {
    meta,
    players: {},
    joinRequests: {},
    rounds: {},
  });
  await set(ref(db(), codeIndexPath(joinCode)), id);
  return meta;
}


/** Host/owner seats approved AI placeholders (draft/lobby only). Owner-only. */
export async function fillWithAi(
  user: OwnerLike,
  tournamentId: string,
  count = 3,
): Promise<TournamentPlayer[]> {
  ensureConfigured();
  requireOwner(user);
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  if (doc.meta.status !== 'draft' && doc.meta.status !== 'lobby') {
    throw new Error('Can only add AI players in lobby');
  }
  const want = Math.max(0, Math.min(PRACTICE_AI_ROSTER.length, Math.floor(count)));
  const seated = approvedPlayers(doc.players);
  const free = Math.max(0, doc.meta.maxSeats - seated.length);
  const toAdd = Math.min(want, free);
  if (toAdd <= 0) {
    throw new Error('No free seats for AI players');
  }

  // Skip roster slots already seated
  const existingIds = new Set(Object.keys(doc.players));
  const added: TournamentPlayer[] = [];
  let workingPlayers = { ...doc.players };
  for (const slot of PRACTICE_AI_ROSTER) {
    if (added.length >= toAdd) break;
    if (existingIds.has(slot.userId)) continue;
    const seat = nextSeat(workingPlayers);
    const player = makeAiTournamentPlayer(slot, seat, now());
    await set(ref(db(), `${tournamentPath(tournamentId)}/players/${slot.userId}`), player);
    workingPlayers = { ...workingPlayers, [slot.userId]: player };
    existingIds.add(slot.userId);
    added.push(player);
  }
  if (added.length === 0) {
    throw new Error('AI seats already filled');
  }
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), { updatedAt: now() });
  return added;
}

/**
 * Owner-only one-click: 4-player Club Night with owner + 3 AI,
 * start tournament + Round 1 so boards are visible on TournamentLive.
 */
export async function createPracticeAiTournament(
  user: OwnerLike & { displayName?: string | null },
): Promise<Tournament> {
  ensureConfigured();
  requireOwner(user);
  const uid = user!.uid!.trim();

  const meta = await createDraft(user, {
    name: 'Practice 4 with AI',
    maxSeats: 4,
    gameClockMin: 0,
    visibility: 'private',
    playoffAdvanceCount: 4,
  });

  // Seat owner as player 1 (seat 0)
  const ownerAvatar = (await fetchCloudAvatarId(uid)) ?? '';
  const ownerPlayer = makeOwnerTournamentPlayer(
    { uid, displayName: user.displayName, avatarId: ownerAvatar || undefined },
    0,
    now(),
  );
  await set(ref(db(), `${tournamentPath(meta.id)}/players/${uid}`), ownerPlayer);

  await fillWithAi(user, meta.id, 3);
  await openLobby(user, meta.id);
  await startTournament(user, meta.id);
  await startRound(user, meta.id, 1);

  const fresh = await fetchTournament(meta.id);
  return fresh?.meta ?? { ...meta, status: 'live', currentRound: 1, pairingsLocked: true };
}

export interface PracticeAiSimSummary {
  meta: Tournament;
  podium: PlayoffPodium | null;
  standingsTop: StandingRow[];
}

/**
 * Owner-only one-click: 20-player Club Night with owner + 19 AI,
 * Top 8 playoffs, then simulate all RR + playoffs to completion.
 */
export async function createPracticeAi20Tournament(
  user: OwnerLike & { displayName?: string | null },
): Promise<PracticeAiSimSummary> {
  ensureConfigured();
  requireOwner(user);
  const uid = user!.uid!.trim();

  const meta = await createDraft(user, {
    name: 'Practice 20 with AI',
    maxSeats: 20,
    gameClockMin: 0,
    visibility: 'private',
    playoffAdvanceCount: 8,
    roundLockInMin: 60,
    tournamentDurationMin: 0,
  });

  const ownerAvatar = (await fetchCloudAvatarId(uid)) ?? '';
  const ownerPlayer = makeOwnerTournamentPlayer(
    { uid, displayName: user.displayName, avatarId: ownerAvatar || undefined },
    0,
    now(),
  );
  await set(ref(db(), `${tournamentPath(meta.id)}/players/${uid}`), ownerPlayer);

  await fillWithAi(user, meta.id, 19);
  await openLobby(user, meta.id);
  await startTournament(user, meta.id);
  await startRound(user, meta.id, 1);

  return simulateTournamentToCompletion(user, meta.id);
}

const PRACTICE_SIM_MAX_STEPS = 500;

/**
 * Owner-only: resolve every RR board + playoff game with random AI scores,
 * then completeTournament. Refetches between rounds; safety-capped.
 */
export async function simulateTournamentToCompletion(
  user: OwnerLike,
  tournamentId: string,
): Promise<PracticeAiSimSummary> {
  ensureConfigured();
  requireOwner(user);

  let steps = 0;

  // --- Round robin ---
  while (steps < PRACTICE_SIM_MAX_STEPS) {
    const doc = await fetchTournament(tournamentId);
    if (!doc) throw new Error('Tournament not found');
    if (isRoundRobinComplete(doc)) break;

    const cur = doc.meta.currentRound;
    if (cur < 1) {
      await startRound(user, tournamentId, 1);
      continue;
    }

    const round = doc.rounds[String(cur)];
    if (!round) throw new Error(`Round ${cur} missing during simulation`);

    if (round.status === 'pending') {
      await startRound(user, tournamentId, cur);
      continue;
    }

    const pending = round.pairings.filter((p) => p.result === 'pending');
    // Byes are already result === 'bye'; skip anything that is still pending
    // but is a one-sided bye-shaped board.
    const toResolve = pending.filter((p) => {
      if (p.result === 'bye') return false;
      const byeShape =
        (p.playerAId && !p.playerBId) || (!p.playerAId && p.playerBId);
      return !byeShape;
    });

    if (toResolve.length === 0) {
      // All boards done — advance (marks round complete; no-ops past last RR).
      console.warn(`[Practice20] RR round ${cur}/${doc.meta.totalRounds} complete`);
      await nextRound(user, tournamentId);
      // If that was the last round, nextRound only marks complete — loop will see rrDone.
      const after = await fetchTournament(tournamentId);
      if (after && isRoundRobinComplete(after)) break;
      continue;
    }

    for (const pairing of toResolve) {
      if (steps >= PRACTICE_SIM_MAX_STEPS) break;
      steps += 1;
      const fresh = await fetchTournament(tournamentId);
      if (!fresh) throw new Error('Tournament not found');
      const fr = fresh.rounds[String(cur)];
      const live = fr?.pairings.find((p) => p.board === pairing.board);
      if (!live || live.result !== 'pending') continue;

      if (pairingInvolvesAi(fresh.players, live)) {
        await resolveAiBoard(user, tournamentId, cur, live.board, { random: true });
      } else {
        // Practice fallback: host override even if no AI seat somehow.
        const scores = pickPracticeAiScores({ random: true });
        await hostOverride(user, tournamentId, cur, live.board, scores);
      }
    }
  }

  {
    const doc = await fetchTournament(tournamentId);
    if (!doc) throw new Error('Tournament not found');
    if (!isRoundRobinComplete(doc)) {
      throw new Error(
        `Practice simulation stalled in RR after ${steps} steps (round ${doc.meta.currentRound}/${doc.meta.totalRounds})`,
      );
    }
  }

  // --- Playoffs ---
  {
    const doc = await fetchTournament(tournamentId);
    if (!doc) throw new Error('Tournament not found');
    if (!doc.playoffs || doc.playoffs.status === 'complete') {
      // start unless already complete (unlikely)
      if (!doc.playoffs) {
        await startPlayoffs(user, tournamentId);
      }
    }
  }

  while (steps < PRACTICE_SIM_MAX_STEPS) {
    const doc = await fetchTournament(tournamentId);
    if (!doc) throw new Error('Tournament not found');
    if (!doc.playoffs) {
      await startPlayoffs(user, tournamentId);
      continue;
    }
    if (doc.playoffs.status === 'complete') break;

    const seriesList = Object.values(doc.playoffs.series ?? {}).filter(
      (s) => s.status !== 'complete' && nextPendingGameIndex(s) !== null,
    );
    if (seriesList.length === 0) {
      // Bracket may need a moment after last QF/SF to build next round — refetch once.
      const again = await fetchTournament(tournamentId);
      if (again?.playoffs?.status === 'complete') break;
      // If semis/final were just built by submitPlayoffGame, they should appear.
      // If still nothing pending and not complete, something is wrong.
      const pendingAfter = Object.values(again?.playoffs?.series ?? {}).filter(
        (s) => s.status !== 'complete' && nextPendingGameIndex(s) !== null,
      );
      if (pendingAfter.length === 0) {
        throw new Error(
          `Practice simulation: playoffs stuck at status=${again?.playoffs?.status ?? 'missing'}`,
        );
      }
      continue;
    }

    console.warn(
      `[Practice20] Playoffs ${doc.playoffs.status}: resolving ${seriesList.length} series game(s)`,
    );

    for (const series of seriesList) {
      if (steps >= PRACTICE_SIM_MAX_STEPS) break;
      steps += 1;
      const fresh = await fetchTournament(tournamentId);
      if (!fresh?.playoffs) break;
      const live = fresh.playoffs.series[series.id];
      if (!live || live.status === 'complete') continue;
      if (nextPendingGameIndex(live) === null) continue;

      const a = fresh.players[live.playerAId];
      const b = fresh.players[live.playerBId];
      if (isAiTournamentPlayer(a) || isAiTournamentPlayer(b)) {
        await resolveAiPlayoffGame(user, tournamentId, live.id, { random: true });
      } else {
        const scores = pickPracticeAiScores({ random: true });
        const gi = nextPendingGameIndex(live);
        if (gi === null) continue;
        await submitPlayoffGame(
          user,
          tournamentId,
          live.id,
          gi,
          scores.scoreA,
          scores.scoreB,
        );
      }
    }
  }

  {
    const doc = await fetchTournament(tournamentId);
    if (!doc?.playoffs || doc.playoffs.status !== 'complete') {
      throw new Error(
        `Practice simulation stalled in playoffs after ${steps} steps (status=${doc?.playoffs?.status ?? 'missing'})`,
      );
    }
  }

  await completeTournament(user, tournamentId);

  const finalDoc = await fetchTournament(tournamentId);
  if (!finalDoc) throw new Error('Tournament missing after complete');

  const standings = computeStandings(finalDoc);
  const podium =
    finalDoc.playoffs?.status === 'complete'
      ? playoffPodium(
          finalDoc.playoffs,
          standings.map((s) => s.userId),
        )
      : null;

  return {
    meta: finalDoc.meta,
    podium,
    standingsTop: standings.slice(0, 8),
  };
}

/**
 * Host/owner quick-submit for boards that include an AI seat.
 * Default fixed 241–200; pass { random: true } for a random non-skunk SuperCrib result.
 */
export async function resolveAiBoard(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
  opts?: { random?: boolean; scoreA?: number; scoreB?: number },
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const pairing = round.pairings.find((p) => p.board === board);
  if (!pairing) throw new Error('Board not found');
  if (pairing.result === 'bye') return;
  if (pairing.result !== 'pending') throw new Error('Result already recorded');
  if (!pairingInvolvesAi(doc.players, pairing)) {
    throw new Error('Resolve AI board only applies to boards with an AI player');
  }

  const scores =
    typeof opts?.scoreA === 'number' && typeof opts?.scoreB === 'number'
      ? { scoreA: opts.scoreA, scoreB: opts.scoreB }
      : pickPracticeAiScores({ random: !!opts?.random });

  await hostOverride(user, tournamentId, roundNumber, board, {
    scoreA: scores.scoreA,
    scoreB: scores.scoreB,
  });
}

export async function openLobby(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'draft' && doc.meta.status !== 'lobby') {
    throw new Error('Lobby can only open from draft');
  }
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), {
    status: 'lobby',
    updatedAt: now(),
  });
}

function assertHostOrOwner(user: OwnerLike, meta: Tournament): void {
  if (isOwner(user)) return;
  if (canHostTournaments(user) && user?.uid === meta.hostUserId) return;
  requireOwner(user);
}

export async function fetchTournament(id: string): Promise<TournamentDoc | null> {
  ensureConfigured();
  const snap = await get(ref(db(), tournamentPath(id)));
  const val = snap.val();
  if (!val || typeof val !== 'object' || !val.meta) return null;
  return normalizeDoc(val);
}

export async function fetchTournamentByCode(code: string): Promise<TournamentDoc | null> {
  ensureConfigured();
  const normalized = normalizeRoomCode(code);
  const idSnap = await get(ref(db(), codeIndexPath(normalized)));
  const id = idSnap.val();
  if (typeof id !== 'string' || !id) return null;
  return fetchTournament(id);
}

export function subscribeTournament(
  id: string,
  cb: (doc: TournamentDoc | null) => void,
): Unsubscribe {
  ensureConfigured();
  const r = ref(db(), tournamentPath(id));
  return onValue(
    r,
    (snap) => {
      const val = snap.val();
      if (!val || typeof val !== 'object' || !val.meta) {
        cb(null);
        return;
      }
      cb(normalizeDoc(val));
    },
    () => cb(null),
  );
}

export async function listHostTournaments(hostUserId: string): Promise<Tournament[]> {
  ensureConfigured();
  const snap = await get(ref(db(), 'tournaments'));
  const val = snap.val();
  if (!val || typeof val !== 'object') return [];
  const list: Tournament[] = [];
  for (const [id, raw] of Object.entries(val as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const meta = (raw as { meta?: Tournament }).meta;
    if (!meta || meta.hostUserId !== hostUserId) continue;
    list.push({ ...meta, id: meta.id || id });
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Club Nights visible to all signed-in users (lobby / live / complete).
 * Does not include raw drafts or cancelled events.
 * Create / admin remain gated by requireHost / requireOwner.
 */
export async function listBrowseTournaments(): Promise<Tournament[]> {
  ensureConfigured();
  const snap = await get(ref(db(), 'tournaments'));
  const val = snap.val();
  if (!val || typeof val !== 'object') return [];
  const list: Tournament[] = [];
  for (const [id, raw] of Object.entries(val as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const meta = (raw as { meta?: Tournament }).meta;
    if (!meta) continue;
    if (meta.status !== 'lobby' && meta.status !== 'live' && meta.status !== 'complete') continue;
    list.push({ ...meta, id: meta.id || id });
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

const MY_TOURNAMENTS_LS_KEY = 'supercrib.myTournaments';

/** Remember a tournament id locally (fallback when listing is slow / partial). */
export function rememberMyTournamentId(tournamentId: string): void {
  if (!tournamentId || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(MY_TOURNAMENTS_LS_KEY);
    const prev: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [tournamentId, ...prev.filter((id) => id !== tournamentId)].slice(0, 40);
    localStorage.setItem(MY_TOURNAMENTS_LS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function readRememberedTournamentIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MY_TOURNAMENTS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * Club Nights the signed-in user is seated in (approved, not dropped).
 * Reads all tournaments (same as listHostTournaments — RTDB allows signed-in read),
 * filters by players[uid], and merges any localStorage-remembered ids.
 */
export async function listMyTournaments(userId: string): Promise<Tournament[]> {
  ensureConfigured();
  if (!userId) return [];
  const snap = await get(ref(db(), 'tournaments'));
  const val = snap.val();
  const byId = new Map<string, Tournament>();
  if (val && typeof val === 'object') {
    for (const [id, raw] of Object.entries(val as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as { meta?: Tournament; players?: Record<string, TournamentPlayer> };
      const meta = row.meta;
      if (!meta) continue;
      if (meta.status !== 'lobby' && meta.status !== 'live' && meta.status !== 'complete') continue;
      const p = row.players?.[userId];
      if (!p?.approved || p.dropped) continue;
      const tid = meta.id || id;
      byId.set(tid, { ...meta, id: tid });
    }
  }
  // Fallback: remembered ids (in case a private night was missed in a shallow list).
  for (const id of readRememberedTournamentIds()) {
    if (byId.has(id)) continue;
    try {
      const doc = await fetchTournament(id);
      if (!doc) continue;
      if (doc.meta.status !== 'lobby' && doc.meta.status !== 'live' && doc.meta.status !== 'complete') {
        continue;
      }
      const p = doc.players[userId];
      if (!p?.approved || p.dropped) continue;
      byId.set(doc.meta.id || id, { ...doc.meta, id: doc.meta.id || id });
    } catch {
      // ignore missing
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeDoc(val: Record<string, unknown>): TournamentDoc {
  const meta = val.meta as Tournament;
  const players = (val.players ?? {}) as Record<string, TournamentPlayer>;
  const joinRequests = (val.joinRequests ?? {}) as Record<string, TournamentJoinRequest>;
  const roundsRaw = (val.rounds ?? {}) as Record<string, TournamentRound>;
  const rounds: Record<string, TournamentRound> = {};
  for (const [k, r] of Object.entries(roundsRaw)) {
    // RTDB may store rounds as an array with a null hole at index 0.
    if (!r || typeof r !== 'object') continue;
    if (k === '0' || k === '') continue;
    let pairings: TournamentPairing[] = [];
    if (Array.isArray(r.pairings)) {
      pairings = r.pairings;
    } else if (r.pairings && typeof r.pairings === 'object') {
      const map = r.pairings as unknown as Record<string, TournamentPairing>;
      pairings = Object.keys(map)
        .filter((x) => /^\d+$/.test(x))
        .sort((a, b) => Number(a) - Number(b))
        .map((i) => map[i]);
    }
    rounds[k] = { ...r, pairings };
  }
  const playoffs = normalizePlayoffs(val.playoffs);
  return { meta, players, joinRequests, rounds, ...(playoffs ? { playoffs } : {}) };
}

function normalizePlayoffs(raw: unknown): PlayoffBracket | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const root = raw as {
    status?: PlayoffBracket['status'];
    series?: Record<string, Record<string, unknown>>;
  };
  if (!root.status || !root.series || typeof root.series !== 'object') return undefined;
  const series: PlayoffBracket['series'] = {};
  for (const [id, s] of Object.entries(root.series)) {
    if (!s || typeof s !== 'object') continue;
    let gamesRaw = s.games;
    let games: PlayoffSeries['games'] = [];
    if (Array.isArray(gamesRaw)) {
      games = gamesRaw as PlayoffSeries['games'];
    } else if (gamesRaw && typeof gamesRaw === 'object') {
      const map = gamesRaw as Record<string, PlayoffSeries['games'][number]>;
      games = Object.keys(map)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => map[k]);
    }
    // Ensure three game slots
    while (games.length < 3) {
      games.push({
        gameIndex: games.length + 1,
        scoreA: null,
        scoreB: null,
        result: 'pending',
      });
    }
    games = games.map((g, i) => ({
      gameIndex: typeof g?.gameIndex === 'number' ? g.gameIndex : i + 1,
      scoreA: typeof g?.scoreA === 'number' ? g.scoreA : null,
      scoreB: typeof g?.scoreB === 'number' ? g.scoreB : null,
      result: g?.result === 'a' || g?.result === 'b' ? g.result : 'pending',
      matchRoomCode:
        typeof g?.matchRoomCode === 'string' && g.matchRoomCode.trim()
          ? g.matchRoomCode.trim()
          : null,
    }));
    series[id] = {
      id: typeof s.id === 'string' ? s.id : id,
      label: typeof s.label === 'string' ? s.label : id,
      seedA: Number(s.seedA) || 0,
      seedB: Number(s.seedB) || 0,
      playerAId: String(s.playerAId ?? ''),
      playerBId: String(s.playerBId ?? ''),
      bestOf: Number(s.bestOf) || 3,
      winsA: Number(s.winsA) || 0,
      winsB: Number(s.winsB) || 0,
      games,
      status: s.status === 'complete' || s.status === 'pending' ? s.status : 'live',
      winnerId: typeof s.winnerId === 'string' ? s.winnerId : null,
    };
  }
  return { status: root.status, series };
}

/** Host adds a signed-in player by their player code. */
export async function addPlayer(
  user: OwnerLike,
  tournamentId: string,
  playerCode: string,
): Promise<TournamentPlayer> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'draft' && doc.meta.status !== 'lobby') {
    throw new Error('Can only add players in lobby');
  }
  const lookup = await lookupByPlayerCode(playerCode);
  if (!lookup) throw new Error('No player found for that code');
  const seated = approvedPlayers(doc.players);
  if (seated.length >= doc.meta.maxSeats) {
    throw new Error(`Lobby full (${doc.meta.maxSeats} seats)`);
  }
  if (doc.players[lookup.uid]?.approved) {
    throw new Error('Player already in lobby');
  }
  const seat = nextSeat(doc.players);
  const cloud = await fetchCloudProfile(lookup.uid);
  const avatarId = (cloud?.avatarId ?? '').trim();
  const player: TournamentPlayer = {
    userId: lookup.uid,
    displayName: lookup.displayName || 'Player',
    playerCode: playerCode.trim().toUpperCase(),
    ...(avatarId ? { avatarId } : {}),
    seat,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt: now(),
    approved: true,
  };
  await set(ref(db(), `${tournamentPath(tournamentId)}/players/${lookup.uid}`), player);
  await remove(ref(db(), `${tournamentPath(tournamentId)}/joinRequests/${lookup.uid}`));
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), { updatedAt: now() });
  return player;
}


/** Host adds a signed-in player by Firebase uid (e.g. from friends list). */
export async function addPlayerByUid(
  user: OwnerLike,
  tournamentId: string,
  targetUid: string,
): Promise<TournamentPlayer> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'draft' && doc.meta.status !== 'lobby') {
    throw new Error('Can only add players in lobby');
  }
  const uid = targetUid.trim();
  if (!uid) throw new Error('Missing player uid');
  const profile = await fetchCloudProfile(uid);
  if (!profile) throw new Error('No player found for that account');
  const seated = approvedPlayers(doc.players);
  if (seated.length >= doc.meta.maxSeats) {
    throw new Error(`Lobby full (${doc.meta.maxSeats} seats)`);
  }
  if (doc.players[uid]?.approved) {
    throw new Error('Player already in lobby');
  }
  const seat = nextSeat(doc.players);
  const code = (profile.playerCode || '').trim().toUpperCase();
  const avatarId = (profile.avatarId || '').trim();
  const player: TournamentPlayer = {
    userId: uid,
    displayName: profile.displayName || 'Player',
    ...(code ? { playerCode: code } : {}),
    ...(avatarId ? { avatarId } : {}),
    seat,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt: now(),
    approved: true,
  };
  await set(ref(db(), `${tournamentPath(tournamentId)}/players/${uid}`), player);
  await remove(ref(db(), `${tournamentPath(tournamentId)}/joinRequests/${uid}`));
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), { updatedAt: now() });
  return player;
}

function nextSeat(players: Record<string, TournamentPlayer>): number {
  const used = new Set(
    Object.values(players)
      .filter((p) => p.approved && !p.dropped)
      .map((p) => p.seat),
  );
  let s = 0;
  while (used.has(s)) s += 1;
  return s;
}

export async function kick(
  user: OwnerLike,
  tournamentId: string,
  targetUserId: string,
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status === 'live' || doc.meta.status === 'complete') {
    // Soft drop mid-event
    await update(ref(db(), `${tournamentPath(tournamentId)}/players/${targetUserId}`), {
      dropped: true,
    });
  } else {
    await remove(ref(db(), `${tournamentPath(tournamentId)}/players/${targetUserId}`));
  }
  await remove(ref(db(), `${tournamentPath(tournamentId)}/joinRequests/${targetUserId}`));
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), { updatedAt: now() });
}

/** Logged-in player requests to join via code. */
export async function requestJoin(
  user: OwnerLike & { displayName?: string | null },
  joinCode: string,
  playerCode?: string,
  avatarId?: string | null,
): Promise<void> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required to join');
  const doc = await fetchTournamentByCode(joinCode);
  if (!doc) throw new Error('Invalid join code');
  const existing = doc.players[user.uid];
  if (existing?.approved && !existing.dropped) {
    throw new Error('Already in this tournament');
  }
  if (doc.meta.status !== 'lobby' && doc.meta.status !== 'draft') {
    throw new Error('Tournament is not accepting joins');
  }
  const av = (avatarId ?? '').trim();
  const req: TournamentJoinRequest = {
    userId: user.uid,
    displayName: (user.displayName || 'Player').trim() || 'Player',
    ...(playerCode ? { playerCode: playerCode.trim().toUpperCase() } : {}),
    ...(av ? { avatarId: av } : {}),
    requestedAt: now(),
  };
  await set(ref(db(), `${tournamentPath(doc.meta.id)}/joinRequests/${user.uid}`), req);
}

export async function approveJoin(
  user: OwnerLike,
  tournamentId: string,
  targetUserId: string,
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const req = doc.joinRequests?.[targetUserId];
  if (!req) throw new Error('No join request from that user');
  const seated = approvedPlayers(doc.players);
  if (seated.length >= doc.meta.maxSeats) {
    throw new Error(`Lobby full (${doc.meta.maxSeats} seats)`);
  }
  const seat = nextSeat(doc.players);
  let avatarId = (req.avatarId ?? '').trim();
  if (!avatarId) {
    avatarId = (await fetchCloudAvatarId(targetUserId)) ?? '';
  }
  const player: TournamentPlayer = {
    userId: targetUserId,
    displayName: req.displayName || 'Player',
    ...(req.playerCode ? { playerCode: req.playerCode } : {}),
    ...(avatarId ? { avatarId } : {}),
    seat,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt: now(),
    approved: true,
  };
  await set(ref(db(), `${tournamentPath(tournamentId)}/players/${targetUserId}`), player);
  await remove(ref(db(), `${tournamentPath(tournamentId)}/joinRequests/${targetUserId}`));
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), { updatedAt: now() });
}

export async function denyJoin(
  user: OwnerLike,
  tournamentId: string,
  targetUserId: string,
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  await remove(ref(db(), `${tournamentPath(tournamentId)}/joinRequests/${targetUserId}`));
}

/** Generate all round pairings and move status → live (currentRound still 0 until startRound). */
export async function startTournament(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const seated = approvedPlayers(doc.players).sort((a, b) => a.seat - b.seat);
  if (seated.length < MIN_SEATS) {
    throw new Error(`Need at least ${MIN_SEATS} players to start`);
  }
  if (doc.meta.status === 'live' && doc.meta.pairingsLocked) {
    throw new Error('Tournament already started');
  }
  if (!regenerateAllowed(doc.meta.currentRound, doc.meta.pairingsLocked)) {
    throw new Error('Cannot regenerate pairings after Round 1');
  }

  const ids = seated.map((p) => p.userId);
  const metaInfo = scheduleMeta(seated.length, doc.meta.rrGamesPerPlayer);
  const generated = generateCirclePairings(ids, metaInfo.rounds);
  assertNoRematches(generated);

  const rounds: Record<string, TournamentRound> = {};
  for (const g of generated) {
    rounds[String(g.roundNumber)] = {
      roundNumber: g.roundNumber,
      status: 'pending',
      pairings: g.pairings.map((p) => ({
        board: p.board,
        playerAId: p.playerAId,
        playerBId: p.playerBId,
        matchRoomCode: null,
        result: p.isBye ? 'bye' : 'pending',
        scoreA: null,
        scoreB: null,
        gamePointsA: 0,
        gamePointsB: 0,
        spreadA: 0,
        spreadB: 0,
      })),
    };
  }

  // Reset player stats
  const playerUpdates: Record<string, unknown> = {};
  for (const p of seated) {
    playerUpdates[`players/${p.userId}/gamePoints`] = 0;
    playerUpdates[`players/${p.userId}/wins`] = 0;
    playerUpdates[`players/${p.userId}/losses`] = 0;
    playerUpdates[`players/${p.userId}/skunksGiven`] = 0;
    playerUpdates[`players/${p.userId}/skunksReceived`] = 0;
    playerUpdates[`players/${p.userId}/spread`] = 0;
    playerUpdates[`players/${p.userId}/place`] = null;
  }

  await update(ref(db(), tournamentPath(tournamentId)), {
    rounds,
    ...playerUpdates,
    'meta/status': 'live',
    'meta/currentRound': 0,
    'meta/totalRounds': metaInfo.rounds,
    'meta/pairingsLocked': false,
    'meta/updatedAt': now(),
  });
}

export async function startRound(user: OwnerLike, tournamentId: string, roundNumber?: number): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'live') throw new Error('Tournament is not live');

  // If currentRound is 0, start round 1; otherwise start the requested round.
  const rNum = roundNumber ?? (doc.meta.currentRound < 1 ? 1 : doc.meta.currentRound);
  const round = doc.rounds[String(rNum)];
  if (!round) throw new Error(`Round ${rNum} not found`);
  if (round.status === 'live') return;
  if (round.status === 'complete') throw new Error('Round already complete');

  // Mark round live + lock pairings; lock-in timer starts separately via startRoundTimer.
  const ts = now();
  await update(ref(db(), tournamentPath(tournamentId)), {
    [`rounds/${rNum}/status`]: 'live',
    'meta/currentRound': rNum,
    'meta/pairingsLocked': true,
    'meta/updatedAt': ts,
  });
}

/**
 * Host starts (or restarts) the lock-in countdown for a live RR round.
 * Does not open boards — startRound / auto-advance must already have set status live.
 */
export async function startRoundTimer(
  user: OwnerLike,
  tournamentId: string,
  roundNumber?: number,
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'live') throw new Error('Tournament is not live');

  const rNum = roundNumber ?? (doc.meta.currentRound < 1 ? 1 : doc.meta.currentRound);
  const round = doc.rounds[String(rNum)];
  if (!round) throw new Error(`Round ${rNum} not found`);
  if (round.status !== 'live') {
    throw new Error(`Round ${rNum} is not live — open the round boards first`);
  }

  const startedAt = now();
  const lockMs = roundLockInMsFromMeta(doc.meta);
  await update(ref(db(), tournamentPath(tournamentId)), {
    [`rounds/${rNum}/roundStartedAt`]: startedAt,
    [`rounds/${rNum}/deadlineAt`]: startedAt + lockMs,
    'meta/updatedAt': startedAt,
  });
}

export async function nextRound(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const cur = doc.meta.currentRound;
  if (cur < 1) {
    await startRound(user, tournamentId, 1);
    return;
  }
  const round = doc.rounds[String(cur)];
  if (!round) throw new Error('Current round missing');
  if (!roundComplete(round)) {
    throw new Error('Finish all boards before next round');
  }
  if (round.status !== 'complete') {
    await update(ref(db(), `${tournamentPath(tournamentId)}/rounds/${cur}`), {
      status: 'complete',
    });
  }
  const next = cur + 1;
  if (next > doc.meta.totalRounds) {
    // Round robin finished — host starts Bo3 playoffs (or finishes from UI).
    return;
  }
  await startRound(user, tournamentId, next);
}

function roundComplete(round: TournamentRound): boolean {
  return round.pairings.every(
    (p) => p.result !== 'pending' || (p.playerAId && !p.playerBId) || (!p.playerAId && p.playerBId),
  );
}

export async function submitResult(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
  scoreA: number,
  scoreB: number,
  opts?: { clockExpiry?: boolean },
): Promise<void> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const pairing = round.pairings.find((p) => p.board === board);
  if (!pairing) throw new Error('Board not found');
  if (pairing.result === 'bye') return;
  if (pairing.result !== 'pending') throw new Error('Result already recorded');

  const isParticipant =
    user.uid === pairing.playerAId || user.uid === pairing.playerBId;
  const hostOk = isOwner(user) || user.uid === doc.meta.hostUserId;
  if (!isParticipant && !hostOk) {
    throw new Error('403 Forbidden — only participants or host can submit');
  }

  const resolved = opts?.clockExpiry
    ? (() => {
        const c = pointsForClockExpiry(scoreA, scoreB, doc.meta.variant);
        return {
          result: c.result as TournamentPairing['result'],
          gamePointsA: c.gamePointsA,
          gamePointsB: c.gamePointsB,
          spreadA: c.spreadA,
          spreadB: c.spreadB,
          skunkA: c.skunkA,
          skunkB: c.skunkB,
        };
      })()
    : resolveSubmittedScores(scoreA, scoreB, doc.meta.variant);

  await writePairingResult(
    tournamentId,
    doc,
    roundNumber,
    board,
    pairing,
    resolved.result,
    scoreA,
    scoreB,
    resolved.gamePointsA,
    resolved.gamePointsB,
    resolved.spreadA,
    resolved.spreadB,
    resolved.skunkA,
    resolved.skunkB,
  );
}

export async function hostOverride(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
  payload: {
    scoreA: number;
    scoreB: number;
    forfeitWinner?: 'a' | 'b' | null;
  },
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const pairingIdx = round.pairings.findIndex((p) => p.board === board);
  if (pairingIdx < 0) throw new Error('Board not found');
  const pairing = round.pairings[pairingIdx];

  // Roll back previous stats if re-scoring
  if (pairing.result !== 'pending' && pairing.result !== 'bye') {
    await rollbackPairingStats(tournamentId, doc, pairing);
    // Re-fetch after rollback
    const fresh = await fetchTournament(tournamentId);
    if (!fresh) throw new Error('Tournament missing after rollback');
    Object.assign(doc, fresh);
  }

  if (payload.forfeitWinner === 'a' || payload.forfeitWinner === 'b') {
    const f = forfeitScores(payload.forfeitWinner === 'a');
    await writePairingResult(
      tournamentId,
      doc,
      roundNumber,
      board,
      pairing,
      f.result,
      f.scoreA,
      f.scoreB,
      f.gamePointsA,
      f.gamePointsB,
      f.spreadA,
      f.spreadB,
      false,
      false,
    );
    return;
  }

  const resolved = resolveSubmittedScores(payload.scoreA, payload.scoreB, doc.meta.variant);
  await writePairingResult(
    tournamentId,
    doc,
    roundNumber,
    board,
    pairing,
    resolved.result,
    payload.scoreA,
    payload.scoreB,
    resolved.gamePointsA,
    resolved.gamePointsB,
    resolved.spreadA,
    resolved.spreadB,
    resolved.skunkA,
    resolved.skunkB,
  );
}

async function rollbackPairingStats(
  tournamentId: string,
  doc: TournamentDoc,
  pairing: TournamentPairing,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  const invert = (uid: string | null, gp: number, sp: number, won: boolean, lost: boolean, skunkG: boolean, skunkR: boolean) => {
    if (!uid || !doc.players[uid]) return;
    const p = doc.players[uid];
    updates[`players/${uid}/gamePoints`] = Math.max(0, p.gamePoints - gp);
    updates[`players/${uid}/spread`] = p.spread - sp;
    if (won) updates[`players/${uid}/wins`] = Math.max(0, p.wins - 1);
    if (lost) updates[`players/${uid}/losses`] = Math.max(0, p.losses - 1);
    if (skunkG) updates[`players/${uid}/skunksGiven`] = Math.max(0, p.skunksGiven - 1);
    if (skunkR) updates[`players/${uid}/skunksReceived`] = Math.max(0, p.skunksReceived - 1);
  };
  const aWon = pairing.result === 'a' || pairing.result === 'forfeit_a';
  const bWon = pairing.result === 'b' || pairing.result === 'forfeit_b';
  const dualDeadline = pairing.result === 'deadline';
  const skunkA = pairing.gamePointsA >= 3;
  const skunkB = pairing.gamePointsB >= 3;
  invert(
    pairing.playerAId,
    pairing.gamePointsA,
    pairing.spreadA,
    aWon,
    bWon || dualDeadline,
    skunkA,
    skunkB,
  );
  invert(
    pairing.playerBId,
    pairing.gamePointsB,
    pairing.spreadB,
    bWon,
    aWon || dualDeadline,
    skunkB,
    skunkA,
  );
  if (Object.keys(updates).length) {
    await update(ref(db(), tournamentPath(tournamentId)), updates);
  }
}

async function writePairingResult(
  tournamentId: string,
  doc: TournamentDoc,
  roundNumber: number,
  board: number,
  pairing: TournamentPairing,
  result: TournamentPairing['result'],
  scoreA: number | null,
  scoreB: number | null,
  gamePointsA: number,
  gamePointsB: number,
  spreadA: number,
  spreadB: number,
  skunkA: boolean,
  skunkB: boolean,
): Promise<void> {
  const round = doc.rounds[String(roundNumber)];
  const idx = round.pairings.findIndex((p) => p.board === board);
  if (idx < 0) throw new Error('Board not found');

  const playersCopy: Record<string, TournamentPlayer> = JSON.parse(JSON.stringify(doc.players));
  applyResultToPlayers(
    playersCopy,
    pairing.playerAId,
    pairing.playerBId,
    result,
    gamePointsA,
    gamePointsB,
    spreadA,
    spreadB,
    skunkA,
    skunkB,
  );

  const updates: Record<string, unknown> = {
    [`rounds/${roundNumber}/pairings/${idx}/result`]: result,
    [`rounds/${roundNumber}/pairings/${idx}/scoreA`]: scoreA,
    [`rounds/${roundNumber}/pairings/${idx}/scoreB`]: scoreB,
    [`rounds/${roundNumber}/pairings/${idx}/gamePointsA`]: gamePointsA,
    [`rounds/${roundNumber}/pairings/${idx}/gamePointsB`]: gamePointsB,
    [`rounds/${roundNumber}/pairings/${idx}/spreadA`]: spreadA,
    [`rounds/${roundNumber}/pairings/${idx}/spreadB`]: spreadB,
    'meta/updatedAt': now(),
  };

  for (const uid of [pairing.playerAId, pairing.playerBId]) {
    if (!uid || !playersCopy[uid]) continue;
    const p = playersCopy[uid];
    updates[`players/${uid}/gamePoints`] = p.gamePoints;
    updates[`players/${uid}/wins`] = p.wins;
    updates[`players/${uid}/losses`] = p.losses;
    updates[`players/${uid}/skunksGiven`] = p.skunksGiven;
    updates[`players/${uid}/skunksReceived`] = p.skunksReceived;
    updates[`players/${uid}/spread`] = p.spread;
  }

  // Mark round complete if all boards done
  const nextPairings = round.pairings.map((p, i) =>
    i === idx
      ? { ...p, result, scoreA, scoreB, gamePointsA, gamePointsB, spreadA, spreadB }
      : p,
  );
  const roundJustFinished = nextPairings.every((p) => p.result !== 'pending');
  if (roundJustFinished) {
    updates[`rounds/${roundNumber}/status`] = 'complete';
  }

  await update(ref(db(), tournamentPath(tournamentId)), updates);

  // Auto-open the next round (pairings already exist) so hosts aren't stuck on COMPLETE.
  if (roundJustFinished) {
    await autoStartNextRoundAfterComplete(tournamentId, roundNumber);
  }
}

/** After the last pending board is scored, start the next pending round if any. */
async function autoStartNextRoundAfterComplete(
  tournamentId: string,
  completedRound: number,
): Promise<void> {
  const doc = await fetchTournament(tournamentId);
  if (!doc || doc.meta.status !== 'live') return;
  if (doc.meta.currentRound !== completedRound) return;
  const round = doc.rounds[String(completedRound)];
  if (!round || round.status !== 'complete') return;
  if (!roundComplete(round)) return;

  const next = completedRound + 1;
  if (next > doc.meta.totalRounds) {
    // Final round done — leave status complete; host can still Force complete profiles.
    return;
  }
  const nextRoundDoc = doc.rounds[String(next)];
  if (!nextRoundDoc) return;
  if (nextRoundDoc.status === 'live' || nextRoundDoc.status === 'complete') return;

  // Mark next round live; host starts lock-in via startRoundTimer.
  const ts = now();
  await update(ref(db(), tournamentPath(tournamentId)), {
    [`rounds/${next}/status`]: 'live',
    'meta/currentRound': next,
    'meta/pairingsLocked': true,
    'meta/updatedAt': ts,
  });
}

function pairingHostDisplayName(
  doc: TournamentDoc,
  pairing: TournamentPairing,
  fallback?: string,
): string {
  const aId = pairing.playerAId;
  const fromA =
    aId && doc.players[aId]?.displayName
      ? doc.players[aId].displayName.trim()
      : '';
  return fromA || (fallback || '').trim() || 'Host';
}

/** Grace before a both-claimed disconnected room is treated as abandoned. */
export const MATCH_ROOM_STUCK_GRACE_MS = 10 * 60 * 1000;

/**
 * Last meaningful activity for stuck detection.
 * createRoom placeholder seat0 uses lastSeen:1 — that alone is not recent activity.
 * Prefer max real lastSeen; fall back to createdAt.
 */
function matchRoomLastActivityMs(room: RoomRecord): number {
  const times: number[] = [];
  for (const seat of [readRoomSeat(room.seats, 0), readRoomSeat(room.seats, 1)]) {
    if (!seat) continue;
    const seen =
      typeof seat.lastSeen === 'number' && Number.isFinite(seat.lastSeen)
        ? seat.lastSeen
        : 0;
    // Placeholder from createRoom is lastSeen: 1 — ignore as activity.
    if (seen > 1) times.push(seen);
  }
  if (typeof room.createdAt === 'number' && Number.isFinite(room.createdAt) && room.createdAt > 1) {
    times.push(room.createdAt);
  }
  return times.length ? Math.max(...times) : 0;
}

function seatClaimed(seat: RoomRecord['seats']['0'] | null | undefined): boolean {
  return !!(seat && typeof seat.name === 'string' && seat.name.trim());
}

/**
 * True when a match room should be discarded and recreated.
 * Never reset while any seat is live. Both-claimed tables (e.g. cutting@cut0
 * after a brief heartbeat drop) stay reclaimable for MATCH_ROOM_STUCK_GRACE_MS.
 * waiting with only the host claimed is always reclaimable. Missing/ended → stuck.
 */
export function isMatchRoomStuck(
  room: RoomRecord | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!room) return true;
  if (room.status === 'ended') return true;
  if (room.game?.state) return false;
  const seat0 = readRoomSeat(room.seats, 0);
  const seat1 = readRoomSeat(room.seats, 1);
  const anyLive = isSeatLive(seat0, nowMs) || isSeatLive(seat1, nowMs);
  // Someone is seated and connected — never auto-wipe (join reclaim / second player).
  if (anyLive) return false;

  const claimed0 = seatClaimed(seat0);
  const claimed1 = seatClaimed(seat1);

  // waiting with only host claimed → reclaimable (Play / second joiner).
  if (room.status === 'waiting' && claimed0 && !claimed1) return false;

  if (claimed0 && claimed1) {
    // Both seats claimed: brief disconnects must NOT fork a new table.
    const activity = matchRoomLastActivityMs(room);
    if (activity > 0 && nowMs - activity < MATCH_ROOM_STUCK_GRACE_MS) {
      return false;
    }
    // Stale beyond grace (or no usable activity) → abandoned.
    return true;
  }

  // No live seats, not a reclaimable waiting host-only room:
  // abandoned cutting / empty one-sided cut → stuck.
  if (room.status === 'cutting') return true;
  return false;
}

/**
 * Pure helper: if a match room is gameOver with scores, return them for submitResult.
 * Does not touch Firebase. Used by Live reconcile + unit tests.
 */
export function finishedMatchRoomScores(
  room: RoomRecord | null | undefined,
): { scoreA: number; scoreB: number } | null {
  const raw = room?.game?.state;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.phase !== 'gameOver') return null;

  const players = s.players;
  let p0: unknown;
  let p1: unknown;
  if (Array.isArray(players) && players.length >= 2) {
    p0 = players[0];
    p1 = players[1];
  } else if (players && typeof players === 'object') {
    const o = players as Record<string, unknown>;
    p0 = o['0'];
    p1 = o['1'];
  } else {
    return null;
  }

  const scoreOf = (p: unknown): number => {
    if (!p || typeof p !== 'object') return NaN;
    const score = (p as { score?: unknown }).score;
    return typeof score === 'number' && Number.isFinite(score) ? score : NaN;
  };
  const scoreA = scoreOf(p0);
  const scoreB = scoreOf(p1);
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return null;
  return { scoreA, scoreB };
}

export type ReconcileFinishedMatchResult = 'submitted' | 'skipped' | 'already';

/**
 * Safety net: if a pending pairing's room is already gameOver, submit the result.
 * Idempotent — submitResult throws when not pending (treated as 'already').
 */
export async function reconcileFinishedMatchRoom(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
  roomOrCode: string | RoomRecord,
): Promise<ReconcileFinishedMatchResult> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const room =
    typeof roomOrCode === 'string' ? await fetchRoom(roomOrCode) : roomOrCode;
  const scores = finishedMatchRoomScores(room);
  if (!scores) return 'skipped';
  try {
    await submitResult(
      user,
      tournamentId,
      roundNumber,
      board,
      scores.scoreA,
      scores.scoreB,
    );
    return 'submitted';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (/already recorded/i.test(msg)) return 'already';
    throw e;
  }
}

function assertPairingRoomAccess(
  user: OwnerLike,
  doc: TournamentDoc,
  pairing: TournamentPairing,
): void {
  if (!user?.uid) throw new Error('Sign in required');
  const isParticipant =
    user.uid === pairing.playerAId || user.uid === pairing.playerBId;
  const hostOk = isOwner(user) || user.uid === doc.meta.hostUserId;
  if (!isParticipant && !hostOk) {
    throw new Error('403 Forbidden — only participants or host can manage match rooms');
  }
}

/**
 * Create an online SuperCrib room for a pairing and store the code.
 * Host seat is always player A's tournament displayName (not the clicker's auth name).
 * If matchRoomCode already exists, returns it unchanged.
 */
export async function attachMatchRoom(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
  _hostDisplayName?: string,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const idx = round.pairings.findIndex((p) => p.board === board);
  if (idx < 0) throw new Error('Board not found');
  const pairing = round.pairings[idx];
  if (pairing.result === 'bye') throw new Error('Bye has no room');
  if (pairing.matchRoomCode) return pairing.matchRoomCode;

  const hostName = pairingHostDisplayName(doc, pairing, _hostDisplayName);
  // Create optimistically, then claim matchRoomCode atomically so two concurrent
  // Plays cannot leave the pairing pointing at different rooms.
  const { code } = await createRoom(hostName);
  const codeRef = ref(
    db(),
    `${tournamentPath(tournamentId)}/rounds/${roundNumber}/pairings/${idx}/matchRoomCode`,
  );
  const txn = await runTransaction(codeRef, (current) => {
    if (typeof current === 'string' && current.trim()) {
      return current;
    }
    return code;
  });
  const assigned = txn.snapshot.val();
  const finalCode =
    typeof assigned === 'string' && assigned.trim() ? assigned.trim() : code;
  if (finalCode !== code) {
    // Lost the race — end our orphan so nobody sits in a ghost table.
    try {
      await update(ref(db(), `rooms/${code}`), { status: 'ended' });
    } catch {
      // best-effort
    }
  } else {
    await update(ref(db(), tournamentPath(tournamentId)), {
      'meta/updatedAt': now(),
    });
  }
  return finalCode;
}

/**
 * Clear pairing.matchRoomCode and create a fresh room with player A as host.
 * Host/owner OR either seated player on that pairing may call.
 */
export async function resetMatchRoom(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const idx = round.pairings.findIndex((p) => p.board === board);
  if (idx < 0) throw new Error('Board not found');
  const pairing = round.pairings[idx];
  if (pairing.result === 'bye') throw new Error('Bye has no room');
  assertPairingRoomAccess(user, doc, pairing);

  const hostName = pairingHostDisplayName(doc, pairing);
  // Clear first so concurrent Play presses do not reuse a stuck code.
  await update(ref(db(), tournamentPath(tournamentId)), {
    [`rounds/${roundNumber}/pairings/${idx}/matchRoomCode`]: null,
    'meta/updatedAt': now(),
  });
  const { code } = await createRoom(hostName);
  await update(ref(db(), tournamentPath(tournamentId)), {
    [`rounds/${roundNumber}/pairings/${idx}/matchRoomCode`]: code,
    'meta/updatedAt': now(),
  });
  return code;
}

/**
 * Return existing match room, or create one. Auto-resets when the room is missing/stuck
 * (no live seats + abandoned cutting / ended). Never wipes while a seat is live.
 */
export async function ensureFreshMatchRoom(
  user: OwnerLike,
  tournamentId: string,
  roundNumber: number,
  board: number,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const round = doc.rounds[String(roundNumber)];
  if (!round) throw new Error('Round not found');
  const pairing = round.pairings.find((p) => p.board === board);
  if (!pairing) throw new Error('Board not found');
  if (pairing.result === 'bye') throw new Error('Bye has no room');

  const existing = pairing.matchRoomCode;
  if (!existing) {
    return attachMatchRoom(user, tournamentId, roundNumber, board);
  }

  let room: RoomRecord | null = null;
  try {
    room = await fetchRoom(existing);
  } catch {
    room = null;
  }
  if (isMatchRoomStuck(room)) {
    return resetMatchRoom(user, tournamentId, roundNumber, board);
  }
  return existing;
}

function assertPlayoffGameRoomAccess(
  user: OwnerLike,
  doc: TournamentDoc,
  series: PlayoffSeries,
): void {
  if (!user?.uid) throw new Error('Sign in required');
  const isParticipant =
    user.uid === series.playerAId || user.uid === series.playerBId;
  const hostOk = isOwner(user) || user.uid === doc.meta.hostUserId;
  if (!isParticipant && !hostOk) {
    throw new Error('403 Forbidden — only playoff participants or host can manage match rooms');
  }
}

function playoffGamePath(seriesId: string, gameIndex: number): string {
  return `playoffs/series/${seriesId}/games/${gameIndex}/matchRoomCode`;
}

/**
 * Create/reuse the online room for one pending playoff game. Room seat 0 is
 * always series player A, so either participant can press Play first.
 */
export async function attachPlayoffGameRoom(
  user: OwnerLike,
  tournamentId: string,
  seriesId: string,
  gameIndex: number,
  _hostDisplayName?: string,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const series = doc.playoffs?.series[seriesId];
  if (!series) throw new Error('Series not found');
  assertPlayoffGameRoomAccess(user, doc, series);
  const gameIdx = series.games.findIndex((g) => g.gameIndex === gameIndex);
  if (gameIdx < 0) throw new Error('Playoff game not found');
  const game = series.games[gameIdx];
  if (series.status === 'complete' || game.result !== 'pending') {
    throw new Error('Playoff game is already complete');
  }
  if (game.matchRoomCode) return game.matchRoomCode;

  const hostName =
    doc.players[series.playerAId]?.displayName?.trim() ||
    (_hostDisplayName || '').trim() ||
    'Host';
  const { code } = await createRoom(hostName);
  const codeRef = ref(
    db(),
    `${tournamentPath(tournamentId)}/${playoffGamePath(seriesId, gameIdx)}`,
  );
  const txn = await runTransaction(codeRef, (current) => {
    if (typeof current === 'string' && current.trim()) return current;
    return code;
  });
  const assigned = txn.snapshot.val();
  const finalCode =
    typeof assigned === 'string' && assigned.trim() ? assigned.trim() : code;
  if (finalCode !== code) {
    try {
      await update(ref(db(), `rooms/${code}`), { status: 'ended' });
    } catch {
      // best-effort cleanup of a concurrent loser
    }
  } else {
    await update(ref(db(), tournamentPath(tournamentId)), { 'meta/updatedAt': now() });
  }
  return finalCode;
}

/** Clear a stuck playoff room and create a fresh room with series A as host. */
export async function resetPlayoffGameRoom(
  user: OwnerLike,
  tournamentId: string,
  seriesId: string,
  gameIndex: number,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const series = doc.playoffs?.series[seriesId];
  if (!series) throw new Error('Series not found');
  assertPlayoffGameRoomAccess(user, doc, series);
  const gameIdx = series.games.findIndex((g) => g.gameIndex === gameIndex);
  if (gameIdx < 0) throw new Error('Playoff game not found');
  const game = series.games[gameIdx];
  if (series.status === 'complete' || game.result !== 'pending') {
    throw new Error('Playoff game is already complete');
  }
  const hostName = doc.players[series.playerAId]?.displayName?.trim() || 'Host';
  await update(ref(db(), tournamentPath(tournamentId)), {
    [playoffGamePath(seriesId, gameIdx)]: null,
    'meta/updatedAt': now(),
  });
  const { code } = await createRoom(hostName);
  await update(ref(db(), tournamentPath(tournamentId)), {
    [playoffGamePath(seriesId, gameIdx)]: code,
    'meta/updatedAt': now(),
  });
  return code;
}

/** Return the shared playoff room, recreating only an abandoned/stuck room. */
export async function ensureFreshPlayoffGameRoom(
  user: OwnerLike,
  tournamentId: string,
  seriesId: string,
  gameIndex: number,
): Promise<string> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  const series = doc.playoffs?.series[seriesId];
  if (!series) throw new Error('Series not found');
  assertPlayoffGameRoomAccess(user, doc, series);
  const game = series.games.find((g) => g.gameIndex === gameIndex);
  if (!game) throw new Error('Playoff game not found');
  if (series.status === 'complete' || game.result !== 'pending') {
    throw new Error('Playoff game is already complete');
  }
  const existing = game.matchRoomCode;
  if (!existing) return attachPlayoffGameRoom(user, tournamentId, seriesId, gameIndex);
  let room: RoomRecord | null = null;
  try {
    room = await fetchRoom(existing);
  } catch {
    room = null;
  }
  if (isMatchRoomStuck(room)) {
    return resetPlayoffGameRoom(user, tournamentId, seriesId, gameIndex);
  }
  return existing;
}

/**
 * Idempotent: for each live/complete round past deadlineAt, lock pending boards
 * as dual deadline forfeits (both 0 GP). Host or any seated player may call.
 * Returns number of boards updated.
 */
export async function applyDeadlineForfeits(
  user: OwnerLike,
  tournamentId: string,
): Promise<number> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  if (doc.meta.status !== 'live' && doc.meta.status !== 'complete') return 0;

  const uid = user.uid;
  const seated = !!doc.players[uid]?.approved && !doc.players[uid]?.dropped;
  const hostOk = isOwner(user) || uid === doc.meta.hostUserId;
  if (!seated && !hostOk) {
    throw new Error('403 Forbidden — only seated players or host can apply deadlines');
  }

  const nowMs = now();
  let applied = 0;
  let working = doc;

  for (const roundKey of Object.keys(working.rounds)) {
    const round = working.rounds[roundKey];
    if (!isDeadlineExpired(round.deadlineAt, nowMs)) continue;
    if (round.status !== 'live' && round.status !== 'complete') continue;

    // Snapshot boards that still need forfeit (re-read after each write)
    const pendingBoards = round.pairings
      .filter((pairing) => pairing.result === 'pending' && pairing.playerAId && pairing.playerBId)
      .map((pairing) => pairing.board);

    for (const board of pendingBoards) {
      const freshRound = working.rounds[String(round.roundNumber)];
      const pairing = freshRound?.pairings.find((p) => p.board === board);
      if (!pairing || pairing.result !== 'pending') continue;

      const d = deadlineForfeitScores();
      await writePairingResult(
        tournamentId,
        working,
        round.roundNumber,
        pairing.board,
        pairing,
        d.result,
        d.scoreA,
        d.scoreB,
        d.gamePointsA,
        d.gamePointsB,
        d.spreadA,
        d.spreadB,
        false,
        false,
      );
      applied += 1;
      const fresh = await fetchTournament(tournamentId);
      if (!fresh) throw new Error('Tournament missing while applying deadlines');
      working = fresh;
    }
  }
  return applied;
}

export function computeStandings(doc: TournamentDoc): StandingRow[] {
  const h2h: HeadToHeadMap = {};
  for (const round of Object.values(doc.rounds)) {
    for (const p of round.pairings) {
      if (!p.playerAId || !p.playerBId) continue;
      if (p.result === 'a' || p.result === 'forfeit_a') {
        h2h[pairKey(p.playerAId, p.playerBId)] = p.playerAId;
      } else if (p.result === 'b' || p.result === 'forfeit_b') {
        h2h[pairKey(p.playerAId, p.playerBId)] = p.playerBId;
      } else if (p.result === 'split') {
        h2h[pairKey(p.playerAId, p.playerBId)] = 'split';
      }
    }
  }
  const rows: StandingRow[] = approvedPlayers(doc.players).map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    gamePoints: p.gamePoints,
    wins: p.wins,
    losses: p.losses,
    skunksGiven: p.skunksGiven,
    skunksReceived: p.skunksReceived,
    spread: p.spread,
    joinedAt: p.joinedAt,
  }));
  return sortStandings(rows, h2h);
}

export async function completeTournament(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const standings = computeStandings(doc);

  // After playoffs, places come from the podium (not RR order).
  const podium =
    doc.playoffs?.status === 'complete'
      ? playoffPodium(
          doc.playoffs,
          standings.map((s) => s.userId),
        )
      : null;

  const placeByUser = new Map<string, number>();
  if (podium) {
    placeByUser.set(podium.firstId, 1);
    placeByUser.set(podium.secondId, 2);
    placeByUser.set(podium.thirdId, 3);
    placeByUser.set(podium.fourthId, 4);
    for (const row of standings) {
      if (!placeByUser.has(row.userId)) {
        placeByUser.set(row.userId, row.place ?? standings.length);
      }
    }
  } else {
    for (const row of standings) {
      placeByUser.set(row.userId, row.place ?? standings.length);
    }
  }

  const updates: Record<string, unknown> = {
    'meta/status': 'complete',
    'meta/phase': 'complete',
    'meta/updatedAt': now(),
  };
  for (const [uid, place] of placeByUser) {
    updates[`players/${uid}/place`] = place;
  }
  await update(ref(db(), tournamentPath(tournamentId)), updates);

  // 1st-place avatar prize (if configured). No art invention — id only until registered.
  const prizeAvatarId = (doc.meta.prizeFirstAvatarId ?? '').trim();
  if (prizeAvatarId) {
    let firstId: string | undefined;
    if (podium) firstId = podium.firstId;
    else {
      for (const [uid, place] of placeByUser) {
        if (place === 1) {
          firstId = uid;
          break;
        }
      }
    }
    if (firstId && !isAiUserId(firstId) && !doc.players[firstId]?.isAi) {
      await grantPrizeAvatarToCloudProfile(firstId, prizeAvatarId);
    }
  }

  // Write tournament stats onto each player profile (+ host hosted count).
  // Skip AI placeholders — they have no real user profile.
  for (const row of standings) {
    if (isAiUserId(row.userId) || doc.players[row.userId]?.isAi) continue;
    const place = placeByUser.get(row.userId) ?? row.place ?? standings.length;
    await applyTournamentRecordToProfile(row.userId, {
      place,
      gamePoints: row.gamePoints,
      skunksGiven: row.skunksGiven,
      skunksReceived: row.skunksReceived,
      tournamentName: doc.meta.name,
      date: now(),
      isHost: row.userId === doc.meta.hostUserId,
    });
  }
  // Host may not be a player
  if (!standings.some((s) => s.userId === doc.meta.hostUserId)) {
    await bumpHostedCount(doc.meta.hostUserId);
  }
}

function prizeAvatarSupplyPath(avatarId: string): string {
  return `prizeAvatars/${avatarId}`;
}

/** How many unique players already hold this limited prize. */
export async function fetchPrizeAvatarGrantedCount(avatarId: string): Promise<number> {
  ensureConfigured();
  const id = avatarId.trim();
  if (!id) return 0;
  const snap = await get(ref(db(), prizeAvatarSupplyPath(id)));
  const val = snap.val() as { granted?: number; holders?: Record<string, unknown> } | null;
  if (!val) return 0;
  if (typeof val.granted === 'number' && Number.isFinite(val.granted)) {
    return Math.max(0, Math.floor(val.granted));
  }
  if (val.holders && typeof val.holders === 'object') {
    return Object.keys(val.holders).length;
  }
  return 0;
}

/** Live map of prizeAvatarId → granted count (for create-sheet supply labels). */
export function subscribePrizeAvatarSupply(
  onData: (counts: Record<string, number>) => void,
): Unsubscribe {
  ensureConfigured();
  const r = ref(db(), 'prizeAvatars');
  return onValue(r, (snap) => {
    const raw = snap.val() as Record<string, { granted?: number; holders?: Record<string, unknown> }> | null;
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
      for (const [id, row] of Object.entries(raw)) {
        if (!row || typeof row !== 'object') continue;
        if (typeof row.granted === 'number' && Number.isFinite(row.granted)) {
          out[id] = Math.max(0, Math.floor(row.granted));
        } else if (row.holders && typeof row.holders === 'object') {
          out[id] = Object.keys(row.holders).length;
        }
      }
    }
    onData(out);
  });
}

/**
 * Grant a prize avatar if supply remains. Limited editions (maxSupply) never
 * exceed circulation; already-owned is a no-op.
 */
async function grantPrizeAvatarToCloudProfile(
  uid: string,
  avatarId: string,
): Promise<void> {
  try {
    const id = avatarId.trim();
    if (!id || !uid) return;
    const catalog = getTournamentPrizeAvatar(id);
    const maxSupply = catalog?.maxSupply;

    // Reserve a limited slot first (atomic), then write ownedAvatarIds.
    if (maxSupply != null && maxSupply > 0) {
      const supplyRef = ref(db(), prizeAvatarSupplyPath(id));
      const result = await runTransaction(supplyRef, (cur) => {
        const base =
          cur && typeof cur === 'object'
            ? (cur as { holders?: Record<string, number>; granted?: number })
            : {};
        const holders: Record<string, number> = {
          ...(base.holders && typeof base.holders === 'object' ? base.holders : {}),
        };
        if (holders[uid]) {
          return {
            holders,
            granted: Object.keys(holders).length,
          };
        }
        const count = Object.keys(holders).length;
        if (count >= maxSupply) {
          return; // abort — sold out
        }
        holders[uid] = Date.now();
        return { holders, granted: Object.keys(holders).length };
      });
      if (!result.committed) {
        console.warn('grantPrizeAvatarToCloudProfile: sold out', id);
        return;
      }
    }

    const r = ref(db(), `users/${uid}/profile/ownedAvatarIds`);
    const snap = await get(r);
    const raw = snap.val();
    const prev: string[] = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : [];
    if (prev.includes(id)) return;
    await set(r, [...prev, id]);

    // Unlimited prizes still record holders for analytics / future caps.
    if (maxSupply == null) {
      await update(ref(db(), prizeAvatarSupplyPath(id)), {
        [`holders/${uid}`]: Date.now(),
      });
    }
  } catch (e) {
    console.warn('grantPrizeAvatarToCloudProfile failed', e);
  }
}

async function applyTournamentRecordToProfile(
  uid: string,
  result: {
    place: number;
    gamePoints: number;
    skunksGiven: number;
    skunksReceived: number;
    tournamentName: string;
    date: number;
    isHost: boolean;
  },
): Promise<void> {
  try {
    const r = ref(db(), `users/${uid}/profile/tournamentRecord`);
    const snap = await get(r);
    const prev = normalizeTournamentRecord(snap.val());
    const next: TournamentRecord = {
      played: prev.played + 1,
      wins: prev.wins + (result.place === 1 ? 1 : 0),
      top4: prev.top4 + (result.place <= 4 ? 1 : 0),
      gamePoints: prev.gamePoints + result.gamePoints,
      skunksGiven: prev.skunksGiven + result.skunksGiven,
      skunksReceived: prev.skunksReceived + result.skunksReceived,
      bestFinish:
        prev.bestFinish === null
          ? result.place
          : Math.min(prev.bestFinish, result.place),
      lastName: result.tournamentName,
      lastDate: result.date,
      lastPlace: result.place,
      hosted: prev.hosted + (result.isHost ? 1 : 0),
    };
    await set(r, next);
  } catch (e) {
    console.warn('applyTournamentRecordToProfile failed', e);
  }
}

async function bumpHostedCount(uid: string): Promise<void> {
  try {
    const r = ref(db(), `users/${uid}/profile/tournamentRecord`);
    const snap = await get(r);
    const prev = normalizeTournamentRecord(snap.val());
    await set(r, { ...prev, hosted: prev.hosted + 1 });
  } catch (e) {
    console.warn('bumpHostedCount failed', e);
  }
}

export function normalizeTournamentRecord(val: unknown): TournamentRecord {
  const empty = emptyTournamentRecord();
  if (!val || typeof val !== 'object') return empty;
  const v = val as Partial<TournamentRecord>;
  return {
    played: Math.max(0, Math.floor(v.played ?? 0)),
    wins: Math.max(0, Math.floor(v.wins ?? 0)),
    top4: Math.max(0, Math.floor(v.top4 ?? 0)),
    gamePoints: Math.max(0, Math.floor(v.gamePoints ?? 0)),
    skunksGiven: Math.max(0, Math.floor(v.skunksGiven ?? 0)),
    skunksReceived: Math.max(0, Math.floor(v.skunksReceived ?? 0)),
    bestFinish:
      typeof v.bestFinish === 'number' && v.bestFinish > 0 ? Math.floor(v.bestFinish) : null,
    lastName: typeof v.lastName === 'string' ? v.lastName : undefined,
    lastDate: typeof v.lastDate === 'number' ? v.lastDate : undefined,
    lastPlace: typeof v.lastPlace === 'number' ? v.lastPlace : null,
    hosted: Math.max(0, Math.floor(v.hosted ?? 0)),
  };
}

export async function cancelTournament(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  await update(ref(db(), `${tournamentPath(tournamentId)}/meta`), {
    status: 'cancelled',
    updatedAt: now(),
  });
}

/** Permanently remove a tournament and free its join code. Host/owner only. */
export async function deleteTournament(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const code = doc.meta.joinCode;
  await remove(ref(db(), tournamentPath(tournamentId)));
  if (code) {
    try {
      await remove(ref(db(), codeIndexPath(code)));
    } catch {
      // Index may already be gone
    }
  }
}


/** Recompute RR player stats + pairing GP/skunk fields from stored scores (scoring v2). */
export async function recalculateRrStats(
  user: OwnerLike,
  tournamentId: string,
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);

  const playersCopy: Record<string, TournamentPlayer> = JSON.parse(JSON.stringify(doc.players));
  for (const p of Object.values(playersCopy)) {
    p.gamePoints = 0;
    p.wins = 0;
    p.losses = 0;
    p.skunksGiven = 0;
    p.skunksReceived = 0;
    p.spread = 0;
  }

  const updates: Record<string, unknown> = {
    'meta/scoringVersion': CURRENT_SCORING_VERSION,
    'meta/updatedAt': now(),
  };

  for (const [rKey, round] of Object.entries(doc.rounds)) {
    round.pairings.forEach((pairing, idx) => {
      if (
        pairing.result === 'pending' ||
        pairing.result === 'bye' ||
        pairing.result === 'deadline'
      ) {
        return;
      }
      if (pairing.result === 'split') {
        applyResultToPlayers(
          playersCopy,
          pairing.playerAId,
          pairing.playerBId,
          'split',
          1,
          1,
          0,
          0,
          false,
          false,
        );
        updates[`rounds/${rKey}/pairings/${idx}/gamePointsA`] = 1;
        updates[`rounds/${rKey}/pairings/${idx}/gamePointsB`] = 1;
        return;
      }
      if (pairing.result === 'forfeit_a' || pairing.result === 'forfeit_b') {
        const f = forfeitScores(pairing.result === 'forfeit_a');
        applyResultToPlayers(
          playersCopy,
          pairing.playerAId,
          pairing.playerBId,
          pairing.result,
          f.gamePointsA,
          f.gamePointsB,
          f.spreadA,
          f.spreadB,
          false,
          false,
        );
        updates[`rounds/${rKey}/pairings/${idx}/gamePointsA`] = f.gamePointsA;
        updates[`rounds/${rKey}/pairings/${idx}/gamePointsB`] = f.gamePointsB;
        updates[`rounds/${rKey}/pairings/${idx}/spreadA`] = f.spreadA;
        updates[`rounds/${rKey}/pairings/${idx}/spreadB`] = f.spreadB;
        return;
      }
      if (typeof pairing.scoreA !== 'number' || typeof pairing.scoreB !== 'number') {
        return;
      }
      const resolved = resolveSubmittedScores(
        pairing.scoreA,
        pairing.scoreB,
        doc.meta.variant,
      );
      applyResultToPlayers(
        playersCopy,
        pairing.playerAId,
        pairing.playerBId,
        resolved.result,
        resolved.gamePointsA,
        resolved.gamePointsB,
        resolved.spreadA,
        resolved.spreadB,
        resolved.skunkA,
        resolved.skunkB,
      );
      updates[`rounds/${rKey}/pairings/${idx}/gamePointsA`] = resolved.gamePointsA;
      updates[`rounds/${rKey}/pairings/${idx}/gamePointsB`] = resolved.gamePointsB;
      updates[`rounds/${rKey}/pairings/${idx}/spreadA`] = resolved.spreadA;
      updates[`rounds/${rKey}/pairings/${idx}/spreadB`] = resolved.spreadB;
      // Keep result as a/b from resolve
      updates[`rounds/${rKey}/pairings/${idx}/result`] = resolved.result;
    });
  }

  for (const [uid, p] of Object.entries(playersCopy)) {
    updates[`players/${uid}/gamePoints`] = p.gamePoints;
    updates[`players/${uid}/wins`] = p.wins;
    updates[`players/${uid}/losses`] = p.losses;
    updates[`players/${uid}/skunksGiven`] = p.skunksGiven;
    updates[`players/${uid}/skunksReceived`] = p.skunksReceived;
    updates[`players/${uid}/spread`] = p.spread;
  }

  await update(ref(db(), tournamentPath(tournamentId)), updates);
}

export function isRoundRobinComplete(doc: TournamentDoc): boolean {
  return rrComplete(doc.meta.currentRound, doc.meta.totalRounds, doc.rounds);
}

/** Seed Bo3 playoffs from current standings (Top 8 / Top 6 / Top 4 / Top 2). */
export async function startPlayoffs(user: OwnerLike, tournamentId: string): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  if (doc.meta.status !== 'live') throw new Error('Tournament is not live');
  if (doc.playoffs && doc.playoffs.status !== 'complete') {
    throw new Error('Playoffs already started');
  }
  if (!isRoundRobinComplete(doc)) {
    throw new Error('Finish all round-robin boards first');
  }
  // Ensure skunk lines are current before seeding
  if ((doc.meta.scoringVersion ?? 1) < CURRENT_SCORING_VERSION) {
    await recalculateRrStats(user, tournamentId);
  }
  const fresh = await fetchTournament(tournamentId);
  if (!fresh) throw new Error('Tournament missing');
  const standings = computeStandings(fresh);
  const advance = clampPlayoffAdvance(
    fresh.meta.playoffAdvanceCount,
    fresh.meta.maxSeats,
  );
  const built =
    advance === 2
      ? buildFinalFromStandings(standings)
      : advance === 8
        ? buildQuartersFromStandings(standings)
        : advance === 6
          ? buildTop6OpeningFromStandings(standings)
          : buildSemisFromStandings(standings);
  const bracket = playoffBracketForRtdb(built);
  await update(ref(db(), tournamentPath(tournamentId)), {
    playoffs: bracket,
    'meta/phase': 'playoffs',
    'meta/updatedAt': now(),
  });
}

export async function submitPlayoffGame(
  user: OwnerLike,
  tournamentId: string,
  seriesId: string,
  gameIndex: number,
  scoreA: number,
  scoreB: number,
): Promise<void> {
  ensureConfigured();
  if (!user?.uid) throw new Error('Sign in required');
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  if (!doc.playoffs) throw new Error('Playoffs not started');
  const series = doc.playoffs.series[seriesId];
  if (!series) throw new Error('Series not found');

  const isParticipant =
    user.uid === series.playerAId || user.uid === series.playerBId;
  const hostOk = isOwner(user) || user.uid === doc.meta.hostUserId;
  if (!isParticipant && !hostOk) {
    throw new Error('403 Forbidden — only participants or host can submit');
  }

  // A completed room must not be reused for the next Bo3 game. Clear only
  // this game's room metadata; pending games retain their own room (if any).
  const scored = applyPlayoffGameResult(series, gameIndex, scoreA, scoreB, {
    variant: doc.meta.variant,
    playoffSkunkCountsAsTwo: !!doc.meta.playoffSkunkCountsAsTwo,
  });
  const updated = playoffSeriesForRtdb({
    ...scored,
    games: scored.games.map((game) =>
      game.gameIndex === gameIndex ? { ...game, matchRoomCode: null } : game,
    ),
  });
  const updates: Record<string, unknown> = {
    'meta/updatedAt': now(),
  };

  let bracket: PlayoffBracket = playoffBracketForRtdb({
    ...doc.playoffs,
    series: { ...doc.playoffs.series, [seriesId]: updated },
  });

  if (
    bracket.status === 'quarters' &&
    bothQuartersComplete(bracket) &&
    !bracket.series['sf-a'] &&
    !bracket.series['sf-b']
  ) {
    const semis =
      isTop6PlayInBracket(bracket) || doc.meta.playoffAdvanceCount === 6
        ? buildSemisFromTop6Quarters(bracket, computeStandings(doc))
        : buildSemisFromQuarters(bracket);
    bracket = playoffBracketForRtdb({
      status: 'semis',
      series: {
        ...bracket.series,
        'sf-a': playoffSeriesForRtdb(semis['sf-a']),
        'sf-b': playoffSeriesForRtdb(semis['sf-b']),
      },
    });
    updates['playoffs'] = bracket;
  } else if (bracket.status === 'semis' && bothSemisComplete(bracket) && !bracket.series['final']) {
    const fin = playoffSeriesForRtdb(buildFinalSeries(bracket));
    bracket = playoffBracketForRtdb({
      status: 'final',
      series: { ...bracket.series, final: fin },
    });
    updates['playoffs'] = bracket;
  } else if (seriesId === 'final' && updated.status === 'complete') {
    updates[`playoffs/series/${seriesId}`] = updated;
    updates['playoffs/status'] = 'complete';
    updates['meta/phase'] = 'complete';
  } else {
    updates[`playoffs/series/${seriesId}`] = updated;
  }

  await update(ref(db(), tournamentPath(tournamentId)), updates);
}

/** Host quick-resolve for a playoff game involving AI. */
export async function resolveAiPlayoffGame(
  user: OwnerLike,
  tournamentId: string,
  seriesId: string,
  opts?: { random?: boolean },
): Promise<void> {
  ensureConfigured();
  const doc = await fetchTournament(tournamentId);
  if (!doc) throw new Error('Tournament not found');
  assertHostOrOwner(user, doc.meta);
  const series = doc.playoffs?.series[seriesId];
  if (!series) throw new Error('Series not found');
  const gameIndex = nextPendingGameIndex(series);
  if (gameIndex === null) throw new Error('No pending game in series');
  const a = doc.players[series.playerAId];
  const b = doc.players[series.playerBId];
  if (!isAiTournamentPlayer(a) && !isAiTournamentPlayer(b)) {
    throw new Error('Resolve AI only for series with an AI seat');
  }
  const scores = pickPracticeAiScores({ random: !!opts?.random });
  await submitPlayoffGame(
    user,
    tournamentId,
    seriesId,
    gameIndex,
    scores.scoreA,
    scores.scoreB,
  );
}


export { scheduleMeta };
export {
  isAiTournamentPlayer,
  isAiUserId,
  pairingInvolvesAi,
  pairingIsAiOnly,
  PRACTICE_AI_ROSTER,
} from './practiceAi';

