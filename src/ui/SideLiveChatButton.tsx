/**
 * Lobby Connect voice + table Live status (VAD).
 * Connect click = Safari mic / remote-audio unlock gesture.
 */
import { useEffect, useRef } from 'react';
import type { SideLiveChatUiStatus } from '../multiplayer/useSideLiveChat';
import { unlockVoiceAudioContext } from '../multiplayer/voiceVad';
import {
  attachRemoteStreamToAudio,
  retryRemoteVoicePlay,
  unlockRemoteVoicePlayback,
} from '../multiplayer/remoteVoicePlayback';

export interface SideLiveChatButtonProps {
  joined: boolean;
  indicator: 'green' | 'red' | 'none';
  uiStatus: SideLiveChatUiStatus;
  remoteTalking?: boolean;
  localSpeaking?: boolean;
  inlineError?: string | null;
  statusDetail?: string | null;
  /** Preview-only WebRTC handshake diagnostics. */
  debugLine?: string | null;
  remoteStream?: MediaStream | null;
  onJoin: () => void;
  onLeave: () => void;
  disabled?: boolean;
  /**
   * Lobby primary CTA label. Table compact mode hides Connect when already
   * live and shows Disconnect instead of Leave.
   */
  connectLabel?: string;
  /** Table chrome: compact Live + Disconnect; no mid-hand Join push. */
  compact?: boolean;
  /** When false (table after lobby connect), hide Connect — status only + Disconnect. */
  allowConnect?: boolean;
  /** Lobby: pulse Connect voice when both seats are here and this seat is not joined. */
  pulseConnect?: boolean;
  /** Lobby: other seat display name when they still need to tap Connect voice. */
  peerNeedsConnectName?: string | null;
}

export function shouldRetrySideLiveAudio(opts: {
  hasStream: boolean;
  joined: boolean;
  uiStatus: SideLiveChatUiStatus;
  remoteTalking: boolean;
}): boolean {
  if (!opts.hasStream || !opts.joined) return false;
  return opts.uiStatus === 'live' || opts.remoteTalking;
}

function unlockAndPlay(el: HTMLAudioElement, stream: MediaStream | null | undefined): void {
  attachRemoteStreamToAudio(el, stream ?? null);
  if (el.srcObject) {
    void el.play().catch((err) => {
      console.warn('side live chat remote audio play()', err);
    });
  }
  if (stream) retryRemoteVoicePlay('element');
}

export function SideLiveChatButton({
  joined,
  indicator,
  uiStatus,
  remoteTalking = false,
  localSpeaking = false,
  inlineError = null,
  statusDetail = null,
  debugLine = null,
  remoteStream = null,
  onJoin,
  onLeave,
  disabled = false,
  connectLabel = 'Connect voice',
  compact = false,
  allowConnect = true,
  pulseConnect = false,
  peerNeedsConnectName = null,
}: SideLiveChatButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    if (remoteStream) {
      el.srcObject = remoteStream;
      if (audioUnlockedRef.current) {
        unlockAndPlay(el, remoteStream);
      } else {
        el.muted = false;
        el.volume = 1;
        void el.play().catch(() => {
          /* Connect gesture unlocks */
        });
      }
    } else {
      el.srcObject = null;
    }
  }, [remoteStream]);

  // Safari may reject the early Connect play() because the remote track arrives
  // later. Retry when the peer becomes Live and on the first talking signal.
  useEffect(() => {
    const el = audioRef.current;
    if (
      !el ||
      !shouldRetrySideLiveAudio({
        hasStream: !!remoteStream,
        joined,
        uiStatus,
        remoteTalking,
      })
    ) {
      return;
    }
    unlockAndPlay(el, remoteStream);
  }, [joined, uiStatus, remoteTalking, remoteStream]);

  // Lobby → table mounts a new audio element. Re-arm it on visibility and the
  // next real gesture after Live; this is the reliable Safari autoplay fallback.
  useEffect(() => {
    if (!joined) return;
    const retry = () => {
      const el = audioRef.current;
      if (!el) return;
      unlockVoiceAudioContext();
      unlockAndPlay(el, remoteStream ?? (el.srcObject as MediaStream | null));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('pointerdown', retry, { passive: true });
    window.addEventListener('touchend', retry, { passive: true });
    window.addEventListener('keydown', retry);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('touchend', retry);
      window.removeEventListener('keydown', retry);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [joined, remoteStream]);

  const unlockRemoteAudio = () => {
    audioUnlockedRef.current = true;
    const el = audioRef.current;
    if (!el) return;
    unlockAndPlay(el, remoteStream ?? (el.srcObject as MediaStream | null));
  };

  const handleJoin = () => {
    if (disabled) return;
    unlockVoiceAudioContext();
    unlockRemoteVoicePlayback();
    unlockRemoteAudio();
    onJoin();
  };

  const lightClass =
    indicator === 'green'
      ? 'is-green'
      : indicator === 'red'
        ? 'is-red'
        : '';

  const statusLabel =
    uiStatus === 'live'
      ? 'Live'
      : uiStatus === 'joining'
        ? 'Connecting…'
        : uiStatus === 'offline'
          ? 'Failed'
          : null;

  const leaveLabel = compact ? 'Disconnect' : 'Leave';

  const peerNeedsHint =
    joined && peerNeedsConnectName && uiStatus !== 'live'
      ? `${peerNeedsConnectName} needs Connect`
      : null;
  const hint =
    inlineError ||
    peerNeedsHint ||
    (!joined
      ? null
      : statusDetail && indicator === 'red'
        ? statusDetail
        : remoteTalking
          ? 'Opp speaking'
          : localSpeaking
            ? 'Mic open'
            : null);

  const showConnect = !joined && allowConnect;
  const showStatusRow = joined;

  return (
    <div
      className={`side-live-chat${joined ? ' is-joined' : ''}${compact ? ' is-compact' : ''}${remoteTalking ? ' opp-talking' : ''}${localSpeaking ? ' self-talking' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-live="polite"
    >
      <audio ref={audioRef} autoPlay playsInline aria-hidden="true" className="side-live-chat-remote-audio" />
      {showConnect ? (
        <button
          type="button"
          className={`side-live-chat-btn side-live-chat-join${pulseConnect ? ' is-pulse' : ''}`}
          aria-label={connectLabel}
          disabled={disabled}
          onClick={handleJoin}
        >
          {connectLabel}
        </button>
      ) : null}
      {showStatusRow ? (
        <div className="side-live-chat-live-row">
          <div className={`side-live-chat-status ${lightClass}`} role="status">
            <span className="side-live-chat-dot" aria-hidden />
            <span className="side-live-chat-live-label">{statusLabel ?? 'Live'}</span>
          </div>
          <button
            type="button"
            className="side-live-chat-btn side-live-chat-leave"
            aria-label={leaveLabel}
            onClick={onLeave}
          >
            {leaveLabel}
          </button>
        </div>
      ) : null}
      {!showConnect && !showStatusRow && compact ? (
        <span className="side-live-chat-hint">Voice off</span>
      ) : null}
      {hint && (
        <span
          className={`side-live-chat-hint${inlineError ? ' is-error' : ''}`}
          role="status"
        >
          {hint}
        </span>
      )}
      {/* Show debug on Failed even after joined drops so host can copy it. */}
      {(joined || !!inlineError) && debugLine && (
        <span className="side-live-chat-debug" role="status">
          {debugLine}
        </span>
      )}
    </div>
  );
}
