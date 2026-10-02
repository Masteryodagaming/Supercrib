/**
 * Persistent remote WebRTC audio sink.
 *
 * Safari rejects <audio>.play() unless the same element was touched during a
 * user gesture. Lobby Connect happens before the remote track exists, and
 * OnlineLobby unmounts its <audio> when the match starts — so a React-owned
 * element loses the unlock. This module keeps one document-level element.
 *
 * Never mute the remote sink. Retry play() on Connect, Live, talking, and
 * visibility — the Connect tap alone is usually too early.
 */
import { unlockVoiceAudioContext } from './voiceVad';

export const SAME_DEVICE_VOICE_HINT =
  'Use two devices or headphones — two tabs on the same phone/computer may stay silent (echo cancel).';

export function configureRemoteAudioElement(el: HTMLAudioElement): HTMLAudioElement {
  el.autoplay = true;
  el.defaultMuted = false;
  el.muted = false;
  el.volume = 1;
  el.setAttribute('autoplay', '');
  el.setAttribute('playsinline', 'true');
  el.setAttribute('webkit-playsinline', 'true');
  (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  return el;
}

export function attachRemoteStreamToAudio(
  el: HTMLAudioElement,
  stream: MediaStream | null,
): void {
  configureRemoteAudioElement(el);
  if (!stream) {
    if (el.srcObject) el.srcObject = null;
    return;
  }
  stream.getAudioTracks().forEach((t) => {
    t.enabled = true;
    // Guest VAD may start muted; when the remote track unmutes, kick play again
    // so the host sink is not stuck on a silent first attach (iOS Safari).
    t.onunmute = () => {
      t.enabled = true;
      el.muted = false;
      el.volume = 1;
      void el.play().catch(() => {
        /* gesture / visibility retry handles NotAllowedError */
      });
    };
  });
  if (el.srcObject !== stream) {
    el.srcObject = stream;
  }
}

/** When to force another play() after the Connect gesture has already expired. */
export function shouldRetryRemoteVoicePlay(opts: {
  hasStream: boolean;
  live?: boolean;
  talking?: boolean;
  visible?: boolean;
}): boolean {
  if (!opts.hasStream) return false;
  return !!(opts.live || opts.talking || opts.visible);
}

let persistEl: HTMLAudioElement | null = null;
let persistStream: MediaStream | null = null;
let unlocked = false;
let visibilityBound = false;

function playEl(el: HTMLAudioElement): void {
  el.muted = false;
  el.volume = 1;
  void el.play().catch((err) => {
    console.warn('remote voice audio play()', err);
  });
}

export function ensurePersistentRemoteAudio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  if (persistEl && persistEl.isConnected) return persistEl;
  const el = document.createElement('audio');
  el.className = 'side-live-chat-remote-audio-persist';
  el.setAttribute('aria-hidden', 'true');
  configureRemoteAudioElement(el);
  // Safari can refuse 0×0 / display:none media. Park a 1×1 off-screen sink.
  el.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(el);
  persistEl = el;
  bindVisibilityRetry();
  return el;
}

function bindVisibilityRetry(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  const kick = () => {
    if (document.visibilityState === 'visible') retryRemoteVoicePlay('visible');
  };
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('pageshow', kick);
}

export function bindRemoteVoiceStream(stream: MediaStream | null): void {
  persistStream = stream;
  const el = ensurePersistentRemoteAudio();
  if (!el) return;
  attachRemoteStreamToAudio(el, stream);
  if (stream) playEl(el);
}

/** Call synchronously from Connect (user gesture). */
export function unlockRemoteVoicePlayback(): void {
  unlocked = true;
  unlockVoiceAudioContext();
  const el = ensurePersistentRemoteAudio();
  if (!el) return;
  attachRemoteStreamToAudio(el, persistStream);
  playEl(el);
}

export function retryRemoteVoicePlay(_reason?: string): void {
  const el = persistEl ?? ensurePersistentRemoteAudio();
  if (!el || !persistStream) return;
  attachRemoteStreamToAudio(el, persistStream);
  playEl(el);
}

/** Debug: persistent remote <audio> state (paused=null when no element). */
export function getRemoteVoiceAudioState(): {
  paused: boolean | null;
  hasSrc: boolean;
  muted: boolean | null;
} {
  const el = persistEl;
  if (!el) return { paused: null, hasSrc: false, muted: null };
  return { paused: el.paused, hasSrc: !!el.srcObject, muted: el.muted };
}

export function isRemoteVoiceUnlocked(): boolean {
  return unlocked;
}

export function __resetRemoteVoicePlaybackForTests(): void {
  if (persistEl) {
    persistEl.srcObject = null;
    persistEl.remove();
  }
  persistEl = null;
  persistStream = null;
  unlocked = false;
}
