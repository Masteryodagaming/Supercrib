import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId, ScoringMode } from '../engine/supercrib';
import { isFirebaseConfigured } from './firebase';
import type { ConnectionStatus, RoomRecord, SeatRole } from './types';
import {
  createRoom,
  joinRoom,
  subscribeRoom,
  subscribeFirebaseConnected,
  pushGameState,
  pushCutState,
  applyCutLocal,
  resetCutRound,
  leaveRoom,
  markConnected,
  gameFromRoom,
  fetchRoom,
  roomShareUrl,
  normalizeRoomCode,
  ensureRoomCut,
  cutCardsFromSynced,
  pushReaction,
  isValidRoomCode,
  setRoomMatchSkins,
  setRoomScoringMode,
} from './roomSession';
import {
  saveActiveRoomSession,
  clearActiveRoomSession,
} from './activeRoomSession';

export interface RoomSessionState {
  configured: boolean;
  code: string | null;
  seat: SeatRole | null;
  room: RoomRecord | null;
  game: GameState | null;
  gameRev: number;
  connection: ConnectionStatus;
  /** True while Firebase socket is down mid-session (presence will refresh on restore). */
  reconnecting: boolean;
  error: string | null;
  shareUrl: string | null;
}

export type SeatAvatarOpts = {
  avatarId?: string | null;
  /** Host-only: scoring mode written onto the room (guest inherits). */
  scoringMode?: ScoringMode;
};

export interface RoomSessionApi extends RoomSessionState {
  create: (hostName: string, opts?: SeatAvatarOpts) => Promise<string>;
  join: (
    code: string,
    guestName: string,
    preferredSeat?: SeatRole,
    opts?: SeatAvatarOpts,
  ) => Promise<void>;
  /**
   * Read-only subscribe — does NOT claim a seat or write presence.
   * Used for tournament Club Night spectate (UI hides hole cards).
   */
  spectate: (code: string) => Promise<void>;
  pushState: (expectedRev: number, next: GameState) => Promise<boolean>;
  applyOptimisticGame: (next: GameState, fromRev: number) => void;
  resyncGame: () => void;
  /** Fetch latest room from server and apply (not stale closure). */
  resyncFromServer: () => Promise<void>;
  cutCard: (cutIndex: number) => Promise<boolean>;
  advanceTieCut: () => Promise<boolean>;
  ensureCut: () => Promise<void>;
  /** Cut winner: write match-scoped felt + board paint for both seats. */
  setMatchSkins: (feltId: string, boardSkinId: string) => Promise<void>;
  leave: () => Promise<void>;
  /** Online trash-talk emoji — overwrites room.reaction. */
  sendReaction: (emoji: string) => Promise<void>;
  /** Host-only: change room scoring mode while still in waiting lobby. */
  setScoringMode: (mode: ScoringMode) => Promise<void>;
  clearError: () => void;
}

function deriveConnection(room: RoomRecord | null, seat: SeatRole | null): ConnectionStatus {
  if (!room || seat === null) return 'offline';
  const seats = room.seats;
  if (!seats || typeof seats !== 'object') return 'waiting';
  const other = (1 - seat) as SeatRole;
  const otherSeat = seats[String(other) as '0' | '1'];
  if (!otherSeat) return 'waiting';
  if (!otherSeat.connected) return 'disconnected';
  const me = seats[String(seat) as '0' | '1'];
  if (me && !me.connected) return 'disconnected';
  return 'connected';
}

