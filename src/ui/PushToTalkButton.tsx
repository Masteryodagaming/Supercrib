/**
 * Hold-to-talk mic control for online matches.
 * Pointer / touch / optional Space while focused.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export interface PushToTalkButtonProps {
  holding: boolean;
  remoteTalking?: boolean;
  /** True when WebRTC peer is actually connected (status live / pc connected). */
  peerLive?: boolean;
  inlineError?: string | null;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  disabled?: boolean;
  /** Short hint when mic UI is visible but voice not ready yet. */
  notReadyHint?: string | null;
  /** Brief WebRTC status (e.g. Connecting voice…) while linking. */
  voiceStatusHint?: string | null;
  /** Remote peer audio stream (hidden element). */
  remoteStream?: MediaStream | null;
}

function unlockAndPlay(el: HTMLAudioElement, stream: MediaStream | null | undefined): void {
  el.muted = false;
  el.volume = 1;
  el.setAttribute('playsinline', 'true');
  el.setAttribute('webkit-playsinline', 'true');
  // playsInline exists on media elements in browsers; TS DOM lib omits it on audio.
  (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  if (stream && el.srcObject !== stream) {
    el.srcObject = stream;
  }
  if (el.srcObject) {
    void el.play().catch((err) => {
      console.warn('ptt remote audio play()', err);
    });
  }
}

export function PushToTalkButton({
  holding,
  remoteTalking = false,
  peerLive = false,
  inlineError = null,
  onHoldStart,
  onHoldEnd,
  disabled = false,
  notReadyHint = null,
  voiceStatusHint = null,
  remoteStream = null,
}: PushToTalkButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const holdingRef = useRef(false);
  /** Set on first hold — Safari needs a user gesture before <audio>.play(). */
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
        // Attach only; play() retried on next hold gesture.
        el.muted = false;
        el.volume = 1;
        void el.play().catch(() => {
          /* autoplay blocked until gesture — hold unlocks */
        });
      }
    } else {
      el.srcObject = null;
    }
  }, [remoteStream]);

  const unlockRemoteAudio = () => {
    audioUnlockedRef.current = true;
    const el = audioRef.current;
    if (!el) return;
    unlockAndPlay(el, remoteStream ?? (el.srcObject as MediaStream | null));
  };

  const start = (ev?: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (ev) {
      // Keep hold without scrolling / context menu on mobile.
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      if (ev.pointerType === 'touch') ev.preventDefault();
    }
    if (holdingRef.current) return;
    holdingRef.current = true;
    // User gesture: unlock Safari / iOS remote audio playback.
    unlockRemoteAudio();
    onHoldStart();
  };

  const end = (ev?: ReactPointerEvent<HTMLButtonElement>) => {
    if (ev) {
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!holdingRef.current && !holding) return;
    holdingRef.current = false;
    onHoldEnd();
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (ev.code === 'Space' || ev.key === ' ') {
      ev.preventDefault();
      if (!holdingRef.current) start();
    }
  };

  const onKeyUp = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.code === 'Space' || ev.key === ' ') {
      ev.preventDefault();
      end();
    }
  };

  const showOppPulse = remoteTalking && peerLive;
  const showVoiceNotLinked = remoteTalking && !peerLive;

  return (
    <div
      className={`ptt-wrap${holding ? ' is-holding' : ''}${showOppPulse ? ' opp-talking' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-live="polite"
    >
      <audio ref={audioRef} autoPlay playsInline className="ptt-remote-audio" />
      <button
        type="button"
        className={`ptt-btn${holding ? ' is-active' : ''}`}
        aria-label={holding ? 'Release to mute' : 'Hold to talk'}
        aria-pressed={holding}
        disabled={disabled}
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={(ev) => {
          // Only end if we captured this pointer (still holding).
          if (holdingRef.current && ev.buttons === 0) end(ev);
        }}
        onContextMenu={(ev) => ev.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <span className="ptt-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        </span>
        <span className="ptt-label">{holding ? 'Talking…' : 'Hold'}</span>
      </button>
      {showOppPulse && (
        <span className="ptt-opp-pulse" aria-label="Opponent speaking">
          Opp
        </span>
      )}
      {showVoiceNotLinked && !inlineError && (
        <span className="ptt-hint ptt-voice-unlinked" role="status">
          Voice not linked
        </span>
      )}
      {inlineError && (
        <span className="ptt-error" role="status">
          {inlineError}
        </span>
      )}
      {!inlineError && !showVoiceNotLinked && (voiceStatusHint || (disabled && notReadyHint)) && (
        <span className="ptt-hint" role="status">
          {voiceStatusHint || notReadyHint}
        </span>
      )}
    </div>
  );
}
