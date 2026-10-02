/** Club Night Round Robin — RTDB / client types. */

export type TournamentVariant = 'supercrib' | 'classic_121';
export type TournamentFormat = 'club_night_rr';
export type TournamentStatus = 'draft' | 'lobby' | 'live' | 'complete' | 'cancelled';
export type TournamentVisibility = 'private' | 'public';
export type RoundStatus = 'pending' | 'live' | 'complete';
export type PairingResult =
  | 'pending'
  | 'a'
  | 'b'
  | 'split'
  | 'forfeit_a'
  | 'forfeit_b'
  | 'deadline'
  | 'bye';

export type GameClockChoice = 0 | 18 | 22 | 25 | 30; // minutes; 0 = off

export interface Tournament {
  id: string;
  name: string;
  hostUserId: string;
  variant: TournamentVariant;
  format: TournamentFormat;
  status: TournamentStatus;
  visibility: TournamentVisibility;
  joinCode: string;
  maxSeats: number;
  /** Seconds; 0 = no clock. */
  gameClockSec: number;
  currentRound: number;
  totalRounds: number;
  createdAt: number;
  updatedAt: number;
  buyInNote?: string;
  prizeNote?: string;
  /** True after Round 1 starts — pairings locked. */
  pairingsLocked?: boolean;
  /** rr while circle rounds run; playoffs after RR; complete when finished. */
  phase?: 'rr' | 'playoffs' | 'complete';
  /** Bump when skunk/GP rules change so clients can recalc stored stats. */
  scoringVersion?: number;
  /**
   * When true, a skunk or double-skunk in a playoff game awards +2 series wins
   * (Bo3 ends immediately). Default false for existing tournaments.
   */
  playoffSkunkCountsAsTwo?: boolean;
  /**
   * How many RR finishers advance to playoffs:
   * Top 8 (quarters → semis → Final), Top 6 (play-in 3v6/4v5; 1–2 bye → semis → Final),
   * Top 4 (semis 1v4/2v3 → Final), or Top 2 (Final only).
   * Default 4 when missing (legacy tournaments).
   */
  playoffAdvanceCount?: PlayoffAdvanceCount;
  /**
   * Minutes for each RR round lock-in window (deadlineAt = roundStartedAt + this).
   * Timer starts when the host presses Start (not when the round goes live).
   * When missing, clients/API use ROUND_LOCK_IN_MS (60 min).
   */
  roundLockInMin?: number;
  /**
   * Overall event limit in minutes from Round 1 start. 0 / missing = off.
   * Does not auto-finish — Live shows a countdown and host cue when expired.
   */
  tournamentDurationMin?: number;
  /**
   * Super Coins entry fee charged on join request. 0 / missing = free.
   */
  entryFeeSc?: number;
  /**
   * Avatar id granted to 1st place on complete (see TOURNAMENT_PRIZE_AVATARS).
   */
  prizeFirstAvatarId?: string;
  /**
   * Target round-robin games per player (2 … seats−1).
   * Missing / 0 = full RR (seats−1 games each; odd counts use bye rounds).
   */
  rrGamesPerPlayer?: number;
}

export interface TournamentPlayer {
  userId: string;
  displayName: string;
  playerCode?: string;
  /** Equipped avatar id from joiner profile when seated (optional for legacy rows). */
  avatarId?: string;
  seat: number;
  gamePoints: number;
  wins: number;
  losses: number;
  skunksGiven: number;
  skunksReceived: number;
  spread: number;
  place: number | null;
  dropped: boolean;
  joinedAt: number;
  approved: boolean;
  /** Owner-testing AI placeholder — never needs Join; skip profile writes. */
  isAi?: boolean;
}

export interface TournamentJoinRequest {
  userId: string;
  displayName: string;
  playerCode?: string;
  /** Snapshot of joiner's profile.avatarId at request time. */
  avatarId?: string;
  requestedAt: number;
}

export interface TournamentPairing {
  board: number;
  playerAId: string | null;
  playerBId: string | null;
  matchRoomCode?: string | null;
  result: PairingResult;
  scoreA: number | null;
  scoreB: number | null;
  gamePointsA: number;
  gamePointsB: number;
  spreadA: number;
  spreadB: number;
}

export interface TournamentRound {
  roundNumber: number;
  status: RoundStatus;
  pairings: TournamentPairing[];
  /** Epoch ms when the host started this round's lock-in timer. */
  roundStartedAt?: number;
  /** Epoch ms lock-in deadline (roundStartedAt + roundLockIn from meta, else ROUND_LOCK_IN_MS). */
  deadlineAt?: number;
}


