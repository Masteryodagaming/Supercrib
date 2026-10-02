import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../engine/cards';
import {
  GameState,
  PlayerId,
  AiDifficulty,
  ScoringMode,
  createGame,
  startDeal,
  toggleDiscardSelect,
  confirmDiscard,
  cutStarter,
  playPegCard,
  sayGo,
  finishPegThirtyOne,
  finishPeggingToShow,
  needsThirtyOnePause,
  needsGoPause,
  needsEndOfPeggingPause,
  PEG_BANNER_MS,
  ackShowContinue,
  resolveZeroHandOffer,
  reorderHand,
  sortHumanHands,
  submitShowClaim,
  confirmShowClaim,
  adjustShowClaim,
  resolveMugginsChoice,
  acknowledgeCompetitiveRef,
  competitiveClaimant,
  competitiveReviewRespondent,
  competitiveMugginsRespondent,
  normalizeScoringMode,
} from '../engine/supercrib';
import { aiShouldAct, applyAiTurn, aiPlayerId } from '../engine/ai';
import {
  Profile,
  loadProfile,
  recordAiGameResult,
  recordOnlineGameResult,
  wasOnlineRoomRecorded,
  markOnlineRoomRecorded,
} from '../profile/storage';
import { useAuth } from '../profile/useAuth';
import {
  hydrateAccountFromCloud,
  pushCloudRecords,
  saveProfileForAccount,
} from '../profile/cloudSync';
import { subscribeAndProcessAccepts } from '../profile/friendRequests';
import { Home, loadStoredAiDifficulty } from './Home';
import { useAiReactions } from './useAiReactions';
import { Rules } from './Rules';
import { Table } from './Table';
import { clearShowForGameOverBanner } from './GameOverBanner';
import {
  AI_THINK_MS,
  AI_CUT_ANIM_MS,
  AI_CUT_SELECT_MS,
  AI_CUT_REVEAL_MS,
  CONN_BANNER_COLLAPSE_MS,
} from './playPace';
import {
  setSoundEnabled,
  unlockGameAudio,
  playCard,
  playCardSelect,
  playCut,
  playPeg,
  playGo,
  playWin,
} from '../audio/gameSfx';
import { Login } from './Login';
import { Splash } from './Splash';
import {
  clampMatchSkinChoice,
  resolveTableSkins,
  winnerEquippedMatchSkins,
  type MatchSkinChoice,
} from '../profile/matchSkins';
import { CRIB_MASTER_ID } from '../profile/avatars';
import { MatchSkinPicker, MatchSkinWaiting } from './MatchSkinPicker';
import { Settings } from './Settings';
import { Store } from './Store';
import { Friends } from './Friends';
import { Tournaments } from './Tournaments';
import { TournamentLobby } from './TournamentLobby';
import { TournamentLive } from './TournamentLive';
import type { TournamentAiBoardLaunch, TournamentOnlineBoardLaunch } from './TournamentLive';
import { submitPlayoffGame, submitResult } from '../tournament/tournamentApi';
import {
  shouldAttemptTournamentSubmit,
  shouldRecordOnlineCareer,
} from './tournamentSubmitGuards';
import { CutForDeal } from './CutForDeal';
import { cutFanSlots, type AiCutAnimView } from './CutFan';
import {
  shouldStartRemoteStarterCutReveal,
  remoteCutAnimSlots,
} from './onlineCutWatch';
import { withDealer } from '../engine/cutForDeal';
import { OnlineLobby } from './OnlineLobby';
import {
  useRoomSession,
  readRoomQueryParam,
  clearRoomQueryParam,
} from '../multiplayer/useRoomSession';
import { useVoicePtt, cleanupVoiceOnLeave } from '../multiplayer/useVoicePtt';
import { useSideLiveChat, cleanupSideLiveChatOnLeave } from '../multiplayer/useSideLiveChat';
import { VOICE_PTT_ENABLED, isSideLiveChatEnabled } from '../multiplayer/voiceConfig';

import { cutCardsFromSynced, setRoomStatus, roomScoringMode } from '../multiplayer/roomSession';

/** Side-avatar slice from a live profile (catalog id + optional custom photo). */
function profileSeatAvatar(
  profile: Pick<Profile, 'displayName' | 'avatarId' | 'avatarDataUrl'> | null | undefined,
  fallbackName: string,
): { displayName: string; avatarId: string; avatarDataUrl: string | null } {
  const displayName = (profile?.displayName ?? '').trim() || fallbackName;
  const avatarId = (profile?.avatarId ?? '').trim() || 'peg';
  const avatarDataUrl = profile?.avatarDataUrl ?? null;
  return { displayName, avatarId, avatarDataUrl };
}

/** Online seat → avatar; never invent faces — missing id falls back to default peg. */
function roomSeatAvatar(
  seat: { name?: string; avatarId?: string | null } | null | undefined,
  fallbackName: string,
): { displayName: string; avatarId: string; avatarDataUrl: string | null } {
  const displayName = (seat?.name ?? '').trim() || fallbackName;
  const avatarId = (seat?.avatarId ?? '').trim() || 'peg';
  return { displayName, avatarId, avatarDataUrl: null };
}
import {
  loadActiveRoomSession,
  clearActiveRoomSession,
} from '../multiplayer/activeRoomSession';
import {
  applyDisconnectForfeit,
  DISCONNECT_FORFEIT_MS,
} from '../multiplayer/disconnectForfeit';

type Screen =
  | 'splash'
  | 'login'
  | 'home'
  | 'rules'
  | 'settings'
  | 'store'
  | 'friends'
  | 'tournaments'
  | 'tournamentLobby'
  | 'tournamentLive'
  | 'table'
  | 'online';

export type SeatLabels = [string, string];

export type PegBanner =
  | { kind: 'go'; player: PlayerId; name: string }
  | { kind: 'thirtyone'; points: number; label?: string };

const AI_SEAT_LABELS: SeatLabels = ['You', 'AI'];

function formatForfeitCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}


type AiCutAnimState = AiCutAnimView & { dealNumber: number };


/** Stable key for GO/31 banner pause — identity changes to game must not remount the timer. */
function derivePegPauseKey(game: GameState | null): string | null {
  if (!game || game.phase !== 'pegging' || !game.peg || game.winner !== null) {
    return null;
  }
  if (needsThirtyOnePause(game)) {
    const flashId = game.lastPegFlash?.id ?? 0;
    return `31|${game.dealNumber}|${flashId}|${game.peg.count}`;
  }
  if (needsEndOfPeggingPause(game)) {
    const flashId = game.lastPegFlash?.id ?? 0;
    return `endpeg|${game.dealNumber}|${flashId}`;
  }
  if (needsGoPause(game)) {
    const tp = game.peg.toPlay;
    const said = [...game.peg.saidGo].sort().join(',');
    const handLens = `${game.players[0].hand.length},${game.players[1].hand.length}`;
    return `go|${game.dealNumber}|${game.peg.count}|${tp}|${said}|${handLens}`;
  }
  return null;
}


