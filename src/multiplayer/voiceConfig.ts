/**
 * Online voice flags.
 *
 * VOICE_PTT_ENABLED — legacy table Hold-to-talk. Stay false; not the primary UX.
 * SIDE_LIVE_CHAT_ENABLED — lobby "Connect voice" + VAD (carries into table).
 *   Compile flag is true. Runtime requires a voice host (preview / live / local)
 *   AND a mobile client (phone/tablet). Desktop browsers never get voice UI.
 */

export const VOICE_PTT_ENABLED = false;

/** Explicit compile-time gate for the side live-chat / VAD UI track. */
export const SIDE_LIVE_CHAT_ENABLED = true;

/** Live Firebase hosting hosts for project supercrib241-baba2. */
const LIVE_HOSTS = new Set([
  'supercrib241-baba2.web.app',
  'supercrib241-baba2.firebaseapp.com',
]);

export type MobileClientSignals = {
  userAgent?: string | null;
  maxTouchPoints?: number | null;
  /** matchMedia('(pointer: coarse)').matches */
  pointerCoarse?: boolean | null;
  /** matchMedia('(hover: none)').matches */
  hoverNone?: boolean | null;
};

/**
 * Reliable phone/tablet detection for voice gating.
 * Combines UA (iPhone / Android / iPad), iPadOS desktop-UA quirk
 * (Macintosh + maxTouchPoints > 1), and coarse-pointer / hover:none + touch.
 */
export function isMobileClient(signals?: MobileClientSignals): boolean {
  const ua =
    signals?.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '') ??
    '';
  const maxTouch =
    signals?.maxTouchPoints ??
    (typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0);

  let pointerCoarse = signals?.pointerCoarse;
  let hoverNone = signals?.hoverNone;
  if (
    (pointerCoarse === undefined || pointerCoarse === null) &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    pointerCoarse = window.matchMedia('(pointer: coarse)').matches;
  }
  if (
    (hoverNone === undefined || hoverNone === null) &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    hoverNone = window.matchMedia('(hover: none)').matches;
  }

  // Phones (classic mobile UA tokens)
  if (
    /iPhone|iPod|Android.*Mobile|Windows Phone|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      ua,
    )
  ) {
    return true;
  }
  // iPad (pre-iPadOS 13 UA still says iPad)
  if (/iPad/i.test(ua)) return true;
  // iPadOS 13+ requests desktop Safari UA ("Macintosh") but is multi-touch
  if (/Macintosh/i.test(ua) && maxTouch > 1) return true;
  // Android tablets often omit "Mobile" in the UA
  if (/Android/i.test(ua) && maxTouch > 0) return true;
  // Generic touch tablet / phone: coarse pointer + no hover + touch points
  if (pointerCoarse && hoverNone && maxTouch > 0) return true;

  return false;
}

/**
 * Hostnames where side live chat is allowed (still requires mobile).
 * Preview channel, live Firebase hosting, and local/dev hosts.
 */
export function isSideLiveChatHostAllowed(
  hostname: string | null | undefined = typeof window !== 'undefined'
    ? window.location.hostname
    : null,
): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  // Firebase preview channel: {project}--desktop-preview-….web.app
  if (h.includes('--desktop-preview-')) return true;
  // Vite / local tunnel hostnames used while developing
  if (h.endsWith('.localhost')) return true;
  if (LIVE_HOSTS.has(h)) return true;
  return false;
}

/**
 * True when side live chat UI + WebRTC/VAD may run.
 * Requires SIDE_LIVE_CHAT_ENABLED, an allowed host (preview / live / local),
 * and a mobile client. Desktop browsers are always gated off.
 */
export function isSideLiveChatEnabled(
  hostname: string | null | undefined = typeof window !== 'undefined'
    ? window.location.hostname
    : null,
  mobile: boolean = typeof window !== 'undefined' ? isMobileClient() : false,
): boolean {
  if (!SIDE_LIVE_CHAT_ENABLED) return false;
  if (!isSideLiveChatHostAllowed(hostname)) return false;
  if (!mobile) return false;
  return true;
}
