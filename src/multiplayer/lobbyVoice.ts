/**
 * Lobby-time voice connect — session owned above Table so React remounts
 * (cut → deal → discard phases) cannot dispose the PeerConnection.
 *
 * Flow: both seats in lobby → Connect voice (mic gesture) → seat 0 offers when
 * both ready; if no offer ~2s, seat 1 backup-offers → answerer =
 * offer.from !== mySeat → green Live → same session carries into the table.
 * Tear down only on Leave room / Quit / Disconnect voice.
 */
import type { SeatRole } from './types';
import {
  VoicePttSession,
  isInitialOffererSeat,
  shouldAnswerRemoteOffer,
  shouldBackupOffer,
  GUEST_NO_OFFER_MSG,
  GUEST_NO_HOST_OFFER_MSG,
  BACKUP_OFFER_WAIT_MS,
  type VoiceSessionCallbacks,
} from './voicePtt';

export { GUEST_NO_OFFER_MSG, GUEST_NO_HOST_OFFER_MSG, BACKUP_OFFER_WAIT_MS, shouldBackupOffer };

/** Seat 0 offers exactly once when both lobby-voice-ready (no mid-hand maze). */
export function shouldOfferOnceWhenBothLobbyReady(opts: {
  mySeat: SeatRole;
  bothLobbyVoiceReady: boolean;
  alreadyPublishedOffer: boolean;
}): boolean {
  return (
    opts.bothLobbyVoiceReady &&
    isInitialOffererSeat(opts.mySeat) &&
    !opts.alreadyPublishedOffer
  );
}

/** Other seat answers once when offer.from !== mySeat. */

/**
 * Production Connect path: when both lobby-voice-ready, seat 0 must publish
 * voice/offer. Unit-tested predicate previously unused by kickNegotiate alone.
 */
export function shouldKickLobbyHostOffer(opts: {
  mySeat: SeatRole;
  bothLobbyVoiceReady: boolean;
  alreadyPublishedOffer: boolean;
}): boolean {
  return shouldOfferOnceWhenBothLobbyReady(opts);
}

/** Drive preferred + backup offer from the lobby Connect effect. */
export function kickLobbyHostOfferIfNeeded(session: VoicePttSession): void {
  if (session.isDisposed()) return;
  // ensureLobbyOffer: seat 0 offers; seat 1 schedules backup + answer path.
  session.ensureLobbyOffer();
  session.kickNegotiate();
}

/** Guest UI: both-ready + still no offer after backup window → Failed. */
export function guestNoHostOfferFailMessage(): string {
  return GUEST_NO_OFFER_MSG;
}

/** Pure: seat 1 should backup-offer when seat 0 stays silent ~2s. */
export function shouldLobbyBackupOffer(opts: {
  mySeat: SeatRole;
  bothLobbyVoiceReady: boolean;
  hasRemoteOffer: boolean;
  hasLocalPublishedOffer: boolean;
  msSinceBothReady: number;
}): boolean {
  if (isInitialOffererSeat(opts.mySeat)) return false;
  return shouldBackupOffer({
    bothReady: opts.bothLobbyVoiceReady,
    hasRemoteOffer: opts.hasRemoteOffer,
    hasLocalPublishedOffer: opts.hasLocalPublishedOffer,
    msSinceBothReady: opts.msSinceBothReady,
    backupWaitMs: BACKUP_OFFER_WAIT_MS,
  });
}

/** Answerer = whoever did not create the offer. */
export function answererIsOfferFromOtherSeat(
  mySeat: SeatRole,
  offerFrom: SeatRole,
): boolean {
  return shouldAnswerRemoteOffer(mySeat, offerFrom);
}

export function shouldAnswerOnceWhenOfferFromOther(opts: {
  mySeat: SeatRole;
  offerFrom: SeatRole | null | undefined;
  alreadyPublishedAnswer: boolean;
}): boolean {
  if (opts.offerFrom === null || opts.offerFrom === undefined) return false;
  if (opts.alreadyPublishedAnswer) return false;
  return shouldAnswerRemoteOffer(opts.mySeat, opts.offerFrom);
}

/**
 * Carry the same WebRTC session into the table — do not tear down on game
 * start / discard / screen changes.
 */
export function shouldCarryVoiceSessionIntoTable(opts: {
  voiceJoined: boolean;
  leavingRoom: boolean;
  disconnectVoice: boolean;
}): boolean {
  return opts.voiceJoined && !opts.leavingRoom && !opts.disconnectVoice;
}

/** Effect cleanup must not dispose a live lobby session while still joined. */
export function shouldDisposeVoiceOnEffectCleanup(opts: {
  stillJoined: boolean;
  intentionalLeave: boolean;
}): boolean {
  if (opts.intentionalLeave) return true;
  if (opts.stillJoined) return false;
  return true;
}

type Held = {
  code: string;
  seat: SeatRole;
  session: VoicePttSession;
};

/** Module-level hold — survives Table mount / StrictMode effect rebinds. */
let held: Held | null = null;

export function getHeldLobbyVoiceSession(): VoicePttSession | null {
  return held?.session ?? null;
}

export function getHeldLobbyVoiceKey(): { code: string; seat: SeatRole } | null {
  if (!held) return null;
  return { code: held.code, seat: held.seat };
}

/**
 * Reuse existing PC for same room+seat, or create a fresh VoicePttSession.
 * Rebinds callbacks so React state updates keep working after remount.
 */
export function shouldRecreateHeldLobbyVoiceSession(opts: {
  disposed: boolean;
  peerLive: boolean;
  hasPc: boolean;
  canPublishReady: boolean;
  started: boolean;
}): boolean {
  if (opts.disposed) return true;
  if (opts.peerLive) return false;
  // Brand-new held session (not started yet) — keep and call start().
  if (!opts.started) return false;
  // Started but cannot publish (no PC / no signaling) — zombie; recreate.
  if (!opts.canPublishReady) return true;
  return false;
}

export function adoptOrCreateLobbyVoiceSession(
  code: string,
  seat: SeatRole,
  callbacks: VoiceSessionCallbacks,
): { session: VoicePttSession; created: boolean } {
  if (held && held.code === code && held.seat === seat && !held.session.isDisposed()) {
    const s = held.session;
    if (
      shouldRecreateHeldLobbyVoiceSession({
        disposed: s.isDisposed(),
        peerLive: s.isPeerLive(),
        hasPc: s.hasPeerConnection(),
        canPublishReady: s.canPublishReady(),
        started: s.hasStarted(),
      })
    ) {
      void s.dispose(false, { stopMic: false });
      held = null;
    } else {
      s.setCallbacks(callbacks);
      return { session: s, created: false };
    }
  }
  // Different room/seat — drop any stale hold without wiping RTDB (caller decides).
  if (held) {
    void held.session.dispose(false, { stopMic: false });
    held = null;
  }
  const session = new VoicePttSession(code, seat, callbacks);
  held = { code, seat, session };
  return { session, created: true };
}

/** Release module hold. clearSignaling / stopMic only when intentional leave. */
export async function releaseLobbyVoiceSession(opts: {
  clearSignaling: boolean;
  stopMic: boolean;
}): Promise<MediaStream | null> {
  const prev = held;
  held = null;
  if (!prev) return null;
  return prev.session.dispose(opts.clearSignaling, { stopMic: opts.stopMic });
}

/** Test helper — drop hold without dispose (unit tests). */
export function __resetLobbyVoiceHoldForTests(): void {
  held = null;
}
