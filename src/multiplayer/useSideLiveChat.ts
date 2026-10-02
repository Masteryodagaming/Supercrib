/**
 * Opt-in side live voice chat (VAD) — lobby Connect voice, carry into table.
 * Session is held at module level (lobbyVoice) so Table remounts cannot kill the PC.
 * Separate from legacy table Hold-to-talk (VOICE_PTT_ENABLED).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeatRole } from './types';
import {
  clearVoiceSignaling,
  formatVoiceLinkDebug,
  publishSeatVoiceReady,
  shouldPublishVoiceReady,
  VOICE_SESSION_DEAD_MSG,
  type VoiceSessionStatus,
} from './voicePtt';
import { isSideLiveChatEnabled } from './voiceConfig';
import { VoiceActivityMonitor, unlockVoiceAudioContext } from './voiceVad';
import {
  bindRemoteVoiceStream,
  getRemoteVoiceAudioState,
  retryRemoteVoicePlay,
  unlockRemoteVoicePlayback,
} from './remoteVoicePlayback';
import {
  adoptOrCreateLobbyVoiceSession,
  getHeldLobbyVoiceSession,
  releaseLobbyVoiceSession,
  shouldDisposeVoiceOnEffectCleanup,
  kickLobbyHostOfferIfNeeded,
} from './lobbyVoice';

export interface UseSideLiveChatArgs {
  code: string | null;
  seat: SeatRole | null;
  bothConnected: boolean;
  /** Online match / lobby + not spectating. */
  enabled: boolean;
}

export type SideLiveChatUiStatus = 'idle' | 'joining' | 'live' | 'offline';

export interface UseSideLiveChatResult {
  /** Feature available on this host + flag. */
  available: boolean;
  joined: boolean;
  /** RTDB ready/{mySeat} from live session debug. */
  localReady: boolean;
  /** RTDB ready/{peerSeat} from live session debug. */
  peerReady: boolean;
  /** Green when WebRTC live; red when joined but not connected. */
  indicator: 'green' | 'red' | 'none';
  uiStatus: SideLiveChatUiStatus;
  status: VoiceSessionStatus;
  statusDetail: string | null;
  remoteTalking: boolean;
  localSpeaking: boolean;
  remoteStream: MediaStream | null;
  inlineError: string | null;
  /** Preview-only link diagnostics under the badge. */
  debugLine: string | null;
  join: () => void;
  leave: () => void;
  clearInlineError: () => void;
}

export const MIC_BLOCKED =
  'Allow microphone, then tap Connect voice';

/**
 * Full teardown (wipe RTDB + stop Join mic) only when the user left chat/room
 * or the feature is unavailable — not on transient bothConnected/enabled blips.
 */
export function shouldFullyTeardownSideChat(
  joined: boolean,
  available: boolean,
  code: string | null | undefined,
): boolean {
  return !joined || !available || !code;
}

/**
 * Fail closed: Joined UI without an active VoicePttSession that can answer
 * must surface Failed (ready heartbeat alone previously lied — A6BDG).
 */
export function shouldFailClosedWithoutVoiceSession(
  joined: boolean,
  hasActiveSession: boolean,
  opts?: { hasPc?: boolean; signalingBound?: boolean; heldSessionAlive?: boolean },
): boolean {
  if (!joined) return false;
  // Transient remount: sessionRef may be null while module hold still has PC+signaling.
  // Must NOT clear ready/{seat} or the peer spins on CONNECTING forever (A6BDG host).
  if (opts?.heldSessionAlive === true) return false;
  if (!hasActiveSession) return true;
  if (opts && (opts.hasPc === false || opts.signalingBound === false)) return true;
  return false;
}

/**
 * Prefer getHeldLobbyVoiceSession() over a possibly-null sessionRef during remount.
 * Unit-tested so fail-closed cannot regress to wiping ready while the hold is alive.
 */
export function resolveVoiceSessionForReadyPoll<T extends { isDisposed(): boolean }>(
  sessionRefCurrent: T | null | undefined,
  held: T | null | undefined,
): T | null {
  if (held && !held.isDisposed()) return held;
  if (sessionRefCurrent && !sessionRefCurrent.isDisposed()) return sessionRefCurrent;
  return null;
}

