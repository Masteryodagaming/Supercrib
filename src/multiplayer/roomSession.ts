/**
 * Firebase RTDB room session — create / join / subscribe / push / leave.
 * Rev-matched writes: clients apply optimistic updates only when rev matches.
 */
import {
  ref,
  set,
  get,
  update,
  onValue,
  off,
  runTransaction,
  onDisconnect,
  type Unsubscribe,
  type DatabaseReference,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from './firebase';
import { clearVoiceSignaling } from './voicePtt';
import { generateRoomCode, normalizeRoomCode, isValidRoomCode } from './roomCode';
import { serializeGameState, deserializeGameState, cardFromId, cardToId, stripUndefined } from './serialize';
import type {
  RoomRecord,
  RoomStatus,
  SyncedCutState,
  SyncedReaction,
  SeatRole,
  CutStage,
} from './types';
import type { GameState, PlayerId, ScoringMode } from '../engine/supercrib';
import { normalizeScoringMode } from '../engine/supercrib';
import { createCutStock, takeCutCard, dealerFromCutCards } from '../engine/cutForDeal';
import type { Card } from '../engine/cards';

export function roomShareUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  return `${origin}${path}?room=${encodeURIComponent(code)}`;
}

function roomRef(code: string): DatabaseReference {
  return ref(getFirebaseDb(), `rooms/${normalizeRoomCode(code)}`);
}

function now(): number {
  return Date.now();
}

/**
 * Firebase may return arrays as plain objects `{0:..,1:..}`.
 * Normalize to a dense list ordered by numeric keys.
 */
export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, unknown>)[k]);
  }
  return [];
}

function cutSlotId(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value);
}

/** Build a Firebase-safe cut payload (no null cuts; omit unset winner). */
function cutWritePayload(
  cut: Omit<SyncedCutState, 'rev'> & { rev?: number },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    deck: asList(cut.deck).map((id) => String(id)),
    cuts: [cutSlotId(asList(cut.cuts)[0]), cutSlotId(asList(cut.cuts)[1])],
    stage: cut.stage,
    round: cut.round,
  };
  if (typeof cut.rev === 'number') {
    payload.rev = cut.rev;
  }
  if (cut.winner === 0 || cut.winner === 1) {
    payload.winner = cut.winner;
  }
  return payload;
}

function emptyCut(): SyncedCutState {
  const deck = createCutStock();
  return {
    rev: 0,
    deck: deck.map(cardToId),
    cuts: ['', ''],
    stage: 'cut0',
    round: 1,
    // winner omitted — Firebase strips null; readers treat missing as null
  };
}

/** Host Play / recovery: write full cut stock + status cutting (no null cuts). */
export async function ensureRoomCut(code: string): Promise<void> {
  const cut = emptyCut();
  await update(roomRef(code), {
    status: 'cutting' as RoomStatus,
    cut: cutWritePayload(cut),
    // Clear prior match skins so a rematch cut starts fresh (Firebase strips null).
    matchFeltId: null,
    matchBoardSkinId: null,
  });
}

/**
 * Cut winner writes match-scoped table skins for both seats.
 * Does not touch either player's profile equip.
 */
export async function setRoomMatchSkins(
  code: string,
  matchFeltId: string,
  matchBoardSkinId: string,
): Promise<void> {
  await update(roomRef(code), {
    matchFeltId,
    matchBoardSkinId,
  });
}

export async function createRoom(
  hostName: string,
  opts?: { avatarId?: string | null; scoringMode?: ScoringMode },
): Promise<{ code: string; room: RoomRecord }> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase not configured');
  }
  const db = getFirebaseDb();
  let code = '';
  let attempts = 0;
  while (attempts < 12) {
    code = generateRoomCode(5);
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) break;
    attempts += 1;
  }
  if (!code) throw new Error('Could not allocate room code');

  const hostAvatar = (opts?.avatarId ?? '').trim() || null;
  const scoringMode = normalizeScoringMode(opts?.scoringMode);
  const room: RoomRecord = {
    code,
    createdAt: now(),
    status: 'waiting',
    hostName,
    guestName: null,
    seats: {
      // Disconnected until the real host joins — avoids ghost seat-0 while
      // both players join as guests and nobody can cut.
      '0': {
        name: hostName,
        connected: false,
        lastSeen: 1,
        ...(hostAvatar ? { avatarId: hostAvatar } : {}),
      },
      '1': null,
    },
    cut: null,
    game: null,
    scoringMode,
  };
  await set(roomRef(code), room);

  // Presence
  const seatPath = ref(db, `rooms/${code}/seats/0`);
  await onDisconnect(seatPath).update({ connected: false, lastSeen: now() });

  return { code, room };
}