export type PlayoffSeriesStatus = 'pending' | 'live' | 'complete';

export interface PlayoffGame {
  gameIndex: number;
  scoreA: number | null;
  scoreB: number | null;
  /** 'a' | 'b' | 'pending' */
  result: 'pending' | 'a' | 'b';
  /** Online room shared by both participants for this playoff game. */
  matchRoomCode?: string | null;
}

export interface PlayoffSeries {
  id: string;
  label: string;
  /** Standing seed 1–4 (final uses 0). */
  seedA: number;
  seedB: number;
  playerAId: string;
  playerBId: string;
  bestOf: number;
  winsA: number;
  winsB: number;
  games: PlayoffGame[];
  status: PlayoffSeriesStatus;
  winnerId: string | null;
}

export interface PlayoffBracket {
  status: 'quarters' | 'semis' | 'final' | 'complete';
  series: Record<string, PlayoffSeries>;
}

/** Full document under tournaments/{id}. */
export interface TournamentDoc {
  meta: Tournament;
  players: Record<string, TournamentPlayer>;
  joinRequests?: Record<string, TournamentJoinRequest>;
  rounds: Record<string, TournamentRound>; // key = String(roundNumber)
  playoffs?: PlayoffBracket;
}

export interface TournamentRecord {
  played: number;
  wins: number;
  top4: number;
  gamePoints: number;
  skunksGiven: number;
  skunksReceived: number;
  /** 1 = best; null if never finished. */
  bestFinish: number | null;
  lastName?: string;
  lastDate?: number;
  lastPlace?: number | null;
  hosted: number;
}

export function emptyTournamentRecord(): TournamentRecord {
  return {
    played: 0,
    wins: 0,
    top4: 0,
    gamePoints: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    bestFinish: null,
    hosted: 0,
  };
}

/** Skunk lines per club / ACC-style (spec): stay 91 / 61 even for SuperCrib 241 games. */
/** Classic 121 skunk lines (ACC-style). */
export const SKUNK_LINE = 91;
export const DOUBLE_SKUNK_LINE = 61;

/**
 * SuperCrib (241) skunk lines — same fraction of the race as classic 91/61 of 121.
 * round(91 * 241/121) = 181, round(61 * 241/121) = 122.
 */
export const SUPERCRIB_SKUNK_LINE = 181;
export const SUPERCRIB_DOUBLE_SKUNK_LINE = 122;
/** 2 = SuperCrib scaled skunk lines (181/122). */
export const CURRENT_SCORING_VERSION = 2;
export const FORFEIT_WIN_SCORE = 121;
export const FORFEIT_LOSS_SCORE = 90;

export type PlayoffAdvanceCount = 2 | 4 | 6 | 8;

/** Clamp requested advance to seats and allowed set (2 | 4 | 6 | 8). Default 4. */
export function clampPlayoffAdvance(
  requested: PlayoffAdvanceCount | undefined,
  maxSeats: number,
): PlayoffAdvanceCount {
  let advance: PlayoffAdvanceCount =
    requested === 2 || requested === 6 || requested === 8 ? requested : 4;
  // Fallback chain when seats are too low: 8 → 6 → 4 → 2
  if (advance === 8 && maxSeats < 8) {
    advance = maxSeats >= 6 ? 6 : maxSeats >= 4 ? 4 : 2;
  }
  if (advance === 6 && maxSeats < 6) {
    advance = maxSeats >= 4 ? 4 : 2;
  }
  if (advance === 4 && maxSeats < 4) {
    advance = 2;
  }
  if (advance > maxSeats) {
    if (maxSeats >= 8) advance = 8;
    else if (maxSeats >= 6) advance = 6;
    else if (maxSeats >= 4) advance = 4;
    else advance = 2;
  }
  return advance;
}

export const MIN_SEATS = 4;
export const MAX_SEATS = 20;

/** Default lock-in window once a round goes live (1 hour). */
export const ROUND_LOCK_IN_MS = 60 * 60 * 1000;
/** Default round lock-in in minutes (matches ROUND_LOCK_IN_MS). */
export const DEFAULT_ROUND_LOCK_IN_MIN = 60;

/** Resolve round lock-in ms from meta; falls back to ROUND_LOCK_IN_MS. */
export function roundLockInMsFromMeta(meta: {
  roundLockInMin?: number | null;
}): number {
  const min = meta.roundLockInMin;
  if (typeof min === 'number' && Number.isFinite(min) && min > 0) {
    return Math.floor(min) * 60 * 1000;
  }
  return ROUND_LOCK_IN_MS;
}