/**
 * Clear ready only when truly dead — never when the held lobby session can still publish.
 */
export function shouldClearVoiceReadyOnFailClosed(opts: {
  joined: boolean;
  heldCanPublish: boolean;
  hasActiveSession: boolean;
  hasPc: boolean;
  signalingBound: boolean;
}): boolean {
  return shouldFailClosedWithoutVoiceSession(opts.joined, opts.hasActiveSession, {
    hasPc: opts.hasPc,
    signalingBound: opts.signalingBound,
    heldSessionAlive: opts.heldCanPublish,
  });
}


/**
 * Drop joined on session error only when PC/signaling is truly dead.
 * readyMe lags the RTDB write (listener async) — dropping on !readyMe alone
 * aborted host Connect when a concurrent offer/answer error fired first
 * (desktop host ready stayed null/false; phone guest Connect worked).
 */
export function shouldDropJoinedOnVoiceSessionError(opts: {
  canPublishReady: boolean;
}): boolean {
  return opts.canPublishReady !== true;
}

/** Surface the real exception on Failed (not a generic "Voice failed to start"). */
export function formatVoiceStartFailure(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message || err.name
      : typeof err === 'string'
        ? err
        : '';
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'Voice failed to start';
  if (/^voice failed to start/i.test(trimmed)) return trimmed;
  return `Voice failed to start: ${trimmed}`;
}

/** Debug line with the remote <audio> paused flag merged in. */
export function formatVoiceDebugWithAudio(
  snap: Parameters<typeof formatVoiceLinkDebug>[0],
): string {
  let audioPaused: boolean | null = null;
  try {
    audioPaused = getRemoteVoiceAudioState().paused;
  } catch {
    audioPaused = null;
  }
  return formatVoiceLinkDebug({ ...snap, audioPaused });
}

/** Keep debug visible on Failed after joined was dropped so the host can copy it. */
export function shouldShowVoiceDebugLine(opts: {
  joined: boolean;
  debugLine: string | null | undefined;
  inlineError: string | null | undefined;
}): boolean {
  if (!opts.debugLine) return false;
  if (opts.joined) return true;
  if (opts.inlineError) return true;
  return false;
}

/** Pure UI mapping for join + peer status (unit-tested). */
export function deriveSideLiveChatUi(
  joined: boolean,
  peerLive: boolean,
  joiningBusy: boolean,
  status: VoiceSessionStatus,
): { uiStatus: SideLiveChatUiStatus; indicator: 'green' | 'red' | 'none' } {
  if (!joined) return { uiStatus: 'idle', indicator: 'none' };
  if (peerLive) return { uiStatus: 'live', indicator: 'green' };
  if (joiningBusy || status === 'connecting' || status === 'ready') {
    return { uiStatus: 'joining', indicator: 'red' };
  }
  return { uiStatus: 'offline', indicator: 'red' };
}

/**
 * Lobby UX: never blame the peer (or show Failed peer-wait) until THIS seat
 * has Connected / readyMe=1. Unjoined + readyMe=0 → pulse Connect voice.
 */
export function shouldShowPeerNeedsConnect(opts: {
  joined: boolean;
  localReady: boolean;
  peerReady: boolean;
  uiStatus: SideLiveChatUiStatus;
}): boolean {
  if (!opts.joined) return false;
  if (!opts.localReady) return false;
  if (opts.peerReady) return false;
  if (opts.uiStatus === 'live') return false;
  return true;
}

/** Pulse Connect when not joined, or Failed without ever publishing ready. */
export function shouldPulseConnectVoice(opts: {
  joined: boolean;
  localReady: boolean;
  uiStatus: SideLiveChatUiStatus;
}): boolean {
  if (!opts.joined) return true;
  if (opts.uiStatus === 'offline' && !opts.localReady) return true;
  return false;
}

/**
 * Effective Joined for lobby badge: Failed without localReady drops back to
 * Connect pulse (do not auto-enter peer-blame Failed).
 */
export function effectiveLobbyVoiceJoined(opts: {
  joined: boolean;
  localReady: boolean;
  uiStatus: SideLiveChatUiStatus;
}): boolean {
  if (!opts.joined) return false;
  if (opts.uiStatus === 'offline' && !opts.localReady) return false;
  return true;
}