/** Host-picked scoring mode on the room (guest inherits). Older rooms → auto. */
export function roomScoringMode(room: RoomRecord | null | undefined): ScoringMode {
  return normalizeScoringMode(room?.scoringMode);
}

/** True while host may still change room.scoringMode (waiting lobby only). */
export function canChangeRoomScoringMode(
  room: Pick<RoomRecord, 'status' | 'game'> | null | undefined,
): boolean {
  if (!room) return false;
  if (room.game?.state) return false;
  if (room.status === 'playing' || room.status === 'ended' || room.status === 'cutting') {
    return false;
  }
  // waiting / missing legacy status
  return true;
}

/**
 * Host may change scoring mode while the lobby is still open (waiting).
 * Locked once cut/deal/playing has begun.
 */
export async function setRoomScoringMode(
  code: string,
  mode: ScoringMode,
): Promise<void> {
  const normalized = normalizeScoringMode(mode);
  const r = roomRef(code);
  const snap = await get(r);
  if (!snap.exists()) {
    throw new Error('Room not found');
  }
  const room = snap.val() as RoomRecord;
  if (!canChangeRoomScoringMode(room)) {
    throw new Error('Scoring mode locked — match underway');
  }
  await update(r, { scoringMode: normalized });
}

/** How long a seat can stay "connected" without a fresh lastSeen before we treat it as stale. */
export const SEAT_STALE_MS = 45_000;

type SeatMap = RoomRecord['seats'] | Array<RoomRecord['seats']['0'] | null | undefined> | null | undefined;

/** RTDB often stores seats/0+1 as an array — normalize either shape. */
export function readRoomSeat(seats: SeatMap, seat: SeatRole): RoomRecord['seats']['0'] | null {
  if (!seats) return null;
  const raw = Array.isArray(seats)
    ? seats[seat]
    : (seats as RoomRecord['seats'])[String(seat) as '0' | '1'];
  if (!raw || typeof raw !== 'object') return null;
  if (typeof (raw as { name?: unknown }).name !== 'string') return null;
  return raw as RoomRecord['seats']['0'];
}

/** True when the seat is holding a live connection (not disconnected / stale ghost). */
export function isSeatLive(
  seat: RoomRecord['seats']['0'] | null | undefined,
  nowMs: number = Date.now(),
  staleMs: number = SEAT_STALE_MS,
): boolean {
  if (!seat) return false;
  if (!seat.connected) return false;
  const seen = typeof seat.lastSeen === 'number' && Number.isFinite(seat.lastSeen) ? seat.lastSeen : 0;
  // Missing/zero lastSeen with connected:true is treated live (legacy rows).
  if (seen > 0 && nowMs - seen > staleMs) return false;
  return true;
}

/**
 * Pick seat for join / resume.
 * - Prefer saved seat when the display name matches.
 * - Reclaim disconnected/stale seats.
 * - Never let the same display name occupy both seats (ghost "table full" / cut freeze).
 * - Treat guest seat named identically to host as a ghost and free it.
 */
/** Generic placeholder name left by incomplete joins — reclaimable ghost. */
export function isGenericPlayerName(n: string | null | undefined): boolean {
  return typeof n === 'string' && n.trim().toLowerCase() === 'player';
}