export default function App() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const auth = useAuth();
  const authUid = auth.user?.uid ?? null;
  /** Always splash first — never auto-home from local guest hasProfile(). */
  const [screen, setScreen] = useState<Screen>('splash');
  const [splashExiting, setSplashExiting] = useState(false);
  const splashStartedRef = useRef(Date.now());
  const splashAdvancedRef = useRef(false);
  const [focusDoctor, setFocusDoctor] = useState(false);
  const [promoToast, setPromoToast] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [seatLabels, setSeatLabels] = useState<SeatLabels>(['You', 'P1']);
  /** True while Table is playing the deal animation (blocks AI / input). */
  const [dealAnimating, setDealAnimating] = useState(false);
  /** Staged AI cut animation — locks until starter is visibly revealed. */
  const [aiCutAnim, setAiCutAnim] = useState<AiCutAnimState | null>(null);
  /** Match-start cut for deal (before deal #1). */
  const [cutForDeal, setCutForDeal] = useState<'ai' | null>(null);
  /** Cut winner picking match skins (null = not in skin-pick phase). */
  const [skinPickDealer, setSkinPickDealer] = useState<PlayerId | null>(null);
  /** Match-scoped skins for this table (null = use profile until set). */
  const [matchFeltId, setMatchFeltId] = useState<string | null>(null);
  const [matchBoardSkinId, setMatchBoardSkinId] = useState<string | null>(null);
  const skinPickDoneRef = useRef(false);
  const skinPickDealerRef = useRef<PlayerId | null>(null);
  const [pendingAiDifficulty, setPendingAiDifficulty] = useState<AiDifficulty>(
    () => loadStoredAiDifficulty(),
  );
  const [pendingScoringMode, setPendingScoringMode] = useState<ScoringMode>('auto');

  /** Prevent double-counting W/L if gameOver effect re-fires. */
  const recordedGameRef = useRef(false);
  /** True only if we saw this online match with winner===null in this tab (not a finished-link rejoin). */
  const sawLiveOnlineMatchRef = useRef(false);
  /** dealNumber for which AI cut anim already started (Strict Mode safe). */
  const aiCutStartedDealRef = useRef<number | null>(null);
  /** Online: deal# for which we already started a remote cut reveal. */
  const remoteCutStartedDealRef = useRef<number | null>(null);
  /** Starter-cut SFX: one cue per deal (human tap / AI / remote share key). */
  const starterCutSfxDealRef = useRef<number | null>(null);
  /** Prior phase/deal for detecting remote cutStarter sync. */
  const prevCutWatchRef = useRef<{ phase: string; dealNumber: number } | null>(null);
  /** Online: only host (seat 0) starts the deal after cut resolves. */
  const onlineDealStartedRef = useRef(false);
  const [onlineDealError, setOnlineDealError] = useState<string | null>(null);
  const autoJoinTried = useRef(false);
  /** Soft status while resuming a saved / URL room on load. */
  const [resumeHint, setResumeHint] = useState<string | null>(null);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentAiMatch, setTournamentAiMatch] = useState<TournamentAiBoardLaunch | null>(null);
  const tournamentAiSubmittedRef = useRef(false);
  const tournamentAiInFlightRef = useRef(false);
  const [tournamentOnlineMatch, setTournamentOnlineMatch] =
    useState<TournamentOnlineBoardLaunch | null>(null);
  const tournamentOnlineSubmittedRef = useRef(false);
  const tournamentOnlineInFlightRef = useRef(false);
  /** Survives score-submit; cleared only when leaving the table back to Live. */
  const tournamentReturnIdRef = useRef<string | null>(null);
  /** Tournament Club Night: full-table watch without claiming a seat. */
  const [spectating, setSpectating] = useState(false);
  /** Latest online game/rev for discard push retry after rev conflict. */
  const sessionGameRef = useRef<GameState | null>(null);
  const sessionRevRef = useRef(0);
  /** Last peg-pause key we scheduled (debug / quit reset). */
  const pegPauseKeyRef = useRef<string>('');
  const [pegBanner, setPegBanner] = useState<PegBanner | null>(null);
  /** SFX dedupe: last peg sequence signature / go key / win deal. */
  const sfxPegSigRef = useRef<string>('');
  const sfxGoKeyRef = useRef<string>('');
  const sfxWinDealRef = useRef<number | null>(null);
  /** Online: Date.now() when forfeit fires if opponent stays disconnected. */
  const [forfeitDeadline, setForfeitDeadline] = useState<number | null>(null);
  const [forfeitRemainMs, setForfeitRemainMs] = useState(0);
  /** Hide "Connected" online strip after a beat so phones gain vertical room. */
  const [connBannerCollapsed, setConnBannerCollapsed] = useState(false);
  const forfeitClaimedRef = useRef(false);

  // Boot: Zero Forge Labs splash → login (unsigned) or home (signed-in).
  // Wait for auth.ready so signed-in users skip login flash; keep min splash time.
  // If signed in, also wait briefly for profile hydrate so home doesn't flash Login.
  useEffect(() => {
    if (screen !== 'splash' || splashAdvancedRef.current) return;
    const SPLASH_MIN_MS = 3200;
    const FADE_MS = 320;
    const PROFILE_WAIT_MAX_MS = 2800;
    let fadeTimer: number | undefined;
    let minTimer: number | undefined;
    let cancelled = false;

    const tryAdvance = () => {
      if (cancelled || splashAdvancedRef.current) return;
      if (!auth.ready) return;
      const elapsed = Date.now() - splashStartedRef.current;
      const remain = Math.max(0, SPLASH_MIN_MS - elapsed);
      if (remain > 0) {
        minTimer = window.setTimeout(tryAdvance, remain);
        return;
      }
      // Signed-in: prefer having a profile before leaving splash (hydrate may still be in flight).
      if (auth.user && !profile && elapsed < PROFILE_WAIT_MAX_MS) {
        minTimer = window.setTimeout(tryAdvance, 120);
        return;
      }
      splashAdvancedRef.current = true;
      setSplashExiting(true);
      fadeTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (auth.user) {
          setScreen('home');
        } else {
          setScreen('login');
        }
      }, FADE_MS);
    };

    tryAdvance();
    return () => {
      cancelled = true;
      if (minTimer !== undefined) window.clearTimeout(minTimer);
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    };
  }, [screen, auth.ready, auth.user, profile]);

  /** Bump to reschedule banner advance if finish/sayGo did not clear the pause. */
  const [pegPauseAttempt, setPegPauseAttempt] = useState(0);
  const gameRef = useRef<GameState | null>(null);
  const applyLocalRef = useRef<(fn: (g: GameState) => GameState | null, retryOnce?: boolean) => void>(() => {});
  const seatLabelsRef = useRef(seatLabels);
  const mySeatRef = useRef<PlayerId>(0);

  const session = useRoomSession();
  const voiceEnabled =
    VOICE_PTT_ENABLED &&
    !spectating &&
    !!session.code &&
    session.seat !== null &&
    game?.mode === 'online';
  const voice = useVoicePtt({
    code: voiceEnabled ? session.code : null,
    seat: voiceEnabled ? session.seat : null,
    bothConnected: session.connection === 'connected',
    enabled: !!voiceEnabled,
  });
  // Lobby-time Connect voice (mobile only via isSideLiveChatEnabled):
  // enable whenever seated in an online room (waiting lobby OR in-match).
  // Session held above Table so remounts keep PC. Desktop browsers: gated off.
  const sideLiveChatEnabled =
    isSideLiveChatEnabled() &&
    !spectating &&
    !!session.code &&
    session.seat !== null &&
    (screen === 'online' || game?.mode === 'online');
  const sideLiveChat = useSideLiveChat({
    code: session.code,
    seat: session.seat,
    bothConnected: session.connection === 'connected',
    enabled: !!sideLiveChatEnabled,
  });
  const mySeat: PlayerId = (session.seat ?? 0) as PlayerId;
  sessionGameRef.current = session.game;
  sessionRevRef.current = session.gameRev;
  gameRef.current = game;
  seatLabelsRef.current = seatLabels;
  mySeatRef.current = mySeat;

  // Auto-join: prefer ?room= share URL, else resume saved active session.
  // Hard timeout so a hung rejoin cannot leave users stuck on "Rejoining room…".
  useEffect(() => {
    if (autoJoinTried.current) return;
    if (!profile) return;
    const urlCode = readRoomQueryParam();
    const saved = loadActiveRoomSession();
    if (!urlCode && !saved) return;
    autoJoinTried.current = true;

    const profileName = profile.displayName.trim() || 'Guest';
    let settled = false;
    const RESUME_TIMEOUT_MS = 8_000;
    const failResume = (msg: string) => {
      if (settled) return;
      settled = true;
      clearActiveRoomSession();
      setResumeHint(null);
      setOnlineDealError(msg);
      setScreen('online');
    };
    const timeoutId = window.setTimeout(() => {
      failResume(
        'Rejoin timed out — tap Back, then open your match from Tournaments and Play game.',
      );
    }, RESUME_TIMEOUT_MS);

    void (async () => {
      try {
        if (urlCode) {
          clearRoomQueryParam();
          const preferredSeat =
            saved && saved.roomCode === urlCode ? saved.seat : undefined;
          const joinName =
            preferredSeat !== undefined
              ? saved!.displayName || profileName
              : profileName;
          setScreen('online');
          setResumeHint('Rejoining room…');
          await session.join(urlCode, joinName, preferredSeat, { avatarId: profile.avatarId });
        } else {
          // Saved session only (no URL)
          setScreen('online');
          setResumeHint('Rejoining room…');
          await session.join(
            saved!.roomCode,
            saved!.displayName || profileName,
            saved!.seat,
            { avatarId: profile.avatarId },
          );
        }
        if (settled) {
          // Timed out already — drop the late join so UI stays actionable.
          void session.leave();
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        setResumeHint(null);
      } catch (e) {
        console.warn('Auto-resume / URL join failed', e);
        window.clearTimeout(timeoutId);
        const msg = e instanceof Error ? e.message : 'Could not rejoin room';
        if (/room is full/i.test(msg)) {
          failResume(
            'Room is full — tap Back, then Play game again from Tournaments.',
          );
        } else if (/ended|not found|missing/i.test(msg)) {
          failResume(
            'Previous room ended or is gone — start or join a new one from Tournaments.',
          );
        } else {
          failResume(msg);
        }
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Sync seat labels from room (seated players). Spectators keep pairing / Watch labels.
  useEffect(() => {
    if (spectating) {
      if (!session.room) return;
      const a =
        session.room.seats?.['0']?.name || session.room.hostName || null;
      const b =
        session.room.seats?.['1']?.name || session.room.guestName || null;
      if (a && b) setSeatLabels([a, b]);
      return;
    }
    if (!session.room || session.seat === null) return;
    const host = session.room.hostName || 'Host';
    const guest = session.room.guestName || 'Guest';
    if (session.seat === 0) {
      setSeatLabels([host === (profile?.displayName || host) ? 'You' : host, guest]);
    } else {
      setSeatLabels([host, 'You']);
    }
  }, [session.room, session.seat, profile?.displayName, spectating]);

  // Mirror remote game into local state when in online session
  useEffect(() => {
    if (!session.code) return;
    if (session.game) {
      setGame(session.game);
      setCutForDeal(null);
      setScreen('table');
    }
  }, [session.code, session.game, session.room?.status]);





  // Online: when opponent (pone) cuts, RTDB jumps us past phase "cut".
  // Replay a local fan select→reveal so the dealer actually sees the cut.
  useEffect(() => {
    const prev = prevCutWatchRef.current;
    if (!game) {
      prevCutWatchRef.current = null;
      return;
    }
    const viewerSeat =
      session.code != null && session.seat !== null
        ? (session.seat as 0 | 1)
        : game.mode === 'online'
          ? mySeat
          : null;
    const oppName =
      seatLabels[game.pone] ||
      (game.pone === 0 ? 'Opponent' : 'Opponent');

    if (
      shouldStartRemoteStarterCutReveal({
        mode: game.mode,
        prevPhase: prev?.phase ?? null,
        prevDealNumber: prev?.dealNumber ?? null,
        nextPhase: game.phase,
        dealNumber: game.dealNumber,
        starter: game.starter,
        viewerSeat,
        pone: game.pone,
        alreadyStartedForDeal: remoteCutStartedDealRef.current,
      })
    ) {
      remoteCutStartedDealRef.current = game.dealNumber;
      const { visualI, cutIndex } = remoteCutAnimSlots(game.deck.length);
      setDealAnimating(true);
      setAiCutAnim({
        stage: 'scanning',
        visualI,
        cutIndex,
        revealCard: game.starter!,
        dealNumber: game.dealNumber,
        remote: true,
        actorLabel: oppName,
      });
    }

    prevCutWatchRef.current = {
      phase: game.phase,
      dealNumber: game.dealNumber,
    };
  }, [game, session.code, session.seat, mySeat, seatLabels]);

  // When Auth signs in (Google or email): merge local + RTDB users/{uid}/profile + friends.
  useEffect(() => {
    if (!auth.ready || !auth.user) return;
    let cancelled = false;
    void (async () => {
      try {
        const { profile: merged, googlePromoGranted } = await hydrateAccountFromCloud(
          auth.user!.uid,
          auth.user!.displayName,
          auth.user!.email,
          auth.user!.providerId,
        );
        if (!cancelled) {
          setProfile(merged);
          if (screen === 'login') setScreen('home');
          if (googlePromoGranted) {
            setPromoToast('+200 SC · Sign-in promo');
          }
        }
      } catch (e) {
        console.warn('Account hydrate failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, auth.user?.uid]);

  // Auto-dismiss sign-in promo toast
  useEffect(() => {
    if (!promoToast) return;
    const t = window.setTimeout(() => setPromoToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [promoToast]);

  // Complete mutual friendship when the other party accepts (even off Friends screen).
  useEffect(() => {
    if (!auth.ready || !auth.user) return;
    return subscribeAndProcessAccepts(auth.user.uid);
  }, [auth.ready, auth.user?.uid]);

  const beginAi = useCallback((
    labels: SeatLabels = AI_SEAT_LABELS,
    difficulty: AiDifficulty = loadStoredAiDifficulty(),
    scoringMode: ScoringMode = 'auto',
  ) => {
    recordedGameRef.current = false;
    aiCutStartedDealRef.current = null;
    tournamentReturnIdRef.current = null;
    setSpectating(false);
    setTournamentAiMatch(null);
    setTournamentOnlineMatch(null);
    tournamentOnlineSubmittedRef.current = false;
    tournamentOnlineInFlightRef.current = false;
    tournamentAiSubmittedRef.current = false;
    tournamentAiInFlightRef.current = false;
    setAiCutAnim(null);
    setDealAnimating(false);
    setGame(null);
    setSeatLabels(labels);
    setPendingAiDifficulty(difficulty);
    setPendingScoringMode(scoringMode);
    setCutForDeal('ai');
    setSkinPickDealer(null);
    skinPickDealerRef.current = null;
    skinPickDoneRef.current = false;
    setMatchFeltId(null);
    setMatchBoardSkinId(null);
    setScreen('table');
  }, []);

  const beginTournamentAiBoard = useCallback(
    (launch: TournamentAiBoardLaunch) => {
      tournamentAiSubmittedRef.current = false;
      tournamentAiInFlightRef.current = false;
      setTournamentAiMatch(launch);
      setTournamentId(launch.tournamentId);
      beginAi(['You', launch.aiDisplayName || 'AI']);
      // After beginAi cleared refs — restore tournament return target.
      tournamentReturnIdRef.current = launch.tournamentId;
      setTournamentAiMatch(launch);
    },
    [beginAi],
  );

  const beginTournamentSpectate = useCallback(
    (args: { code: string; tournamentId: string; seatLabels: SeatLabels }) => {
      recordedGameRef.current = false;
      sawLiveOnlineMatchRef.current = false;
      aiCutStartedDealRef.current = null;
      onlineDealStartedRef.current = false;
      setTournamentAiMatch(null);
      setTournamentOnlineMatch(null);
      tournamentOnlineSubmittedRef.current = false;
      tournamentOnlineInFlightRef.current = false;
      tournamentAiSubmittedRef.current = false;
      tournamentAiInFlightRef.current = false;
      setAiCutAnim(null);
      setDealAnimating(false);
      setPegBanner(null);
      pegPauseKeyRef.current = '';
      setGame(null);
      setCutForDeal(null);
      setSkinPickDealer(null);
      skinPickDealerRef.current = null;
      skinPickDoneRef.current = false;
      setMatchFeltId(null);
      setMatchBoardSkinId(null);
      setOnlineDealError(null);
      setResumeHint(null);
      setSpectating(true);
      setTournamentId(args.tournamentId);
      tournamentReturnIdRef.current = args.tournamentId;
      setSeatLabels(args.seatLabels);
      setScreen('table');
      void session.spectate(args.code).catch((e) => {
        setOnlineDealError(
          e instanceof Error ? e.message : 'Could not watch match',
        );
      });
    },
    [session],
  );

  const beginOnline = useCallback((scoringMode: ScoringMode = 'auto') => {
    recordedGameRef.current = false;
    sawLiveOnlineMatchRef.current = false;
    aiCutStartedDealRef.current = null;
    onlineDealStartedRef.current = false;
    setSpectating(false);
    setAiCutAnim(null);
    setDealAnimating(false);
    setGame(null);
    setCutForDeal(null);
    setSkinPickDealer(null);
    skinPickDealerRef.current = null;
    skinPickDoneRef.current = false;
    setMatchFeltId(null);
    setMatchBoardSkinId(null);
    setOnlineDealError(null);
    setResumeHint(null);
    setPendingScoringMode(normalizeScoringMode(scoringMode));
    setScreen('online');
  }, []);

  /** Host (or local) starts the first deal after match skins are settled. */
  const startDealAfterSkins = useCallback(
    (dealer: PlayerId) => {
      // Online: HOST (seat 0) only writes full deal; guest waits for sync.
      if (session.code && session.seat !== null) {
        if (onlineDealStartedRef.current) return;
        if (session.seat !== 0) return; // guest waits for host push
        onlineDealStartedRef.current = true;
        setOnlineDealError(null);
        // Prefer room (host write / guest inherit); fall back to pending if room omitted.
        const onlineMode = normalizeScoringMode(
          session.room?.scoringMode ?? pendingScoringMode,
        );
        const dealt = sortHumanHands(
          startDeal(
            withDealer(createGame('online', { scoringMode: onlineMode }), dealer),
          ),
        );
        void session.pushState(0, dealt).then(async (ok) => {
          if (!ok) {
            onlineDealStartedRef.current = false;
            await session.resyncFromServer();
            setOnlineDealError('Deal did not sync after cut — waiting to retry…');
            return;
          }
          setDealAnimating(true);
          setGame(dealt);
          setScreen('table');
        });
        return;
      }
      const mode = cutForDeal ?? 'ai';
      setCutForDeal(null);
      setDealAnimating(true);
      const created =
        mode === 'ai'
          ? createGame('ai', {
              aiDifficulty: pendingAiDifficulty,
              scoringMode: pendingScoringMode,
            })
          : createGame(mode);
      setGame(startDeal(withDealer(created, dealer)));
    },
    [cutForDeal, pendingAiDifficulty, pendingScoringMode, session],
  );

  const applyMatchSkinChoice = useCallback(
    (choice: MatchSkinChoice) => {
      const clamped = clampMatchSkinChoice(
        auth.user?.uid,
        choice,
        profile?.ownedFeltIds,
        profile?.ownedBoardIds,
        auth.user?.email,
      );
      setMatchFeltId(clamped.feltId);
      setMatchBoardSkinId(clamped.boardSkinId);
      return clamped;
    },
    [auth.user?.uid, auth.user?.email, profile?.ownedFeltIds, profile?.ownedBoardIds],
  );

  const completeMatchSkinPick = useCallback(
    async (choice: MatchSkinChoice) => {
      if (skinPickDoneRef.current) return;
      skinPickDoneRef.current = true;
      const dealer = skinPickDealerRef.current;
      const clamped = applyMatchSkinChoice(choice);
      setSkinPickDealer(null);
      skinPickDealerRef.current = null;

      if (session.code && session.seat !== null) {
        try {
          await session.setMatchSkins(clamped.feltId, clamped.boardSkinId);
        } catch {
          skinPickDoneRef.current = false;
          setSkinPickDealer(dealer);
          skinPickDealerRef.current = dealer;
          setOnlineDealError('Could not sync table skins — try again');
          return;
        }
        if (dealer !== null) startDealAfterSkins(dealer);
        return;
      }
      if (dealer !== null) startDealAfterSkins(dealer);
    },
    [applyMatchSkinChoice, session, startDealAfterSkins],
  );

  const onCutForDealResolved = useCallback(
    (dealer: PlayerId) => {
      // Online: if skins already on room (rejoin / rematch race), skip picker.
      if (session.code && session.seat !== null) {
        const roomFelt = session.room?.matchFeltId;
        const roomBoard = session.room?.matchBoardSkinId;
        if (typeof roomFelt === 'string' && typeof roomBoard === 'string') {
          setMatchFeltId(roomFelt);
          setMatchBoardSkinId(roomBoard);
          startDealAfterSkins(dealer);
          return;
        }
        skinPickDoneRef.current = false;
        skinPickDealerRef.current = dealer;
        setSkinPickDealer(dealer);
        return;
      }

      // vs AI (local): no match skin snapshot. Table paint reads live equipped
      // profile skins via resolveTableSkins (null match* → effectiveBoardId).
      // Snapshotting here caused stale maple when cut ran before cloud hydrate
      // or when settings.board landed after deal — felt could still look right.
      startDealAfterSkins(dealer);
    },
    [
      session.code,
      session.seat,
      session.room?.matchFeltId,
      session.room?.matchBoardSkinId,
      startDealAfterSkins,
    ],
  );

  // Mirror room match skins so both seats (and rejoin) see the same table.
  useEffect(() => {
    const f = session.room?.matchFeltId;
    const b = session.room?.matchBoardSkinId;
    if (typeof f === 'string' && f) setMatchFeltId(f);
    if (typeof b === 'string' && b) setMatchBoardSkinId(b);
  }, [session.room?.matchFeltId, session.room?.matchBoardSkinId]);

  // Non-winner (esp. host when guest won cut): when skins land on the room, deal.
  useEffect(() => {
    if (skinPickDealer === null) return;
    if (!session.code) return;
    const f = session.room?.matchFeltId;
    const b = session.room?.matchBoardSkinId;
    if (typeof f !== 'string' || typeof b !== 'string') return;

    setMatchFeltId(f);
    setMatchBoardSkinId(b);

    // Winner already finished locally (wrote skins + maybe dealt).
    if (skinPickDoneRef.current) {
      setSkinPickDealer(null);
      skinPickDealerRef.current = null;
      return;
    }

    const dealer = skinPickDealer;
    setSkinPickDealer(null);
    skinPickDealerRef.current = null;
    skinPickDoneRef.current = true;
    startDealAfterSkins(dealer);
  }, [
    skinPickDealer,
    session.code,
    session.room?.matchFeltId,
    session.room?.matchBoardSkinId,
    startDealAfterSkins,
  ]);

  // Mark that we actually played this online match live (winner still open).
  useEffect(() => {
    if (spectating) return;
    if (!session.code || !game || game.mode !== 'online') return;
    if (game.winner === null && game.phase !== 'gameOver') {
      sawLiveOnlineMatchRef.current = true;
    }
  }, [session.code, game, spectating]);

  // Game SFX — Settings sound toggle (default on).
  useEffect(() => {
    setSoundEnabled(profile?.settings?.sound !== false);
  }, [profile?.settings?.sound]);

  useEffect(() => {
    unlockGameAudio();
  }, []);

  // Peg card play (human, AI, or online sync).
  useEffect(() => {
    if (!game || screen !== 'table' || game.phase !== 'pegging' || !game.peg) {
      if (!game || game.phase !== 'pegging') sfxPegSigRef.current = '';
      return;
    }
    const seq = game.peg.sequence;
    if (seq.length === 0) {
      sfxPegSigRef.current = `${game.dealNumber}|0`;
      return;
    }
    const last = seq[seq.length - 1];
    const sig = `${game.dealNumber}|${seq.length}|${last.card.id}`;
    if (sig === sfxPegSigRef.current) return;
    const prev = sfxPegSigRef.current;
    sfxPegSigRef.current = sig;
    if (!prev) return; // initial snapshot — no sound
    const prevLen = Number(prev.split('|')[1] ?? 0);
    if (seq.length > prevLen) {
      // Plain card play = card WAV slap only (no wood / prize / metallic).
      playCard();
      // Peg wood tick + prize tiers only when this play scored points.
      const pts = game.lastPegFlash?.points ?? 0;
      if (pts > 0) playPeg(pts);
    }
  }, [game, screen]);

  // Game over / win (celebratory sting once per deal).
  useEffect(() => {
    if (!game || screen !== 'table') return;
    if (game.winner === null) {
      sfxWinDealRef.current = null;
      return;
    }
    if (sfxWinDealRef.current === game.dealNumber) return;
    sfxWinDealRef.current = game.dealNumber;
    playWin();
  }, [game?.winner, game?.dealNumber, screen]);

  // Persist career record once when a winner is decided (AI or online).
  // Club Night tournament submit is independent of career W/L guards so
  // refresh/rejoin/reconnect-at-gameOver still writes the pairing result.
  useEffect(() => {
    if (!game || screen !== 'table') return;
    if (game.winner === null) return;

    if (game.mode === 'ai') {
      if (!recordedGameRef.current) {
        recordedGameRef.current = true;
        const updated = recordAiGameResult(game.winner === 0);
        if (updated) {
          setProfile(updated);
          if (authUid) void pushCloudRecords(authUid, updated);
        }
      }
      const tMatch = tournamentAiMatch;
      if (
        shouldAttemptTournamentSubmit({
          hasTournamentContext: !!tMatch,
          hasAuth: !!auth.user,
          alreadySubmitted: tournamentAiSubmittedRef.current,
          inFlight: tournamentAiInFlightRef.current,
          hasScores: !!(game.players?.[0] && game.players?.[1]),
        }) &&
        tMatch &&
        auth.user
      ) {
        tournamentAiInFlightRef.current = true;
        const humanScore = game.players[0].score;
        const aiScore = game.players[1].score;
        const scoreA = tMatch.humanIsA ? humanScore : aiScore;
        const scoreB = tMatch.humanIsA ? aiScore : humanScore;
        const submitPromise =
          tMatch.kind === 'playoff'
            ? submitPlayoffGame(
                auth.user,
                tMatch.tournamentId,
                tMatch.seriesId,
                tMatch.gameIndex,
                scoreA,
                scoreB,
              )
            : submitResult(
                auth.user,
                tMatch.tournamentId,
                tMatch.roundNumber,
                tMatch.board,
                scoreA,
                scoreB,
              );
        void submitPromise
          .then(() => {
            tournamentAiSubmittedRef.current = true;
          })
          .catch((e) => {
            console.warn('Tournament AI result submit failed', e);
            setPromoToast(
              'Club Night result didn’t save — open Live to retry.',
            );
          })
          .finally(() => {
            tournamentAiInFlightRef.current = false;
          });
        // Keep tournamentAiMatch / return ref until Done/Quit so we navigate to Live, not Home.
      }
      return;
    }
    if (game.mode === 'online') {
      if (spectating) return;
      const code = session.code;

      // Career W/L — gated so reopening an old finished room does not double-count.
      if (!recordedGameRef.current) {
        recordedGameRef.current = true;
        const recordCareer = shouldRecordOnlineCareer({
          sawLiveOnlineMatch: sawLiveOnlineMatchRef.current,
          roomAlreadyRecorded: !!(code && wasOnlineRoomRecorded(code)),
        });
        if (recordCareer) {
          const updated = recordOnlineGameResult(game.winner === mySeat);
          if (updated) {
            setProfile(updated);
            if (authUid) void pushCloudRecords(authUid, updated);
          }
          if (code) {
            markOnlineRoomRecorded(code);
            clearActiveRoomSession();
            void setRoomStatus(code, 'ended');
          }
        } else if (code) {
          markOnlineRoomRecorded(code);
        }
      }

      // Tournament online board: seat 0 = pairing A, seat 1 = pairing B.
      // Always attempt when context is set — even if career guards skipped.
      const tOnline = tournamentOnlineMatch;
      if (
        shouldAttemptTournamentSubmit({
          hasTournamentContext: !!tOnline,
          hasAuth: !!auth.user,
          alreadySubmitted: tournamentOnlineSubmittedRef.current,
          inFlight: tournamentOnlineInFlightRef.current,
          hasScores: !!(game.players?.[0] && game.players?.[1]),
        }) &&
        tOnline &&
        auth.user
      ) {
        tournamentOnlineInFlightRef.current = true;
        const scoreA = game.players[0].score;
        const scoreB = game.players[1].score;
        const submitPromise =
          tOnline.kind === 'playoff'
            ? submitPlayoffGame(
                auth.user,
                tOnline.tournamentId,
                tOnline.seriesId,
                tOnline.gameIndex,
                scoreA,
                scoreB,
              )
            : submitResult(
                auth.user,
                tOnline.tournamentId,
                tOnline.roundNumber,
                tOnline.board,
                scoreA,
                scoreB,
              );
        void submitPromise
          .then(() => {
            tournamentOnlineSubmittedRef.current = true;
          })
          .catch((e) => {
            console.warn('Tournament online result submit failed', e);
            setPromoToast(
              'Club Night result didn’t save — open Live to retry.',
            );
          })
          .finally(() => {
            tournamentOnlineInFlightRef.current = false;
          });
      }
    }
  }, [game, screen, mySeat, session.code, authUid, tournamentAiMatch, tournamentOnlineMatch, auth.user, spectating]);

  // Online: 2-minute disconnect grace → remaining player wins by forfeit.
  useEffect(() => {
    if (
      !session.code ||
      !game ||
      game.mode !== 'online' ||
      game.winner !== null ||
      game.phase === 'gameOver'
    ) {
      setForfeitDeadline(null);
      setForfeitRemainMs(0);
      forfeitClaimedRef.current = false;
      return;
    }
    const room = session.room;
    const seat = session.seat;
    if (!room || seat === null) {
      setForfeitDeadline(null);
      return;
    }
    const me = room.seats[String(seat) as '0' | '1'];
    const other = room.seats[String((1 - seat) as 0 | 1) as '0' | '1'];
    const opponentGone = Boolean(other && !other.connected);
    const iAmHere = !me || me.connected;
    if (opponentGone && iAmHere) {
      setForfeitDeadline((d) => d ?? Date.now() + DISCONNECT_FORFEIT_MS);
    } else {
      setForfeitDeadline(null);
      setForfeitRemainMs(0);
      forfeitClaimedRef.current = false;
    }
  }, [session.code, session.room, session.seat, game]);

  useEffect(() => {
    if (forfeitDeadline === null) {
      setForfeitRemainMs(0);
      return;
    }
    const tick = () => {
      const left = forfeitDeadline - Date.now();
      setForfeitRemainMs(Math.max(0, left));
      if (left > 0) return;
      if (forfeitClaimedRef.current) return;
      const seat = session.seat;
      if (seat === null) return;
      forfeitClaimedRef.current = true;
      applyLocalRef.current((g) => applyDisconnectForfeit(g, seat), true);
      if (session.code) {
        clearActiveRoomSession();
        void setRoomStatus(session.code, 'ended');
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [forfeitDeadline, session.seat, session.code]);

  // Auto-play AI seat in vs-AI mode (non-cut actions). Never in online.
  useEffect(() => {
    if (!game || screen !== 'table') return;
    if (game.mode === 'online') return;
    if (dealAnimating || aiCutAnim || pegBanner) return;
    if (needsThirtyOnePause(game) || needsGoPause(game) || needsEndOfPeggingPause(game)) return;
    if (!aiShouldAct(game)) return;

    if (game.phase === 'cut') {
      if (aiCutStartedDealRef.current === game.dealNumber) return;
      const dealNumber = game.dealNumber;
      const deckSnapshot = game.deck;
      const t = window.setTimeout(() => {
        if (aiCutStartedDealRef.current === dealNumber) return;
        if (deckSnapshot.length === 0) return;
        const slots = cutFanSlots(deckSnapshot.length);
        if (slots.length === 0) return;
        const visualI = Math.floor(Math.random() * slots.length);
        const cutIndex = slots[visualI];
        const revealCard = deckSnapshot[cutIndex];
        if (!revealCard) return;
        aiCutStartedDealRef.current = dealNumber;
        setDealAnimating(true);
        setAiCutAnim({
          stage: 'scanning',
          visualI,
          cutIndex,
          revealCard,
          dealNumber,
        });
      }, AI_THINK_MS);
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(() => {
      setGame((g) => {
        if (!g || !aiShouldAct(g)) return g;
        if (g.phase === 'cut') return g;
        return applyAiTurn(g, aiPlayerId());
      });
    }, AI_THINK_MS);

    return () => window.clearTimeout(t);
  }, [game, screen, dealAnimating, aiCutAnim, pegBanner]);

  const aiReaction = useAiReactions(
    game,
    Boolean(game && game.mode === 'ai' && screen === 'table' && !spectating),
  );

  // Advance AI cut stages
  useEffect(() => {
    if (!aiCutAnim) return;
    const { dealNumber, cutIndex, remote } = aiCutAnim;

    const tSelect = window.setTimeout(() => {
      if (starterCutSfxDealRef.current !== dealNumber) {
        starterCutSfxDealRef.current = dealNumber;
        playCut();
      }
      setAiCutAnim((a) =>
        a && a.dealNumber === dealNumber ? { ...a, stage: 'select' } : a,
      );
    }, AI_CUT_SELECT_MS);

    const tReveal = window.setTimeout(() => {
      setAiCutAnim((a) =>
        a && a.dealNumber === dealNumber ? { ...a, stage: 'reveal' } : a,
      );
    }, AI_CUT_REVEAL_MS);

    const tDone = window.setTimeout(() => {
      // Remote online replay: starter already applied via RTDB — only clear anim.
      if (remote) {
        setAiCutAnim(null);
        setDealAnimating(false);
        return;
      }
      setGame((g) => {
        if (!g || g.phase !== 'cut' || g.dealNumber !== dealNumber) return g;
        return cutStarter(g, cutIndex);
      });
      setAiCutAnim(null);
      setDealAnimating(false);
    }, AI_CUT_ANIM_MS);

    return () => {
      window.clearTimeout(tSelect);
      window.clearTimeout(tReveal);
      window.clearTimeout(tDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiCutAnim?.dealNumber, aiCutAnim?.cutIndex]);

  useEffect(() => {
    if (!game) return;
    if (game.phase === 'discard') {
      aiCutStartedDealRef.current = null;
      remoteCutStartedDealRef.current = null;
      starterCutSfxDealRef.current = null;
    }
  }, [game?.dealNumber, game?.phase]);

  /** Apply a local engine transition; in online mode push with rev check.
   *  When retryOnce, on rev conflict resyncFromServer then re-apply (up to 3 retries). */
  const applyLocal = useCallback(
    (fn: (g: GameState) => GameState | null, retryOnce = false) => {
      if (session.code && game?.mode === 'online') {
        const rev = session.gameRev;
        const current = session.game ?? game;
        if (!current) return;
        const next = fn(current);
        if (!next || next === current) return;
        // Optimistic: card must leave hand / count update instantly on both screens
        setGame(next);
        void (async () => {
          let ok = await session.pushState(rev, next);
          if (ok) return;
          const maxRetries = retryOnce ? 3 : 0;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            await session.resyncFromServer();
            const latest = sessionGameRef.current;
            const latestRev = sessionRevRef.current;
            if (!latest || latest.mode !== 'online') return;
            const retryNext = fn(latest);
            if (!retryNext || retryNext === latest) return;
            setGame(retryNext);
            ok = await session.pushState(latestRev, retryNext);
            if (ok) return;
          }
          await session.resyncFromServer();
        })();
        return;
      }
      setGame((g) => {
        if (!g) return g;
        const next = fn(g);
        return next ?? g;
      });
    },
    [session, game],
  );

  const actingOk = (player: PlayerId): boolean => {
    if (!game) return false;
    if (game.mode === 'online') {
      return player === mySeat;
    }
    if (game.mode === 'ai' && player !== 0) return false;
    return true;
  };

  const onToggleDiscard = (player: PlayerId, card: Card) => {
    if (!actingOk(player)) return;
    // Soft card cue on crib discard tap (select + quieter deselect). Play
    // outside applyLocal so online rev-retry does not multi-fire the SFX.
    const g0 = gameRef.current ?? game;
    if (g0 && g0.phase === 'discard') {
      const p = g0.players[player];
      const wasSelected = p.discardSel.some((c) => c.id === card.id);
      const need = player === g0.dealer ? 3 : 2;
      const canToggle =
        wasSelected ||
        (p.discardSel.length < need && p.hand.some((c) => c.id === card.id));
      if (canToggle) playCardSelect(wasSelected);
    }
    applyLocal((g) => toggleDiscardSelect(g, player, card), true);
  };

  const onConfirmDiscard = (player: PlayerId) => {
    if (!actingOk(player)) return;
    applyLocal((g) => confirmDiscard(g, player), true);
  };

  const onCut = (cutIndex: number) => {
    const g0 = gameRef.current ?? game;
    if (!g0 || g0.phase !== 'cut') return;
    if (g0.mode === 'ai' && g0.pone !== 0) return;
    if (g0.mode === 'online' && g0.pone !== mySeat) return;
    if (starterCutSfxDealRef.current !== g0.dealNumber) {
      starterCutSfxDealRef.current = g0.dealNumber;
      playCut();
    }
    applyLocal((g) => {
      if (g.mode === 'ai' && g.pone !== 0) return g;
      if (g.mode === 'online' && g.pone !== mySeat) return g;
      if (g.phase !== 'cut') return g;
      return cutStarter(g, cutIndex);
    }, true);
  };

  const onPeg = (player: PlayerId, card: Card) => {
    if (!actingOk(player)) return;
    if (pegBanner) return;
    applyLocal((g) => {
      const latest = g.players[player].hand.find((c) => c.id === card.id);
      if (!latest) return g;
      return playPegCard(g, player, latest);
    }, true);
  };

  const onGo = (player: PlayerId) => {
    if (!actingOk(player)) return;
    if (pegBanner) return;
    applyLocal((g) => sayGo(g, player), true);
  };

  // Stable string | null — same pause situation keeps the same key across Firebase revs.
  const pegPauseKey = derivePegPauseKey(game);

  // Keep applyLocalRef fresh without putting applyLocal in banner effect deps
  // (its identity changes every game snapshot and would retrigger the timer).
  applyLocalRef.current = applyLocal;

  // GO banner SFX (when pause overlay appears).
  useEffect(() => {
    if (!pegBanner || pegBanner.kind !== 'go') {
      if (!pegBanner) sfxGoKeyRef.current = '';
      return;
    }
    const key = pegPauseKey ?? `go|${pegBanner.player}|${pegBanner.name}`;
    if (key === sfxGoKeyRef.current) return;
    sfxGoKeyRef.current = key;
    playGo();
  }, [pegBanner, pegPauseKey]);

  // Delayed GO / 31 banners. Depend on pegPauseKey (+ attempt) — NOT full game / every rev —
  // so Firebase snapshot churn cannot clearTimeout before the 1.5s advance fires.
  useEffect(() => {
    if (!pegPauseKey) {
      pegPauseKeyRef.current = '';
      setPegBanner(null);
      setPegPauseAttempt(0);
      return;
    }

    const g = gameRef.current;
    if (!g || g.phase !== 'pegging' || !g.peg || g.winner !== null) {
      setPegBanner(null);
      return;
    }

    let banner: PegBanner | null = null;
    if (needsThirtyOnePause(g)) {
      // One announcement only: banner carries total points (31 + any 15/pair/run).
      // Table suppresses the sticky peg-score callout when events include thirtyone.
      const flash = g.lastPegFlash;
      const pts = flash?.points ?? 2;
      const label =
        flash && flash.events.length > 1
          ? (flash.kindLabel ||
              flash.events.map((e) => e.kind).join(' · ')).toUpperCase()
          : undefined;
      banner = { kind: 'thirtyone', points: pts, label };
    } else if (needsEndOfPeggingPause(g)) {
      // Peg-score callout is enough; keep phase pegging until finishPeggingToShow.
      banner = null;
    } else if (needsGoPause(g)) {
      const tp = g.peg.toPlay;
      const labels = seatLabelsRef.current;
      banner = { kind: 'go', player: tp, name: labels[tp] || `P${tp}` };
    } else {
      setPegBanner(null);
      return;
    }

    pegPauseKeyRef.current = pegPauseKey;
    setPegBanner(banner);

    const keyAtSchedule = pegPauseKey;
    const attemptAtSchedule = pegPauseAttempt;
    const followUpHolder: { id: number | undefined } = { id: undefined };

    const t = window.setTimeout(() => {
      const latest = gameRef.current;
      if (!latest) return;

      // Online: only host (seat 0) pushes finish/sayGo; guest keeps overlay until sync.
      if (latest.mode === 'online' && mySeatRef.current !== 0) {
        return;
      }

      applyLocalRef.current((state) => {
        if (keyAtSchedule.startsWith('31|')) {
          if (!needsThirtyOnePause(state)) return state;
          return finishPegThirtyOne(state);
        }
        if (keyAtSchedule.startsWith('endpeg|')) {
          if (!needsEndOfPeggingPause(state)) return state;
          return finishPeggingToShow(state);
        }
        if (keyAtSchedule.startsWith('go|')) {
          if (!needsGoPause(state) || !state.peg) return state;
          return sayGo(state, state.peg.toPlay);
        }
        return state;
      }, true);

      // If pause still needed after apply/retries, bump attempt so effect can run again.
      followUpHolder.id = window.setTimeout(() => {
        const after = gameRef.current;
        const still = derivePegPauseKey(after);
        if (still === keyAtSchedule) {
          if (attemptAtSchedule < 3) {
            setPegPauseAttempt((n) => n + 1);
          }
          return;
        }
        setPegBanner(null);
      }, 80);
    }, PEG_BANNER_MS);

    return () => {
      window.clearTimeout(t);
      if (followUpHolder.id !== undefined) window.clearTimeout(followUpHolder.id);
      // Do NOT clear pegPauseKeyRef / banner here — clearing the ref on every cleanup
      // retriggered infinite reschedule while needsThirtyOnePause stayed true.
    };
  }, [pegPauseKey, pegPauseAttempt]);

  const onReorderHand = (player: PlayerId, from: number, to: number) => {
    if (!actingOk(player)) return;
    applyLocal((g) => reorderHand(g, player, from, to));
  };

  const onZeroHandChoice = (choice: 'redeal' | 'continue') => {
    applyLocal((g) => resolveZeroHandOffer(g, choice), true);
  };

  const onShowClaim = (claimed: number) => {
    applyLocal((g) => {
      if (g.mode === 'online') {
        const claimant = competitiveClaimant(g);
        if (claimant === null || claimant !== mySeatRef.current) return g;
      }
      return submitShowClaim(g, claimed);
    }, true);
  };

  const onConfirmClaim = () => {
    applyLocal((g) => {
      if (g.mode === 'online') {
        const seat = competitiveReviewRespondent(g);
        if (seat === null || seat !== mySeatRef.current) return g;
      }
      return confirmShowClaim(g);
    }, true);
  };

  const onAdjustClaim = (adjusted: number) => {
    applyLocal((g) => {
      if (g.mode === 'online') {
        const seat = competitiveReviewRespondent(g);
        if (seat === null || seat !== mySeatRef.current) return g;
      }
      return adjustShowClaim(g, adjusted);
    }, true);
  };

  const onMugginsChoice = (choice: 'accept' | 'muggins') => {
    applyLocal((g) => {
      if (g.mode === 'online') {
        const seat = competitiveMugginsRespondent(g);
        if (seat === null || seat !== mySeatRef.current) return g;
      }
      return resolveMugginsChoice(g, choice);
    }, true);
  };

  const onAcknowledgeRef = () => {
    applyLocal((g) => {
      if (!g.competitiveShow?.pendingRef) return g;
      return acknowledgeCompetitiveRef(g);
    }, true);
  };

  const leaveTableAfterMatch = () => {
    const tid =
      tournamentReturnIdRef.current ||
      tournamentAiMatch?.tournamentId ||
      tournamentOnlineMatch?.tournamentId ||
      null;
    // Last-chance Club Night submit if gameOver effect skipped or failed.
    const g = game;
    if (
      g &&
      g.winner !== null &&
      g.players?.[0] &&
      g.players?.[1] &&
      auth.user
    ) {
      const tOnline = tournamentOnlineMatch;
      if (
        tOnline &&
        !tournamentOnlineSubmittedRef.current &&
        !tournamentOnlineInFlightRef.current
      ) {
        const scoreA = g.players[0].score;
        const scoreB = g.players[1].score;
        const p =
          tOnline.kind === 'playoff'
            ? submitPlayoffGame(
                auth.user,
                tOnline.tournamentId,
                tOnline.seriesId,
                tOnline.gameIndex,
                scoreA,
                scoreB,
              )
            : submitResult(
                auth.user,
                tOnline.tournamentId,
                tOnline.roundNumber,
                tOnline.board,
                scoreA,
                scoreB,
              );
        void p.catch((e) =>
          console.warn('Tournament online result submit (quit) failed', e),
        );
      }
      const tAi = tournamentAiMatch;
      if (
        tAi &&
        g.mode === 'ai' &&
        !tournamentAiSubmittedRef.current &&
        !tournamentAiInFlightRef.current
      ) {
        const humanScore = g.players[0].score;
        const aiScore = g.players[1].score;
        const scoreA = tAi.humanIsA ? humanScore : aiScore;
        const scoreB = tAi.humanIsA ? aiScore : humanScore;
        const p =
          tAi.kind === 'playoff'
            ? submitPlayoffGame(
                auth.user,
                tAi.tournamentId,
                tAi.seriesId,
                tAi.gameIndex,
                scoreA,
                scoreB,
              )
            : submitResult(
                auth.user,
                tAi.tournamentId,
                tAi.roundNumber,
                tAi.board,
                scoreA,
                scoreB,
              );
        void p.catch((e) =>
          console.warn('Tournament AI result submit (quit) failed', e),
        );
      }
    }
    tournamentReturnIdRef.current = null;
    setTournamentAiMatch(null);
    tournamentAiSubmittedRef.current = false;
    tournamentAiInFlightRef.current = false;
    setTournamentOnlineMatch(null);
    tournamentOnlineSubmittedRef.current = false;
    tournamentOnlineInFlightRef.current = false;
    setSpectating(false);
    setGame(null);
    setAiCutAnim(null);
    setCutForDeal(null);
    setSkinPickDealer(null);
    skinPickDealerRef.current = null;
    skinPickDoneRef.current = false;
    setMatchFeltId(null);
    setMatchBoardSkinId(null);
    setDealAnimating(false);
    setPegBanner(null);
    pegPauseKeyRef.current = '';
    setPegPauseAttempt(0);
    aiCutStartedDealRef.current = null;
    onlineDealStartedRef.current = false;
    setResumeHint(null);
    setOnlineDealError(null);
    if (tid) {
      setTournamentId(tid);
      setScreen('tournamentLive');
    } else {
      setScreen('home');
    }
  };

  const onShowContinue = () => {
    // Winner decided during show: dismiss show overlay first so GameOverBanner can appear
    // (AI and online). Pegging wins already land with showResult null.
    if (game && game.winner !== null && game.showResult) {
      if (session.code && game.mode === 'online') {
        applyLocal((g) => clearShowForGameOverBanner(g), true);
        return;
      }
      setGame((g) => (g ? clearShowForGameOverBanner(g) : g));
      return;
    }
    if (session.code && game?.mode === 'online') {
      if (game.winner !== null) {
        // Banner already up (or no show overlay) — Home from banner uses onQuit.
        void session.leave();
        setGame(null);
        onlineDealStartedRef.current = false;
        setScreen('home');
        return;
      }
      applyLocal((g) => {
        const next = ackShowContinue(g, mySeat);
        // After both acks, nextRound/redeal lands in discard — sort hands.
        if (next.phase === 'discard') return sortHumanHands(next);
        return next;
      });
      return;
    }
    if (game && game.winner !== null && game.mode === 'ai') {
      leaveTableAfterMatch();
      return;
    }
    setGame((g) => {
      if (!g) return g;
      if (g.winner !== null) {
        leaveTableAfterMatch();
        return null;
      }
      return ackShowContinue(g, 0);
    });
  };

  const onDealAnimChange = (animating: boolean) => {
    if (!animating && aiCutAnim) return;
    setDealAnimating(animating);
  };

  const onAutoSortHands = () => {
    // Online deals are pre-sorted by the host before the first push.
    if (game?.mode === 'online') return;
    applyLocal((g) => sortHumanHands(g));
  };

  const onQuit = () => {
    const leaveCode = session.code;
    sideLiveChat.leave();
    if (leaveCode) {
      void cleanupVoiceOnLeave(leaveCode);
      void cleanupSideLiveChatOnLeave(leaveCode);
      void session.leave();
    } else {
      clearActiveRoomSession();
    }
    leaveTableAfterMatch();
  };

  const onLoginDone = (p: Profile) => {
    void saveProfileForAccount(p, authUid).then((saved) => {
      setProfile(saved);
      setScreen('home');
    });
  };

  const roomStatus = session.room?.status;
  const loadingDeal =
    !!session.code &&
    roomStatus === 'playing' &&
    !session.game &&
    !game;

  const onlineCutView =
    !!session.code &&
    roomStatus === 'cutting' &&
    !game &&
    !session.game
      ? cutCardsFromSynced(session.room?.cut)
      : null;

  const onlineCutting = onlineCutView !== null;
  const preparingCut =
    !!session.code &&
    roomStatus === 'cutting' &&
    !game &&
    !session.game &&
    !onlineCutting;

  // Online: always prefer live session.seat (never collapse guest→0 if seat briefly null).
  const viewer: PlayerId = spectating
    ? 0
    : session.code != null && session.seat !== null
      ? (session.seat as PlayerId)
      : game?.mode === 'online' || onlineCutting
        ? mySeat
        : 0;

  // Auto-collapse online "Connected" strip; keep waiting/disconnect/forfeit visible.
  useEffect(() => {
    if (session.connection === 'connected' && !forfeitDeadline) {
      setConnBannerCollapsed(false);
      const id = window.setTimeout(() => setConnBannerCollapsed(true), CONN_BANNER_COLLAPSE_MS);
      return () => window.clearTimeout(id);
    }
    setConnBannerCollapsed(false);
  }, [session.connection, forfeitDeadline]);

    // Connection banner for online table
  const connBanner =
    session.code && (game?.mode === 'online' || onlineCutting)
      ? session.connection
      : null;

  // Online: room/local match pick wins (viewer may not own the paint).
  // vs-AI / local: never pass a match snapshot — always live equipped board/felt
  // so cloud hydrate or mid-session re-equip cannot leave stale maple wood.
  const localPlay = !session.code;
  const { feltId, boardId } = resolveTableSkins({
    matchFeltId: localPlay ? null : (session.room?.matchFeltId ?? matchFeltId),
    matchBoardSkinId: localPlay
      ? null
      : (session.room?.matchBoardSkinId ?? matchBoardSkinId),
    uid: auth.user?.uid,
    email: auth.user?.email,
    profileTheme: profile?.settings?.theme,
    profileBoard: profile?.settings?.board,
    ownedBoardIds: profile?.ownedBoardIds,
  });
  const feltClass = feltId !== 'felt' ? ` felt-${feltId}` : '';
  const boardClass = boardId !== 'default' ? ` board-${boardId}` : '';

  return (
    <div
      className={`app${
        screen === 'table' ||
        skinPickDealer !== null ||
        (screen === 'online' && (!!game || onlineCutting || loadingDeal || skinPickDealer !== null))
          ? ' app-playing'
          : ''
      }${feltClass}${boardClass}`}
      data-felt={feltId}
      data-board={boardId}
    >
      {(session.reconnecting || resumeHint) && (
        <div className="online-banner status-waiting" aria-live="polite">
          {session.reconnecting ? 'Reconnecting…' : resumeHint}
        </div>
      )}
      {promoToast && (
        <div className="promo-toast" role="status" aria-live="polite">
          {promoToast}
        </div>
      )}
      {screen === 'splash' && <Splash exiting={splashExiting} />}
      {screen === 'login' && (
        <Login
          existing={profile}
          onDone={onLoginDone}
          authUser={auth.user}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          authError={auth.error}
          onSignIn={() => {
            void auth.signIn();
          }}
          onSignInWithEmail={(email, password) => {
            void auth.signInWithEmail(email, password);
          }}
          onSignUpWithEmail={(email, password, displayName) => {
            void auth.signUpWithEmail(email, password, displayName);
          }}
          onForgotPassword={(email) => auth.sendPasswordReset(email)}
        />
      )}
      {screen === 'home' && profile && (
        <Home
          profile={profile}
          authUser={auth.user}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          authError={auth.error}
          onSignIn={() => {
            void auth.signIn();
          }}
          onAi={(difficulty, scoringMode) =>
            beginAi(AI_SEAT_LABELS, difficulty, scoringMode ?? 'auto')
          }
          onOnline={(scoringMode) => beginOnline(scoringMode ?? 'auto')}
          onRules={() => setScreen('rules')}
          onSettings={() => setScreen('settings')}
          onOpenDoctor={() => {
            setFocusDoctor(true);
            setScreen('settings');
          }}
          onOpenStore={() => setScreen('store')}
          onFriends={() => setScreen('friends')}
          onTournaments={() => setScreen('tournaments')}
          onEditProfile={() => setScreen('settings')}
          onProfileUpdate={setProfile}
        />
      )}
      {screen === 'home' && !profile && auth.user && (
        <div className="splash-screen splash-enter" role="status" aria-live="polite">
          <p className="splash-presents">Loading your profile…</p>
        </div>
      )}
      {screen === 'home' && !profile && !auth.user && (
        <Login
          existing={null}
          onDone={onLoginDone}
          authUser={auth.user}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          authError={auth.error}
          onSignIn={() => {
            void auth.signIn();
          }}
          onSignInWithEmail={(email, password) => {
            void auth.signInWithEmail(email, password);
          }}
          onSignUpWithEmail={(email, password, displayName) => {
            void auth.signUpWithEmail(email, password, displayName);
          }}
          onForgotPassword={(email) => auth.sendPasswordReset(email)}
        />
      )}
      {screen === 'online' && profile && (
        <OnlineLobby
          configured={session.configured}
          displayName={profile.displayName.trim() || 'Player'}
          code={session.code}
          shareUrl={session.shareUrl}
          connection={session.connection}
          error={session.error || onlineDealError}
          tournamentMatch={
            tournamentOnlineMatch
              ? { opponentName: tournamentOnlineMatch.opponentName }
              : null
          }
          scoringMode={
            session.room
              ? roomScoringMode(session.room)
              : pendingScoringMode
          }
          onSetScoringMode={
            session.seat === 0
              ? async (mode) => {
                  await session.setScoringMode(mode);
                  setPendingScoringMode(mode);
                }
              : undefined
          }
          onCreate={async (name) => {
            onlineDealStartedRef.current = false;
            setOnlineDealError(null);
            return session.create(name, {
              avatarId: profile.avatarId,
              scoringMode: pendingScoringMode,
            });
          }}
          onJoin={async (code, name) => {
            onlineDealStartedRef.current = false;
            setOnlineDealError(null);
            await session.join(code, name, undefined, { avatarId: profile.avatarId });
          }}
          onLeave={() => {
            sideLiveChat.leave();
            void cleanupSideLiveChatOnLeave(session.code);
            void session.leave();
            setOnlineDealError(null);
            setResumeHint(null);
            const returnId =
              tournamentOnlineMatch?.tournamentId || tournamentReturnIdRef.current;
            setTournamentOnlineMatch(null);
            if (returnId) {
              setTournamentId(returnId);
              setScreen('tournamentLive');
            } else {
              setScreen('home');
            }
          }}
          onBack={() => {
            const returnId =
              tournamentOnlineMatch?.tournamentId || tournamentReturnIdRef.current;
            if (returnId) {
              setTournamentId(returnId);
              setScreen('tournamentLive');
            } else {
              setScreen('home');
            }
          }}
          lobbyVoice={
            sideLiveChat.available
              ? {
                  available: true,
                  joined: sideLiveChat.joined,
                  localReady: sideLiveChat.localReady,
                  peerReady: sideLiveChat.peerReady,
                  indicator: sideLiveChat.indicator,
                  uiStatus: sideLiveChat.uiStatus,
                  remoteTalking: sideLiveChat.remoteTalking,
                  localSpeaking: sideLiveChat.localSpeaking,
                  inlineError: sideLiveChat.inlineError,
                  statusDetail: sideLiveChat.statusDetail,
                  debugLine: sideLiveChat.debugLine,
                  remoteStream: sideLiveChat.remoteStream,
                  onConnect: sideLiveChat.join,
                  onDisconnect: sideLiveChat.leave,
                  peerSeatName:
                    session.seat === 0
                      ? seatLabels[1] && seatLabels[1] !== 'You'
                        ? seatLabels[1]
                        : 'Opponent'
                      : seatLabels[0] && seatLabels[0] !== 'You'
                        ? seatLabels[0]
                        : 'Host',
                }
              : null
          }
          busy={onlineCutting || !!session.game || roomStatus === 'playing' || skinPickDealer !== null}
          preparingCut={preparingCut}
          loadingDeal={loadingDeal}
          roomStatus={roomStatus}
          isHost={session.seat === 0}
          onPlay={async () => {
            session.clearError();
            setOnlineDealError(null);
            await session.ensureCut();
          }}
        />
      )}
      
      {screen === 'tournaments' && (
        <Tournaments
          authUser={auth.user}
          playerCode={profile?.playerCode ?? null}
          profile={profile}
          onProfileUpdate={setProfile}
          onBack={() => setScreen('home')}
          onOpenLobby={(id) => {
            setTournamentId(id);
            setScreen('tournamentLobby');
          }}
          onOpenLive={(id) => {
            setTournamentId(id);
            setScreen('tournamentLive');
          }}
        />
      )}
      {screen === 'tournamentLobby' && tournamentId && (
        <TournamentLobby
          tournamentId={tournamentId}
          authUser={auth.user}
          onBack={() => setScreen('tournaments')}
          onLive={(id) => {
            setTournamentId(id);
            setScreen('tournamentLive');
          }}
        />
      )}
      {screen === 'tournamentLive' && tournamentId && (
        <TournamentLive
          tournamentId={tournamentId}
          authUser={auth.user}
          onBack={() => setScreen('tournaments')}
          onOpenRoom={(code, opts) => {
            setOnlineDealError(null);
            setResumeHint(null);
            setTournamentAiMatch(null);
            const launch = opts?.onlineLaunch;
            if (launch) {
              tournamentOnlineSubmittedRef.current = false;
              tournamentOnlineInFlightRef.current = false;
              setTournamentOnlineMatch(launch);
              setTournamentId(launch.tournamentId);
              tournamentReturnIdRef.current = launch.tournamentId;
            } else if (tournamentId) {
              // Fallback: still return to Live if we came from a tournament screen.
              tournamentReturnIdRef.current = tournamentId;
            }
            setScreen('online');
            const joinName =
              (opts?.displayName || '').trim() ||
              (profile?.displayName || '').trim() ||
              'Player';
            return session.join(code, joinName, opts?.seat, { avatarId: profile?.avatarId }).catch((e) => {
              const msg = e instanceof Error ? e.message : 'Could not join room';
              clearActiveRoomSession();
              // Never leave a tournament player on Create/Join with a dead code.
              if (launch || tournamentReturnIdRef.current) {
                const returnId = launch?.tournamentId || tournamentReturnIdRef.current;
                setTournamentOnlineMatch(null);
                if (returnId) {
                  setTournamentId(returnId);
                  setScreen('tournamentLive');
                }
                setOnlineDealError(
                  /room is full/i.test(msg)
                    ? 'Table busy — tap Play game again on the live board.'
                    : `${msg} — tap Play game again on the live board.`,
                );
              } else if (/room is full/i.test(msg)) {
                setOnlineDealError(
                  'Room is full — go back to the live board and tap Play game again.',
                );
              } else {
                setOnlineDealError(msg);
              }
              throw e instanceof Error ? e : new Error(msg);
            });
          }}
          onPlayAiBoard={beginTournamentAiBoard}
          onWatchMatch={(code, labels) => {
            if (!tournamentId) return;
            beginTournamentSpectate({
              code,
              tournamentId,
              seatLabels: labels,
            });
          }}
        />
      )}
      {screen === 'rules' && <Rules onBack={() => setScreen('home')} />}
      {screen === 'settings' && profile && (
        <Settings
          profile={profile}
          onSave={setProfile}
          onBack={() => setScreen('home')}
          onFriends={() => setScreen('friends')}
          uid={authUid}
          signedIn={!!auth.user}
          authUser={auth.user}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          authError={auth.error}
          onSignIn={() => {
            void auth.signIn();
          }}
          onSignInWithEmail={(email, password) => {
            void auth.signInWithEmail(email, password);
          }}
          onSignOut={() => {
            void auth.signOut();
          }}
          focusDoctor={focusDoctor}
          onFocusDoctorHandled={() => setFocusDoctor(false)}
          onOpenStore={() => setScreen('store')}
        />
      )}
      {screen === 'store' && profile && (
        <Store
          profile={profile}
          authUser={auth.user}
          uid={authUid}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          onSignIn={() => {
            void auth.signIn();
          }}
          onSave={setProfile}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'friends' && (
        <Friends
          onBack={() => setScreen(profile ? 'home' : 'login')}
          uid={authUid}
          signedIn={!!auth.user}
          playerCode={profile?.playerCode ?? null}
          authConfigured={auth.configured}
          authBusy={auth.busy}
          authError={auth.error}
          onSignIn={() => {
            void auth.signIn();
          }}
        />
      )}
      {screen === 'table' && cutForDeal && !game && skinPickDealer === null && (
        <CutForDeal
          mode={cutForDeal}
          seatLabels={seatLabels}
          onResolved={onCutForDealResolved}
          onQuit={onQuit}
        />
      )}
      {skinPickDealer !== null &&
        (session.seat === null
          ? skinPickDealer === 0
          : session.seat === skinPickDealer) && (
        <MatchSkinPicker
          uid={auth.user?.uid}
          email={auth.user?.email}
          ownedFeltIds={profile?.ownedFeltIds}
          ownedBoardIds={profile?.ownedBoardIds}
          initial={winnerEquippedMatchSkins(
            auth.user?.uid,
            profile?.settings,
            profile?.ownedFeltIds,
            profile?.ownedBoardIds,
            auth.user?.email,
          )}
          onConfirm={(choice) => {
            void completeMatchSkinPick(choice);
          }}
        />
      )}
      {skinPickDealer !== null &&
        session.seat !== null &&
        session.seat !== skinPickDealer && (
        <MatchSkinWaiting winnerLabel={seatLabels[skinPickDealer]} />
      )}
      {skinPickDealer !== null &&
        session.seat === null &&
        skinPickDealer !== 0 && (
        <MatchSkinWaiting winnerLabel={seatLabels[skinPickDealer]} />
      )}
      {(screen === 'table' || screen === 'online') &&
        onlineCutting &&
        onlineCutView &&
        session.room?.cut &&
        session.seat !== null &&
        !spectating &&
        skinPickDealer === null && (
        <>
          {connBanner && !(connBanner === 'connected' && connBannerCollapsed) && (
            <div className={`online-banner status-${connBanner}`} aria-live="polite">
              {connBanner === 'waiting' && 'Waiting for opponent…'}
              {connBanner === 'connected' && 'Connected'}
              {connBanner === 'disconnected' &&
                (forfeitDeadline
                  ? `Opponent disconnected — forfeit in ${formatForfeitCountdown(forfeitRemainMs)}`
                  : 'Opponent disconnected')}
              {connBanner === 'offline' && 'Offline'}
            </div>
          )}
          <CutForDeal
            mode="online"
            seatLabels={seatLabels}
            onResolved={onCutForDealResolved}
            onQuit={onQuit}
            online={{
              stage: session.room.cut.stage,
              deckCount: onlineCutView.deck.length,
              cuts: onlineCutView.cuts,
              winner: session.room.cut.winner ?? null,
              round: session.room.cut.round,
              // Never default null→0: that shows "your turn" while cutCard no-ops.
              viewer: session.seat,
              onCutIndex: (index) => {
                void session.cutCard(index);
              },
              onTieAdvance: () => {
                void session.advanceTieCut();
              },
            }}
          />
        </>
      )}
      {/* Spectator: cut-for-deal in progress — wait for deal (no seat / no cut controls). */}
      {screen === 'table' && spectating && !game && (
        <div className="home online-lobby">
          <div className="watching-banner" role="status">
            Watching · {seatLabels[0]} vs {seatLabels[1]}
          </div>
          <h1 className="title">Watching</h1>
          <p className="find-match-hint">
            {onlineCutting || roomStatus === 'cutting'
              ? 'Players are cutting for deal…'
              : loadingDeal || roomStatus === 'playing'
                ? 'Loading deal…'
                : roomStatus === 'waiting'
                  ? 'Waiting for players to start…'
                  : session.error || onlineDealError || 'Connecting to match…'}
          </p>
          {(session.error || onlineDealError) && (
            <p className="online-warn" role="alert">
              {session.error || onlineDealError}
            </p>
          )}
          <button type="button" className="primary" onClick={onQuit}>
            Back to tournament
          </button>
        </div>
      )}
      {/* Joiner: status playing but game not parsed/arrived yet */}
      {screen === 'online' && loadingDeal && (
        <div className="home online-lobby">
          <h1 className="title">Play Online</h1>
          <div className="online-status" aria-live="polite">
            <span
              className={`online-dot status-${session.connection}`}
              aria-hidden
            />
            {session.connection === 'connected'
              ? 'Connected'
              : session.connection === 'waiting'
                ? 'Waiting for opponent…'
                : session.connection === 'disconnected'
                  ? 'Opponent disconnected'
                  : 'Offline'}
          </div>
          {session.code && (
            <div className="online-code-block">
              <div className="section-label">Room code</div>
              <div className="online-code-big">{session.code}</div>
            </div>
          )}
          <p className="find-match-hint">Loading deal…</p>
          {(session.error || onlineDealError) && (
            <p className="online-warn" role="alert">
              {session.error || onlineDealError}
            </p>
          )}
          <button type="button" onClick={onQuit}>
            Leave room
          </button>
        </div>
      )}
      {/* Never blank: online session without deal yet stays on lobby; if somehow on table, show error */}
      {screen === 'table' &&
        session.code &&
        !game &&
        !onlineCutting &&
        !cutForDeal &&
        skinPickDealer === null &&
        !spectating && (
        <div className="online-lobby panel">
          <h1>{loadingDeal ? 'Loading deal…' : 'Waiting for deal'}</h1>
          <p className="online-warn" role="alert">
            {onlineDealError ||
              (loadingDeal
                ? 'Syncing deal from host…'
                : 'No deal in Firebase yet. Waiting for host to deal after cut…')}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setOnlineDealError(null);
              setScreen('online');
            }}
          >
            Back to lobby
          </button>
          <button type="button" onClick={onQuit}>
            Quit
          </button>
        </div>
      )}
      {(screen === 'table' || screen === 'online') && game && (
        <>
          {!spectating &&
            connBanner &&
            !(connBanner === 'connected' && connBannerCollapsed) && (
            <div
              className={`online-banner status-${connBanner}`}
              aria-live="polite"
            >
              {connBanner === 'waiting' && 'Waiting for opponent…'}
              {connBanner === 'connected' && 'Connected'}
              {connBanner === 'disconnected' &&
                (forfeitDeadline
                  ? `Opponent disconnected — forfeit in ${formatForfeitCountdown(forfeitRemainMs)}`
                  : 'Opponent disconnected')}
              {connBanner === 'offline' && 'Offline'}
              {session.code && connBanner !== 'connected'
                ? ` · Room ${session.code}`
                : ''}
            </div>
          )}
          <Table
            state={game}
            viewer={viewer}
            seatLabels={seatLabels}
            dealAnimating={dealAnimating}
            aiCutAnim={aiCutAnim}
            pegBanner={pegBanner}
            onDealAnimChange={onDealAnimChange}
            onAutoSortHands={onAutoSortHands}
            onToggleDiscard={onToggleDiscard}
            onConfirmDiscard={onConfirmDiscard}
            onCut={onCut}
            onPeg={onPeg}
            onGo={onGo}
            onReorderHand={onReorderHand}
            onShowContinue={onShowContinue}
            onZeroHandChoice={onZeroHandChoice}
            onShowClaim={onShowClaim}
            onConfirmClaim={onConfirmClaim}
            onAdjustClaim={onAdjustClaim}
            onMugginsChoice={onMugginsChoice}
            onAcknowledgeRef={onAcknowledgeRef}
            onQuit={onQuit}
            remoteReaction={session.room?.reaction ?? null}
            externalOppReaction={game.mode === 'ai' ? aiReaction : null}
            onReact={
              !spectating && game.mode === 'online'
                ? (emoji) => void session.sendReaction(emoji)
                : undefined
            }
            equippedRailEmojiIds={profile?.equippedRailEmojiIds ?? null}
            spectate={spectating}
            {...(VOICE_PTT_ENABLED
              ? {
                  voicePtt:
                    !spectating && game.mode === 'online'
                      ? {
                          holding: voice.holding,
                          remoteTalking: voice.remoteTalking,
                          peerLive: voice.peerLive,
                          inlineError: voice.inlineError,
                          remoteStream: voice.remoteStream,
                          onHoldStart: voice.holdStart,
                          onHoldEnd: voice.holdEnd,
                          /* Mic UI always visible online; wiring still needs connected */
                          voiceReady: session.connection === 'connected',
                          voiceStatusHint:
                            voice.status === 'denied' && voice.statusDetail
                              ? voice.statusDetail
                              : !voice.peerLive && voice.status === 'connecting'
                                ? voice.statusDetail || 'Connecting voice…'
                                : null,
                        }
                      : null,
                }
              : {})}
            {...(sideLiveChat.available && !spectating && game.mode === 'online'
              ? {
                  sideLiveChat: {
                    joined: sideLiveChat.joined,
                    indicator: sideLiveChat.indicator,
                    uiStatus: sideLiveChat.uiStatus,
                    remoteTalking: sideLiveChat.remoteTalking,
                    localSpeaking: sideLiveChat.localSpeaking,
                    inlineError: sideLiveChat.inlineError,
                    statusDetail: sideLiveChat.statusDetail,
                    debugLine: sideLiveChat.debugLine,
                    remoteStream: sideLiveChat.remoteStream,
                    onJoin: sideLiveChat.join,
                    onLeave: sideLiveChat.leave,
                    roomReady: session.connection === 'connected',
                    compact: true,
                    // Prefer lobby Connect; table Join only if they skipped lobby.
                    allowConnect: !sideLiveChat.joined,
                  },
                }
              : {})}
            seatAvatar0={
              game.mode === 'ai'
                ? profileSeatAvatar(profile, seatLabels[0] || 'You')
                : session.seat === 0
                  ? profileSeatAvatar(profile, seatLabels[0] || 'You')
                  : roomSeatAvatar(
                      session.room?.seats?.['0'],
                      seatLabels[0] || 'P0',
                    )
            }
            seatAvatar1={
              game.mode === 'ai'
                ? {
                    displayName: seatLabels[1] || 'AI',
                    avatarId: CRIB_MASTER_ID,
                    avatarDataUrl: null,
                  }
                : session.seat === 1
                  ? profileSeatAvatar(profile, seatLabels[1] || 'You')
                  : roomSeatAvatar(
                      session.room?.seats?.['1'],
                      seatLabels[1] || 'P1',
                    )
            }
          />
        </>
      )}
    </div>
  );
}