/** 15s peer-wait Failed only after local Connect succeeded and peer still 0. */
export function shouldPeerWaitFail(opts: {
  localReady: boolean;
  peerReady: boolean;
  bothReady: boolean;
  isPeerLive: boolean;
}): boolean {
  if (!opts.localReady) return false;
  if (opts.peerReady || opts.bothReady || opts.isPeerLive) return false;
  return true;
}

export function deriveLobbyVoiceHint(opts: {
  joined: boolean;
  localReady: boolean;
  peerReady: boolean;
  uiStatus: SideLiveChatUiStatus;
  peerSeatName?: string | null;
}): string {
  const effJoined = effectiveLobbyVoiceJoined(opts);
  if (!effJoined) {
    return 'Both here — tap Connect voice (allow mic). Start the match after green Live.';
  }
  if (opts.uiStatus === 'live') {
    return 'Voice linked — use two devices or headphones; same-device tabs may be silenced by echo cancellation.';
  }
  if (shouldShowPeerNeedsConnect(opts)) {
    const name = opts.peerSeatName?.trim() || 'Opponent';
    return `${name} needs Connect — waiting on them.`;
  }
  if (!opts.localReady) {
    return 'Connecting voice… allow mic if prompted.';
  }
  return 'Connecting voice… both players need Connect.';
}