export function resolveJoinSeat(
  existing: Pick<RoomRecord, 'hostName' | 'guestName' | 'seats'>,
  guestName: string,
  preferredSeat?: SeatRole,
  nowMs: number = Date.now(),
): SeatRole {
  const name = guestName.trim();
  const seat0 = readRoomSeat(existing.seats, 0);
  const seat1 = readRoomSeat(existing.seats, 1);
  // Ghost: guest copied host name into seat 1 (seen in freezes).
  const seat1IsGhostDouble =
    !!seat1 &&
    !!existing.hostName &&
    (seat1.name === existing.hostName ||
      (!!existing.guestName && existing.guestName === existing.hostName && seat1.name === existing.guestName));
  // Ghost: generic "Player" occupying guest seat (wrong profile join).
  const seat1IsPlayerGhost =
    isGenericPlayerName(seat1?.name) || isGenericPlayerName(existing.guestName);
  const live0 = isSeatLive(seat0, nowMs);
  const live1 = isSeatLive(seat1, nowMs) && !seat1IsGhostDouble && !seat1IsPlayerGhost;

  const nameMatchesSeat = (s: SeatRole): boolean => {
    if (s === 0) {
      return existing.hostName === name || seat0?.name === name;
    }
    if (seat1IsGhostDouble || seat1IsPlayerGhost) return false;
    return existing.guestName === name || seat1?.name === name;
  };

  /** Preferred seat is empty, stale, disconnected, or a reclaimable Player ghost. */
  const preferredSeatReclaimable = (s: SeatRole): boolean => {
    const seat = s === 0 ? seat0 : seat1;
    if (!seat) return true;
    if (!seat.connected) return true;
    if (!isSeatLive(seat, nowMs)) return true;
    if (isGenericPlayerName(seat.name)) return true;
    if (s === 1 && (seat1IsGhostDouble || seat1IsPlayerGhost)) return true;
    return false;
  };

  if (preferredSeat === 0 || preferredSeat === 1) {
    if (nameMatchesSeat(preferredSeat)) {
      return preferredSeat;
    }
    // Preferred host: reclaim free/stale/Player ghost; name-match already returned above.
    if (preferredSeat === 0 && preferredSeatReclaimable(0)) {
      return 0;
    }
    // Preferred guest: empty / stale / ghost / Player — take it.
    if (preferredSeat === 1 && preferredSeatReclaimable(1)) {
      return 1;
    }
  }

  // Rejoin as host if seat 0 is free/stale and name matches.
  if (!live0 && (existing.hostName === name || seat0?.name === name)) {
    return 0;
  }

  // Same display name must not take the guest seat while host still holds that name.
  if (existing.hostName && existing.hostName === name) {
    if (!live0) return 0;
    throw new Error('That name is already the host — rejoin as host or use a different name');
  }

  if (live1) {
    if (existing.guestName === name || seat1?.name === name) {
      return 1;
    }
    throw new Error('Room is full');
  }
  return 1;
}

export async function joinRoom(
  codeRaw: string,
  guestName: string,
  preferredSeat?: SeatRole,
  opts?: { avatarId?: string | null },
): Promise<{ code: string; seat: SeatRole; room: RoomRecord }> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase not configured');
  }
  const code = normalizeRoomCode(codeRaw);
  if (!isValidRoomCode(code)) {
    throw new Error('Invalid room code');
  }
  const r = roomRef(code);
  const snap = await get(r);
  if (!snap.exists()) {
    throw new Error('Room not found');
  }
  const existing = snap.val() as RoomRecord;

  if (existing.status === 'ended') {
    throw new Error('This match already ended — start a new room');
  }

  const seat = resolveJoinSeat(existing, guestName, preferredSeat);

  const seatAvatar = (opts?.avatarId ?? '').trim() || null;
  const seatPayload = {
    name: guestName,
    connected: true,
    lastSeen: now(),
    ...(seatAvatar ? { avatarId: seatAvatar } : {}),
  };
  const updates: Record<string, unknown> = {};
  if (seat === 1) {
    updates['guestName'] = guestName;
    updates['seats/1'] = seatPayload;
    // Stay in waiting so lobby scoring chooser + host Play can run.
    // Only heal a stuck mid-cut with empty cuts (do not auto-start cut on join).
    const cut = existing.cut;
    const cutStuckEmpty =
      existing.status === 'cutting' &&
      (!cut || cut.stage === 'cut0') &&
      (!cut?.cuts?.[0] && !cut?.cuts?.[1]);
    if (cutStuckEmpty && !existing.game?.state) {
      updates['status'] = 'cutting';
      updates['cut'] = cutWritePayload(emptyCut());
    }
  } else {
    updates['seats/0'] = seatPayload;
    // Host reclaim mid-cut with empty cuts — restart cut so neither side is stuck waiting.
    const cut = existing.cut;
    const cutStuckEmpty =
      existing.status === 'cutting' &&
      (!cut || cut.stage === 'cut0') &&
      (!cut?.cuts?.[0] && !cut?.cuts?.[1]);
    if (cutStuckEmpty && !existing.game?.state) {
      updates['cut'] = cutWritePayload(emptyCut());
      updates['status'] = 'cutting';
    }
  }
  await update(r, updates);

  const db = getFirebaseDb();
  const seatPath = ref(db, `rooms/${code}/seats/${seat}`);
  await onDisconnect(seatPath).update({ connected: false, lastSeen: now() });

  const after = await get(r);
  return { code, seat, room: after.val() as RoomRecord };
}

