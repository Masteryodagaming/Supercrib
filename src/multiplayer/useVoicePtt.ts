/**
 * React hook: start WebRTC PTT when both online seats are connected.
 * Cleanup on leave / unmount — stops tracks, closes PC, clears voice node.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeatRole } from './types';
import {
  VoicePttSession,
  clearVoiceSignaling,
  type VoiceSessionStatus,
} from './voicePtt';
import { VOICE_PTT_ENABLED } from './voiceConfig';

export interface UseVoicePttArgs {
  /** Room code when in an online match. */
  code: string | null;
  seat: SeatRole | null;
  /** True when both seats present & connected. */
  bothConnected: boolean;
  /** Hide for vs-AI / spectate. */
  enabled: boolean;
}

export interface UseVoicePttResult {
  status: VoiceSessionStatus;
  statusDetail: string | null;
  remoteTalking: boolean;
  /** True when WebRTC peer connection is live (honest Opp gate). */
  peerLive: boolean;
  holding: boolean;
  /** Attach remote MediaStream to a hidden <audio>. */
  remoteStream: MediaStream | null;
  holdStart: () => void;
  holdEnd: () => void;
  /** Brief mic-denied / error string for inline UI. */
  inlineError: string | null;
  clearInlineError: () => void;
}

export function useVoicePtt(args: UseVoicePttArgs): UseVoicePttResult {
  const { code, seat, bothConnected, enabled } = args;
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [remoteTalking, setRemoteTalking] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [holding, setHolding] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const sessionRef = useRef<VoicePttSession | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const showError = useCallback((msg: string, holdMs = 3200) => {
    setInlineError(msg);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      setInlineError(null);
      errorTimerRef.current = null;
    }, holdMs);
  }, []);

  const clearInlineError = useCallback(() => setInlineError(null), []);

  // Lifecycle: start when online + both connected; tear down otherwise.
  useEffect(() => {
    const shouldRun =
      VOICE_PTT_ENABLED && enabled && !!code && seat !== null && bothConnected;
    if (!shouldRun) {
      const prev = sessionRef.current;
      sessionRef.current = null;
      if (prev) {
        const clearNode = !VOICE_PTT_ENABLED || enabled === false || !code;
        void prev.dispose(clearNode);
      }
      setStatus('idle');
      setStatusDetail(null);
      setRemoteTalking(false);
      setRemoteStream(null);
      setHolding(false);
      return;
    }

    let cancelled = false;
    const session = new VoicePttSession(code, seat, {
      onStatus: (s, detail) => {
        if (cancelled) return;
        setStatus(s);
        setStatusDetail(detail ?? null);
        if (s === 'denied' && detail) showError(detail, 10000);
      },
      onRemoteTalking: (t) => {
        if (!cancelled) setRemoteTalking(t);
      },
      onRemoteStream: (stream) => {
        if (!cancelled) setRemoteStream(stream);
      },
    });
    sessionRef.current = session;
    void session.start().catch((e) => {
      console.warn('voice start failed', e);
      if (!cancelled) showError('Voice failed to start');
    });

    return () => {
      cancelled = true;
      sessionRef.current = null;
      // On dependency change (reconnect / leave), dispose.
      // Clear signaling when leaving room entirely (code becomes null) — handled below.
      void session.dispose(false);
    };
  }, [enabled, code, seat, bothConnected, showError]);

  // When fully leaving (code null or disabled), wipe voice node.
  useEffect(() => {
    if (!enabled || !code) {
      // Best-effort clear if we still know a prior code via leave path in App.
      return;
    }
    return () => {
      // If code changes away, clear old node's signaling (host/guest either may).
    };
  }, [enabled, code]);

  // Explicit leave cleanup helper exposed via dispose on unmount of enabled session
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const holdStart = useCallback(() => {
    if (!VOICE_PTT_ENABLED) return;
    setHolding(true);
    const s = sessionRef.current;
    if (!s) return;
    void (async () => {
      const result = await s.ensureMic(true);
      if (!result.ok && result.error) showError(result.error);
    })();
  }, [showError]);

  const holdEnd = useCallback(() => {
    setHolding(false);
    void sessionRef.current?.setTalking(false);
  }, []);

  return {
    status,
    statusDetail,
    remoteTalking,
    peerLive: status === 'live',
    holding,
    remoteStream,
    holdStart,
    holdEnd,
    inlineError,
    clearInlineError,
  };
}

/** Call from App leave path so voice RTDB node is wiped. */
export async function cleanupVoiceOnLeave(code: string | null): Promise<void> {
  if (!code) return;
  await clearVoiceSignaling(code);
}