export function useSideLiveChat(args: UseSideLiveChatArgs): UseSideLiveChatResult {
  const { code, seat, bothConnected, enabled } = args;
  const available = isSideLiveChatEnabled();
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [remoteTalking, setRemoteTalking] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [joiningBusy, setJoiningBusy] = useState(false);
  const [debugLine, setDebugLine] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [peerReady, setPeerReady] = useState(false);

  const sessionRef = useRef<ReturnType<typeof adoptOrCreateLobbyVoiceSession>['session'] | null>(
    null,
  );
  const vadRef = useRef<VoiceActivityMonitor | null>(null);
  const pendingMicRef = useRef<MediaStream | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  const joinedRef = useRef(false);
  const deadSessionNotifiedRef = useRef(false);

  const showError = useCallback((msg: string, holdMs = 4000) => {
    setInlineError(msg);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      setInlineError(null);
      errorTimerRef.current = null;
    }, holdMs);
  }, []);

  const clearInlineError = useCallback(() => setInlineError(null), []);

  const stopVad = useCallback(() => {
    const v = vadRef.current;
    vadRef.current = null;
    if (v) v.dispose();
    setLocalSpeaking(false);
  }, []);

  const startVadForSession = useCallback(
    (session: NonNullable<typeof sessionRef.current>) => {
      stopVad();
      const stream = session.getLocalStream();
      if (!stream) return;
      const vad = new VoiceActivityMonitor((speaking) => {
        setLocalSpeaking(speaking);
        void session.setTalking(speaking);
      });
      vadRef.current = vad;
      vad.start(stream);
    },
    [stopVad],
  );

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  // Ready ONLY while an active session has PC + signaling bound (fail closed).
  useEffect(() => {
    if (!joined || !available || !code || seat === null) return;
    const sessionCaps = () => {
      const held = getHeldLobbyVoiceSession();
      const s = resolveVoiceSessionForReadyPoll(sessionRef.current, held);
      const alive = !!s && !s.isDisposed();
      const heldCanPublish = !!held && !held.isDisposed() && held.canPublishReady();
      return {
        hasActiveSession: alive,
        hasPc: alive && s.hasPeerConnection(),
        signalingBound: alive && s.isSignalingBound(),
        heldCanPublish,
      };
    };
    const t = window.setInterval(() => {
      if (!joinedRef.current) return;
      const caps = sessionCaps();
      if (!shouldPublishVoiceReady(caps)) {
        // Do NOT heartbeat ready without PC — clear + Failed (A6BDG).
        if (
          shouldClearVoiceReadyOnFailClosed({
            joined: true,
            heldCanPublish: caps.heldCanPublish,
            hasActiveSession: caps.hasActiveSession,
            hasPc: caps.hasPc,
            signalingBound: caps.signalingBound,
          })
        ) {
          void publishSeatVoiceReady(code, seat, false);
          if (!deadSessionNotifiedRef.current) {
            deadSessionNotifiedRef.current = true;
            setStatus('error');
            setStatusDetail(VOICE_SESSION_DEAD_MSG);
            showError(VOICE_SESSION_DEAD_MSG, 8000);
            // Drop joined so Connect pulses — never stick Failed when readyMe=0.
            setLocalReady(false);
            setJoined(false);
            joinedRef.current = false;
            setJoiningBusy(false);
          }
        }
        return;
      }
      // Do not heartbeat ready before mic is on the sender — bothReady-before-mic
      // deferred answers into the link-watchdog failure window.
      const held = getHeldLobbyVoiceSession();
      const live = resolveVoiceSessionForReadyPoll(sessionRef.current, held);
      if (live && !live.isDisposed() && live.isMicAttached()) {
        void publishSeatVoiceReady(code, seat);
      }
    }, 2000);
    const failT = window.setTimeout(() => {
      if (!joinedRef.current) return;
      const caps = sessionCaps();
      if (
        shouldClearVoiceReadyOnFailClosed({
          joined: true,
          heldCanPublish: caps.heldCanPublish,
          hasActiveSession: caps.hasActiveSession,
          hasPc: caps.hasPc,
          signalingBound: caps.signalingBound,
        })
      ) {
        void publishSeatVoiceReady(code, seat, false);
        if (!deadSessionNotifiedRef.current) {
          deadSessionNotifiedRef.current = true;
          setStatus('error');
          setStatusDetail(VOICE_SESSION_DEAD_MSG);
          showError(VOICE_SESSION_DEAD_MSG, 8000);
          setLocalReady(false);
          setJoined(false);
          joinedRef.current = false;
          setJoiningBusy(false);
        }
      }
    }, 6000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(failT);
    };
  }, [joined, available, code, seat, showError]);

  useEffect(() => {
    const shouldRun = available && joined && !!code && seat !== null;

    if (!shouldRun) {
      const intentionalLeave = shouldFullyTeardownSideChat(joined, available, code);
      if (
        shouldDisposeVoiceOnEffectCleanup({
          stillJoined: joined,
          intentionalLeave,
        })
      ) {
        void (async () => {
          sessionRef.current = null;
          stopVad();
          const preserved = await releaseLobbyVoiceSession({
            clearSignaling: intentionalLeave,
            stopMic: intentionalLeave,
          });
          if (!intentionalLeave && preserved && !pendingMicRef.current) {
            pendingMicRef.current = preserved;
          }
          setStatus('idle');
          setStatusDetail(null);
          setRemoteTalking(false);
          setRemoteStream(null);
        })();
        if (intentionalLeave) {
          pendingMicRef.current?.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          });
          pendingMicRef.current = null;
        }
      }
      setJoiningBusy(false);
      return;
    }

    let cancelled = false;
    const { session, created } = adoptOrCreateLobbyVoiceSession(code, seat, {
      onStatus: (s, detail) => {
        if (cancelled) return;
        setStatus(s);
        setStatusDetail(detail ?? null);
        if (s === 'denied' && detail) showError(detail, 10000);
        // Fail-closed / peer-wait must not lock seat 0 on Failed when never ready.
        if (s === 'error' || s === 'denied') {
          try {
            const snap = session.getDebugSnapshot();
            setDebugLine(formatVoiceDebugWithAudio(snap));
            // Only drop joined when PC/signaling is dead — not when readyMe is
            // still 0 due to RTDB listener lag after announceReady wrote true.
            if (shouldDropJoinedOnVoiceSessionError({
              canPublishReady: session.canPublishReady(),
            })) {
              setLocalReady(false);
              setPeerReady(!!snap.peerReady);
              setJoined(false);
              joinedRef.current = false;
              setJoiningBusy(false);
              if (detail) showError(detail, 8000);
            } else if (detail) {
              showError(detail, 8000);
            }
          } catch {
            /* ignore */
          }
        }
      },
      onRemoteTalking: (t) => {
        if (!cancelled) setRemoteTalking(t);
      },
      onRemoteStream: (stream) => {
        if (!cancelled) setRemoteStream(stream);
      },
      onRemoteRebind: (reason) => {
        // Receive track re-checked after (re)negotiation — make sure the
        // persistent <audio> is unmuted + playing (Safari play retries).
        if (!cancelled) retryRemoteVoicePlay(`rebind:${reason}`);
      },
    });
    sessionRef.current = session;

    void (async () => {
      try {
        if (created || !session.hasPeerConnection()) {
          // New session OR held zombie (started without PC) — must start().
          // Defer ready until mic is on the sender (see announceReady below).
          // Ready-before-mic + wait-for-mic answers raced the link watchdog.
          await session.start({ announceReady: false });
        } else {
          // Reused live PC (Table remount / StrictMode) — mic usually already
          // attached; re-announce after adopt below. Do not ready-before-mic.
          if (session.isPeerLive()) {
            setStatus('live');
          }
        }
        if (cancelled) return;
        const pending = pendingMicRef.current;
        pendingMicRef.current = null;
        if (cancelled) {
          if (pending && !pendingMicRef.current) pendingMicRef.current = pending;
          return;
        }
        let micOk = false;
        if (pending) {
          const result = await session.adoptMicStream(pending, false);
          if (cancelled) {
            if (!result.ok && !pendingMicRef.current) pendingMicRef.current = pending;
            return;
          }
          if (!result.ok) {
            if (result.error) showError(result.error, 10000);
            if (!cancelled) {
              setStatus('error');
              setStatusDetail(result.error || 'Mic not on sender — Connect again');
              setLocalReady(false);
              setJoined(false);
              joinedRef.current = false;
              setJoiningBusy(false);
            }
          } else {
            micOk = true;
          }
        } else if (!session.getLocalStream()) {
          const result = await session.ensureMic(false);
          if (!result.ok) {
            if (result.error) showError(result.error, 10000);
            if (!cancelled) {
              setStatus('error');
              setStatusDetail(result.error || 'Mic failed — Connect again');
              setLocalReady(false);
              setJoined(false);
              joinedRef.current = false;
              setJoiningBusy(false);
            }
          } else {
            micOk = true;
          }
        } else {
          micOk = true;
        }
        if (cancelled) return;
        // Never ready without mic on sender (session.announceReady also gates).
        if (micOk) {
          await session.announceReady();
        } else {
          // adopt/ensure already surfaced error + dropped joined.
          return;
        }
        if (cancelled) return;
        // Host must publish offer on both-ready even if mic adopt lagged —
        // kickLobbyHostOfferIfNeeded wires shouldOfferOnceWhenBothLobbyReady
        // into the real Connect path (retry / without-mic grace inside session).
        kickLobbyHostOfferIfNeeded(session);
        if (session.getLocalStream()) {
          startVadForSession(session);
        }
      } catch (e) {
        console.warn('lobby voice start failed', e);
        if (!cancelled) {
          const msg = formatVoiceStartFailure(e);
          try {
            const snap = session.getDebugSnapshot();
            setDebugLine(formatVoiceDebugWithAudio(snap));
          } catch {
            /* ignore */
          }
          showError(msg, 10000);
          setStatus('error');
          setStatusDetail(msg);
          setLocalReady(false);
          setJoined(false);
          joinedRef.current = false;
          setJoiningBusy(false);
        }
      } finally {
        if (!cancelled) setJoiningBusy(false);
      }
    })();

    let lastPausedKick = 0;
    const debugTimer = window.setInterval(() => {
      if (cancelled || sessionRef.current !== session) return;
      try {
        const snap = session.getDebugSnapshot();
        setDebugLine(formatVoiceDebugWithAudio(snap));
        setLocalReady(!!snap.readyMe);
        setPeerReady(!!snap.peerReady);
        // Live but the remote sink is paused (Safari dropped play) → retry ~2s.
        const audio = getRemoteVoiceAudioState();
        const now = Date.now();
        if (
          session.isPeerLive() &&
          audio.hasSrc &&
          audio.paused === true &&
          now - lastPausedKick > 2000
        ) {
          lastPausedKick = now;
          retryRemoteVoicePlay('paused');
        }
      } catch {
        /* ignore */
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(debugTimer);
      // CRITICAL: do NOT dispose the held PC while still joined — Table remount
      // / StrictMode must carry the same session into the match.
      if (
        shouldDisposeVoiceOnEffectCleanup({
          stillJoined: joinedRef.current,
          intentionalLeave: false,
        })
      ) {
        sessionRef.current = null;
        stopVad();
        setDebugLine(null);
        void (async () => {
          const preserved = await releaseLobbyVoiceSession({
            clearSignaling: false,
            stopMic: false,
          });
          if (preserved && joinedRef.current && !pendingMicRef.current) {
            pendingMicRef.current = preserved;
          } else if (preserved && !joinedRef.current) {
            preserved.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                /* ignore */
              }
            });
          }
        })();
      } else {
        // Keep sessionRef pointing at held PC; only stop polling this mount.
        setDebugLine(null);
      }
    };
  }, [
    available,
    joined,
    code,
    seat,
    showError,
    startVadForSession,
    stopVad,
  ]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
      pendingMicRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      pendingMicRef.current = null;
      stopVad();
    };
  }, [stopVad]);

  // Persistent <audio> lives outside lobby/table remounts (Safari unlock).
  useEffect(() => {
    bindRemoteVoiceStream(remoteStream);
  }, [remoteStream]);

  useEffect(() => {
    if (status === 'live' && remoteStream) retryRemoteVoicePlay('live');
  }, [status, remoteStream]);

  useEffect(() => {
    if (remoteTalking && remoteStream) retryRemoteVoicePlay('talking');
  }, [remoteTalking, remoteStream]);

  const join = useCallback(() => {
    if (!available || !enabled || !code || seat === null || !bothConnected) return;
    if (joinedRef.current || joiningBusy) return;
    clearInlineError();
    setJoiningBusy(true);

    // Safari / iPad: unlock VAD AudioContext synchronously and request the mic
    // from this Connect gesture. The monitor starts later after WebRTC setup.
    unlockVoiceAudioContext();
    unlockRemoteVoicePlayback();
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          showError('Mic not supported on this device');
          setJoiningBusy(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        // Keep the capture track enabled for Web Audio analysis. adoptMicStream
        // sends a separate disabled clone until VAD detects speech.
        stream.getAudioTracks().forEach((t) => {
          t.enabled = true;
        });
        pendingMicRef.current = stream;
        deadSessionNotifiedRef.current = false;
        setLocalReady(false);
        setPeerReady(false);
        setJoined(true);
      } catch (e) {
        const isDenied =
          e instanceof Error &&
          (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
        showError(
          isDenied
            ? MIC_BLOCKED
            : e instanceof Error
              ? e.message
              : 'Mic failed',
          isDenied ? 10000 : 4000,
        );
        setJoiningBusy(false);
      }
    })();
  }, [available, enabled, bothConnected, code, seat, joiningBusy, clearInlineError, showError]);

  const leave = useCallback(() => {
    setJoined(false);
    setLocalReady(false);
    setPeerReady(false);
    deadSessionNotifiedRef.current = false;
    setJoiningBusy(false);
    pendingMicRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    pendingMicRef.current = null;
    stopVad();
    sessionRef.current = null;
    void releaseLobbyVoiceSession({ clearSignaling: true, stopMic: true }).then(() => {
      setStatus('idle');
      setStatusDetail(null);
      setRemoteTalking(false);
      setRemoteStream(null);
      bindRemoteVoiceStream(null);
      setDebugLine(null);
    });
  }, [stopVad]);

  const peerLive = status === 'live';
  const { uiStatus, indicator } = deriveSideLiveChatUi(
    joined,
    peerLive,
    joiningBusy,
    status,
  );

  return {
    available,
    joined,
    localReady,
    peerReady,
    indicator,
    uiStatus,
    status,
    statusDetail,
    remoteTalking,
    localSpeaking,
    remoteStream,
    inlineError,
    debugLine,
    join,
    leave,
    clearInlineError,
  };
}

/** Call from App leave path so voice RTDB node is wiped. */
export async function cleanupSideLiveChatOnLeave(code: string | null): Promise<void> {
  await releaseLobbyVoiceSession({ clearSignaling: false, stopMic: true });
  if (!code) return;
  await clearVoiceSignaling(code);
}