export async function markConnected(
  code: string,
  seat: SeatRole,
  name: string,
  opts?: { avatarId?: string | null },
): Promise<void> {
  const db = getFirebaseDb();
  const seatPath = ref(db, `rooms/${normalizeRoomCode(code)}/seats/${seat}`);
  const avatarId = (opts?.avatarId ?? '').trim() || null;
  await update(seatPath, {
    connected: true,
    lastSeen: now(),
    name,
    ...(avatarId ? { avatarId } : {}),
  });
  await onDisconnect(seatPath).update({ connected: false, lastSeen: now() });
}

export function subscribeRoom(
  code: string,
  onRoom: (room: RoomRecord | null) => void,
): Unsubscribe {
  const r = roomRef(code);
  const handler = (snap: { val: () => unknown }) => {
    onRoom((snap.val() as RoomRecord) || null);
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** RTDB client connectivity — fires true/false as the socket drops/restores. */
export function subscribeFirebaseConnected(
  onConnected: (connected: boolean) => void,
): Unsubscribe {
  const infoRef = ref(getFirebaseDb(), '.info/connected');
  const handler = (snap: { val: () => unknown }) => {
    onConnected(snap.val() === true);
  };
  onValue(infoRef, handler);
  return () => off(infoRef, 'value', handler);
}

/** One-shot fetch of the latest room record (for conflict resync). */
export async function fetchRoom(code: string): Promise<RoomRecord | null> {
  const snap = await get(roomRef(code));
  if (!snap.exists()) return null;
  return (snap.val() as RoomRecord) || null;
}

/**
 * Push game state if expectedRev matches. Returns true if committed.
 */
export async function pushGameState(
  code: string,
  expectedRev: number,
  state: GameState,
): Promise<boolean> {
  const gameRef = ref(getFirebaseDb(), `rooms/${normalizeRoomCode(code)}/game`);
  // serializeGameState already stripUndefineds; scrub again so the transaction
  // payload is plain JSON-safe (Firebase RTDB rejects undefined).
  const serialized = stripUndefined(serializeGameState({ ...state, mode: 'online' }));
  try {
    // Abort (return undefined) yields committed=false — not an exception.
    const result = await runTransaction(gameRef, (current) => {
      if (current == null) {
        if (expectedRev !== 0) return undefined;
        return { rev: 1, state: serialized };
      }
      if ((current as { rev: number }).rev !== expectedRev) {
        return undefined;
      }
      return {
        rev: expectedRev + 1,
        state: serialized,
      };
    });
    if (result.committed) {
      // Best-effort status; game write already landed — don't throw and leave optimistic stuck.
      try {
        await update(roomRef(code), { status: 'playing' as RoomStatus });
      } catch (e) {
        console.warn('pushGameState: status update failed after commit', e);
      }
    }
    return result.committed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('pushGameState failed', msg);
    throw e;
  }
}

/**
 * Push cut state if expectedRev matches.
 */
export async function pushCutState(
  code: string,
  expectedRev: number,
  cut: Omit<SyncedCutState, 'rev'>,
): Promise<boolean> {
  const cutRef = ref(getFirebaseDb(), `rooms/${normalizeRoomCode(code)}/cut`);
  const result = await runTransaction(cutRef, (current) => {
    if (current == null) {
      if (expectedRev !== 0) return undefined;
      return cutWritePayload({ ...cut, rev: 1 });
    }
    if ((current as SyncedCutState).rev !== expectedRev) {
      return undefined;
    }
    return cutWritePayload({ ...cut, rev: expectedRev + 1 });
  });
  return result.committed;
}

/** Apply a cut for the given seat; returns new cut payload (without writing). */
export function applyCutLocal(
  cut: SyncedCutState,
  seat: PlayerId,
  cutIndex: number,
): SyncedCutState | null {
  const expectedStage: CutStage = seat === 0 ? 'cut0' : 'cut1';
  if (cut.stage !== expectedStage) return null;

  const deckIds = asList(cut.deck).map((id) => String(id));
  const priorCuts: [string, string] = [
    cutSlotId(asList(cut.cuts)[0]),
    cutSlotId(asList(cut.cuts)[1]),
  ];
  if (priorCuts[seat]) return null;

  const deckCards = deckIds.map(cardFromId);
  if (deckCards.length === 0) return null;
  const { card, remaining } = takeCutCard(deckCards, cutIndex);
  const cuts: [string | null, string | null] = [...priorCuts];
  cuts[seat] = cardToId(card);
  let stage: CutStage = seat === 0 ? 'cut1' : 'reveal';
  let winner: PlayerId | null | undefined = undefined;

  if (stage === 'reveal' && cuts[0] && cuts[1]) {
    const dealer = dealerFromCutCards(cardFromId(cuts[0]), cardFromId(cuts[1]));
    if (dealer === null) {
      stage = 'tie';
    } else {
      winner = dealer;
      stage = 'winner';
    }
  }

  const next: SyncedCutState = {
    rev: cut.rev,
    deck: remaining.map(cardToId),
    cuts,
    stage,
    round: cut.round,
  };
  if (winner === 0 || winner === 1) {
    next.winner = winner;
  }
  return next;
}

export function resetCutRound(cut: SyncedCutState): SyncedCutState {
  const deck = createCutStock();
  return {
    rev: cut.rev,
    deck: deck.map(cardToId),
    cuts: ['', ''],
    stage: 'cut0',
    round: cut.round + 1,
    // winner omitted — Firebase strips null
  };
}

export function cutCardsFromSynced(cut: SyncedCutState | null | undefined): {
  deck: Card[];
  cuts: [Card | null, Card | null];
} | null {
  // Firebase may deliver status "cutting" before cut exists, or with object-shaped arrays.
  if (!cut) return null;
  const deckList = asList((cut as { deck?: unknown }).deck);
  if (deckList.length === 0) return null;
  const cutsList = asList((cut as { cuts?: unknown }).cuts);

  const slot = (value: unknown): Card | null => {
    if (value == null || value === '') return null;
    try {
      return cardFromId(String(value));
    } catch {
      return null;
    }
  };

  return {
    deck: deckList.map((id) => cardFromId(String(id))),
    cuts: [slot(cutsList[0]), slot(cutsList[1])],
  };
}

export function gameFromRoom(room: RoomRecord | null): {
  state: GameState | null;
  rev: number;
  parseError: string | null;
} {
  if (!room?.game?.state) {
    return { state: null, rev: room?.game?.rev ?? 0, parseError: null };
  }
  try {
    return {
      state: deserializeGameState(room.game.state),
      rev: room.game.rev ?? 0,
      parseError: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to parse game state';
    console.warn('gameFromRoom deserialize failed', msg, e);
    return {
      state: null,
      rev: room.game.rev ?? 0,
      parseError: msg,
    };
  }
}

/** Convenience parse for UI / recovery — same as gameFromRoom. */
export function tryParseGame(room: RoomRecord | null) {
  return gameFromRoom(room);
}


/** Overwrite latest trash-talk emoji on the room (no rev; fire-and-forget). */
export async function pushReaction(
  code: string,
  seat: SeatRole,
  emoji: string,
): Promise<void> {
  const reaction: SyncedReaction = { seat, emoji, at: now() };
  await update(roomRef(code), { reaction });
}

export async function leaveRoom(code: string, seat: SeatRole): Promise<void> {
  try {
    const seatPath = ref(
      getFirebaseDb(),
      `rooms/${normalizeRoomCode(code)}/seats/${seat}`,
    );
    await update(seatPath, { connected: false, lastSeen: now() });
  } catch {
    // ignore leave errors (offline / unconfigured)
  }
  // Drop WebRTC signaling so a rematch / rejoin starts clean.
  await clearVoiceSignaling(code);
}

export async function setRoomStatus(code: string, status: RoomStatus): Promise<void> {
  await update(roomRef(code), { status });
}

export { normalizeRoomCode, isValidRoomCode, deserializeGameState, serializeGameState, stripUndefined };
