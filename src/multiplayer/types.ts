import type { PlayerId } from '../engine/supercrib';

export type RoomStatus = 'waiting' | 'cutting' | 'playing' | 'ended';

export type ConnectionStatus = 'waiting' | 'connected' | 'disconnected' | 'offline';

export type CutStage = 'cut0' | 'cut1' | 'reveal' | 'tie' | 'winner';

export type SeatRole = 0 | 1;

/**
 * RTDB cut-for-deal payload (cards by id).
 * Empty cut slots are stored as '' in RTDB (Firebase deletes nulls).
 * `winner` may be omitted when unset — treat missing as null on read.
 */
export interface SyncedCutState {
  rev: number;
  deck: string[];
  /** Empty slots are '' in RTDB; null is only used in-memory before write. */
  cuts: [string | null, string | null];
  stage: CutStage;
  /** Omitted in RTDB when unset (Firebase strips null). */
  winner?: PlayerId | null;
  round: number;
}

/** RTDB game payload wrapper. */
export interface SyncedGameEnvelope {
  rev: number;
  state: unknown;
}

/** Latest table trash-talk emoji (overwrite-only; mirror via room subscribe). */
export interface SyncedReaction {
  seat: SeatRole;
  emoji: string;
  at: number;
}

export interface RoomSeat {
  name: string;
  connected: boolean;
  lastSeen: number;
  /** Catalog / unlock avatar id from the player's profile (optional; older rooms omit). */
  avatarId?: string | null;
}

export interface RoomRecord {
  code: string;
  createdAt: number;
  status: RoomStatus;
  hostName: string;
  guestName: string | null;
  seats: {
    '0': RoomSeat;
    '1': RoomSeat | null;
  };
  cut: SyncedCutState | null;
  game: SyncedGameEnvelope | null;
  /** Latest emoji reaction (optional; overwrite latest). */
  reaction?: SyncedReaction | null;
  /**
   * Match-scoped felt id chosen by cut-for-deal winner.
   * Both seats render this for the match; does not change profile equip.
   * Omitted / stripped until set (Firebase deletes null).
   */
  matchFeltId?: string | null;
  /**
   * Match-scoped pegboard paint id chosen by cut-for-deal winner.
   * Paint-only — never changes hole/path math.
   */
  matchBoardSkinId?: string | null;
  /**
   * Host-picked show scoring mode. Guest inherits from the room.
   * Omitted on older rooms → treat as 'auto' (Normal).
   */
  scoringMode?: 'auto' | 'competitive';
}
