import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../profile/auth';
import { isOwner } from '../tournament/isOwner';
import {
  applyDeadlineForfeits,
  ensureFreshMatchRoom,
  ensureFreshPlayoffGameRoom,
  isMatchRoomStuck,
  resetMatchRoom,
  resetPlayoffGameRoom,
  completeTournament,
  computeStandings,
  hostOverride,
  isAiTournamentPlayer,
  isRoundRobinComplete,
  nextRound,
  pairingInvolvesAi,
  pairingIsAiOnly,
  recalculateRrStats,
  resolveAiBoard,
  resolveAiPlayoffGame,
  startPlayoffs,
  startRound,
  startRoundTimer,
  reconcileFinishedMatchRoom,
  submitPlayoffGame,
  submitResult,
  subscribeTournament,
} from '../tournament/tournamentApi';
import { fetchRoom, readRoomSeat } from '../multiplayer/roomSession';
import { CURRENT_SCORING_VERSION } from '../tournament/types';
import { nextPendingGameIndex, playoffPodium } from '../tournament/playoffs';
import type { PlayoffSeries, TournamentDoc, TournamentPairing } from '../tournament/types';
import {
  formatLockInCountdown,
  remainingLockInMs,
} from '../tournament/scoring';
import { getTournamentPrizeAvatar } from '../profile/avatars';
import { fetchCloudAvatarId } from '../profile/cloudSync';
import { resolveAvatarId } from '../tournament/resolveAvatarId';
import { AvatarPreviewModal } from './AvatarPreviewModal';
import { AvatarView } from './AvatarView';

export type TournamentAiBoardLaunch =
  | {
      kind?: 'rr';
      tournamentId: string;
      roundNumber: number;
      board: number;
      /** True when the signed-in human is pairing.playerAId. */
      humanIsA: boolean;
      aiDisplayName: string;
    }
  | {
      kind: 'playoff';
      tournamentId: string;
      seriesId: string;
      gameIndex: number;
      /** True when the signed-in human is series.playerAId. */
      humanIsA: boolean;
      aiDisplayName: string;
    };

/** Human vs human online board — seat 0 is always pairing A. */
export type TournamentOnlineBoardLaunch =
  | {
      kind?: 'rr';
      tournamentId: string;
      roundNumber: number;
      board: number;
      /** True when the signed-in human is pairing.playerAId (room seat 0). */
      humanIsA: boolean;
      /** Other human's display name — waiting UI (no code share). */
      opponentName?: string;
    }
  | {
      kind: 'playoff';
      tournamentId: string;
      seriesId: string;
      gameIndex: number;
      humanIsA: boolean;
      opponentName?: string;
    };

interface Props {
  tournamentId: string;
  authUser: AuthUser | null;
  onBack: () => void;
  /** Join as a seated player (writes to room) — human vs human. Returns join promise. */
  onOpenRoom?: (
    code: string,
    opts?: {
      seat: 0 | 1;
      displayName: string;
      /** Set before join so App can submitResult + return to Live. */
      onlineLaunch?: TournamentOnlineBoardLaunch;
    },
  ) => void | Promise<void>;
  /** Human vs AI board — local AI match (cut + play), not an empty online room. */
  onPlayAiBoard?: (launch: TournamentAiBoardLaunch) => void;
  /**
   * Full-table spectate (read-only). Opens Table with hole cards hidden until show.
   * labels = pairing display names [A, B] (e.g. Joe / Dad).
   */
  onWatchMatch?: (code: string, labels: [string, string]) => void;
}

function boardStatusLabel(p: TournamentPairing): string {
  if (p.result === 'bye' || !p.playerAId || !p.playerBId) return 'Bye';
  if (p.result === 'deadline') return 'Time expired';
  if (p.result !== 'pending') return 'Done';
  if (p.matchRoomCode) return 'In progress';
  return 'Waiting';
}

function boardStatusTone(p: TournamentPairing): string {
  if (p.result === 'bye' || !p.playerAId || !p.playerBId) return 'bye';
  if (p.result === 'deadline') return 'expired';
  if (p.result !== 'pending') return 'done';
  if (p.matchRoomCode) return 'live';
  return 'waiting';
}