export function useRoomSession(): RoomSessionApi {
  const [configured] = useState(() => isFirebaseConfigured());
  const [code, setCode] = useState<string | null>(null);
  const [seat, setSeat] = useState<SeatRole | null>(null);
  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [gameRev, setGameRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const localOptimisticRev = useRef<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const codeRef = useRef<string | null>(null);
  const seatRef = useRef<SeatRole | null>(null);
  const displayNameRef = useRef<string>('Player');
  /** Live catalog/unlock avatar id written onto our seat for opponent UI. */
  const avatarIdRef = useRef<string | null>(null);
  /** Host-only: auto ensureCut once per stuck cutting room. */
  const ensureCutOnceRef = useRef(false);
  /** Skip first .info/connected=true so we don't flash Reconnecting on join. */
  const sawFirebaseDisconnectRef = useRef(false);

  const attachSubscription = useCallback((roomCode: string) => {
    unsubRef.current?.();
    unsubRef.current = subscribeRoom(roomCode, (r) => {
      setRoom(r);
      if (!r || r.status === 'ended') {
        clearActiveRoomSession();
      }
      if (!r) return;
      const { state, rev, parseError } = gameFromRoom(r);
      // Ignore strictly older server snaps while optimistic write is in flight.
      // Equal or newer rev (>= localOptimisticRev) always clears optimistic and
      // takes server as authoritative — never skip equal rev.
      if (
        localOptimisticRev.current !== null &&
        rev < localOptimisticRev.current
      ) {
        return;
      }
      if (state) {
        localOptimisticRev.current = null;
        setGame(state);
        setGameRev(rev);
        setError((prev) =>
          prev === 'Deal sync failed — refresh' ? null : prev,
        );
      } else if (r.game?.state && parseError) {
        // Envelope present but deserialize failed — don't leave joiner clueless
        setGame(null);
        setGameRev(rev);
        setError('Deal sync failed — refresh');
      } else if (!r.game) {
        // still cutting / waiting (or status playing without envelope yet)
        if (localOptimisticRev.current === null) {
          setGame(null);
          setGameRev(0);
        }
      }
    });
  }, []);

  const seatDisplayName = useCallback((s: SeatRole, r: RoomRecord | null) => {
    return (
      r?.seats?.[String(s) as '0' | '1']?.name ||
      (s === 0 ? r?.hostName : r?.guestName) ||
      displayNameRef.current ||
      'Player'
    );
  }, []);

  // Resubscribe on visibility (Safari background tabs)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const c = codeRef.current;
      const s = seatRef.current;
      if (!c || s === null || !configured) return;
      attachSubscription(c);
      void markConnected(c, s, seatDisplayName(s, room), { avatarId: avatarIdRef.current });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, attachSubscription, room?.hostName, room?.guestName, seatDisplayName]);

  // Mid-session: when Firebase socket restores, refresh presence + re-subscribe
  // so the opponent's disconnect-forfeit timer cancels.
  useEffect(() => {
    if (!configured || !code || seat === null) {
      setReconnecting(false);
      sawFirebaseDisconnectRef.current = false;
      return;
    }
    let unsub: (() => void) | null = null;
    try {
      unsub = subscribeFirebaseConnected((connected) => {
        const c = codeRef.current;
        const s = seatRef.current;
        if (!c || s === null) return;
        if (!connected) {
          sawFirebaseDisconnectRef.current = true;
          setReconnecting(true);
          return;
        }
        attachSubscription(c);
        void markConnected(c, s, seatDisplayName(s, room), { avatarId: avatarIdRef.current });
        if (sawFirebaseDisconnectRef.current) {
          setReconnecting(false);
        }
      });
    } catch (e) {
      console.warn('subscribeFirebaseConnected failed', e);
    }
    return () => {
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, code, seat, attachSubscription, seatDisplayName]);

  useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  // Host auto-heal: status cutting but cut payload incomplete (e.g. null cuts stripped)
  useEffect(() => {
    if (!code || seat !== 0) return;
    if (!room || room.status !== 'cutting' || room.game) {
      ensureCutOnceRef.current = false;
      return;
    }
    if (cutCardsFromSynced(room.cut)) {
      ensureCutOnceRef.current = false;
      return;
    }
    if (ensureCutOnceRef.current) return;
    ensureCutOnceRef.current = true;
    void ensureRoomCut(code).catch(() => {
      ensureCutOnceRef.current = false;
    });
  }, [code, seat, room]);

  const create = useCallback(
    async (hostName: string, opts?: SeatAvatarOpts) => {
      setError(null);
      if (!isFirebaseConfigured()) {
        const msg =
          'Firebase is not configured. Copy .env.example to .env (next to package.json), fill VITE_FIREBASE_* values, and restart Vite.';
        setError(msg);
        throw new Error(msg);
      }
      try {
        const avatarId = (opts?.avatarId ?? '').trim() || null;
        avatarIdRef.current = avatarId;
        const { code: c } = await createRoom(hostName, {
          avatarId,
          scoringMode: opts?.scoringMode,
        });
        displayNameRef.current = hostName.trim() || 'Player';
        setCode(c);
        codeRef.current = c;
        setSeat(0);
        seatRef.current = 0;
        ensureCutOnceRef.current = false;
        sawFirebaseDisconnectRef.current = false;
        setReconnecting(false);
        saveActiveRoomSession({
          roomCode: c,
          seat: 0,
          displayName: displayNameRef.current,
        });
        attachSubscription(c);
        return c;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to create room';
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [attachSubscription],
  );

  const join = useCallback(
    async (
      rawCode: string,
      guestName: string,
      preferredSeat?: SeatRole,
      opts?: SeatAvatarOpts,
    ) => {
      setError(null);
      if (!isFirebaseConfigured()) {
        const msg =
          'Firebase is not configured. Copy .env.example to .env (next to package.json), fill VITE_FIREBASE_* values, and restart Vite.';
        setError(msg);
        throw new Error(msg);
      }
      try {
        const avatarId = (opts?.avatarId ?? '').trim() || null;
        avatarIdRef.current = avatarId;
        const { code: c, seat: s } = await joinRoom(
          rawCode,
          guestName,
          preferredSeat,
          { avatarId },
        );
        displayNameRef.current = guestName.trim() || 'Player';
        setCode(c);
        codeRef.current = c;
        setSeat(s);
        seatRef.current = s;
        ensureCutOnceRef.current = false;
        sawFirebaseDisconnectRef.current = false;
        setReconnecting(false);
        saveActiveRoomSession({
          roomCode: c,
          seat: s,
          displayName: displayNameRef.current,
        });
        attachSubscription(c);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to join room';
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [attachSubscription],
  );

  const applyOptimisticGame = useCallback((next: GameState, fromRev: number) => {
    localOptimisticRev.current = fromRev + 1;
    setGame(next);
    setGameRev(fromRev + 1);
  }, []);

  const applyRoomSnapshot = useCallback((fresh: RoomRecord) => {
    setRoom(fresh);
    const parsed = gameFromRoom(fresh);
    setGame(parsed.state);
    setGameRev(parsed.rev);
    if (fresh.game?.state && !parsed.state && parsed.parseError) {
      setError('Deal sync failed — refresh');
    }
  }, []);

  /** Observer-only: subscribe to room state without joining a seat. */
  const spectate = useCallback(
    async (rawCode: string) => {
      setError(null);
      if (!isFirebaseConfigured()) {
        const msg =
          'Firebase is not configured. Copy .env.example to .env (next to package.json), fill VITE_FIREBASE_* values, and restart Vite.';
        setError(msg);
        throw new Error(msg);
      }
      try {
        const c = normalizeRoomCode(rawCode);
        if (!isValidRoomCode(c)) throw new Error('Invalid room code');
        const prevCode = codeRef.current;
        const prevSeat = seatRef.current;
        unsubRef.current?.();
        unsubRef.current = null;
        if (prevCode != null && prevSeat != null) {
          await leaveRoom(prevCode, prevSeat);
        }
        clearActiveRoomSession();
        localOptimisticRev.current = null;
        setGame(null);
        setGameRev(0);
        setSeat(null);
        seatRef.current = null;
        setCode(c);
        codeRef.current = c;
        ensureCutOnceRef.current = false;
        sawFirebaseDisconnectRef.current = false;
        setReconnecting(false);
        // Do NOT saveActiveRoomSession — spectators must not resume as a seat.
        attachSubscription(c);
        const fresh = await fetchRoom(c);
        if (fresh) {
          applyRoomSnapshot(fresh);
        } else {
          setRoom(null);
          setError('Room not found');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to spectate room';
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [attachSubscription, applyRoomSnapshot],
  );

  const resyncGame = useCallback(() => {
    localOptimisticRev.current = null;
    if (!room) return;
    const { state, rev, parseError } = gameFromRoom(room);
    setGame(state);
    setGameRev(rev);
    if (room.game?.state && !state && parseError) {
      setError('Deal sync failed — refresh');
    }
  }, [room]);

  /** Fetch room from Firebase and apply — avoids stale room closure after conflict. */
  const resyncFromServer = useCallback(async () => {
    localOptimisticRev.current = null;
    const c = codeRef.current;
    if (!c) return;
    try {
      const fresh = await fetchRoom(c);
      if (fresh) applyRoomSnapshot(fresh);
    } catch (e) {
      console.warn('resyncFromServer failed', e);
    }
  }, [applyRoomSnapshot]);

  const pushState = useCallback(
    async (expectedRev: number, next: GameState) => {
      if (!code) return false;
      applyOptimisticGame(next, expectedRev);
      try {
        const ok = await pushGameState(code, expectedRev, next);
        if (!ok) {
          localOptimisticRev.current = null;
          const fresh = await fetchRoom(code);
          if (fresh) {
            applyRoomSnapshot(fresh);
          }
        }
        return ok;
      } catch {
        localOptimisticRev.current = null;
        try {
          const fresh = await fetchRoom(code);
          if (fresh) {
            applyRoomSnapshot(fresh);
          }
        } catch (e) {
          console.warn('pushState catch resync failed', e);
        }
        return false;
      }
    },
    [code, applyOptimisticGame, applyRoomSnapshot],
  );

  const cutCard = useCallback(
    async (cutIndex: number) => {
      if (!code || seat === null || !room?.cut) return false;
      const cut = room.cut;
      const next = applyCutLocal(cut, seat as PlayerId, cutIndex);
      if (!next) return false;
      const ok = await pushCutState(code, cut.rev, {
        deck: next.deck,
        cuts: next.cuts,
        stage: next.stage,
        winner: next.winner ?? null,
        round: next.round,
      });
      return ok;
    },
    [code, seat, room?.cut],
  );

  const advanceTieCut = useCallback(async () => {
    if (!code || !room?.cut) return false;
    const cut = room.cut;
    if (cut.stage !== 'tie') return false;
    const next = resetCutRound(cut);
    return pushCutState(code, cut.rev, {
      deck: next.deck,
      cuts: next.cuts,
      stage: next.stage,
      winner: next.winner ?? null,
      round: next.round,
    });
  }, [code, room?.cut]);

  const ensureCut = useCallback(async () => {
    if (!code) return;
    setError(null);
    try {
      await ensureRoomCut(code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start cut';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    }
  }, [code]);

  const sendReaction = useCallback(async (emoji: string) => {
    const c = codeRef.current;
    const s = seatRef.current;
    if (!c || s === null) return;
    try {
      await pushReaction(c, s, emoji);
    } catch (e) {
      console.warn('sendReaction failed', e);
    }
  }, []);

  const setMatchSkins = useCallback(async (feltId: string, boardSkinId: string) => {
    const c = codeRef.current;
    if (!c) return;
    try {
      await setRoomMatchSkins(c, feltId, boardSkinId);
    } catch (e) {
      console.warn('setMatchSkins failed', e);
      throw e;
    }
  }, []);

  const setScoringMode = useCallback(async (mode: ScoringMode) => {
    const c = codeRef.current;
    const s = seatRef.current;
    if (!c || s !== 0) {
      throw new Error('Only the host can change scoring mode');
    }
    setError(null);
    try {
      await setRoomScoringMode(c, mode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to set scoring mode';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    }
  }, []);

  const leave = useCallback(async () => {
    const c = codeRef.current;
    const s = seatRef.current;
    unsubRef.current?.();
    unsubRef.current = null;
    if (c != null && s != null) {
      await leaveRoom(c, s);
    }
    clearActiveRoomSession();
    setCode(null);
    codeRef.current = null;
    setSeat(null);
    seatRef.current = null;
    setRoom(null);
    setGame(null);
    setGameRev(0);
    localOptimisticRev.current = null;
    ensureCutOnceRef.current = false;
    sawFirebaseDisconnectRef.current = false;
    setReconnecting(false);
  }, []);

  const connection = deriveConnection(room, seat);
  const shareUrl = code ? roomShareUrl(code) : null;

  return {
    configured,
    code,
    seat,
    room,
    game,
    gameRev,
    connection,
    reconnecting,
    error,
    shareUrl,
    create,
    join,
    spectate,
    pushState,
    applyOptimisticGame,
    resyncGame,
    resyncFromServer,
    cutCard,
    advanceTieCut,
    ensureCut,
    setMatchSkins,
    leave,
    sendReaction,
    setScoringMode,
    clearError: () => setError(null),
  };
}

export function readRoomQueryParam(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('room');
  if (!raw) return null;
  const code = normalizeRoomCode(raw);
  return code || null;
}

export function clearRoomQueryParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room')) return;
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}