export function TournamentLive({
  tournamentId,
  authUser,
  onBack,
  onOpenRoom,
  onPlayAiBoard,
  onWatchMatch,
}: Props) {
  const [doc, setDoc] = useState<TournamentDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [prizePreviewOpen, setPrizePreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState<Record<string, { a: string; b: string }>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** Board whose admin sheet is open; null = closed. */
  const [adminBoard, setAdminBoard] = useState<number | null>(null);
  /** Playoff series whose admin sheet is open; null = closed. */
  const [adminPlayoffSeriesId, setAdminPlayoffSeriesId] = useState<string | null>(null);
  const [roundAdminOpen, setRoundAdminOpen] = useState(false);
  /** null = follow live currentRound; otherwise a past/current round to display. */
  const [browseRound, setBrowseRound] = useState<number | null>(null);
  /** Which stage panel to show when playoffs exist. */
  const [viewStage, setViewStage] = useState<'rr' | 'playoffs'>('rr');
  /** Semis vs Final sub-tab inside the Playoffs panel. */
  const [playoffStageView, setPlayoffStageView] = useState<'quarters' | 'semis' | 'final'>('semis');
  /** Congrats / nice-run overlay dismissed for this visit. */
  const [tourneyBannerDismissed, setTourneyBannerDismissed] = useState(false);
  /** Boards whose finished-room reconcile already submitted (or confirmed already). */
  const reconcileAttemptedRef = useRef<Set<string>>(new Set());
  /** uid → avatarId from users/{uid}/profile when TournamentPlayer.avatarId is missing. */
  const [avatarCache, setAvatarCache] = useState<Record<string, string | null>>({});
  const avatarFetchAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return subscribeTournament(tournamentId, setDoc);
  }, [tournamentId]);

  // Reset avatar backfill when switching tournaments.
  useEffect(() => {
    setAvatarCache({});
    avatarFetchAttemptedRef.current = new Set();
  }, [tournamentId]);

  // Backfill thumbs for humans already seated without avatarId (no re-join needed).
  useEffect(() => {
    if (!doc?.players) return;
    const missing: string[] = [];
    for (const p of Object.values(doc.players)) {
      if (!p?.userId || !p.approved) continue;
      if (isAiTournamentPlayer(p)) continue;
      if ((p.avatarId ?? '').trim()) continue;
      if (avatarFetchAttemptedRef.current.has(p.userId)) continue;
      missing.push(p.userId);
    }
    if (missing.length === 0) return;
    for (const uid of missing) avatarFetchAttemptedRef.current.add(uid);
    let cancelled = false;
    void Promise.all(
      missing.map(async (uid) => {
        const id = await fetchCloudAvatarId(uid);
        return [uid, id] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      setAvatarCache((prev) => {
        const next = { ...prev };
        for (const [uid, id] of rows) next[uid] = id;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [doc?.players]);

  /** Stable key of pending boards-with-rooms — avoid refetch on every standings tick. */
  const pendingReconcileKey = useMemo(() => {
    if (!doc || doc.meta.status !== 'live') return '';
    const roundNum = doc.meta.currentRound;
    const round = roundNum > 0 ? doc.rounds[String(roundNum)] : null;
    if (!round || (round.status !== 'live' && round.status !== 'complete')) return '';
    return round.pairings
      .filter((p) => p.result === 'pending' && !!p.matchRoomCode)
      .map((p) => `${roundNum}:${p.board}:${p.matchRoomCode}`)
      .sort()
      .join('|');
  }, [doc]);

  // Safety net: pending pairing with matchRoomCode already gameOver → submitResult.
  // Heals refresh/rejoin paths that skipped App tournament submit.
  useEffect(() => {
    if (!authUser?.uid || !doc || !pendingReconcileKey) return;
    if (doc.meta.status !== 'live') return;
    const roundNum = doc.meta.currentRound;
    const round = roundNum > 0 ? doc.rounds[String(roundNum)] : null;
    if (!round || (round.status !== 'live' && round.status !== 'complete')) return;

    const uid = authUser.uid;
    const hostOk =
      isOwner(authUser) || uid === doc.meta.hostUserId;

    const run = () => {
      for (const pairing of round.pairings) {
        if (pairing.result !== 'pending' || !pairing.matchRoomCode) continue;
        const isParticipant =
          uid === pairing.playerAId || uid === pairing.playerBId;
        if (!isParticipant && !hostOk) continue;
        const key = `${roundNum}-${pairing.board}-${pairing.matchRoomCode}`;
        if (reconcileAttemptedRef.current.has(key)) continue;
        reconcileAttemptedRef.current.add(key);
        void reconcileFinishedMatchRoom(
          authUser,
          tournamentId,
          roundNum,
          pairing.board,
          pairing.matchRoomCode,
        )
          .then((result) => {
            // Still playing — allow a later poll to retry.
            if (result === 'skipped') {
              reconcileAttemptedRef.current.delete(key);
            }
          })
          .catch((e) => {
            reconcileAttemptedRef.current.delete(key);
            console.warn('Reconcile finished match failed', e);
          });
      }
    };
    run();
    const id = window.setInterval(run, 15_000);
    return () => window.clearInterval(id);
  }, [authUser, tournamentId, pendingReconcileKey]);

  // Tick countdown every second while a live round has a deadline.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // On load + every 20s: apply expired deadline forfeits (idempotent).
  useEffect(() => {
    if (!authUser?.uid || !doc) return;
    if (doc.meta.status !== 'live') return;
    const uid = authUser.uid;
    const canTrigger =
      isOwner(authUser) ||
      uid === doc.meta.hostUserId ||
      (!!doc.players[uid]?.approved && !doc.players[uid]?.dropped);
    if (!canTrigger) return;

    let cancelled = false;
    const run = () => {
      void applyDeadlineForfeits(authUser, tournamentId).catch(() => {
        /* ignore transient; next poll retries */
      });
    };
    run();
    const id = window.setInterval(run, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      void cancelled;
    };
  }, [authUser, tournamentId, doc?.meta.status, doc?.meta.hostUserId]);

  const standings = useMemo(() => (doc ? computeStandings(doc) : []), [doc]);
  const meta = doc?.meta;
  const currentRoundNum = meta?.currentRound ?? 0;
  const roundNum = browseRound ?? currentRoundNum;
  const round = doc && roundNum > 0 ? doc.rounds[String(roundNum)] : null;
  const viewingHistory = browseRound !== null && browseRound !== currentRoundNum;
  const hostOk =
    !!authUser &&
    !!meta &&
    (isOwner(authUser) || authUser.uid === meta.hostUserId);
  const rrDone = !!doc && isRoundRobinComplete(doc);
  /** Bracket exists and RR is finished — only then expose Playoffs UI. */
  const playoffsAvailable = rrDone && !!doc?.playoffs;
  /** Top 2 advance: bracket starts with Final only (no semis/quarters). */
  const playoffsHasQuarters = Object.keys(doc?.playoffs?.series ?? {}).some((id) =>
    id.startsWith('qf-'),
  );
  const playoffsHasSemis = Object.keys(doc?.playoffs?.series ?? {}).some((id) =>
    id.startsWith('sf-'),
  );
  const playoffsFinalOnly =
    !!doc?.playoffs?.series['final'] && !playoffsHasSemis && !playoffsHasQuarters;
  const playoffAdvance =
    doc?.meta.playoffAdvanceCount === 2 ||
    doc?.meta.playoffAdvanceCount === 6 ||
    doc?.meta.playoffAdvanceCount === 8
      ? doc.meta.playoffAdvanceCount
      : 4;
  /** Playoffs are a separate stage — RR boards stay read-only once they start. */
  const inPlayoffs = playoffsAvailable;
  const isActiveRound =
    !playoffsAvailable && !viewingHistory && roundNum === currentRoundNum;

  // Keep browse in range when the live round advances.
  useEffect(() => {
    if (browseRound === null) return;
    if (browseRound < 1 || browseRound > currentRoundNum) {
      setBrowseRound(null);
    }
  }, [browseRound, currentRoundNum]);

  // Only jump to Playoffs after RR is done and the bracket exists.
  useEffect(() => {
    if (rrDone && doc?.playoffs) setViewStage('playoffs');
    else setViewStage('rr');
  }, [rrDone, doc?.playoffs?.status]);

  // Default playoff sub-tab to the active bracket stage.
  useEffect(() => {
    const st = doc?.playoffs?.status;
    if (!st) return;
    if (st === 'quarters') setPlayoffStageView('quarters');
    else if (st === 'semis') setPlayoffStageView('semis');
    else setPlayoffStageView('final'); // final | complete
  }, [doc?.playoffs?.status]);

  const remainMs = remainingLockInMs(
    isActiveRound ? round?.deadlineAt : undefined,
    nowMs,
  );
  const activeLiveRound =
    isActiveRound && !!round && round.status === 'live';
  const lockLabel =
    activeLiveRound && round.deadlineAt
      ? remainMs > 0
        ? `Lock in within ${formatLockInCountdown(remainMs)}`
        : 'Time expired — applying forfeits…'
      : null;
  const roundTimerLabel = activeLiveRound
    ? lockLabel ?? 'Round timer · not started'
    : null;

  const tourneyDurationMin =
    typeof meta?.tournamentDurationMin === 'number' && meta.tournamentDurationMin > 0
      ? meta.tournamentDurationMin
      : 0;
  const tourneyStartedAt = doc?.rounds['1']?.roundStartedAt;
  const tourneyEndsAt =
    tourneyDurationMin > 0 && typeof tourneyStartedAt === 'number'
      ? tourneyStartedAt + tourneyDurationMin * 60 * 1000
      : null;
  const tourneyRemainMs =
    tourneyEndsAt != null ? Math.max(0, tourneyEndsAt - nowMs) : 0;
  const tourneyExpired =
    tourneyEndsAt != null &&
    nowMs >= tourneyEndsAt &&
    meta?.status === 'live';
  const tourneyTimerLabel =
    tourneyEndsAt == null || meta?.status !== 'live'
      ? null
      : tourneyExpired
        ? 'Tournament timer expired — host: finish or lock remaining boards'
        : `Event timer · ${formatLockInCountdown(tourneyRemainMs)} left`;

  const myUid = authUser?.uid ?? null;

  const podium = useMemo(() => {
    if (!doc?.playoffs) return null;
    const playoffsDone = doc.playoffs.status === 'complete';
    const metaDone =
      doc.meta.status === 'complete' || doc.meta.phase === 'complete';
    if (!playoffsDone && !metaDone) return null;
    return playoffPodium(
      doc.playoffs,
      standings.map((s) => s.userId),
    );
  }, [doc?.playoffs, doc?.meta.status, doc?.meta.phase, standings]);

  const showTourneyResults =
    !!podium &&
    (doc?.playoffs?.status === 'complete' ||
      meta?.status === 'complete' ||
      meta?.phase === 'complete');

  const myPodiumPlace = podium && myUid
    ? podium.firstId === myUid
      ? 1
      : podium.secondId === myUid
        ? 2
        : podium.thirdId === myUid
          ? 3
          : podium.fourthId === myUid
            ? 4
            : null
    : null;

  const showCongratsBanner =
    showTourneyResults &&
    !tourneyBannerDismissed &&
    (myPodiumPlace === 1 || myPodiumPlace === 2 || myPodiumPlace === 3);

  // One-time repair: recompute RR pts/skunks with current SuperCrib lines.
  useEffect(() => {
    if (!authUser || !doc || !hostOk) return;
    if (doc.meta.status !== 'live' && doc.meta.status !== 'complete') return;
    if ((doc.meta.scoringVersion ?? 1) >= CURRENT_SCORING_VERSION) return;
    void recalculateRrStats(authUser, tournamentId).catch(() => {
      /* ignore; host can retry */
    });
  }, [
    authUser,
    tournamentId,
    doc?.meta.status,
    doc?.meta.scoringVersion,
    hostOk,
  ]);

  // Close board admin sheet if that pairing disappears.
  useEffect(() => {
    if (adminBoard === null || !round) return;
    if (!round.pairings.some((p) => p.board === adminBoard)) {
      setAdminBoard(null);
    }
  }, [adminBoard, round]);

  const nameOf = (uid: string | null) => {
    if (!uid) return 'BYE';
    const p = doc?.players[uid];
    const base = p?.displayName ?? uid.slice(0, 6);
    return isAiTournamentPlayer(p) ? `${base} (AI)` : base;
  };

  const playerThumb = (uid: string | null) => {
    if (!uid) return null;
    const p = doc?.players[uid];
    const displayName = p?.displayName ?? nameOf(uid);
    const avatarId = resolveAvatarId(p, avatarCache) ?? '';
    return (
      <span className="tl-avatar-thumb" aria-hidden="true">
        <AvatarView
          profile={{ displayName, avatarId, avatarDataUrl: null }}
          size="sm"
          className="tl-avatar-thumb-inner"
        />
      </span>
    );
  };

  const nameWithThumb = (uid: string | null) => (
    <span className="tl-name">
      {playerThumb(uid)}
      <span className="tl-name-text">{nameOf(uid)}</span>
    </span>
  );

  const draftKey = (board: number) => `${roundNum}-${board}`;

  const isMyBoard = (p: TournamentPairing) =>
    !!myUid && (myUid === p.playerAId || myUid === p.playerBId);

  const adminPairing =
    adminBoard !== null && round
      ? round.pairings.find((p) => p.board === adminBoard) ?? null
      : null;

  const adminPlayoffSeries =
    adminPlayoffSeriesId !== null && doc?.playoffs
      ? doc.playoffs.series[adminPlayoffSeriesId] ?? null
      : null;

  // Close playoff admin sheet if that series disappears or completes without pending games.
  useEffect(() => {
    if (adminPlayoffSeriesId === null || !doc?.playoffs) return;
    const s = doc.playoffs.series[adminPlayoffSeriesId];
    if (!s) {
      setAdminPlayoffSeriesId(null);
      return;
    }
    if (s.status === 'complete' && nextPendingGameIndex(s) === null) {
      /* keep open so host can see Done; no auto-close required */
    }
  }, [adminPlayoffSeriesId, doc?.playoffs]);

  const playoffDraftKey = (seriesId: string, gameIndex: number) =>
    `po-${seriesId}-${gameIndex}`;

  const onSubmitPlayoffScores = async (
    series: PlayoffSeries,
    gameIndex: number,
    forfeit?: 'a' | 'b',
  ) => {
    if (!authUser) return;
    setBusy(true);
    setError(null);
    try {
      let scoreA: number;
      let scoreB: number;
      if (forfeit === 'a') {
        scoreA = 121;
        scoreB = 0;
      } else if (forfeit === 'b') {
        scoreA = 0;
        scoreB = 121;
      } else {
        const d = scoreDraft[playoffDraftKey(series.id, gameIndex)] ?? { a: '', b: '' };
        scoreA = Number(d.a);
        scoreB = Number(d.b);
        if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
          throw new Error('Enter both scores');
        }
      }
      await submitPlayoffGame(authUser, tournamentId, series.id, gameIndex, scoreA, scoreB);
      setAdminPlayoffSeriesId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const onResolveAiPlayoff = async (series: PlayoffSeries, random = false) => {
    if (!authUser || !hostOk) return;
    setBusy(true);
    setError(null);
    try {
      await resolveAiPlayoffGame(authUser, tournamentId, series.id, { random });
      setAdminPlayoffSeriesId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve AI failed');
    } finally {
      setBusy(false);
    }
  };

  const onPlayPlayoffAi = (series: PlayoffSeries, gameIndex: number) => {
    if (!authUser || !doc || !onPlayAiBoard) return;
    const humanIsA = series.playerAId === authUser.uid;
    const aiId = humanIsA ? series.playerBId : series.playerAId;
    const aiName = doc.players[aiId]?.displayName || 'AI';
    onPlayAiBoard({
      kind: 'playoff',
      tournamentId,
      seriesId: series.id,
      gameIndex,
      humanIsA,
      aiDisplayName: aiName,
    });
  };

  /** Participant Join: human playoff games share one stored room, just like RR boards. */
  const onJoinPlayoffMatch = async (series: PlayoffSeries, gameIndex: number) => {
    if (!authUser || !doc || !myUid) return;
    if (series.playerAId !== myUid && series.playerBId !== myUid) return;
    const game = series.games.find((g) => g.gameIndex === gameIndex);
    if (!game || game.result !== 'pending') return;
    setBusy(true);
    setError(null);
    try {
      const humanIsA = series.playerAId === authUser.uid;
      const preferredSeat: 0 | 1 = humanIsA ? 0 : 1;
      const tourneyName =
        (doc.players[authUser.uid]?.displayName || '').trim() ||
        (authUser.displayName || '').trim() ||
        'Player';
      let code = await ensureFreshPlayoffGameRoom(
        authUser,
        tournamentId,
        series.id,
        gameIndex,
      );
      const opponentId = humanIsA ? series.playerBId : series.playerAId;
      const opponentName =
        (doc.players[opponentId]?.displayName || '').trim() || 'your opponent';
      const onlineLaunch: TournamentOnlineBoardLaunch = {
        kind: 'playoff',
        tournamentId,
        seriesId: series.id,
        gameIndex,
        humanIsA,
        opponentName,
      };
      const openOpts = {
        seat: preferredSeat,
        displayName: tourneyName,
        onlineLaunch,
      };
      if (!onOpenRoom) {
        throw new Error('Open the live board in the app to play — no codes needed.');
      }
      try {
        await onOpenRoom(code, openOpts);
      } catch (joinErr) {
        const msg = joinErr instanceof Error ? joinErr.message : String(joinErr ?? '');
        if (!/room is full/i.test(msg)) throw joinErr;
        // Reclaim a prior seat when possible; only fork an abandoned room.
        let room = null;
        try {
          room = await fetchRoom(code);
        } catch {
          room = null;
        }
        if (isMatchRoomStuck(room)) {
          code = await resetPlayoffGameRoom(authUser, tournamentId, series.id, gameIndex);
          await onOpenRoom(code, openOpts);
        } else if (room) {
          const seat0 = readRoomSeat(room.seats, 0);
          const seat1 = readRoomSeat(room.seats, 1);
          let reclaimSeat: 0 | 1 | null = null;
          if (seat0?.name === tourneyName || room.hostName === tourneyName) reclaimSeat = 0;
          else if (seat1?.name === tourneyName || room.guestName === tourneyName) reclaimSeat = 1;
          if (reclaimSeat !== null) {
            await onOpenRoom(code, { ...openOpts, seat: reclaimSeat });
          } else {
            throw new Error(
              'Table is occupied — wait for your opponent or ask the host to Reset stuck table.',
            );
          }
        } else {
          code = await resetPlayoffGameRoom(authUser, tournamentId, series.id, gameIndex);
          await onOpenRoom(code, openOpts);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Join failed');
    } finally {
      setBusy(false);
    }
  };

  const onResetPlayoffTable = async (series: PlayoffSeries, gameIndex: number) => {
    if (!authUser || !hostOk) return;
    setBusy(true);
    setError(null);
    try {
      await resetPlayoffGameRoom(authUser, tournamentId, series.id, gameIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset table failed');
    } finally {
      setBusy(false);
    }
  };

  const updatePlayoffDraft = (seriesId: string, gameIndex: number, side: 'a' | 'b', value: string) => {
    const key = playoffDraftKey(seriesId, gameIndex);
    setScoreDraft((s) => {
      const cur = s[key] ?? { a: '', b: '' };
      return { ...s, [key]: { ...cur, [side]: value } };
    });
  };

  const onSubmitBoard = async (pairing: TournamentPairing, forfeit?: 'a' | 'b') => {
    if (!authUser || !meta) return;
    setBusy(true);
    setError(null);
    try {
      if (forfeit) {
        await hostOverride(authUser, tournamentId, roundNum, pairing.board, {
          scoreA: 0,
          scoreB: 0,
          forfeitWinner: forfeit,
        });
      } else {
        const d = scoreDraft[draftKey(pairing.board)] ?? { a: '', b: '' };
        const scoreA = Number(d.a);
        const scoreB = Number(d.b);
        if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
          throw new Error('Enter both scores');
        }
        if (hostOk) {
          await hostOverride(authUser, tournamentId, roundNum, pairing.board, {
            scoreA,
            scoreB,
          });
        } else {
          await submitResult(authUser, tournamentId, roundNum, pairing.board, scoreA, scoreB);
        }
      }
      setAdminBoard(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  /** Participant Join: AI boards → local AI; human boards → online room. */
  const onJoinMatch = async (pairing: TournamentPairing) => {
    if (!authUser || !isMyBoard(pairing) || !doc) return;
    setBusy(true);
    setError(null);
    try {
      const hasAi = pairingInvolvesAi(doc.players, pairing);
      const aiOnly = pairingIsAiOnly(doc.players, pairing);
      if (hasAi && !aiOnly && onPlayAiBoard) {
        const humanIsA = pairing.playerAId === authUser.uid;
        const aiId = humanIsA ? pairing.playerBId : pairing.playerAId;
        const aiName =
          (aiId && doc.players[aiId]?.displayName) || 'AI';
        onPlayAiBoard({
          tournamentId,
          roundNumber: roundNum,
          board: pairing.board,
          humanIsA,
          aiDisplayName: aiName,
        });
        return;
      }
      const humanIsA = pairing.playerAId === authUser.uid;
      const preferredSeat: 0 | 1 = humanIsA ? 0 : 1;
      const tourneyName =
        (doc.players[authUser.uid]?.displayName || '').trim() ||
        (authUser.displayName || '').trim() ||
        'Player';
      // Create if missing; auto-reset only when stuck (never while a seat is live).
      let code = await ensureFreshMatchRoom(
        authUser,
        tournamentId,
        roundNum,
        pairing.board,
      );
      const oppId = humanIsA ? pairing.playerBId : pairing.playerAId;
      const opponentName =
        (oppId && doc.players[oppId]?.displayName)?.trim() || 'your opponent';
      const onlineLaunch: TournamentOnlineBoardLaunch = {
        tournamentId,
        roundNumber: roundNum,
        board: pairing.board,
        humanIsA,
        opponentName,
      };
      const openOpts = {
        seat: preferredSeat,
        displayName: tourneyName,
        onlineLaunch,
      };
      if (!onOpenRoom) {
        throw new Error('Open the live board in the app to play — no codes needed.');
      }
      try {
        await onOpenRoom(code, openOpts);
      } catch (joinErr) {
        const msg =
          joinErr instanceof Error ? joinErr.message : String(joinErr ?? '');
        if (/room is full/i.test(msg)) {
          // Do NOT immediately reset — that forks mid-live tables.
          // Prefer reclaim by tournament displayName + preferred seat; reset
          // only when the room is truly abandoned (or host uses Reset stuck table).
          let room = null;
          try {
            room = await fetchRoom(code);
          } catch {
            room = null;
          }
          if (isMatchRoomStuck(room)) {
            code = await resetMatchRoom(
              authUser,
              tournamentId,
              roundNum,
              pairing.board,
            );
            await onOpenRoom(code, openOpts);
          } else if (room) {
            const seat0 = readRoomSeat(room.seats, 0);
            const seat1 = readRoomSeat(room.seats, 1);
            let reclaimSeat: 0 | 1 | null = null;
            if (seat0?.name === tourneyName || room.hostName === tourneyName) {
              reclaimSeat = 0;
            } else if (seat1?.name === tourneyName || room.guestName === tourneyName) {
              reclaimSeat = 1;
            }
            if (reclaimSeat !== null) {
              await onOpenRoom(code, { ...openOpts, seat: reclaimSeat });
            } else {
              throw new Error(
                'Table is occupied — wait for your opponent or ask the host to Reset stuck table.',
              );
            }
          } else {
            code = await resetMatchRoom(
              authUser,
              tournamentId,
              roundNum,
              pairing.board,
            );
            await onOpenRoom(code, openOpts);
          }
        } else {
          throw joinErr;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Join failed');
    } finally {
      setBusy(false);
    }
  };

  /** Host may pre-create a room without joining (player A is always room host). */
  /** Host: wipe stuck table so both players can tap Play game again (no codes). */
  const onResetTable = async (pairing: TournamentPairing) => {
    if (!authUser || !hostOk) return;
    setBusy(true);
    setError(null);
    try {
      await resetMatchRoom(authUser, tournamentId, roundNum, pairing.board);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset table failed');
    } finally {
      setBusy(false);
    }
  };

  const onResolveAi = async (pairing: TournamentPairing, random = false) => {
    if (!authUser || !hostOk) return;
    setBusy(true);
    setError(null);
    try {
      await resolveAiBoard(authUser, tournamentId, roundNum, pairing.board, {
        random,
      });
      setAdminBoard(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve AI failed');
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (board: number, side: 'a' | 'b', value: string) => {
    const key = draftKey(board);
    setScoreDraft((s) => {
      const cur = s[key] ?? { a: '', b: '' };
      return { ...s, [key]: { ...cur, [side]: value } };
    });
  };

  if (!meta) {
    return (
      <div className="home tournament-screen">
        <p>Loading…</p>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const renderBoardAdminSheet = (p: TournamentPairing) => {
    const key = draftKey(p.board);
    const draft = scoreDraft[key] ?? { a: '', b: '' };
    const bye = p.result === 'bye' || !p.playerBId || !p.playerAId;
    const hasAi = !!doc && pairingInvolvesAi(doc.players, p);
    const aiOnly = !!doc && pairingIsAiOnly(doc.players, p);
    const pending = p.result === 'pending' && !bye;

    return (
      <div
        className="tl-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Board ${p.board} admin`}
        onClick={() => setAdminBoard(null)}
      >
        <div
          className="tl-sheet overlay-card"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tl-sheet-header">
            <h2>Board {p.board}</h2>
            <button
              type="button"
              className="tl-sheet-close"
              aria-label="Close"
              onClick={() => setAdminBoard(null)}
            >
              ×
            </button>
          </div>
          <p className="tl-sheet-matchup">
            {nameOf(p.playerAId)} vs {nameOf(p.playerBId)}
          </p>
          <p className="record-note">
            {boardStatusLabel(p)}
            {p.matchRoomCode ? ` · room ${p.matchRoomCode}` : ''}
          </p>

          {pending && (
            <>
              <p className="section-label">Scores</p>
              <div className="tl-score-row">
                <label className="tl-score-field">
                  <span>A</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.a}
                    onChange={(e) => updateDraft(p.board, 'a', e.target.value)}
                  />
                </label>
                <label className="tl-score-field">
                  <span>B</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.b}
                    onChange={(e) => updateDraft(p.board, 'b', e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void onSubmitBoard(p)}
              >
                Lock in scores
              </button>

              {!aiOnly && (
                <button type="button" disabled={busy} onClick={() => void onResetTable(p)}>
                  {p.matchRoomCode ? 'Reset stuck table' : 'Prep table'}
                </button>
              )}
              <p className="find-match-hint">
                Players each tap Play game on this board — no room codes.
              </p>

              <p className="section-label">Forfeit</p>
              <div className="tl-sheet-actions">
                <button type="button" disabled={busy} onClick={() => void onSubmitBoard(p, 'a')}>
                  Forfeit → A
                </button>
                <button type="button" disabled={busy} onClick={() => void onSubmitBoard(p, 'b')}>
                  Forfeit → B
                </button>
              </div>

              {hasAi && (
                <>
                  <p className="section-label">AI</p>
                  <div className="tl-sheet-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void onResolveAi(p, false)}
                      title="Submit fixed 241–200 for quick testing"
                    >
                      Resolve AI board
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onResolveAi(p, true)}
                      title="Random non-skunk scores"
                    >
                      Resolve AI (random)
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {!pending && p.result !== 'bye' && (
            <>
              <p className="record-note">
                Result {p.result} · {p.scoreA}–{p.scoreB} · Pts {p.gamePointsA}–{p.gamePointsB}
              </p>
              <p className="section-label">Host override</p>
              <div className="tl-score-row">
                <label className="tl-score-field">
                  <span>A</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.a}
                    onChange={(e) => updateDraft(p.board, 'a', e.target.value)}
                  />
                </label>
                <label className="tl-score-field">
                  <span>B</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.b}
                    onChange={(e) => updateDraft(p.board, 'b', e.target.value)}
                  />
                </label>
              </div>
              <button type="button" disabled={busy} onClick={() => void onSubmitBoard(p)}>
                Host override
              </button>
            </>
          )}

          {bye && <p className="record-note">BYE (0 pts) — no admin actions.</p>}
        </div>
      </div>
    );
  };

  const renderPlayoffAdminSheet = (series: PlayoffSeries) => {
    const pendingIdx = nextPendingGameIndex(series);
    const gameIndex = pendingIdx ?? series.games.find((g) => g.result === 'pending')?.gameIndex ?? 1;
    const key = playoffDraftKey(series.id, gameIndex);
    const draft = scoreDraft[key] ?? { a: '', b: '' };
    const aIsAi = !!doc && isAiTournamentPlayer(doc.players[series.playerAId]);
    const bIsAi = !!doc && isAiTournamentPlayer(doc.players[series.playerBId]);
    const hasAi = aIsAi || bIsAi;
    const pending = series.status !== 'complete' && pendingIdx !== null;
    const pendingGame = pendingIdx !== null
      ? series.games.find((g) => g.gameIndex === pendingIdx) ?? null
      : null;

    return (
      <div
        className="tl-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`${series.label} admin`}
        onClick={() => setAdminPlayoffSeriesId(null)}
      >
        <div
          className="tl-sheet overlay-card"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tl-sheet-header">
            <h2>{series.label}</h2>
            <button
              type="button"
              className="tl-sheet-close"
              aria-label="Close"
              onClick={() => setAdminPlayoffSeriesId(null)}
            >
              ×
            </button>
          </div>
          <p className="tl-sheet-matchup">
            {nameOf(series.playerAId)} vs {nameOf(series.playerBId)}
          </p>
          <p className="record-note">
            Series {series.winsA}–{series.winsB}
            {pending ? ` · Game ${gameIndex}` : series.winnerId ? ` · ${nameOf(series.winnerId)} wins` : ''}
            {pendingGame?.matchRoomCode ? ` · room ${pendingGame.matchRoomCode}` : ''}
          </p>

          {pending && (
            <>
              <p className="section-label">Scores</p>
              <div className="tl-score-row">
                <label className="tl-score-field">
                  <span>A</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.a}
                    onChange={(e) =>
                      updatePlayoffDraft(series.id, gameIndex, 'a', e.target.value)
                    }
                  />
                </label>
                <label className="tl-score-field">
                  <span>B</span>
                  <input
                    inputMode="numeric"
                    placeholder="0"
                    value={draft.b}
                    onChange={(e) =>
                      updatePlayoffDraft(series.id, gameIndex, 'b', e.target.value)
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void onSubmitPlayoffScores(series, gameIndex)}
              >
                Lock in scores
              </button>

              {!hasAi && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onResetPlayoffTable(series, gameIndex)}
                >
                  {pendingGame?.matchRoomCode ? 'Reset stuck table' : 'Prep table'}
                </button>
              )}
              <p className="find-match-hint">
                Players each tap Play game on this game — no room codes.
              </p>

              <p className="section-label">Forfeit</p>
              <div className="tl-sheet-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubmitPlayoffScores(series, gameIndex, 'a')}
                >
                  Forfeit → A
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubmitPlayoffScores(series, gameIndex, 'b')}
                >
                  Forfeit → B
                </button>
              </div>

              {hasAi && (
                <>
                  <p className="section-label">AI</p>
                  <div className="tl-sheet-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void onResolveAiPlayoff(series, false)}
                      title="Submit fixed 241–200 for quick testing"
                    >
                      Resolve AI game
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onResolveAiPlayoff(series, true)}
                      title="Random non-skunk scores"
                    >
                      Random
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {!pending && (
            <p className="record-note">
              Series complete
              {series.winnerId ? ` · ${nameOf(series.winnerId)} wins` : ''}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderRoundAdminSheet = () => (
    <div
      className="tl-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Round admin"
      onClick={() => setRoundAdminOpen(false)}
    >
      <div className="tl-sheet overlay-card" onClick={(e) => e.stopPropagation()}>
        <div className="tl-sheet-header">
          <h2>Round controls</h2>
          <button
            type="button"
            className="tl-sheet-close"
            aria-label="Close"
            onClick={() => setRoundAdminOpen(false)}
          >
            ×
          </button>
        </div>

        {meta.status === 'live' && roundNum === 0 && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void startRound(authUser, tournamentId, 1)
                .catch((e) => setError(e instanceof Error ? e.message : 'Start round failed'))
                .finally(() => {
                  setBusy(false);
                  setRoundAdminOpen(false);
                });
            }}
          >
            Start round 1
          </button>
        )}

        {meta.status === 'live' && roundNum > 0 && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void nextRound(authUser, tournamentId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Next round failed'))
                .finally(() => {
                  setBusy(false);
                  setRoundAdminOpen(false);
                });
            }}
          >
            Next round / complete
          </button>
        )}

        {meta.status === 'live' && roundNum >= meta.totalRounds && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void completeTournament(authUser, tournamentId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Complete failed'))
                .finally(() => {
                  setBusy(false);
                  setRoundAdminOpen(false);
                });
            }}
          >
            Force complete & write profiles
          </button>
        )}

        {meta.status !== 'live' && (
          <p className="record-note">Tournament is {meta.status}.</p>
        )}
      </div>
    </div>
  );

  const prizeAvatar = getTournamentPrizeAvatar(meta.prizeFirstAvatarId);

  return (
    <div className="home tournament-screen">
      <div className="tl-title-with-prize">
        <h1 className="title">{meta.name}</h1>
        {prizeAvatar && (
          <button
            type="button"
            className="tl-title-prize"
            onClick={() => {
              if (prizeAvatar.imageSrc) setPrizePreviewOpen(true);
            }}
            aria-label={`1st place prize: ${prizeAvatar.label}`}
          >
            {prizeAvatar.imageSrc ? (
              <img
                src={prizeAvatar.imageSrc}
                alt=""
                width={44}
                height={44}
                className="tl-title-prize-img"
              />
            ) : (
              <span className="tl-title-prize-glyph" aria-hidden>
                {prizeAvatar.glyph ?? '🏆'}
              </span>
            )}
            <span className="tl-title-prize-label">
              <span className="tl-title-prize-kicker">1st prize</span>
              {prizeAvatar.label}
            </span>
          </button>
        )}
      </div>
      <p className="subtitle">
        {meta.status === 'complete'
          ? 'Final standings'
          : inPlayoffs && viewStage === 'playoffs'
            ? `Playoffs · ${playoffStageView === 'quarters' ? (playoffAdvance === 6 ? 'Play-in' : 'Quarters') : playoffStageView === 'semis' ? 'Semifinals' : 'Final'}`
            : currentRoundNum > 0
              ? viewingHistory
                ? `Round Robin · viewing R${roundNum} (live R${currentRoundNum} of ${meta.totalRounds})`
                : `Round Robin · Round ${currentRoundNum} of ${meta.totalRounds}`
              : 'Round Robin · pairings ready'}
      </p>

      {playoffsAvailable && (
        <div className="tl-stage-tabs" role="tablist" aria-label="Tournament stage">
          <button
            type="button"
            role="tab"
            className={`tl-stage-tab${viewStage === 'rr' ? ' active' : ''}`}
            aria-selected={viewStage === 'rr'}
            onClick={() => setViewStage('rr')}
          >
            Round Robin
          </button>
          <button
            type="button"
            role="tab"
            className={`tl-stage-tab${viewStage === 'playoffs' ? ' active' : ''}`}
            aria-selected={viewStage === 'playoffs'}
            onClick={() => setViewStage('playoffs')}
          >
            Playoffs
          </button>
        </div>
      )}

      {roundTimerLabel && (
        <div className="tl-round-timer-row" role="status">
          <p className="tl-round-countdown">{roundTimerLabel}</p>
          {hostOk && (
            <button
              type="button"
              className="tl-round-timer-start"
              disabled={busy}
              onClick={() => {
                if (!authUser || !meta) return;
                setBusy(true);
                void startRoundTimer(authUser, tournamentId, currentRoundNum)
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : 'Start timer failed'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Start
            </button>
          )}
        </div>
      )}

      {tourneyTimerLabel && (
        <p
          className={`tl-tourney-countdown${tourneyExpired ? ' expired' : ''}`}
          role="status"
        >
          {tourneyTimerLabel}
        </p>
      )}

      {hostOk && meta.status === 'live' && roundNum === 0 && !round && (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            if (!authUser) return;
            void startRound(authUser, tournamentId, 1).catch((e) =>
              setError(e instanceof Error ? e.message : 'Start round failed'),
            );
          }}
        >
          Start round 1
        </button>
      )}

      {hostOk &&
        meta.status === 'live' &&
        !inPlayoffs &&
        !viewingHistory &&
        round &&
        round.status === 'complete' &&
        currentRoundNum > 0 &&
        currentRoundNum < meta.totalRounds && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void nextRound(authUser, tournamentId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Next round failed'))
                .finally(() => setBusy(false));
            }}
          >
            Start round {currentRoundNum + 1}
          </button>
        )}

      {hostOk &&
        meta.status === 'live' &&
        rrDone &&
        !doc?.playoffs &&
        !viewingHistory && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void startPlayoffs(authUser, tournamentId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Playoffs failed'))
                .finally(() => setBusy(false));
            }}
          >
            {doc?.meta.playoffAdvanceCount === 2
              ? 'Start playoffs (Bo3 · Top 2 Final)'
              : doc?.meta.playoffAdvanceCount === 8
                ? 'Start playoffs (Bo3 · Top 8 · Quarters)'
                : doc?.meta.playoffAdvanceCount === 6
                  ? 'Start playoffs (Bo3 · Top 6 · Play-in)'
                  : 'Start playoffs (Bo3 · Top 4 · 1v4 / 2v3)'}
          </button>
        )}

      {hostOk &&
        meta.status === 'live' &&
        viewStage === 'playoffs' &&
        doc?.playoffs?.status === 'complete' && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!authUser) return;
              setBusy(true);
              void completeTournament(authUser, tournamentId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Complete failed'))
                .finally(() => setBusy(false));
            }}
          >
            Finish tournament
          </button>
        )}

      {showTourneyResults && podium && (
        <div className="panel tl-podium" role="region" aria-label="Tournament results">
          <p className="tl-podium-title">
            <span className="tl-podium-trophy" aria-hidden="true">
              🏆
            </span>{' '}
            Tournament results
          </p>
          <ol className="tl-podium-list">
            <li className="tl-podium-row place-1">
              <span className="tl-podium-medal" aria-hidden="true">
                🥇
              </span>
              <span className="tl-podium-place">1st</span>
              <span className="tl-podium-name">{nameOf(podium.firstId)}</span>
            </li>
            <li className="tl-podium-row place-2">
              <span className="tl-podium-medal" aria-hidden="true">
                🥈
              </span>
              <span className="tl-podium-place">2nd</span>
              <span className="tl-podium-name">{nameOf(podium.secondId)}</span>
            </li>
            <li className="tl-podium-row place-3">
              <span className="tl-podium-medal" aria-hidden="true">
                🥉
              </span>
              <span className="tl-podium-place">3rd</span>
              <span className="tl-podium-name">{nameOf(podium.thirdId)}</span>
            </li>
          </ol>
        </div>
      )}

      {doc?.playoffs && viewStage === 'playoffs' && (
        <div className="panel tl-boards-panel tl-playoffs-panel" style={{ textAlign: 'left' }}>
          <p className="section-label tl-round-title">
            Playoffs ·{' '}
            {playoffsFinalOnly
              ? 'Final'
              : playoffStageView === 'quarters'
                ? playoffAdvance === 6
                  ? 'Play-in'
                  : 'Quarters'
                : playoffStageView === 'semis'
                  ? 'Semifinals'
                  : 'Final'}{' '}
            · Best of 3
          </p>
          <p className="record-note" style={{ marginTop: 0 }}>
            {playoffsFinalOnly
              ? 'Seeds from Round Robin standings · Top 2 Final (RR #1 vs #2)'
              : playoffsHasQuarters
                ? playoffAdvance === 6
                  ? 'Seeds from Round Robin standings · Play-in 3v6 / 4v5 (seeds 1–2 bye), then Semis, then Final'
                  : 'Seeds from Round Robin standings · Quarters 1v8 / 4v5 / 2v7 / 3v6, then Semis, then Final'
                : 'Seeds from Round Robin standings · 1v4 and 2v3, then Final'}
          </p>
          {!playoffsFinalOnly && (
            <div className="tl-stage-tabs tl-playoff-stage-tabs" role="tablist" aria-label="Playoff stage">
              {playoffsHasQuarters && (
                <button
                  type="button"
                  role="tab"
                  className={`tl-stage-tab${playoffStageView === 'quarters' ? ' active' : ''}`}
                  aria-selected={playoffStageView === 'quarters'}
                  onClick={() => setPlayoffStageView('quarters')}
                >
                  {playoffAdvance === 6 ? 'Play-in' : 'Quarters'}
                </button>
              )}
              {playoffsHasSemis || playoffAdvance !== 2 ? (
                <button
                  type="button"
                  role="tab"
                  className={`tl-stage-tab${playoffStageView === 'semis' ? ' active' : ''}`}
                  aria-selected={playoffStageView === 'semis'}
                  onClick={() => setPlayoffStageView('semis')}
                >
                  Semifinals
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                className={`tl-stage-tab${playoffStageView === 'final' ? ' active' : ''}`}
                aria-selected={playoffStageView === 'final'}
                onClick={() => setPlayoffStageView('final')}
              >
                Final
              </button>
            </div>
          )}
          {playoffsFinalOnly && (playoffStageView === 'semis' || playoffStageView === 'quarters') && (
            <p className="record-note" role="status">
              No semifinals (Top 2 advance)
            </p>
          )}
          {playoffStageView === 'semis' &&
            playoffsHasQuarters &&
            !playoffsHasSemis && (
            <p className="record-note" role="status">
              {playoffAdvance === 6
                ? 'Waiting for play-in series to finish…'
                : 'Waiting for all quarterfinals to finish…'}
            </p>
          )}
          {playoffStageView === 'final' && !doc.playoffs.series['final'] && (
            <p className="record-note" role="status">
              Waiting for both semifinals to finish…
            </p>
          )}
                    <p className="find-match-hint tl-boards-howto">
            Your board: tap <strong>Play game</strong>. Opponent does the same on their phone —
            you meet at the table automatically. No codes.
          </p>
<ul className="tl-board-list">
            {Object.values(doc.playoffs.series)
              .filter((s) => {
                if (playoffsFinalOnly || playoffStageView === 'final') {
                  return s.id === 'final';
                }
                if (playoffStageView === 'quarters') {
                  return s.id.startsWith('qf-');
                }
                // semis
                return s.id.startsWith('sf-');
              })
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((series) => {
                const pendingIdx = nextPendingGameIndex(series);
                const pendingGame = pendingIdx !== null
                  ? series.games.find((g) => g.gameIndex === pendingIdx) ?? null
                  : null;
                const aIsAi = isAiTournamentPlayer(doc.players[series.playerAId]);
                const bIsAi = isAiTournamentPlayer(doc.players[series.playerBId]);
                const hasAi = aIsAi || bIsAi;
                const aiOnly = aIsAi && bIsAi;
                const mine =
                  !!myUid &&
                  (myUid === series.playerAId || myUid === series.playerBId);
                const canPlayAi =
                  mine &&
                  hasAi &&
                  !aiOnly &&
                  series.status !== 'complete' &&
                  pendingIdx !== null &&
                  !!onPlayAiBoard;
                const canPlayOnline =
                  mine &&
                  !hasAi &&
                  series.status !== 'complete' &&
                  pendingIdx !== null &&
                  !!onOpenRoom;
                return (
                  <li
                    key={series.id}
                    className={`tl-board-card${mine ? ' tl-board-mine' : ''}`}
                  >
                    <div className="tl-board-top">
                      <span className="tl-board-num">{series.label}</span>
                      <span
                        className={`tl-status-chip tone-${
                          series.status === 'complete' ? 'done' : 'live'
                        }`}
                      >
                        {series.status === 'complete'
                          ? 'Done'
                          : `${series.winsA}–${series.winsB}`}
                      </span>
                      {hostOk && series.status !== 'complete' && pendingIdx !== null && (
                        <button
                          type="button"
                          className="tl-gear"
                          aria-label={`${series.label} admin`}
                          title="Series admin"
                          onClick={() => setAdminPlayoffSeriesId(series.id)}
                        >
                          ⚙
                        </button>
                      )}
                    </div>
                    <div className="tl-board-names">
                      {nameWithThumb(series.playerAId)}
                      <span className="tl-vs">vs</span>
                      {nameWithThumb(series.playerBId)}
                    </div>
                    <p className="tl-board-result record-note">
                      Series {series.winsA}–{series.winsB}
                      {series.winnerId
                        ? ` · ${nameOf(series.winnerId)} wins`
                        : pendingIdx
                          ? ` · Game ${pendingIdx}`
                          : ''}
                      {pendingGame?.matchRoomCode ? ` · table ready` : ''}
                    </p>
                    <ul className="record-note" style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                      {series.games.map((g) => (
                        <li key={g.gameIndex}>
                          G{g.gameIndex}:{' '}
                          {g.result === 'pending'
                            ? '—'
                            : `${g.scoreA}–${g.scoreB}`}
                        </li>
                      ))}
                    </ul>
                    <div className="tl-board-actions" style={{ marginTop: 8 }}>
                      {(canPlayAi || canPlayOnline) && pendingIdx !== null && (
                        <>
                          <button
                            type="button"
                            className="primary tl-join-btn"
                            disabled={busy}
                            onClick={() =>
                              canPlayAi
                                ? onPlayPlayoffAi(series, pendingIdx)
                                : void onJoinPlayoffMatch(series, pendingIdx)
                            }
                          >
                            {canPlayAi
                              ? 'Play game'
                              : pendingGame?.matchRoomCode
                                ? 'Join table'
                                : 'Play game'}
                          </button>
                          {canPlayOnline && (
                            <p className="find-match-hint tl-play-hint">
                              {pendingGame?.matchRoomCode
                                ? 'Table ready — opponent taps Play game too. No codes.'
                                : 'Both of you tap Play game here. No codes to send.'}
                            </p>
                          )}
                        </>
                      )}
                      {!mine &&
                        !!pendingGame?.matchRoomCode &&
                        series.status !== 'complete' &&
                        !!onWatchMatch && (
                          <button
                            type="button"
                            className="tl-view-btn"
                            disabled={busy}
                            title="Watch live — hole cards hidden until show"
                            onClick={() =>
                              onWatchMatch(pendingGame.matchRoomCode!, [
                                nameOf(series.playerAId),
                                nameOf(series.playerBId),
                              ])
                            }
                          >
                            Watch
                          </button>
                        )}
                      {!mine &&
                        !pendingGame?.matchRoomCode &&
                        series.status !== 'complete' &&
                        pendingIdx !== null &&
                        !hasAi && (
                          <span className="record-note">Waiting for players to tap Play</span>
                        )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {round && (!inPlayoffs || viewStage === 'rr') && (
        <div className="panel tl-boards-panel" style={{ textAlign: 'left' }}>
          <div className="tl-round-header">
            <p className="section-label tl-round-title">
              Round Robin · Round {roundNum} of {meta.totalRounds} ·{' '}
              {round.status.toUpperCase()}
              {viewingHistory ? ' · history' : ''}
            </p>
            {hostOk && isActiveRound && (
              <button
                type="button"
                className="tl-gear"
                aria-label="Round admin"
                title="Round admin"
                onClick={() => setRoundAdminOpen(true)}
              >
                ⚙
              </button>
            )}
          </div>

          <div className="tl-round-nav">
            <button
              type="button"
              className="tl-round-nav-btn"
              disabled={roundNum <= 1}
              onClick={() => {
                setAdminBoard(null);
                setBrowseRound(roundNum - 1);
              }}
            >
              Previous round
            </button>
            {viewingHistory && (
              <button
                type="button"
                className="tl-round-nav-btn primary"
                onClick={() => {
                  setAdminBoard(null);
                  setBrowseRound(null);
                }}
              >
                Current round
              </button>
            )}
            <button
              type="button"
              className="tl-round-nav-btn"
              disabled={roundNum >= currentRoundNum}
              onClick={() => {
                setAdminBoard(null);
                const next = roundNum + 1;
                setBrowseRound(next >= currentRoundNum ? null : next);
              }}
            >
              Next round
            </button>
          </div>

          <ul className="tl-board-list">
            {round.pairings
              .filter(
                (p) =>
                  p.result !== 'bye' && !!p.playerAId && !!p.playerBId,
              )
              .map((p) => {
              const mine = isMyBoard(p);
              const status = boardStatusLabel(p);
              const tone = boardStatusTone(p);
              const hasAi = !!doc && pairingInvolvesAi(doc.players, p);
              const aiOnly = !!doc && pairingIsAiOnly(doc.players, p);
              const resultLine =
                p.result !== 'pending' && p.result !== 'deadline'
                  ? `${p.scoreA}–${p.scoreB}`
                  : null;

              return (
                <li
                  key={p.board}
                  className={`tl-board-card${mine ? ' tl-board-mine' : ''}`}
                >
                  <div className="tl-board-top">
                    <span className="tl-board-num">Board {p.board}</span>
                    <span className={`tl-status-chip tone-${tone}`}>{status}</span>
                    {hostOk && isActiveRound && (
                      <button
                        type="button"
                        className="tl-gear"
                        aria-label={`Board ${p.board} admin`}
                        title="Board admin"
                        onClick={() => setAdminBoard(p.board)}
                      >
                        ⚙
                      </button>
                    )}
                  </div>

                  <div className="tl-board-names">
                    {nameWithThumb(p.playerAId)}
                    <span className="tl-vs">vs</span>
                    {nameWithThumb(p.playerBId)}
                  </div>

                  {resultLine && (
                    <p className="tl-board-result record-note">
                      {resultLine}
                      {p.result === 'deadline' ? '' : ` · Pts ${p.gamePointsA}–${p.gamePointsB}`}
                    </p>
                  )}
                  {p.result === 'deadline' && (
                    <p className="tl-board-result record-note">No result locked in (0 pts)</p>
                  )}

                  <div className="tl-board-actions">
                    {isActiveRound && mine && p.result === 'pending' && (
                      <button
                        type="button"
                        className="primary tl-join-btn"
                        disabled={busy}
                        onClick={() => void onJoinMatch(p)}
                      >
                        {hasAi
                          ? 'Play AI'
                          : p.matchRoomCode
                            ? 'Join table'
                            : 'Play game'}
                      </button>
                    )}
                    {isActiveRound && mine && p.result === 'pending' && !hasAi && (
                      <p className="find-match-hint tl-play-hint">
                        {p.matchRoomCode
                          ? 'Table ready — opponent taps Join / Play on their phone. No codes.'
                          : 'Both of you tap Play game here. No codes to send.'}
                      </p>
                    )}

                    {isActiveRound &&
                      !mine &&
                      p.matchRoomCode &&
                      p.result === 'pending' &&
                      !!onWatchMatch && (
                      <button
                        type="button"
                        className="tl-view-btn"
                        disabled={busy}
                        title="Watch live — hole cards hidden until show"
                        onClick={() =>
                          onWatchMatch(p.matchRoomCode!, [
                            nameOf(p.playerAId),
                            nameOf(p.playerBId),
                          ])
                        }
                      >
                        Watch
                      </button>
                    )}

                    {!mine && !p.matchRoomCode && p.result === 'pending' && !hasAi && (
                      <span className="record-note">Waiting for players to tap Play</span>
                    )}
                    {!mine && !p.matchRoomCode && p.result === 'pending' && aiOnly && (
                      <span className="record-note">AI board</span>
                    )}
                    {!mine &&
                      !p.matchRoomCode &&
                      p.result === 'pending' &&
                      hasAi &&
                      !aiOnly && (
                        <span className="record-note">AI opponent</span>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>

          {(() => {
            const byes = round.pairings.filter(
              (p) => p.result === 'bye' || !p.playerAId || !p.playerBId,
            );
            if (byes.length === 0) return null;
            return (
              <div className="tl-byes-section" style={{ marginTop: 10 }}>
                <p className="section-label" style={{ marginBottom: 4 }}>
                  Byes this round
                </p>
                <ul className="tl-bye-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {byes.map((p) => {
                    const who =
                      (p.playerAId && nameOf(p.playerAId)) ||
                      (p.playerBId && nameOf(p.playerBId)) ||
                      'Player';
                    return (
                      <li key={`bye-${p.board}`} className="record-note">
                        {who} · BYE
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
        </div>
      )}


      <div className="panel tl-standings-panel" style={{ textAlign: 'left' }}>
        <p className="section-label">Standings</p>
        <div className="tl-standings" role="table" aria-label="Standings">
          <div className="tl-standings-row tl-standings-head" role="row">
            <span className="tl-st-rank" role="columnheader">
              #
            </span>
            <span className="tl-st-player" role="columnheader">
              Player
            </span>
            <span className="tl-st-num" role="columnheader" title="Games played">
              G
            </span>
            <span
              className="tl-st-num"
              role="columnheader"
              title="Game points: 2 win, 3 skunk, 4 double-skunk"
            >
              Pts
            </span>
            <span className="tl-st-num tl-st-wl" role="columnheader">
              W–L
            </span>
            <span className="tl-st-num tl-st-skunks" role="columnheader">
              Skunks
            </span>
            <span className="tl-st-num tl-st-spread" role="columnheader">
              Spread
            </span>
          </div>
          {standings.map((r) => (
            <div className="tl-standings-row" role="row" key={r.userId}>
              <span className="tl-st-rank" role="cell">
                {r.place}
              </span>
              <span className="tl-st-player" role="cell">
                {playerThumb(r.userId)}
                <span className="tl-st-player-name">{r.displayName}</span>
              </span>
              <span className="tl-st-num" role="cell">
                {r.wins + r.losses}
              </span>
              <span className="tl-st-num" role="cell">
                {r.gamePoints}
              </span>
              <span className="tl-st-num tl-st-wl" role="cell">
                {r.wins}-{r.losses}
              </span>
              <span className="tl-st-num tl-st-skunks" role="cell">
                {r.skunksGiven}
              </span>
              <span className="tl-st-num tl-st-spread" role="cell">
                {r.spread > 0 ? '+' : ''}
                {r.spread}
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={onBack}>
        Back
      </button>

      {prizePreviewOpen && prizeAvatar?.imageSrc && (
        <AvatarPreviewModal
          src={prizeAvatar.imageSrc}
          label={prizeAvatar.label}
          onClose={() => setPrizePreviewOpen(false)}
        />
      )}

      {showCongratsBanner && (
        <div
          className="overlay tl-congrats-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            myPodiumPlace === 1
              ? 'Congratulations — you won the tournament'
              : myPodiumPlace === 2
                ? 'Nice run — 2nd place'
                : 'Nice run — 3rd place'
          }
          onClick={() => setTourneyBannerDismissed(true)}
        >
          <div
            className={`overlay-card game-over-card tl-congrats-card tone-${
              myPodiumPlace === 1 ? 'win' : 'lose'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="tl-congrats-close"
              aria-label="Dismiss"
              onClick={() => setTourneyBannerDismissed(true)}
            >
              ×
            </button>
            <div
              className={`game-over-banner tl-congrats-banner tone-${
                myPodiumPlace === 1 ? 'win' : 'lose'
              }`}
            >
              <p className="tl-congrats-emoji" aria-hidden="true">
                {myPodiumPlace === 1 ? '🏆' : myPodiumPlace === 2 ? '🥈' : '🥉'}
              </p>
              <p className="game-over-headline">
                {myPodiumPlace === 1
                  ? 'Congrats — you won the tournament!'
                  : myPodiumPlace === 2
                    ? 'Nice run — 2nd place'
                    : 'Nice run — 3rd place'}
              </p>
              {myPodiumPlace === 1 ? (
                <p className="game-over-sub">You are the tournament champion</p>
              ) : null}
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => setTourneyBannerDismissed(true)}
              >
                Awesome
              </button>
            </div>
          </div>
        </div>
      )}

      {hostOk && adminPairing && renderBoardAdminSheet(adminPairing)}
      {hostOk && adminPlayoffSeries && renderPlayoffAdminSheet(adminPlayoffSeries)}
      {hostOk && roundAdminOpen && renderRoundAdminSheet()}
    </div>
  );
}
