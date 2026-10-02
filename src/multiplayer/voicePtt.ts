/**
 * Online-only WebRTC push-to-talk helpers + session.
 * Signaling via Firebase RTDB under rooms/{code}/voice/.
 * Audio never uploaded to Storage — peer-to-peer only.
 *
 * ICE: Google/Cloudflare STUN first (PC starts immediately). Best-effort TURN
 * (openrelay.metered.ca + optional Metered API) upgrades async — must not block
 * ready/handshake. FreeSTUN/staticauth omitted (unreachable TURN).
 * Ready handshake: after both write voice/ready/{seat}, SEAT 0 IS THE ONLY
 * OFFERER (initial offer, ICE restarts, renegotiation). Seat 1 only answers.
 * If seat 1 needs a new negotiation (no offer yet, late mic, recvonly residue,
 * ICE failed) it writes voice/reoffer = {from:1, at, reason} and seat 0
 * re-offers. No backup offerer, no glare.
 *
 * Every offer carries round = "<hostSid>.<seq>"; the answer echoes it. Seat 0
 * applies an answer only when answer.round === its current local offer round,
 * so a stale answer (earlier round / earlier host session) is dropped quietly.
 *
 * Only seat 0 pre-creates the audio transceiver. JSEP (RFC 9429 §5.10): a remote
 * offer never re-uses a transceiver made by addTransceiver(), so a guest-side
 * pre-created transceiver is orphaned and its mic never reaches the host.
 */
import {
  ref,
  set,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  type Unsubscribe,
  type DatabaseReference,
} from 'firebase/database';
import { getFirebaseDb } from './firebase';
import { normalizeRoomCode } from './roomCode';
import type { SeatRole } from './types';

/**
 * STUN baselines — proven to gather srflx in the wild.
 * Dead hosts intentionally omitted: freeturn.net (NXDOMAIN),
 * freestun.net turn:3478 (CF proxy only — no TURN),
 * staticauth.openrelay.metered.ca (ICE 701 / 3478 timeout).
 */
export const VOICE_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** @deprecated Prefer buildVoiceIceServers(). Sync STUN-only fallback for tests. */
export const VOICE_ICE_SERVERS: RTCIceServer[] = [...VOICE_STUN_SERVERS];

/** Clear error when the browser has no usable RTCPeerConnection constructor. */
export const RTCPEERCONNECTION_MISSING_MSG =
  'RTCPeerConnection unavailable — WebRTC missing or disabled in this browser (use HTTPS Chrome/Edge, check chrome://flags / enterprise policy)';

type RTCPeerConnectionCtor = new (
  configuration?: RTCConfiguration,
) => RTCPeerConnection;

/**
 * Resolve the browser RTCPeerConnection constructor without shadowing the global.
 * Bare `new RTCPeerConnection(...)` throws "X is not a constructor" when the
 * global is undefined/overwritten (Chrome desktop enterprise / flags); phone
 * browsers often still expose a working ctor. Always read from globalThis/window
 * and verify typeof === 'function' before `new`.
 */
export function resolveRTCPeerConnectionCtor(): RTCPeerConnectionCtor {
  const g = globalThis as typeof globalThis & {
    RTCPeerConnection?: RTCPeerConnectionCtor;
    webkitRTCPeerConnection?: RTCPeerConnectionCtor;
  };
  const w =
    typeof window !== 'undefined'
      ? (window as Window & {
          RTCPeerConnection?: RTCPeerConnectionCtor;
          webkitRTCPeerConnection?: RTCPeerConnectionCtor;
        })
      : undefined;
  // Prefer globalThis; fall back to window / legacy webkit. Never assign a
  // same-named local that is not the real constructor.
  const Ctor =
    g.RTCPeerConnection ??
    w?.RTCPeerConnection ??
    g.webkitRTCPeerConnection ??
    w?.webkitRTCPeerConnection ??
    null;
  if (typeof Ctor !== 'function') {
    throw new Error(RTCPEERCONNECTION_MISSING_MSG);
  }
  return Ctor;
}

/** True when voice/ready/{seat} is asserted (handles RTDB array or map shapes). */
export function isSeatVoiceReady(val: unknown, seat: SeatRole): boolean {
  if (val == null || typeof val !== 'object') return false;
  const rec = val as Record<string, unknown>;
  const v = rec[String(seat)] ?? (val as unknown[])[seat as number];
  return v === true || v === 1;
}

/**
 * STUN + best-effort TURN. Never throws; never blocks the ready handshake.
 * Order: proven STUN → openrelay.metered.ca (TCP 3478 reachable) → optional
 * Metered REST (VITE_METERED_TURN_API_URL). FreeSTUN omitted — CF proxies
 * 80/443 only; turn:3478 does not connect. staticauth.openrelay omitted (ICE 701).
 */
export async function buildVoiceIceServers(): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [...VOICE_STUN_SERVERS];

  // Metered Open Relay public demo creds — host resolves + TCP 3478 open from box.
  // Auth may still fail for some regions; Metered REST env overrides when set.
  servers.push(
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:443',
        'turn:global.relay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  );

  // Optional Metered Open Relay REST — set VITE_METERED_TURN_API_URL to the
  // full credentials URL from the Metered dashboard (includes apiKey).
  try {
    const meteredUrl =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      typeof import.meta.env.VITE_METERED_TURN_API_URL === 'string'
        ? String(import.meta.env.VITE_METERED_TURN_API_URL).trim()
        : '';
    if (meteredUrl && typeof fetch === 'function') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(meteredUrl, { signal: ctrl.signal });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          const list = Array.isArray(data)
            ? data
            : data && typeof data === 'object' && Array.isArray((data as { iceServers?: unknown }).iceServers)
              ? (data as { iceServers: RTCIceServer[] }).iceServers
              : null;
          if (list) {
            for (const s of list) {
              if (s && typeof s === 'object' && 'urls' in s) servers.push(s as RTCIceServer);
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    console.warn('voice Metered TURN fetch skipped', e);
  }

  return servers;
}

/**
 * Publish voice/ready/{seat}. Prefer true only when session canPublishReady().
 * Pass ready=false to clear (fail-closed / Leave).
 */
export async function publishSeatVoiceReady(
  code: string,
  seat: SeatRole,
  ready: boolean = true,
): Promise<void> {
  const normalized = normalizeRoomCode(code);
  try {
    await set(ref(getFirebaseDb(), `${voiceRootPath(normalized)}/ready/${seat}`), ready);
  } catch (e) {
    console.warn('voice ready publish failed', e);
  }
}

export interface VoiceSdpPayload {
  type: RTCSdpType;
  sdp: string;
  from: SeatRole;
  at: number;
  /** Negotiation round "<hostSid>.<seq>" — offer sets it, answer echoes it. */
  round?: string;
  /** Answerer (seat 1) session id — lets seat 0 detect a refreshed guest. */
  gsid?: string;
}

export interface VoiceIcePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  from: SeatRole;
  at: number;
  /** Host session id the candidate belongs to (drop candidates of dead sessions). */
  sid?: string;
}

export function voiceRootPath(code: string): string {
  return `rooms/${normalizeRoomCode(code)}/voice`;
}

export function voiceRootRef(code: string): DatabaseReference {
  return ref(getFirebaseDb(), voiceRootPath(code));
}

/** Pure: enable/disable a local audio track for PTT. Returns new enabled state. */
export function setMicTrackEnabled(
  track: MediaStreamTrack | null | undefined,
  enabled: boolean,
): boolean {
  if (!track) return false;
  track.enabled = enabled;
  return track.enabled;
}

/**
 * VAD must analyse an enabled capture track. `MediaStreamTrack.enabled = false`
 * produces silence for every consumer of that track, including Web Audio, so
 * using one track for both the analyser and the WebRTC sender deadlocks: VAD
 * never hears speech and therefore never enables transmission. Keep the source
 * track enabled for the analyser and gate an independent clone on the sender.
 */
export function cloneMicTrackForVad(
  monitorTrack: MediaStreamTrack,
  sendEnabled: boolean,
): MediaStreamTrack {
  monitorTrack.enabled = true;
  const sendTrack = monitorTrack.clone();
  sendTrack.enabled = sendEnabled;
  return sendTrack;
}

/** Pure: shape for talking/{seat} UI flag. */
export function talkingWritePayload(talking: boolean): boolean {
  return talking === true;
}

/** Coerce RTDB seat `from` (number or numeric string) to 0|1, else null. */
export function coerceSeatFrom(value: unknown): SeatRole | null {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  return null;
}

export function isVoiceSdpPayload(value: unknown): value is VoiceSdpPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const from = coerceSeatFrom(v.from);
  if (v.round !== undefined && v.round !== null && typeof v.round !== 'string') return false;
  return (
    (v.type === 'offer' || v.type === 'answer' || v.type === 'pranswer' || v.type === 'rollback') &&
    typeof v.sdp === 'string' &&
    v.sdp.length > 0 &&
    from !== null &&
    typeof v.at === 'number'
  );
}

/**
 * Publish local SDP to RTDB immediately after setLocalDescription.
 * Do NOT await ICE gathering first — cellular Safari can stall gather while
 * trickle ice/{seat} already carries candidates; blocking left answer=0 and
 * host link-watchdog Failed (MT22J).
 */
export function shouldPublishSdpBeforeIceGather(): boolean {
  return true;
}

/**
 * Host must NOT null voice/answer on every offer republish/retry.
 * Clearing while guest is mid-createAnswer/set() races and leaves answer=0 forever
 * (MT22J 12:51 ADT: offer present, answer absent, ice/1 absent).
 * Only clear on ICE restart, or when publishing a distinct new offer after we
 * already had a remote answer (true renegotiation).
 */
export function shouldClearAnswerOnOfferPublish(opts: {
  iceRestart: boolean;
  offerSdpChanged: boolean;
  hadRemoteAnswer: boolean;
  /** Fresh createOffer (new round id). Stale answers are round-filtered anyway. */
  newRound?: boolean;
}): boolean {
  if (opts.newRound) return true;
  if (opts.iceRestart) return true;
  if (opts.offerSdpChanged && opts.hadRemoteAnswer) return true;
  return false;
}

/**
 * Do NOT answer before the mic is on the sender.
 * A recvonly first answer (common when start() sees the host offer before
 * adoptMicStream) left hosts unable to hear seat1 on iOS Safari — renegotiate
 * upgrade was unreliable once ICE was already live one-way.
 * Join always captures mic under the Connect gesture before start(); pending
 * offers stay queued and flush after adoptMicStream/ensureMic.
 */
export function shouldAnswerOfferWithoutMic(): boolean {
  return false;
}

/**
 * After mic lands on the sender, keep the audio transceiver sendrecv.
 * Safari can flip a muted/empty sender to recvonly/inactive.
 */
export function shouldForceAudioSendRecv(opts: { micAttached: boolean }): boolean {
  return opts.micAttached === true;
}

/**
 * Answerer must bump renegotiate after late mic when a prior answer may have
 * been recvonly (or direction drifted). Offerer renegotiates via maybeNegotiate.
 */
export function shouldBumpRenegotiateAfterMicAttach(opts: {
  micAttached: boolean;
  hasPublishedOffer: boolean;
  canCreateOffer: boolean;
  seenRemoteOffer: boolean;
  wroteLocalAnswer: boolean;
}): boolean {
  // Answers wait for mic (shouldAnswerOfferWithoutMic=false) → first answer is
  // already sendrecv. Blind renegotiate bumps after attach/Live tore down
  // working Safari links (Josh: no UI / no sound after 1JGaDOn_).
  if (!shouldAnswerOfferWithoutMic()) return false;
  if (!opts.micAttached) return false;
  if (opts.hasPublishedOffer || opts.canCreateOffer) return false;
  return opts.seenRemoteOffer || opts.wroteLocalAnswer;
}

/**
 * Only bump outbound upgrade on Live when negotiated direction is still
 * recvonly/inactive. sendrecv/sendonly → no renegotiate (avoids ICE thrash).
 */
export function shouldBumpOutboundUpgradeOnLive(opts: {
  micAttached: boolean;
  hasPublishedOffer: boolean;
  canCreateOffer: boolean;
  seenRemoteOffer: boolean;
  wroteLocalAnswer: boolean;
  audioCurrentDirection?: string | null;
}): boolean {
  if (!shouldBumpRenegotiateAfterMicAttach(opts)) return false;
  const dir = opts.audioCurrentDirection;
  return dir === 'recvonly' || dir === 'inactive';
}

/**
 * Keep one remote MediaStream across renegotiate; replace superseded audio
 * tracks so Safari does not stick on an ended silent track.
 */
export function accumulateRemoteAudioTrack(
  existing: MediaStream | null,
  track: MediaStreamTrack,
): MediaStream {
  const stream = existing ?? new MediaStream();
  if (track.kind === 'audio') {
    for (const t of stream.getAudioTracks()) {
      if (t !== track) {
        try {
          stream.removeTrack(t);
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    for (const t of [...stream.getTracks()]) {
      if (t.readyState === 'ended' && t !== track) {
        try {
          stream.removeTrack(t);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (!stream.getTracks().includes(track)) {
    stream.addTrack(track);
  }
  return stream;
}

/**
 * Safari can emit a=inactive/recvonly when createOffer/Answer runs with
 * track.enabled=false. Briefly enable for SDP, then restore VAD gate.
 */
export function captureSendTrackEnabledForSdp(
  track: MediaStreamTrack | null | undefined,
): boolean | null {
  if (!track) return null;
  const was = track.enabled;
  track.enabled = true;
  return was;
}

export function restoreSendTrackEnabledAfterSdp(
  track: MediaStreamTrack | null | undefined,
  was: boolean | null,
): void {
  if (!track || was === null) return;
  track.enabled = was;
}

/** Seat 0 is the ONLY offerer (initial, ICE restart, renegotiation). */
export function isInitialOffererSeat(seat: SeatRole): boolean {
  return seat === 0;
}

/**
 * After both-ready, if no RTDB offer appears, seat 1 asks seat 0 to (re)offer
 * by writing voice/reoffer. It never creates an offer itself (no glare).
 * Pure predicate — unit-tested; VoicePttSession schedules the timer.
 */
export function shouldBackupOffer(opts: {
  bothReady: boolean;
  hasRemoteOffer: boolean;
  hasLocalPublishedOffer: boolean;
  msSinceBothReady: number;
  backupWaitMs?: number;
}): boolean {
  if (!opts.bothReady) return false;
  if (opts.hasRemoteOffer || opts.hasLocalPublishedOffer) return false;
  const wait = opts.backupWaitMs ?? 2000;
  return opts.msSinceBothReady >= wait;
}

/**
 * Seat may createOffer: seat 0 only. `backupOffererActive` is ignored — the
 * old seat-1 backup offer raced seat 0 and produced glare (host answered the
 * guest's offer, then dropped the guest's answer to its own: answer-ignored:stable).
 */
export function shouldCreateOfferAsSeat(opts: {
  mySeat: SeatRole;
  bothReady: boolean;
  alreadyPublishedOffer: boolean;
  backupOffererActive?: boolean;
  hasRemoteOffer: boolean;
}): boolean {
  if (!opts.bothReady || opts.alreadyPublishedOffer) return false;
  if (opts.hasRemoteOffer) return false;
  return isInitialOffererSeat(opts.mySeat);
}

/**
 * @deprecated No glare is possible any more (seat 1 never offers). Kept for
 * older call sites/tests.
 */
export function isPoliteVoicePeer(seat: SeatRole): boolean {
  return !isInitialOffererSeat(seat);
}

/** @deprecated Single-offerer model — no glare path uses this any more. */
export function shouldRollbackLocalOfferOnGlare(opts: {
  mySeat: SeatRole;
  haveLocalOffer: boolean;
  remoteOfferAt: number;
  localOfferAt: number | null;
}): boolean {
  if (!opts.haveLocalOffer) return false;
  // Higher `at` wins when both published — loser rolls back.
  if (
    opts.localOfferAt != null &&
    opts.remoteOfferAt > opts.localOfferAt
  ) {
    return true;
  }
  if (
    opts.localOfferAt != null &&
    opts.remoteOfferAt < opts.localOfferAt
  ) {
    return false;
  }
  // Same/unknown at → polite peer rolls back.
  return isPoliteVoicePeer(opts.mySeat);
}

/**
 * Single deterministic offerer: only seat 1 answers, and only seat 0's offers.
 * Seat 0 NEVER answers (a stale/rogue offer from=1 is ignored) — answering the
 * guest's backup offer is exactly how the host ended up in glare.
 */
export function shouldAnswerRemoteOffer(mySeat: SeatRole, offerFrom: SeatRole): boolean {
  return mySeat === 1 && offerFrom === 0;
}

/** Only seat 0 applies answers, and only answers written by seat 1. */
export function shouldApplyRemoteAnswer(mySeat: SeatRole, answerFrom: SeatRole): boolean {
  return mySeat === 0 && answerFrom === 1;
}

/** Round id for one host negotiation: "<hostSid>.<seq>". */
export function makeVoiceRound(sid: string, seq: number): string {
  return `${sid}.${seq}`;
}

/** Host session id embedded in a round ("" when missing/malformed). */
export function sidFromRound(round: string | null | undefined): string {
  if (!round || typeof round !== 'string') return '';
  const i = round.lastIndexOf('.');
  return i > 0 ? round.slice(0, i) : round;
}

/** Random short id for a PeerConnection session. */
export function makeVoiceSid(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${rnd}`;
}

export type AnswerRoundDecision =
  | 'apply'
  | 'not-mine'
  | 'stale-round'
  | 'no-round'
  | 'not-waiting';

/**
 * Seat 0: apply an answer only for the CURRENT local offer round while
 * have-local-offer. Anything else is dropped quietly (no error status).
 */
export function decideAnswerForRound(opts: {
  mySeat: SeatRole;
  answerFrom: SeatRole;
  answerRound: string | null | undefined;
  currentRound: string | null | undefined;
  signalingState: string | null | undefined;
}): AnswerRoundDecision {
  if (!shouldApplyRemoteAnswer(opts.mySeat, opts.answerFrom)) return 'not-mine';
  if (!opts.answerRound) return 'no-round';
  if (!opts.currentRound || opts.answerRound !== opts.currentRound) return 'stale-round';
  if (opts.signalingState !== 'have-local-offer') return 'not-waiting';
  return 'apply';
}

/** sendrecv / sendonly: this side's sender is negotiated to transmit. */
export function isSendCapableDirection(dir: string | null | undefined): boolean {
  return dir === 'sendrecv' || dir === 'sendonly';
}

/** sendrecv / recvonly: this side is negotiated to receive. */
export function isRecvCapableDirection(dir: string | null | undefined): boolean {
  return dir === 'sendrecv' || dir === 'recvonly';
}

/**
 * Seat 1 asks seat 0 to re-offer when it already negotiated but its audio is
 * not send-capable (late mic / recvonly residue). Never for seat 0.
 */
export function shouldRequestReoffer(opts: {
  seat: SeatRole;
  micAttached: boolean;
  hasNegotiated: boolean;
  negotiatedDir: string | null | undefined;
}): boolean {
  if (isInitialOffererSeat(opts.seat)) return false;
  if (!opts.micAttached || !opts.hasNegotiated) return false;
  return !isSendCapableDirection(opts.negotiatedDir);
}

/** Audio m-line mids in SDP order (a=mid under m=audio). */
export function audioMidsFromSdp(sdp: string | null | undefined): string[] {
  if (!sdp) return [];
  const mids: string[] = [];
  let inAudio = false;
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      inAudio = line.startsWith('m=audio');
      continue;
    }
    if (!inAudio) continue;
    const m = /^a=mid:(\S+)/.exec(line);
    if (m && m[1]) mids.push(m[1]);
  }
  return mids;
}

type TransceiverLike = Pick<RTCRtpTransceiver, 'mid' | 'direction' | 'sender' | 'receiver'> & {
  currentDirection?: RTCRtpTransceiverDirection | null;
  stopped?: boolean;
};

function isAudioTransceiver(tr: TransceiverLike): boolean {
  if (tr.stopped) return false;
  if (tr.currentDirection === 'stopped' || tr.direction === 'stopped') return false;
  const kind = tr.receiver?.track?.kind ?? tr.sender?.track?.kind ?? 'audio';
  return kind === 'audio';
}

/**
 * The transceiver bound to the negotiated audio m-line (first audio mid in the
 * remote SDP), else the first associated audio transceiver. Orphans (mid=null,
 * never negotiated) are never returned.
 */
export function selectNegotiatedAudioTransceiver<T extends TransceiverLike>(
  transceivers: readonly T[],
  remoteSdp?: string | null,
): T | null {
  const audio = transceivers.filter(isAudioTransceiver);
  for (const mid of audioMidsFromSdp(remoteSdp)) {
    const hit = audio.find((tr) => tr.mid === mid);
    if (hit) return hit;
  }
  return audio.find((tr) => tr.mid != null) ?? null;
}

/**
 * The transceiver whose receiver actually carries the peer's audio: negotiated
 * mid + recv-capable currentDirection, in remote SDP order. Falls back to the
 * negotiated audio transceiver (still before currentDirection settles).
 */
export function selectReceiveAudioTransceiver<T extends TransceiverLike>(
  transceivers: readonly T[],
  remoteSdp?: string | null,
): T | null {
  const audio = transceivers.filter(isAudioTransceiver).filter((tr) => tr.mid != null);
  const mids = audioMidsFromSdp(remoteSdp);
  const ordered = mids.length
    ? [
        ...mids
          .map((mid) => audio.find((tr) => tr.mid === mid))
          .filter((tr): tr is T => !!tr),
        ...audio.filter((tr) => !mids.includes(String(tr.mid))),
      ]
    : audio;
  const receiving = ordered.find(
    (tr) => isRecvCapableDirection(tr.currentDirection ?? null) && !!tr.receiver?.track,
  );
  if (receiving) return receiving;
  return ordered.find((tr) => !!tr.receiver?.track) ?? null;
}

/** Count negotiated audio transceivers that are receiving (debug remTracks). */
export function countReceivingAudioTransceivers(
  transceivers: readonly TransceiverLike[],
): number {
  return transceivers.filter(
    (tr) =>
      isAudioTransceiver(tr) &&
      tr.mid != null &&
      !!tr.receiver?.track &&
      isRecvCapableDirection(tr.currentDirection ?? null),
  ).length;
}

export interface InboundAudioStats {
  bytesReceived: number | null;
  audioLevel: number | null;
}

/**
 * Pull inbound-rtp audio bytesReceived / audioLevel from getStats(). Prefers
 * the entry whose trackIdentifier matches the bound receive track; otherwise
 * the busiest inbound audio stream. Falls back to legacy `track` audioLevel.
 */
export function extractInboundAudioStats(
  report: { forEach: (cb: (value: unknown) => void) => void } | null | undefined,
  trackId?: string | null,
): InboundAudioStats {
  const out: InboundAudioStats = { bytesReceived: null, audioLevel: null };
  if (!report) return out;
  let best: Record<string, unknown> | null = null;
  let legacyLevel: number | null = null;
  report.forEach((raw) => {
    const s = raw as Record<string, unknown>;
    if (!s || typeof s !== 'object') return;
    const kind = s.kind ?? s.mediaType;
    if (s.type === 'inbound-rtp' && kind === 'audio') {
      if (trackId && s.trackIdentifier === trackId) {
        best = s;
        return;
      }
      if (
        !best ||
        (!(trackId && best.trackIdentifier === trackId) &&
          Number(s.bytesReceived ?? 0) > Number(best.bytesReceived ?? 0))
      ) {
        best = s;
      }
    } else if (
      s.type === 'track' &&
      s.kind === 'audio' &&
      s.remoteSource === true &&
      typeof s.audioLevel === 'number'
    ) {
      legacyLevel = s.audioLevel;
    }
  });
  const b = best as Record<string, unknown> | null;
  if (b) {
    if (typeof b.bytesReceived === 'number') out.bytesReceived = b.bytesReceived;
    if (typeof b.audioLevel === 'number') out.audioLevel = b.audioLevel;
  }
  if (out.audioLevel == null && legacyLevel != null) out.audioLevel = legacyLevel;
  return out;
}

/**
 * Fail closed: never publish ready/{seat} without an active VoicePttSession
 * that already bound PC + signaling (can answer). Heartbeat-without-session
 * left ready=[true,true] with ice/0 empty + answer absent forever (A6BDG / MT22J).
 */
export function shouldPublishVoiceReady(opts: {
  hasActiveSession: boolean;
  hasPc: boolean;
  signalingBound: boolean;
}): boolean {
  return (
    opts.hasActiveSession === true &&
    opts.hasPc === true &&
    opts.signalingBound === true
  );
}

/**
 * Ready must not stick before the mic is on the sender when answers wait for mic.
 * Cn2CEX15 still re-asserted ready via stayReady before adoptMicStream → bothReady
 * → offer → answer-wait-mic → 3.5s link watchdog ICE-restart (one-way / drops).
 */
export function shouldAnnounceVoiceReady(opts: {
  canPublishReady: boolean;
  micAttached: boolean;
}): boolean {
  return opts.canPublishReady === true && opts.micAttached === true;
}

/** stayReady / heartbeat re-publish — same mic gate as announce. */
export function shouldReassertVoiceReady(opts: {
  stayReady: boolean;
  canPublishReady: boolean;
  micAttached: boolean;
  mineAlreadyReady: boolean;
}): boolean {
  if (!opts.stayReady) return false;
  if (opts.mineAlreadyReady) return false;
  return shouldAnnounceVoiceReady({
    canPublishReady: opts.canPublishReady,
    micAttached: opts.micAttached,
  });
}

/**
 * Link watchdog ICE-restart only after SDP answer exists (or long grace).
 * Firing at bothReady+3.5s while guest still attach/answer thrashed Safari.
 */
export function shouldRunLinkWatchdogIceRestart(opts: {
  bothReady: boolean;
  isPeerLive: boolean;
  micAttached: boolean;
  hasAnswer: boolean;
  msSinceBothReady: number;
  graceMs: number;
  answerGraceMs: number;
}): boolean {
  if (!opts.bothReady || opts.isPeerLive) return false;
  if (!opts.micAttached) return false;
  if (opts.hasAnswer) {
    return opts.msSinceBothReady >= opts.graceMs;
  }
  // No answer yet — wait much longer (peer may still be creatingAnswer).
  return opts.msSinceBothReady >= opts.answerGraceMs;
}

/** Parse first audio m= direction from SDP (a=sendrecv|sendonly|recvonly|inactive). */
export function audioDirectionFromSdp(sdp: string | null | undefined): string | null {
  if (!sdp) return null;
  const lines = sdp.split(/\r?\n/);
  let inAudio = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inAudio = line.startsWith('m=audio');
      continue;
    }
    if (!inAudio) continue;
    const m = /^a=(sendrecv|sendonly|recvonly|inactive)/.exec(line);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Joined UI + ready heartbeat must surface Failed when PC/signaling died. */
export const VOICE_SESSION_DEAD_MSG = 'Voice session dead — tap Connect voice again';

/** Force createAnswer within this window after a remote offer (backup from=1). */
export const ANSWER_FORCE_MS = 1000;

export function isVoiceIcePayload(value: unknown): value is VoiceIcePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.candidate === 'string' &&
    v.candidate.length > 0 &&
    coerceSeatFrom(v.from) !== null &&
    typeof v.at === 'number'
  );
}

export function buildSdpPayload(
  desc: RTCSessionDescriptionInit,
  from: SeatRole,
  at: number = Date.now(),
  extra: { round?: string | null; gsid?: string | null } = {},
): VoiceSdpPayload {
  const payload: VoiceSdpPayload = {
    type: (desc.type ?? 'offer') as RTCSdpType,
    sdp: desc.sdp ?? '',
    from,
    at,
  };
  // RTDB rejects `undefined` values — only add keys that are set.
  if (extra.round) payload.round = extra.round;
  if (extra.gsid) payload.gsid = extra.gsid;
  return payload;
}

export function buildIcePayload(
  candidate: RTCIceCandidate,
  from: SeatRole,
  at: number = Date.now(),
  sid?: string | null,
): VoiceIcePayload {
  const payload: VoiceIcePayload = {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    from,
    at,
  };
  if (sid) payload.sid = sid;
  return payload;
}

export type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'live'
  | 'denied'
  | 'error';

export interface VoiceSessionCallbacks {
  onStatus?: (status: VoiceSessionStatus, detail?: string) => void;
  onRemoteTalking?: (talking: boolean) => void;
  /** New MediaStream object whenever the bound receive track changes. */
  onRemoteStream?: (stream: MediaStream | null) => void;
  /** Receive track re-checked after (re)negotiation — kick <audio>.play(). */
  onRemoteRebind?: (reason: string) => void;
}

export const MIC_BLOCKED_HINT =
  'Allow microphone, then tap Connect voice';

const HOLD_LIVE_RESTART_MS = 2000;
/**
 * After both-ready + answer, auto ICE-restart once if still not live.
 * Was 3500ms from bothReady alone — too early while answer-wait-mic / Safari ICE.
 */
export const LINK_WATCHDOG_MS = 8000;
/** Without any answer yet, wait this long before ICE-restart (guest mid-answer). */
export const LINK_WATCHDOG_NO_ANSWER_MS = 14000;
/** After ICE restart still not live → surface failed (no infinite CONNECTING). */
const LINK_FAIL_MS = 10000;
/** Re-publish ready while waiting so peer remounts cannot strand us false. */
const READY_HEARTBEAT_MS = 2500;
/** Stuck waiting for peer ready — clearer copy, then failed. */
/** Guest/host waiting on peerReady=0 — hint then Failed (no infinite CONNECTING). */
const PEER_WAIT_HINT_MS = 5000;
/** ~15s with peerReady still 0 → Failed (was 45s / infinite CONNECTING). */
export const PEER_WAIT_FAIL_MS = 15000;
/** Status while local ready but peer has not tapped Connect voice. */
export const WAITING_FOR_HOST_CONNECT_MSG = 'Waiting for host to tap Connect voice';
/** Host (or anyone) waiting on the other seat after local ready. */
export const WAITING_FOR_PEER_CONNECT_MSG = 'Waiting for opponent to tap Connect voice';

/** Pure: 15s Failed only after localReady and peer still not ready. */
export function shouldPeerWaitFailClosed(opts: {
  localReady: boolean;
  peerReady: boolean;
  bothReady: boolean;
  isPeerLive: boolean;
}): boolean {
  if (!opts.localReady) return false;
  if (opts.peerReady || opts.bothReady || opts.isPeerLive) return false;
  return true;
}
/** Offerer: retry createOffer while both-ready (mic preferred) until live / Failed. */
const OFFER_RETRY_MS = 1000;
/** Seat 1: if no RTDB offer after both-ready, request a re-offer (never offers). */
export const BACKUP_OFFER_WAIT_MS = 2000;
/** Seat 1 re-offer request throttle / cap (per PeerConnection). */
export const REOFFER_MIN_GAP_MS = 2500;
export const REOFFER_MAX_PER_PC = 6;
/** Seat 0: re-offers it may issue on its own when the guest is not sending. */
const HOST_RECV_REOFFER_MAX = 2;
/** getStats refresh for inBytes / audioLevel debug. */
export const RECV_STATS_MS = 2000;
/**
 * Fail only after backup window + grace — still no offer from anyone.
 * Timeline: t=0 bothReady → t=2s backup offers → t≈5s fail if still none.
 */
const GUEST_OFFER_WAIT_MS = BACKUP_OFFER_WAIT_MS + 3000;
/** Host: both-ready but mic never attached → Failed. */
const HOST_MIC_WAIT_MS = 8000;
/** If mic still missing ~1s after both-ready, offer anyway (transceiver exists). */
const HOST_OFFER_WITHOUT_MIC_MS = 1000;
/** Guest statusDetail when nobody published voice/offer (after backup attempt). */
export const GUEST_NO_OFFER_MSG = 'No offer — reconnect';
/** @deprecated alias — prefer GUEST_NO_OFFER_MSG */
export const GUEST_NO_HOST_OFFER_MSG = GUEST_NO_OFFER_MSG;
/** Offerer statusDetail when offer never lands in RTDB. */
export const HOST_OFFER_PUBLISH_FAIL_MSG =
  "Offer never published — Disconnect and Connect again";

/**
 * One WebRTC PTT link for a seat in a room.
 * Mic starts muted (track.enabled = false); PTT toggles enabled.
 */
/** Preview debug snapshot for the side-chat badge. */
export interface VoiceLinkDebugSnapshot {
  readyMe: boolean;
  peerReady: boolean;
  bothReady: boolean;
  hasOffer: boolean;
  hasAnswer: boolean;
  /** Guest: offer listener fired. Host: same as hasOffer. */
  seenOffer: boolean;
  /** Guest: answer written to RTDB. Host: remote answer applied. */
  wroteAnswer: boolean;
  /** RTDB voice/answer present (host listener / guest write success). */
  rtdbAnswer: boolean;
  ice: string;
  conn: string;
  micAttached: boolean;
  seat: SeatRole;
  /** Local audio transceiver currentDirection (or SDP parse). */
  sendDir?: string;
  /** Sender clone track.enabled (VAD gate). */
  sendEnabled?: boolean;
  /** Latest voice/diag/{seat} string (answer/createAnswer failures). */
  diag?: string;
  /** Short last error for the debug line. */
  lastErr?: string;
  /** Receive transceiver currentDirection (the one bound to remote <audio>). */
  recvDir?: string;
  /** inbound-rtp audio bytesReceived (refreshed ~2s). */
  inBytes?: number | null;
  /** inbound-rtp audioLevel 0..1 when the browser reports it. */
  audioLevel?: number | null;
  /** Negotiated audio transceivers currently receiving. */
  remTracks?: number;
  /** Total transceivers on the PC (orphans show up as txc>remTracks). */
  txc?: number;
  /** Persistent remote <audio> paused state (filled by the hook). */
  audioPaused?: boolean | null;
  /** Current negotiation round id (seat0: local offer; seat1: answered offer). */
  round?: string | null;
}

/** Short round tag for the debug line: "<sid tail>.<seq>". */
export function shortVoiceRound(round: string | null | undefined): string {
  if (!round) return '-';
  const sid = sidFromRound(round);
  const seq = round.slice(sid.length + 1);
  return `${sid.slice(-4)}.${seq || '?'}`;
}

export function formatVoiceLinkDebug(d: VoiceLinkDebugSnapshot): string {
  const diag = (d.diag ?? '').trim();
  const lastErr = (d.lastErr ?? '').trim();
  const sendDir = (d.sendDir ?? '').trim() || 'none';
  const sendEn =
    d.sendEnabled === undefined ? '-' : d.sendEnabled ? '1' : '0';
  const recvDir = (d.recvDir ?? '').trim() || 'none';
  const inBytes =
    typeof d.inBytes === 'number' && Number.isFinite(d.inBytes)
      ? String(Math.round(d.inBytes))
      : '-';
  const audioLevel =
    typeof d.audioLevel === 'number' && Number.isFinite(d.audioLevel)
      ? d.audioLevel.toFixed(3)
      : '-';
  const remTracks = typeof d.remTracks === 'number' ? String(d.remTracks) : '-';
  const txc = typeof d.txc === 'number' ? String(d.txc) : '-';
  const audioPaused =
    d.audioPaused === undefined || d.audioPaused === null
      ? '-'
      : d.audioPaused
        ? '1'
        : '0';
  return (
    `readyMe=${d.readyMe ? 1 : 0} peerReady=${d.peerReady ? 1 : 0} ` +
    `bothReady=${d.bothReady ? 1 : 0} micAttached=${d.micAttached ? 1 : 0} ` +
    `offer=${d.hasOffer ? 1 : 0} answer=${d.hasAnswer ? 1 : 0} ` +
    `seenOffer=${d.seenOffer ? 1 : 0} wroteAnswer=${d.wroteAnswer ? 1 : 0} ` +
    `rtdbAnswer=${d.rtdbAnswer ? 1 : 0} ` +
    `sendDir=${sendDir} sendEn=${sendEn} ` +
    `recvDir=${recvDir} inBytes=${inBytes} audioLevel=${audioLevel} ` +
    `remTracks=${remTracks} txc=${txc} audioPaused=${audioPaused} ` +
    `round=${shortVoiceRound(d.round)} ` +
    `ice=${d.ice || 'none'} conn=${d.conn || 'none'} seat=${d.seat}` +
    (diag ? ` diag=${diag}` : '') +
    (lastErr ? ` lastErr=${lastErr}` : '')
  );
}

export class VoicePttSession {
  readonly code: string;
  readonly seat: SeatRole;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private localTrack: MediaStreamTrack | null = null;
  /** Accumulated remote audio — survives renegotiate track swaps. */
  private remoteStream: MediaStream | null = null;
  private unsubs: Unsubscribe[] = [];
  private started = false;
  private makingOffer = false;
  private disposed = false;
  private micRequested = false;
  /** Set when offer deferred (not stable); retry after answer lands. */
  private needsRenegotiate = false;
  /** Queue remote ICE until setRemoteDescription has applied (tagged by host sid). */
  private pendingRemoteIce: Array<{ init: RTCIceCandidateInit; sid?: string }> = [];
  /** This PeerConnection's session id (seat0: embedded in every round). */
  private sid = '';
  /** Seat 0 round counter for the current sid. */
  private roundSeq = 0;
  /** Seat 0: round of the current local offer. Seat 1: round of the last applied offer. */
  private currentRound: string | null = null;
  /** Seat 1: host sid of the offer applied to this PC. */
  private remoteSid: string | null = null;
  /** Seat 0: guest session id of the applied answer. */
  private appliedGuestSid: string | null = null;
  /** Seat 0: the one audio transceiver we created (sole offerer). */
  private hostAudioTransceiver: RTCRtpTransceiver | null = null;
  /** Latest ICE servers (STUN + async TURN) — reused if the PC is rebuilt. */
  private iceServers: RTCIceServer[] = [...VOICE_STUN_SERVERS];
  /** Seat 1 re-offer request throttle. */
  private reofferRequests = 0;
  private lastReofferAt = 0;
  /** Seat 0: last voice/reoffer `at` acted on. */
  private lastHandledReofferAt = 0;
  /** Seat 0: self-issued re-offers because the guest was not sending. */
  private hostRecvReoffers = 0;
  /** Receive diagnostics. */
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private inBytes: number | null = null;
  private inAudioLevel: number | null = null;
  /** Host may ICE-restart once after failed. */
  private iceRestartAttempted = false;
  /** Host may ICE-restart once after Hold while !live (post both-ready). */
  private iceRestartAfterHoldAttempted = false;
  private holdLiveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host auto ICE-restart once after both-ready if link never goes live. */
  private linkWatchdogAttempted = false;
  private linkWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private linkFailTimer: ReturnType<typeof setTimeout> | null = null;
  private readyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private peerWaitHintTimer: ReturnType<typeof setTimeout> | null = null;
  private peerWaitFailTimer: ReturnType<typeof setTimeout> | null = null;
  /** Both seats wrote voice/ready/{seat}. */
  private bothReady = false;
  /** True from start() until dispose — re-assert ready / heartbeat while Joined. */
  private stayReady = false;
  /** Mic track on sender — guest must not answer offers before this. */
  private micAttached = false;
  /** One-shot sendrecv upgrade after Live (late mic / recvonly residue). */
  private outboundUpgradeAttempted = false;
  private pendingRemoteOffer: VoiceSdpPayload | null = null;
  private callbacks: VoiceSessionCallbacks;
  private offerRetryTimer: ReturnType<typeof setInterval> | null = null;
  private guestOfferWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private hostMicWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private hostOfferWithoutMicTimer: ReturnType<typeof setTimeout> | null = null;
  private hostOfferPublishFailTimer: ReturnType<typeof setTimeout> | null = null;
  /** After both-ready grace, allow createOffer even if mic attach lagged. */
  private allowOfferWithoutMic = false;
  /** Seat 1: timer that requests a re-offer when no offer lands. */
  private backupOfferTimer: ReturnType<typeof setTimeout> | null = null;
  private bothReadyAt: number | null = null;
  private seenRemoteOffer = false;
  private seenRemoteAnswer = false;
  /** Host: last RTDB answer snap was a valid SDP payload (not wiped). */
  private rtdbAnswerPresent = false;
  /** Host: last offer SDP published to RTDB (detect distinct renegotiate). */
  private lastPublishedOfferSdp: string | null = null;
  /** Guest successfully wrote rooms/.../voice/answer to RTDB. */
  private wroteLocalAnswer = false;
  private makingAnswer = false;
  private answerRetryTimer: ReturnType<typeof setInterval> | null = null;
  /** One-shot: force onRemoteOffer within ANSWER_FORCE_MS of seeing remote offer. */
  private answerForceTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once bindSignaling() attached RTDB listeners. */
  private signalingBound = false;
  private localReadyFlag = false;
  private remoteReadyFlag = false;
  /** Latest diag string published to voice/diag/{seat}. */
  private lastDiag = '';
  /** Short last error for debugLine. */
  private lastErr = '';

  constructor(code: string, seat: SeatRole, callbacks: VoiceSessionCallbacks = {}) {
    this.code = normalizeRoomCode(code);
    this.seat = seat;
    this.callbacks = callbacks;
  }

  /** Rebind React status listeners without recreating the PeerConnection. */
  setCallbacks(callbacks: VoiceSessionCallbacks): void {
    this.callbacks = callbacks;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** True after start() began (even if PC later cleared on failure). */
  hasStarted(): boolean {
    return this.started;
  }

  /** True when RTCPeerConnection exists and session is not disposed. */
  hasPeerConnection(): boolean {
    return !!this.pc && !this.disposed;
  }

  /** True after bindSignaling(); false after dispose. */
  isSignalingBound(): boolean {
    return this.signalingBound && !this.disposed && this.unsubs.length > 0;
  }

  /** Ready heartbeat / Join poll — fail closed without PC + listeners. */
  canPublishReady(): boolean {
    return shouldPublishVoiceReady({
      hasActiveSession: this.started && !this.disposed,
      hasPc: !!this.pc,
      signalingBound: this.signalingBound && this.unsubs.length > 0,
    });
  }

  get hasMic(): boolean {
    return !!this.localTrack;
  }

  /** True when peer/ICE path is up. */
  isPeerLive(): boolean {
    if (!this.pc) return false;
    const conn = this.pc.connectionState;
    const ice = this.pc.iceConnectionState;
    return conn === 'connected' || ice === 'connected' || ice === 'completed';
  }

  /**
   * Create PC + bind signaling. By default announces ready/{seat}.
   * Pass { announceReady: false } when the caller will attach a mic first
   * (side live chat) then call announceReady().
   */
  async start(opts: { announceReady?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    // Recover from a partial start (PC threw / signaling failed) so Connect retry
    // on the held session is not a silent no-op (started=true, pc=null).
    if (this.started && this.pc && this.signalingBound) return;
    if (this.started && !this.pc) {
      this.started = false;
      this.signalingBound = false;
    }
    this.started = true;
    const shouldAnnounce = opts.announceReady !== false;
    this.stayReady = false;
    this.micAttached = false;
    this.outboundUpgradeAttempted = false;
    this.remoteStream = null;
    this.pendingRemoteOffer = null;
    this.wroteLocalAnswer = false;
    this.makingAnswer = false;
    this.seenRemoteOffer = false;
    this.seenRemoteAnswer = false;
    this.rtdbAnswerPresent = false;
    this.lastPublishedOfferSdp = null;
    this.bothReadyAt = null;
    this.signalingBound = false;
    this.sid = makeVoiceSid();
    this.roundSeq = 0;
    this.currentRound = null;
    this.remoteSid = null;
    this.appliedGuestSid = null;
    this.reofferRequests = 0;
    this.lastReofferAt = 0;
    this.lastHandledReofferAt = 0;
    this.hostRecvReoffers = 0;
    this.pendingRemoteIce = [];
    this.inBytes = null;
    this.inAudioLevel = null;
    this.lastDiag = '';
    this.lastErr = '';
    this.bothReady = false;
    this.linkWatchdogAttempted = false;
    this.iceRestartAttempted = false;
    this.iceRestartAfterHoldAttempted = false;
    // Stay connecting until local ready publishes; do NOT start 15s peer-wait
    // Failed until readyMe=1 (unjoined / readyMe=0 must pulse Connect, not Failed).
    this.callbacks.onStatus?.('connecting', 'Connecting voice…');

    // Do NOT write ready/{seat}=false here — a remount that cancels before
    // announceReady() used to leave the seat stranded false forever while the
    // UI still showed Leave + CONNECTING. Ready is only cleared on full dispose.

    if (this.disposed) return;

    try {
    // STUN-only PC synchronously — NEVER await TURN/HMAC/fetch before the PC
    // exists. Host used to await buildVoiceIceServers + offer/answer clear here;
    // when that stalled, announceReady never ran → RTDB ready=[null,true] (NCM5X).
    // Resolve ctor via globalThis/window — bare `new RTCPeerConnection` throws
    // "is not a constructor" when the global is undefined/overwritten (Josh PC).
    this.iceServers = [...VOICE_STUN_SERVERS];
    this.createPeerConnection();

    // Bind listeners BEFORE any awaited RTDB writes so we never miss snapshots.
    this.bindSignaling();
    this.signalingBound = true;

    // Soft reset — fire-and-forget so a slow/hung Firebase update cannot strand
    // ready. Only clears THIS seat's ICE; host clears stale SDP without awaiting.
    void this.resetSignalingSoft();

    // Best-effort TURN upgrade (async). STUN already works for many NATs.
    void this.upgradeIceWithTurn();
    this.startRecvStatsLoop();

    // stayReady from PC bind so peer Leave cannot strand us — but do NOT write
    // ready/{seat}=true before mic when caller passes announceReady:false.
    // bothReady-before-mic + shouldAnswerOfferWithoutMic=false deferred answers
    // until the 3.5s link watchdog ICE-restarted and killed the link (1JGaDOn_).
    // Side live chat: start({announceReady:false}) → adoptMic → announceReady().
    this.stayReady = true;
    if (shouldAnnounce) {
      await this.announceReady();
    }

    // Stay on 'connecting' — never claim 'ready' just because PC exists.
    // Host offers only when both ready/{0} and ready/{1} are true (via listener).
    } catch (e) {
      // Leave session restartable: clear PC/signaling so retry is not a no-op.
      console.warn('voice start failed', e);
      this.stayReady = false;
      this.signalingBound = false;
      for (const u of this.unsubs) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
      this.unsubs = [];
      try {
        this.pc?.close();
      } catch {
        /* ignore */
      }
      this.pc = null;
      this.started = false;
      throw e;
    }
  }

  /**
   * Create the RTCPeerConnection + handlers. Only seat 0 (sole offerer)
   * pre-creates the audio transceiver: per JSEP §5.10 a remote offer never
   * re-uses an addTransceiver() transceiver, so a guest-side one was orphaned
   * (mid=null) while the guest mic sat on its sender — host deaf.
   */
  private createPeerConnection(): RTCPeerConnection {
    // Resolve ctor via globalThis/window — bare `new RTCPeerConnection` throws
    // "is not a constructor" when the global is undefined/overwritten (Josh PC).
    const PeerConnection = resolveRTCPeerConnectionCtor();
    const pc = new PeerConnection({ iceServers: [...this.iceServers] });
    this.pc = pc;
    this.hostAudioTransceiver = null;
    this.remoteStream = null;
    if (isInitialOffererSeat(this.seat)) {
      this.hostAudioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.localTrack) {
        void this.hostAudioTransceiver.sender.replaceTrack(this.localTrack).catch((e) => {
          console.warn('voice host bind mic on new PC', e);
        });
      }
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || this.disposed || this.pc !== pc) return;
      const iceRef = push(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ice/${this.seat}`));
      // Tag with the HOST sid this candidate belongs to (seat0: own; seat1: answered host).
      const tag = isInitialOffererSeat(this.seat) ? this.sid : this.remoteSid;
      void set(iceRef, buildIcePayload(ev.candidate, this.seat, Date.now(), tag));
    };

    pc.ontrack = () => {
      if (this.pc !== pc) return;
      this.rebindRemoteAudio('ontrack');
    };

    pc.onnegotiationneeded = () => {
      // Sole offerer only, and never before both seats are ready.
      if (this.pc !== pc || !isInitialOffererSeat(this.seat) || !this.bothReady) return;
      void this.maybeNegotiate();
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.handlePeerStateChange();
    };

    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.handlePeerStateChange();
    };
    return pc;
  }

  /** Detach + close the current PC (rebuild / dispose helper). */
  private closeCurrentPeerConnection(): void {
    const old = this.pc;
    this.pc = null;
    this.hostAudioTransceiver = null;
    if (!old) return;
    try {
      old.onicecandidate = null;
      old.ontrack = null;
      old.onconnectionstatechange = null;
      old.oniceconnectionstatechange = null;
      old.onnegotiationneeded = null;
      old.close();
    } catch {
      /* ignore */
    }
  }

  /**
   * Seat 1: a new host session (different sid) is offering while our PC still
   * holds the dead host's DTLS/ICE. Start a fresh PC — keep the mic.
   */
  private rebuildGuestPeerConnection(newSid: string): void {
    this.closeCurrentPeerConnection();
    this.pendingRemoteIce = this.pendingRemoteIce.filter((c) => !c.sid || c.sid === newSid);
    this.wroteLocalAnswer = false;
    this.currentRound = null;
    this.remoteSid = newSid;
    this.reofferRequests = 0;
    this.outboundUpgradeAttempted = false;
    this.inBytes = null;
    this.inAudioLevel = null;
    this.callbacks.onRemoteStream?.(null);
    void remove(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ice/${this.seat}`)).catch(
      () => undefined,
    );
    this.createPeerConnection();
    void this.publishVoiceDiag('guest-pc-rebuild');
  }

  /**
   * Seat 0: the guest re-joined with a new PeerConnection while ours is bound
   * to the old guest's DTLS. Fresh PC + new sid, then offer round 1.
   */
  private rebuildHostPeerConnection(reason: string): void {
    this.closeCurrentPeerConnection();
    this.sid = makeVoiceSid();
    this.roundSeq = 0;
    this.currentRound = null;
    this.appliedGuestSid = null;
    this.lastPublishedOfferSdp = null;
    this.seenRemoteAnswer = false;
    this.rtdbAnswerPresent = false;
    this.pendingRemoteIce = [];
    this.makingOffer = false;
    this.needsRenegotiate = false;
    this.iceRestartAttempted = false;
    this.iceRestartAfterHoldAttempted = false;
    this.linkWatchdogAttempted = false;
    this.outboundUpgradeAttempted = false;
    this.hostRecvReoffers = 0;
    this.inBytes = null;
    this.inAudioLevel = null;
    this.callbacks.onRemoteStream?.(null);
    void remove(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ice/${this.seat}`)).catch(
      () => undefined,
    );
    this.createPeerConnection();
    void this.publishVoiceDiag(`host-pc-rebuild:${reason}`);
    if (this.bothReady) {
      void this.maybeNegotiate();
      this.startOfferRetryLoop();
    }
  }

  /**
   * Non-blocking tidy at start(). Seat 1 clears only its ICE. Seat 0 — the
   * sole SDP writer — also drops stale offer/answer/reoffer from any earlier
   * session (hard refresh leaves them in RTDB). Safe: ready is mic-gated, so
   * this write is issued before our first offer and RTDB keeps client order.
   */
  private async resetSignalingSoft(): Promise<void> {
    try {
      if (isInitialOffererSeat(this.seat)) {
        await update(voiceRootRef(this.code), {
          [`ice/${this.seat}`]: null,
          offer: null,
          answer: null,
          reoffer: null,
          renegotiate: null,
        });
      } else {
        await remove(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ice/${this.seat}`));
      }
    } catch (e) {
      console.warn('voice signaling reset', e);
    }
  }

  /** Async TURN inject after STUN PC is already up. */
  private async upgradeIceWithTurn(): Promise<void> {
    try {
      const iceServers = await buildVoiceIceServers();
      if (this.disposed || !this.pc) return;
      this.iceServers = iceServers;
      this.pc.setConfiguration({ iceServers });
    } catch (e) {
      console.warn('voice TURN upgrade skipped', e);
    }
  }

  /** The transceiver our mic must ride on (seat0: own; seat1: negotiated mid). */
  private sendTransceiver(): RTCRtpTransceiver | null {
    if (!this.pc) return null;
    if (isInitialOffererSeat(this.seat)) {
      const tr = this.hostAudioTransceiver;
      if (tr && !(tr as { stopped?: boolean }).stopped) return tr;
      return null;
    }
    return selectNegotiatedAudioTransceiver(
      this.pc.getTransceivers(),
      this.pc.remoteDescription?.sdp ?? null,
    );
  }

  /** Transceiver whose receiver carries the peer's audio. */
  private receiveTransceiver(): RTCRtpTransceiver | null {
    if (!this.pc) return null;
    return selectReceiveAudioTransceiver(
      this.pc.getTransceivers(),
      this.pc.remoteDescription?.sdp ?? null,
    );
  }

  /** Put localTrack on the negotiated sender + sendrecv. False if no m-line yet. */
  private async bindLocalTrackToSender(): Promise<boolean> {
    const tr = this.sendTransceiver();
    if (!tr || !this.localTrack) return false;
    try {
      if (tr.direction !== 'sendrecv') tr.direction = 'sendrecv';
    } catch (e) {
      console.warn('voice bind sendrecv', e);
    }
    if (tr.sender.track !== this.localTrack) {
      try {
        await tr.sender.replaceTrack(this.localTrack);
      } catch (e) {
        console.warn('voice bind replaceTrack', e);
        return false;
      }
    }
    return true;
  }

  /**
   * Bind the remote <audio> to the receiver track of the transceiver that
   * actually carries the peer's audio. Emits a NEW MediaStream whenever that
   * track changes so React re-binds srcObject (Safari ignores in-place
   * addTrack on an already-playing srcObject).
   */
  private rebindRemoteAudio(reason: string): void {
    if (!this.pc || this.disposed) return;
    const tr = this.receiveTransceiver();
    const track = tr?.receiver?.track ?? null;
    if (!track) return;
    track.enabled = true;
    const current = this.remoteStream?.getAudioTracks?.()[0] ?? null;
    if (current !== track || !this.remoteStream) {
      this.remoteStream = new MediaStream([track]);
      this.callbacks.onRemoteStream?.(this.remoteStream);
    }
    this.callbacks.onRemoteRebind?.(reason);
  }

  /** Refresh inbound-rtp bytes / audioLevel every RECV_STATS_MS. */
  private startRecvStatsLoop(): void {
    if (this.statsTimer != null) return;
    this.statsTimer = setInterval(() => {
      void this.refreshRecvStats();
    }, RECV_STATS_MS);
  }

  private async refreshRecvStats(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.disposed || typeof pc.getStats !== 'function') return;
    try {
      const report = await pc.getStats();
      if (this.pc !== pc) return;
      const trackId = this.receiveTransceiver()?.receiver?.track?.id ?? null;
      const st = extractInboundAudioStats(report, trackId);
      this.inBytes = st.bytesReceived;
      this.inAudioLevel = st.audioLevel;
    } catch {
      /* stats are best-effort */
    }
  }

  /**
   * Publish voice/ready/{seat}=true so the peer handshake can proceed.
   * Safe to call more than once; no-ops if disposed.
   */
  async announceReady(): Promise<void> {
    if (this.disposed || !this.started) return;
    if (
      !shouldAnnounceVoiceReady({
        canPublishReady: this.canPublishReady(),
        micAttached: this.micAttached,
      })
    ) {
      if (!this.canPublishReady()) {
        await this.failClosedDeadSession();
      } else {
        // Mic not on sender yet — do not write ready (defeats wait-for-mic answers).
        void this.publishVoiceDiag('ready-wait-mic');
      }
      return;
    }
    try {
      await set(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ready/${this.seat}`), true);
      // Optimistic readyMe: RTDB onValue lags the write. Concurrent offer/answer
      // errors must not see readyMe=0 and abort Connect before the listener fires.
      this.localReadyFlag = true;
    } catch (e) {
      console.warn('voice ready write failed', e);
    }
    this.startReadyHeartbeat();
  }

  /** Publish voice/diag/{seat} so host debug can see guest createAnswer / write failures. */
  private async publishVoiceDiag(msg: string): Promise<void> {
    const trimmed = (msg || '').slice(0, 240);
    this.lastDiag = trimmed;
    this.lastErr = trimmed.split(':')[0]?.slice(0, 64) || trimmed.slice(0, 64);
    if (this.disposed) return;
    try {
      await set(
        ref(getFirebaseDb(), `${voiceRootPath(this.code)}/diag/${this.seat}`),
        trimmed || null,
      );
    } catch (e) {
      console.warn('voice diag write failed', e);
    }
  }

  /** Keep ready/{seat}=true while we still want chat (survives peer clearSignaling). */
  private startReadyHeartbeat(): void {
    if (this.readyHeartbeatTimer != null) return;
    this.readyHeartbeatTimer = setInterval(() => {
      if (this.disposed || !this.stayReady || this.isPeerLive()) return;
      // Fail closed: never heartbeat ready without PC + signaling (A6BDG).
      if (!this.canPublishReady()) {
        void this.failClosedDeadSession();
        return;
      }
      // Never heartbeat ready before mic — bothReady-before-mic races watchdog.
      if (!this.micAttached) return;
      void set(
        ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ready/${this.seat}`),
        true,
      );
    }, READY_HEARTBEAT_MS);
  }

  /** Joined but PC/signaling dead — clear ready and surface Failed. */
  private async failClosedDeadSession(): Promise<void> {
    this.stayReady = false;
    if (this.readyHeartbeatTimer != null) {
      clearInterval(this.readyHeartbeatTimer);
      this.readyHeartbeatTimer = null;
    }
    void this.publishVoiceDiag('session-dead');
    try {
      await set(
        ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ready/${this.seat}`),
        false,
      );
    } catch (e) {
      console.warn('voice ready clear on session-dead failed', e);
    }
    this.callbacks.onStatus?.('error', VOICE_SESSION_DEAD_MSG);
  }

  private peerWaitMessage(): string {
    // Seat 1 waiting on host; seat 0 waiting on guest/opponent.
    return this.seat === 1
      ? WAITING_FOR_HOST_CONNECT_MSG
      : WAITING_FOR_PEER_CONNECT_MSG;
  }

  private schedulePeerWaitTimers(): void {
    this.clearPeerWaitTimers();
    // Only meaningful after local ready — caller must gate.
    this.peerWaitHintTimer = setTimeout(() => {
      this.peerWaitHintTimer = null;
      if (
        !shouldPeerWaitFailClosed({
          localReady: this.localReadyFlag,
          peerReady: this.remoteReadyFlag,
          bothReady: this.bothReady,
          isPeerLive: this.isPeerLive(),
        })
      ) {
        return;
      }
      this.callbacks.onStatus?.('connecting', this.peerWaitMessage());
    }, PEER_WAIT_HINT_MS);
    this.peerWaitFailTimer = setTimeout(() => {
      this.peerWaitFailTimer = null;
      if (
        !shouldPeerWaitFailClosed({
          localReady: this.localReadyFlag,
          peerReady: this.remoteReadyFlag,
          bothReady: this.bothReady,
          isPeerLive: this.isPeerLive(),
        })
      ) {
        return;
      }
      this.callbacks.onStatus?.('error', this.peerWaitMessage());
    }, PEER_WAIT_FAIL_MS);
  }

  private clearPeerWaitTimers(): void {
    if (this.peerWaitHintTimer != null) {
      clearTimeout(this.peerWaitHintTimer);
      this.peerWaitHintTimer = null;
    }
    if (this.peerWaitFailTimer != null) {
      clearTimeout(this.peerWaitFailTimer);
      this.peerWaitFailTimer = null;
    }
  }

  private clearLinkTimers(): void {
    if (this.holdLiveTimer != null) {
      clearTimeout(this.holdLiveTimer);
      this.holdLiveTimer = null;
    }
    if (this.linkWatchdogTimer != null) {
      clearTimeout(this.linkWatchdogTimer);
      this.linkWatchdogTimer = null;
    }
    if (this.linkFailTimer != null) {
      clearTimeout(this.linkFailTimer);
      this.linkFailTimer = null;
    }
    this.clearOfferRetryLoop();
    this.clearAnswerRetryLoop();
    this.clearForceAnswer();
    this.clearGuestOfferWait();
    this.clearHostMicWait();
    this.clearOfferWithoutMicGrace();
    this.clearHostOfferPublishFail();
    this.clearBackupOfferTimer();
    this.allowOfferWithoutMic = false;
  }

  /**
   * Seat 1 → seat 0: "please re-offer". Seat 1 NEVER creates an offer; this
   * RTDB request is the only way it can trigger (re)negotiation.
   */
  private async requestReoffer(reason: string): Promise<void> {
    if (this.disposed || isInitialOffererSeat(this.seat)) return;
    const now = Date.now();
    if (now - this.lastReofferAt < REOFFER_MIN_GAP_MS) return;
    if (this.reofferRequests >= REOFFER_MAX_PER_PC) return;
    this.lastReofferAt = now;
    this.reofferRequests += 1;
    void this.publishVoiceDiag(`reoffer-req:${reason}`);
    const payload: Record<string, unknown> = { from: this.seat, at: now, reason };
    if (this.currentRound) payload.round = this.currentRound;
    try {
      await set(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/reoffer`), payload);
    } catch (e) {
      console.warn('voice reoffer request failed', e);
    }
  }

  /** Force the audio m-line we send on to sendrecv after mic (Safari drift). */
  private forceAudioSendRecv(): void {
    if (!this.pc || !shouldForceAudioSendRecv({ micAttached: this.micAttached })) {
      return;
    }
    const tr = this.sendTransceiver();
    if (!tr) return;
    try {
      if (tr.direction !== 'sendrecv') {
        tr.direction = 'sendrecv';
      }
    } catch (e) {
      console.warn('voice force sendrecv', e);
    }
  }

  /** Negotiated direction of the transceiver we send on (null before negotiation). */
  private negotiatedSendDirection(): string | null {
    const tr = this.sendTransceiver();
    return ((tr as { currentDirection?: string | null } | null)?.currentDirection ?? null) || null;
  }

  /**
   * Common path once the mic clone is on this.localTrack (adopt / ensureMic).
   * Seat 1: answer a queued offer, or — if already negotiated without a send
   * direction (late mic / recvonly residue) — ask seat 0 to re-offer.
   * Seat 0: first offer if none yet; re-offer only if our send m-line is dead.
   */
  private async afterMicAttached(): Promise<void> {
    this.micAttached = true;
    await this.bindLocalTrackToSender();
    this.forceAudioSendRecv();
    this.clearHostMicWait();
    if (!isInitialOffererSeat(this.seat)) {
      if (this.pendingRemoteOffer) {
        await this.flushPendingRemoteOffer();
      } else if (
        shouldRequestReoffer({
          seat: this.seat,
          micAttached: true,
          hasNegotiated: !!this.pc?.remoteDescription && this.wroteLocalAnswer,
          negotiatedDir: this.negotiatedSendDirection(),
        })
      ) {
        await this.requestReoffer('late-mic');
      }
      if (this.bothReady) this.startAnswerRetryLoop();
      return;
    }
    if (!this.bothReady) return;
    if (!this.hasPublishedOffer()) {
      await this.maybeNegotiate();
      this.startOfferRetryLoop();
      return;
    }
    const state = this.pc?.signalingState;
    if (state === 'have-local-offer') {
      // Still waiting on the answer — maybeNegotiate re-touches the same round.
      await this.maybeNegotiate();
      return;
    }
    const dir = this.negotiatedSendDirection();
    if (dir && !isSendCapableDirection(dir)) {
      void this.publishVoiceDiag(`host-reoffer:send-${dir}`);
      await this.maybeNegotiate();
    }
  }

  /**
   * After Live: re-assert the sender track + sendrecv. Seat 1 asks for ONE
   * re-offer if negotiated recvonly/inactive; seat 0 re-offers once itself if
   * it is not receiving (guest answered recvonly). Never blind renegotiate.
   */
  private ensureOutboundAudio(): void {
    if (this.disposed || !this.pc || !this.micAttached || !this.localTrack) return;
    void this.bindLocalTrackToSender();
    if (this.outboundUpgradeAttempted) return;
    if (!isInitialOffererSeat(this.seat)) {
      const currentDir = this.negotiatedSendDirection();
      if (
        shouldBumpOutboundUpgradeOnLive({
          micAttached: true,
          hasPublishedOffer: false,
          canCreateOffer: false,
          seenRemoteOffer: this.seenRemoteOffer,
          wroteLocalAnswer: this.wroteLocalAnswer,
          audioCurrentDirection: currentDir,
        }) ||
        (currentDir != null && !isSendCapableDirection(currentDir))
      ) {
        this.outboundUpgradeAttempted = true;
        void this.requestReoffer('live-recvonly');
      }
      return;
    }
    this.maybeHostReofferForReceive('live');
  }

  /**
   * Seat 0: after an answer / on Live, if our transceiver is negotiated but
   * not receiving (sendonly/inactive = guest not sending), re-offer (bounded).
   */
  private maybeHostReofferForReceive(reason: string): void {
    if (!isInitialOffererSeat(this.seat) || !this.pc || this.disposed) return;
    if (this.pc.signalingState !== 'stable') return;
    const tr = this.hostAudioTransceiver;
    const dir = (tr as { currentDirection?: string | null } | null)?.currentDirection ?? null;
    if (!dir || isRecvCapableDirection(dir)) return;
    if (this.hostRecvReoffers >= HOST_RECV_REOFFER_MAX) return;
    this.hostRecvReoffers += 1;
    void this.publishVoiceDiag(`host-reoffer:recv-${dir}:${reason}`);
    void this.maybeNegotiate();
  }

  /** Answer a remote offer that arrived before/without Join mic on the sender. */
  private async flushPendingRemoteOffer(): Promise<void> {
    const pending = this.pendingRemoteOffer;
    if (!pending) return;
    await this.onRemoteOffer(pending);
  }

  /** Request mic on first PTT press; track starts according to `holding`. */
  async ensureMic(holding: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.disposed) return { ok: false, error: 'Voice closed' };
    if (this.localTrack) {
      setMicTrackEnabled(this.localTrack, holding);
      if (holding && !this.isPeerLive()) {
        this.kickConnectWhileHolding();
        return { ok: true };
      }
      await this.writeTalking(holding);
      return { ok: true };
    }
    if (this.micRequested) return { ok: false, error: 'Mic busy' };
    this.micRequested = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        this.callbacks.onStatus?.('denied', 'Mic not supported');
        return { ok: false, error: 'Mic not supported on this device' };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return { ok: false, error: 'Voice closed' };
      }
      this.localStream = stream;
      const monitorTrack = stream.getAudioTracks()[0] ?? null;
      if (monitorTrack) {
        // Same VAD split as adoptMicStream — never gate the analyser source.
        const track = cloneMicTrackForVad(monitorTrack, holding);
        this.localTrack = track;
        this.allowOfferWithoutMic = false;
        this.clearOfferWithoutMicGrace();
        // Binds to the negotiated sender (never addTrack an extra m-line).
        await this.afterMicAttached();
        if (holding && !this.isPeerLive()) {
          this.kickConnectWhileHolding();
          return { ok: true };
        }
        await this.writeTalking(holding);
      }
      this.handlePeerStateChange();
      return { ok: true };
    } catch (e) {
      const isDenied =
        e instanceof Error &&
        (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
      const msg = isDenied
        ? MIC_BLOCKED_HINT
        : e instanceof Error
          ? e.message
          : 'Mic failed';
      this.callbacks.onStatus?.('denied', msg);
      return { ok: false, error: msg };
    } finally {
      this.micRequested = false;
    }
  }

  /**
   * Attach a mic MediaStream acquired under a user gesture (Join click).
   * Track starts according to `enabled` (false for VAD until speech).
   */
  async adoptMicStream(
    stream: MediaStream,
    enabled: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    // Never stop tracks on disposed — StrictMode/effect races must return the
    // Join-gesture stream to pendingMicRef for the next session (EVQCJ).
    if (this.disposed) {
      return { ok: false, error: 'Voice closed' };
    }
    // Replace any prior local mic.
    if (this.localStream && this.localStream !== stream) {
      // VAD uses a cloned sender track, which is not part of localStream.
      // Stop an older clone before replacing its monitor stream.
      try {
        this.localTrack?.stop();
      } catch {
        /* ignore */
      }
      this.localStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    this.localStream = stream;
    const monitorTrack = stream.getAudioTracks()[0] ?? null;
    if (!monitorTrack) return { ok: false, error: 'No audio track' };
    try {
      // Never disable the analyser's source track. Safari/Web Audio correctly
      // renders a disabled MediaStreamTrack as silence, which previously meant
      // VAD could never detect the first word on either iOS device.
      const track = cloneMicTrackForVad(monitorTrack, enabled);
      this.localTrack = track;
      // Seat 0: its own transceiver. Seat 1: the transceiver the host's offer
      // created (bound again right before createAnswer if no offer yet).
      await this.afterMicAttached();
      await this.writeTalking(enabled);
      this.handlePeerStateChange();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Mic attach failed';
      this.callbacks.onStatus?.('error', msg);
      return { ok: false, error: msg };
    }
  }

  /** Public nudge after Join mic attach (side live chat). */
  kickNegotiate(): void {
    if (this.disposed || !this.bothReady) return;
    if (this.canCreateOffer()) {
      void this.maybeNegotiate();
      this.startOfferRetryLoop();
      this.scheduleOfferWithoutMicGrace();
      this.scheduleHostOfferPublishFail();
    }
    // Seat 1 answers seat 0's offer (seat 0 never answers).
    this.ensureAnswerRemoteOffer();
    if (!isInitialOffererSeat(this.seat)) {
      // Host silent → request a re-offer (never offer ourselves).
      this.scheduleBackupOffer();
      this.scheduleGuestOfferWait();
    }
  }

  /**
   * If a remote offer is pending/seen and we should answer, flush + force within
   * ANSWER_FORCE_MS + retry loop. Safe for seat 0 (backup) and seat 1 (primary).
   */
  private ensureAnswerRemoteOffer(): void {
    if (this.disposed || this.isPeerLive()) return;
    const pending = this.pendingRemoteOffer;
    if (!this.seenRemoteOffer && !pending) return;
    const from = pending?.from;
    if (from != null && !shouldAnswerRemoteOffer(this.seat, from)) return;
    void this.flushPendingRemoteOffer();
    this.startAnswerRetryLoop();
    this.scheduleForceAnswer();
  }

  /** True once seat 0 has written voice/offer SDP to RTDB. */
  hasPublishedOffer(): boolean {
    return this.lastPublishedOfferSdp != null;
  }

  isBothReady(): boolean {
    return this.bothReady;
  }

  isMicAttached(): boolean {
    return this.micAttached;
  }

  /**
   * Lobby Connect path: seat 0 offers when both-ready; seat 1 schedules backup.
   * Safe to call repeatedly.
   */
  ensureLobbyHostOffer(): void {
    this.ensureLobbyOffer();
  }

  /** Seat 0 offer kick (seat 1: answer + re-offer request) from lobby Connect. */
  ensureLobbyOffer(): void {
    if (this.disposed || !this.bothReady) return;
    if (this.hasPublishedOffer() && this.isPeerLive()) return;
    if (isInitialOffererSeat(this.seat)) {
      void this.maybeNegotiate();
      this.startOfferRetryLoop();
      this.scheduleOfferWithoutMicGrace();
      this.scheduleHostOfferPublishFail();
    }
    // Seat 1 answers seat 0's offer.
    this.ensureAnswerRemoteOffer();
    if (!isInitialOffererSeat(this.seat)) {
      this.scheduleBackupOffer();
      this.scheduleGuestOfferWait();
    }
  }

  /** True when this seat is allowed to createOffer right now. */
  private canCreateOffer(): boolean {
    return shouldCreateOfferAsSeat({
      mySeat: this.seat,
      bothReady: this.bothReady,
      alreadyPublishedOffer: this.hasPublishedOffer(),
      backupOffererActive: false,
      hasRemoteOffer: this.seenRemoteOffer,
    });
  }

  getDebugSnapshot(): VoiceLinkDebugSnapshot {
    const localDesc = this.pc?.localDescription;
    const iOffered = this.hasPublishedOffer() || localDesc?.type === 'offer';
    const localAnswer =
      this.wroteLocalAnswer || localDesc?.type === 'answer';
    // Answerer sees remote offer; offerer sees own local offer publish.
    const hasOffer = iOffered || this.seenRemoteOffer;
    const hasAnswer = this.seenRemoteAnswer || localAnswer;
    const rtdbAnswer = iOffered ? this.rtdbAnswerPresent : this.wroteLocalAnswer;
    let sendDir: string | undefined;
    let recvDir: string | undefined;
    let remTracks: number | undefined;
    let txc: number | undefined;
    if (this.pc) {
      const sendTr = this.sendTransceiver();
      sendDir =
        (sendTr as { currentDirection?: string | null } | null)?.currentDirection ??
        (sendTr ? `${sendTr.direction}?` : undefined) ??
        undefined;
      if (!sendTr) sendDir = audioDirectionFromSdp(localDesc?.sdp) ?? undefined;
      const recvTr = this.receiveTransceiver();
      recvDir =
        ((recvTr as { currentDirection?: string | null } | null)?.currentDirection ??
          undefined) || undefined;
      const all = this.pc.getTransceivers();
      remTracks = countReceivingAudioTransceivers(all);
      txc = all.length;
    }
    return {
      readyMe: this.localReadyFlag,
      peerReady: this.remoteReadyFlag,
      bothReady: this.bothReady,
      hasOffer,
      hasAnswer,
      seenOffer: this.seenRemoteOffer || (iOffered && !!localDesc),
      wroteAnswer: iOffered ? this.seenRemoteAnswer : localAnswer,
      rtdbAnswer,
      ice: this.pc?.iceConnectionState ?? 'none',
      conn: this.pc?.connectionState ?? 'none',
      micAttached: this.micAttached,
      seat: this.seat,
      sendDir,
      sendEnabled: this.localTrack ? this.localTrack.enabled : undefined,
      diag: this.lastDiag || undefined,
      lastErr: this.lastErr || undefined,
      recvDir,
      inBytes: this.inBytes,
      audioLevel: this.inAudioLevel,
      remTracks,
      txc,
      round: this.currentRound,
    };
  }

  /** Test/debug: current negotiation round id. */
  getCurrentRound(): string | null {
    return this.currentRound;
  }

  /** Local mic stream for VAD monitoring (null until mic granted). */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  async setTalking(holding: boolean): Promise<void> {

    if (this.disposed) return;
    if (!this.localTrack) {
      if (holding) await this.ensureMic(true);
      return;
    }
    setMicTrackEnabled(this.localTrack, holding);
    if (holding) {
      this.forceAudioSendRecv();
      await this.bindLocalTrackToSender();
    }
    if (holding && !this.isPeerLive()) {
      this.kickConnectWhileHolding();
      return;
    }
    await this.writeTalking(holding);
  }

  /**
   * Publish talking/{seat} only when the peer link is live.
   * Clearing (false) always writes so remote UI can drop Opp / Voice not linked.
   */
  private async writeTalking(talking: boolean): Promise<void> {
    if (talking && !this.isPeerLive()) return;
    try {
      await update(voiceRootRef(this.code), {
        [`talking/${this.seat}`]: talkingWritePayload(talking),
      });
    } catch (e) {
      console.warn('voice talking write failed', e);
    }
  }

  /** Hold while !live: local hint + kick renegotiate / delayed ICE restart. */
  private kickConnectWhileHolding(): void {
    if (this.isPeerLive()) return;
    this.callbacks.onStatus?.('connecting', 'Still connecting…');
    if (!this.bothReady) return;
    if (this.hasPublishedOffer() || this.canCreateOffer()) {
      void this.maybeNegotiate();
      this.scheduleHoldLiveCheck();
    }
  }

  /** After first Hold post both-ready, if still !live >2s, host ICE-restarts once. */
  private scheduleHoldLiveCheck(): void {
    if (
      (!this.hasPublishedOffer() && !this.canCreateOffer()) ||
      this.iceRestartAfterHoldAttempted
    )
      return;
    if (this.holdLiveTimer != null) {
      clearTimeout(this.holdLiveTimer);
      this.holdLiveTimer = null;
    }
    this.holdLiveTimer = setTimeout(() => {
      this.holdLiveTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      this.iceRestartAfterHoldAttempted = true;
      this.callbacks.onStatus?.('connecting', 'ICE restart');
      void this.maybeNegotiate(true);
    }, HOLD_LIVE_RESTART_MS);
  }

  /**
   * VAD has no Hold gesture — after both-ready, if ICE never goes live,
   * host forces one iceRestart so preview peer chat can recover.
   */

  private startOfferRetryLoop(): void {
    if (!this.canCreateOffer() && !this.hasPublishedOffer()) return;
    if (this.offerRetryTimer != null) return;
    this.offerRetryTimer = setInterval(() => {
      if (this.disposed || this.isPeerLive() || !this.bothReady) {
        this.clearOfferRetryLoop();
        return;
      }
      if (this.seenRemoteOffer && !this.hasPublishedOffer()) {
        this.clearOfferRetryLoop();
        return;
      }
      if (!this.canCreateOffer() && !this.hasPublishedOffer()) {
        this.clearOfferRetryLoop();
        return;
      }
      if (!this.micAttached && !this.allowOfferWithoutMic) return;
      // Retry until offer SDP is published (lastPublishedOfferSdp) or live.
      void this.maybeNegotiate();
    }, OFFER_RETRY_MS);
  }

  private clearOfferRetryLoop(): void {
    if (this.offerRetryTimer != null) {
      clearInterval(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }
  }

  /**
   * Any seat that saw a remote offer (incl. seat0 answering backup from=1):
   * keep retrying flush + onRemoteOffer while Joined until answer published.
   */
  private startAnswerRetryLoop(): void {
    if (this.answerRetryTimer != null) return;
    this.answerRetryTimer = setInterval(() => {
      if (this.disposed || this.isPeerLive() || !this.bothReady) {
        this.clearAnswerRetryLoop();
        return;
      }
      if (!this.seenRemoteOffer || this.wroteLocalAnswer) return;
      if (!this.pc) {
        void this.failClosedDeadSession();
        this.clearAnswerRetryLoop();
        return;
      }
      const pending = this.pendingRemoteOffer;
      if (pending && shouldAnswerRemoteOffer(this.seat, pending.from)) {
        void this.flushPendingRemoteOffer();
      }
    }, OFFER_RETRY_MS);
  }

  private clearAnswerRetryLoop(): void {
    if (this.answerRetryTimer != null) {
      clearInterval(this.answerRetryTimer);
      this.answerRetryTimer = null;
    }
  }

  /**
   * Force createAnswer within ANSWER_FORCE_MS of seeing a remote offer.
   * setInterval alone waits a full tick — seat0 skipped answer for seconds (A6BDG).
   */
  private scheduleForceAnswer(): void {
    if (this.answerForceTimer != null || this.wroteLocalAnswer) return;
    if (!this.seenRemoteOffer && !this.pendingRemoteOffer) return;
    this.answerForceTimer = setTimeout(() => {
      this.answerForceTimer = null;
      if (this.disposed || this.isPeerLive() || this.wroteLocalAnswer) return;
      const pending = this.pendingRemoteOffer;
      if (!pending || !shouldAnswerRemoteOffer(this.seat, pending.from)) return;
      if (!this.pc) {
        void this.failClosedDeadSession();
        return;
      }
      void this.publishVoiceDiag('answer-force');
      if (!this.isPeerLive()) this.callbacks.onStatus?.('connecting', 'Answering…');
      void this.onRemoteOffer(pending);
      this.startAnswerRetryLoop();
    }, ANSWER_FORCE_MS);
  }

  private clearForceAnswer(): void {
    if (this.answerForceTimer != null) {
      clearTimeout(this.answerForceTimer);
      this.answerForceTimer = null;
    }
  }

  private scheduleGuestOfferWait(): void {
    // Primary offerer doesn't use this; backup offerer still fails if nothing lands.
    if (isInitialOffererSeat(this.seat) || this.guestOfferWaitTimer != null) return;
    this.guestOfferWaitTimer = setTimeout(() => {
      this.guestOfferWaitTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      // Succeeded if we saw remote offer OR we published our own backup offer
      // and are waiting on answer (not a "no offer" failure).
      if (this.seenRemoteOffer || this.hasPublishedOffer()) return;
      this.callbacks.onStatus?.('error', GUEST_NO_OFFER_MSG);
    }, GUEST_OFFER_WAIT_MS);
  }

  private clearGuestOfferWait(): void {
    if (this.guestOfferWaitTimer != null) {
      clearTimeout(this.guestOfferWaitTimer);
      this.guestOfferWaitTimer = null;
    }
  }

  private scheduleHostMicWait(): void {
    if (!isInitialOffererSeat(this.seat) || this.hostMicWaitTimer != null) return;
    if (this.micAttached) return;
    this.hostMicWaitTimer = setTimeout(() => {
      this.hostMicWaitTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      if (this.micAttached) return;
      this.callbacks.onStatus?.(
        'error',
        'Mic not on sender — Leave and Join again',
      );
    }, HOST_MIC_WAIT_MS);
  }

  private scheduleOfferWithoutMicGrace(): void {
    if (!this.canCreateOffer() || this.hostOfferWithoutMicTimer != null) return;
    if (this.micAttached) {
      this.allowOfferWithoutMic = false;
      return;
    }
    this.hostOfferWithoutMicTimer = setTimeout(() => {
      this.hostOfferWithoutMicTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      if (this.micAttached) return;
      if (!this.canCreateOffer()) return;
      this.allowOfferWithoutMic = true;
      this.callbacks.onStatus?.(
        'connecting',
        'Hosting offer (mic still attaching)…',
      );
      void this.maybeNegotiate();
      this.startOfferRetryLoop();
    }, HOST_OFFER_WITHOUT_MIC_MS);
  }

  private clearOfferWithoutMicGrace(): void {
    if (this.hostOfferWithoutMicTimer != null) {
      clearTimeout(this.hostOfferWithoutMicTimer);
      this.hostOfferWithoutMicTimer = null;
    }
  }

  private scheduleHostOfferPublishFail(): void {
    if (!this.canCreateOffer() || this.hostOfferPublishFailTimer != null) return;
    this.hostOfferPublishFailTimer = setTimeout(() => {
      this.hostOfferPublishFailTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      if (this.hasPublishedOffer() || this.seenRemoteOffer) return;
      this.callbacks.onStatus?.('error', HOST_OFFER_PUBLISH_FAIL_MSG);
    }, GUEST_OFFER_WAIT_MS + 1500);
  }

  private clearHostOfferPublishFail(): void {
    if (this.hostOfferPublishFailTimer != null) {
      clearTimeout(this.hostOfferPublishFailTimer);
      this.hostOfferPublishFailTimer = null;
    }
  }

  /**
   * Seat 1: if seat 0's offer has not landed BACKUP_OFFER_WAIT_MS after
   * both-ready, write voice/reoffer so seat 0 (re)publishes. Seat 1 never
   * creates an offer — the old backup offer is what produced glare.
   */
  private scheduleBackupOffer(): void {
    if (isInitialOffererSeat(this.seat) || this.backupOfferTimer != null) return;
    if (this.seenRemoteOffer) return;
    if (!this.bothReady) return;
    const startedAt = this.bothReadyAt ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, BACKUP_OFFER_WAIT_MS - elapsed);
    this.backupOfferTimer = setTimeout(() => {
      this.backupOfferTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      if (
        !shouldBackupOffer({
          bothReady: this.bothReady,
          hasRemoteOffer: this.seenRemoteOffer,
          hasLocalPublishedOffer: false,
          msSinceBothReady: Date.now() - (this.bothReadyAt ?? Date.now()),
          backupWaitMs: BACKUP_OFFER_WAIT_MS,
        })
      ) {
        return;
      }
      this.callbacks.onStatus?.('connecting', 'Waiting for host offer…');
      void this.requestReoffer('no-offer');
    }, delay);
  }

  private clearBackupOfferTimer(): void {
    if (this.backupOfferTimer != null) {
      clearTimeout(this.backupOfferTimer);
      this.backupOfferTimer = null;
    }
  }

  private clearHostMicWait(): void {
    if (this.hostMicWaitTimer != null) {
      clearTimeout(this.hostMicWaitTimer);
      this.hostMicWaitTimer = null;
    }
  }

  private scheduleLinkWatchdog(): void {
    // Sole offerer (seat 0) owns ICE restarts.
    if (!isInitialOffererSeat(this.seat) || this.linkWatchdogAttempted) return;
    if (this.linkWatchdogTimer != null) {
      clearTimeout(this.linkWatchdogTimer);
      this.linkWatchdogTimer = null;
    }
    // Poll so we do not ICE-restart while guest is still answer-wait-mic.
    const tick = () => {
      this.linkWatchdogTimer = null;
      if (this.disposed || this.isPeerLive() || !this.bothReady) return;
      const ms = Date.now() - (this.bothReadyAt ?? Date.now());
      const hasAnswer =
        this.seenRemoteAnswer || this.rtdbAnswerPresent || this.wroteLocalAnswer;
      if (
        !shouldRunLinkWatchdogIceRestart({
          bothReady: true,
          isPeerLive: false,
          micAttached: this.micAttached,
          hasAnswer,
          msSinceBothReady: ms,
          graceMs: LINK_WATCHDOG_MS,
          answerGraceMs: LINK_WATCHDOG_NO_ANSWER_MS,
        })
      ) {
        // Re-check shortly until grace elapses or Live.
        this.linkWatchdogTimer = setTimeout(tick, 1000);
        return;
      }
      this.linkWatchdogAttempted = true;
      this.callbacks.onStatus?.('connecting', 'ICE restart');
      void this.publishVoiceDiag('link-watchdog-ice');
      void this.maybeNegotiate(true);
      if (this.linkFailTimer != null) clearTimeout(this.linkFailTimer);
      this.linkFailTimer = setTimeout(() => {
        this.linkFailTimer = null;
        if (this.disposed || this.isPeerLive()) return;
        this.callbacks.onStatus?.(
          'error',
          'Voice link failed — Leave and Join again (check mic / network)',
        );
      }, LINK_FAIL_MS);
    };
    this.linkWatchdogTimer = setTimeout(tick, 1000);
  }

  /**
   * If the link is already up, re-emit 'live' so a transient connecting label
   * from a renegotiation round ('Answering…') cannot stick — ICE does not fire
   * another state change when a re-answer completes on a connected PC.
   */
  private reassertLiveStatus(): void {
    if (this.disposed || !this.isPeerLive()) return;
    this.callbacks.onStatus?.('live');
  }

  /**
   * Treat connectionState OR iceConnectionState as live (Safari often lags
   * connectionState). On failed, host ICE-restarts once and UI returns to connecting.
   */
  private handlePeerStateChange(): void {
    if (this.disposed || !this.pc) return;
    const conn = this.pc.connectionState;
    const ice = this.pc.iceConnectionState;

    if (conn === 'connected' || ice === 'connected' || ice === 'completed') {
      this.clearLinkTimers();
      this.clearPeerWaitTimers();
      if (this.readyHeartbeatTimer != null) {
        clearInterval(this.readyHeartbeatTimer);
        this.readyHeartbeatTimer = null;
      }
      this.rebindRemoteAudio('live');
      this.ensureOutboundAudio();
      this.callbacks.onStatus?.('live');
      return;
    }

    if (conn === 'failed' || ice === 'failed') {
      const iOffered = isInitialOffererSeat(this.seat);
      if (iOffered && !this.iceRestartAttempted) {
        this.iceRestartAttempted = true;
        this.callbacks.onStatus?.('connecting', 'ICE restart');
        void this.maybeNegotiate(true);
      } else if (iOffered) {
        this.callbacks.onStatus?.(
          'error',
          'Voice link failed — Leave and Join again',
        );
      } else {
        this.callbacks.onStatus?.('connecting', 'Waiting for reconnect');
        void this.requestReoffer('ice-failed');
      }
      return;
    }

    if (conn === 'closed') {
      this.callbacks.onStatus?.('error', 'Peer closed');
    }
  }

  private bindSignaling(): void {
    const root = voiceRootPath(this.code);
    const other = (1 - this.seat) as SeatRole;

    // Ready handshake — host offers only when both seats are listening.
    this.unsubs.push(
      onValue(ref(getFirebaseDb(), `${root}/ready`), (snap) => {
        if (this.disposed) return;
        const val = snap.val();
        const r0 = isSeatVoiceReady(val, 0);
        const r1 = isSeatVoiceReady(val, 1);
        const mine = this.seat === 0 ? r0 : r1;
        // Peer Leave used to wipe the whole voice tree (collateral). Re-assert
        // whenever this session still wants chat — including before announceReady
        // finished (4DGBF: seat0 stranded ready=[null,true]).
        if (this.stayReady && !mine) {
          if (
            shouldReassertVoiceReady({
              stayReady: true,
              canPublishReady: this.canPublishReady(),
              micAttached: this.micAttached,
              mineAlreadyReady: false,
            })
          ) {
            void set(
              ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ready/${this.seat}`),
              true,
            );
          } else if (!this.canPublishReady()) {
            void this.failClosedDeadSession();
          }
          // else: stayReady but mic not attached yet — wait for announceReady().
          // Do NOT return — still process bothReady from this snapshot.
        }
        const prevLocalReady = this.localReadyFlag;
        this.localReadyFlag = this.seat === 0 ? r0 : r1;
        this.remoteReadyFlag = this.seat === 0 ? r1 : r0;
        const wasBoth = this.bothReady;
        this.bothReady = r0 && r1;
        // Start 15s peer-wait ONLY once local ready sticks (never when readyMe=0).
        if (this.localReadyFlag && !prevLocalReady && !this.bothReady && !this.isPeerLive()) {
          this.schedulePeerWaitTimers();
          this.callbacks.onStatus?.('connecting', this.peerWaitMessage());
        }
        if (this.isPeerLive()) return;
        if (this.bothReady) {
          if (!wasBoth) {
            this.bothReadyAt = Date.now();
            this.clearPeerWaitTimers();
            // Guest re-joined (handshake re-formed) while our PC is bound to the
            // previous guest's DTLS/ICE → fresh host PC + sid before offering.
            if (
              isInitialOffererSeat(this.seat) &&
              this.pc?.remoteDescription &&
              this.hasPublishedOffer()
            ) {
              this.rebuildHostPeerConnection('guest-rejoined');
            }
            this.callbacks.onStatus?.('connecting', 'Linking…');
            this.scheduleLinkWatchdog();
            this.scheduleHostMicWait();
            this.scheduleGuestOfferWait();
            if (isInitialOffererSeat(this.seat)) {
              void this.maybeNegotiate();
              this.startOfferRetryLoop();
              this.scheduleOfferWithoutMicGrace();
              this.scheduleHostOfferPublishFail();
              if (!this.micAttached) {
                void this.publishVoiceDiag('offer-wait-mic');
              }
            } else {
              // Seat 1: answer if offer exists; else request re-offer after ~2s.
              // No blind renegotiate bump — first answer waits for mic (sendrecv).
              this.ensureAnswerRemoteOffer();
              this.scheduleBackupOffer();
            }
          }
        } else {
          this.bothReadyAt = null;
          this.clearOfferRetryLoop();
          this.clearGuestOfferWait();
          this.clearHostMicWait();
          this.clearOfferWithoutMicGrace();
          this.clearHostOfferPublishFail();
          this.clearBackupOfferTimer();
          this.allowOfferWithoutMic = false;
          // Only show peer-wait copy after WE are ready; else stay on Connecting.
          if (this.localReadyFlag) {
            this.callbacks.onStatus?.('connecting', this.peerWaitMessage());
          } else {
            this.clearPeerWaitTimers();
            this.callbacks.onStatus?.('connecting', 'Connecting voice…');
          }
        }

      }),
    );

    // Offer — seat 1 only answers seat 0's offers. Seat 0 ignores voice/offer
    // entirely (a stale/rogue from=1 offer can no longer pull it into glare).
    this.unsubs.push(
      onValue(ref(getFirebaseDb(), `${root}/offer`), (snap) => {
        if (this.disposed || isInitialOffererSeat(this.seat)) return;
        const val = snap.val();
        if (!isVoiceSdpPayload(val)) return;
        const from = coerceSeatFrom(val.from);
        if (from === null || !shouldAnswerRemoteOffer(this.seat, from)) return;
        if (val.type !== 'offer') return;
        if (!val.round) {
          // Pre-round build / stale leftover — never answer (answer would be dropped).
          void this.publishVoiceDiag('offer-ignored:no-round');
          return;
        }
        // Normalize `from` so downstream always sees 0|1 numbers.
        const payload: VoiceSdpPayload = { ...val, from };
        this.seenRemoteOffer = true;
        this.clearGuestOfferWait();
        this.clearBackupOfferTimer();
        // Always retain latest offer so mic-attach retry can flush.
        this.pendingRemoteOffer = payload;
        void this.publishVoiceDiag(`answer-seen:${shortVoiceRound(val.round)}`);
        this.startAnswerRetryLoop();
        this.scheduleForceAnswer();
        void this.onRemoteOffer(payload);
      }),
    );

    // Answer — seat 0 only, current round only. Stale rounds dropped quietly.
    this.unsubs.push(
      onValue(ref(getFirebaseDb(), `${root}/answer`), (snap) => {
        if (this.disposed || !isInitialOffererSeat(this.seat)) return;
        const val = snap.val();
        if (!isVoiceSdpPayload(val)) {
          this.rtdbAnswerPresent = false;
          return;
        }
        const from = coerceSeatFrom(val.from);
        if (from === null || !shouldApplyRemoteAnswer(this.seat, from)) return;
        if (val.type !== 'answer') return;
        void this.onRemoteAnswer({ ...val, from });
      }),
    );

    // Remote ICE — buffer until remote description is set; filter by host sid.
    const icePath = ref(getFirebaseDb(), `${root}/ice/${other}`);
    this.unsubs.push(
      onChildAdded(icePath, (snap) => {
        const val = snap.val();
        if (!isVoiceIcePayload(val) || coerceSeatFrom(val.from) === this.seat) return;
        void this.addRemoteIceCandidate(
          {
            candidate: val.candidate,
            sdpMid: val.sdpMid,
            sdpMLineIndex: val.sdpMLineIndex,
          },
          typeof val.sid === 'string' ? val.sid : undefined,
        );
      }),
    );

    // Remote talking UI
    this.unsubs.push(
      onValue(ref(getFirebaseDb(), `${root}/talking/${other}`), (snap) => {
        this.callbacks.onRemoteTalking?.(snap.val() === true);
      }),
    );

    // Seat 1 "please re-offer" → seat 0 (sole offerer) re-offers.
    this.unsubs.push(
      onValue(ref(getFirebaseDb(), `${root}/reoffer`), (snap) => {
        if (this.disposed || !isInitialOffererSeat(this.seat)) return;
        const val = snap.val() as
          | { from?: unknown; at?: unknown; reason?: unknown }
          | null;
        if (!val || typeof val !== 'object') return;
        if (coerceSeatFrom(val.from) !== 1 || typeof val.at !== 'number') return;
        if (!this.bothReady) return;
        if (val.at <= this.lastHandledReofferAt) return;
        this.lastHandledReofferAt = val.at;
        const reason = typeof val.reason === 'string' ? val.reason : 'req';
        void this.publishVoiceDiag(`reoffer-got:${reason}`);
        // "no-offer" = a guest PC that has never seen an offer. If our PC is
        // already negotiated (with a previous guest PC), start fresh.
        if (reason === 'no-offer' && this.pc?.remoteDescription) {
          this.rebuildHostPeerConnection('guest-no-offer');
          return;
        }
        const iceRestart = reason === 'ice-failed' && !this.isPeerLive();
        void this.maybeNegotiate(iceRestart);
        this.startOfferRetryLoop();
      }),
    );
  }

  /** Queue ICE until remote SDP is applied; then addIceCandidate. */
  private async addRemoteIceCandidate(init: RTCIceCandidateInit, sid?: string): Promise<void> {
    if (!this.pc || this.disposed) return;
    if (isInitialOffererSeat(this.seat)) {
      // Guest candidates are tagged with the host sid they answered.
      if (sid && this.sid && sid !== this.sid) return;
    } else if (sid && sid !== this.remoteSid) {
      // Candidate for a host session we have not applied yet (or a dead one).
      if (this.pendingRemoteIce.length < 200) this.pendingRemoteIce.push({ init, sid });
      return;
    }
    if (!this.pc.remoteDescription) {
      if (this.pendingRemoteIce.length < 200) this.pendingRemoteIce.push({ init, sid });
      return;
    }
    try {
      await this.pc.addIceCandidate(init);
    } catch (err) {
      console.warn('addIceCandidate', err);
    }
  }

  private async flushPendingRemoteIce(): Promise<void> {
    if (!this.pc || this.disposed) return;
    const keepSid = isInitialOffererSeat(this.seat) ? this.sid : this.remoteSid;
    const queued = this.pendingRemoteIce.splice(0);
    for (const item of queued) {
      if (item.sid && keepSid && item.sid !== keepSid) {
        // Seat 1 may still get this sid later — keep; seat 0 drops foreign sids.
        if (!isInitialOffererSeat(this.seat)) this.pendingRemoteIce.push(item);
        continue;
      }
      try {
        await this.pc.addIceCandidate(item.init);
      } catch (err) {
        console.warn('addIceCandidate flush', err);
      }
    }
  }

  private async onRemoteOffer(payload: VoiceSdpPayload): Promise<void> {
    // Seat 1 answers seat 0 only — seat 0 never answers (no glare).
    if (!shouldAnswerRemoteOffer(this.seat, payload.from)) return;
    if (this.disposed) {
      void this.publishVoiceDiag('answer-skip:disposed');
      return;
    }
    if (!this.pc) {
      // Keep offer for flush after PC bind — failClosed here aborted host Connect
      // when an early remote offer raced PC creation (ready never stuck).
      this.pendingRemoteOffer = payload;
      void this.publishVoiceDiag('answer-skip:no-pc');
      return;
    }
    const round = payload.round ?? null;
    if (!round) {
      void this.publishVoiceDiag('offer-ignored:no-round');
      return;
    }
    // Always keep latest offer for mic-attach retry (MT22J: answer never written).
    this.pendingRemoteOffer = payload;
    // Wait for mic on sender — recvonly answers made host deaf to guest (iOS).
    // Join queues getUserMedia before start(); flushPendingRemoteOffer after adopt.
    if (!shouldAnswerOfferWithoutMic() && !this.micAttached) {
      void this.publishVoiceDiag('answer-wait-mic');
      this.startAnswerRetryLoop();
      return;
    }
    if (this.makingAnswer) {
      // Newer offer stashed in pendingRemoteOffer; retry after in-flight finishes.
      this.startAnswerRetryLoop();
      return;
    }
    // New host session (host refreshed / rebuilt its PC) while our PC holds the
    // old host's DTLS/ICE → rebuild before applying.
    const offerSid = sidFromRound(round);
    if (this.pc.remoteDescription && this.remoteSid && offerSid && offerSid !== this.remoteSid) {
      this.rebuildGuestPeerConnection(offerSid);
    }
    else if (offerSid && (!this.pc.remoteDescription || !this.remoteSid)) {
      this.remoteSid = offerSid;
    }
    const pc = this.pc;
    if (!pc) return;
    // Already answered this exact round → nothing to do (onValue re-fire / republish).
    if (this.wroteLocalAnswer && this.currentRound === round) {
      this.pendingRemoteOffer = null;
      return;
    }
    if (this.wroteLocalAnswer && this.currentRound !== round) {
      this.wroteLocalAnswer = false;
    }
    const answeredRound = round;
    try {
      let state = pc.signalingState;
      if (state === 'have-local-offer') {
        // Should be impossible (seat 1 never offers) — roll back defensively.
        try {
          await pc.setLocalDescription({ type: 'rollback' });
          void this.publishVoiceDiag('guest-rollback-local');
        } catch (e) {
          console.warn('voice guest rollback failed', e);
        }
        state = pc.signalingState;
      }
      if (state !== 'stable' && state !== 'have-remote-offer') {
        console.warn('voice offer deferred, signalingState=', state);
        void this.publishVoiceDiag(`offer-deferred:${state}`);
        this.startAnswerRetryLoop();
        return;
      }
      this.makingAnswer = true;
      void this.publishVoiceDiag('answer-start');
      // Re-answers (new round) happen while already connected — never replace
      // a Live label with 'Answering…' (guest UI stuck on Answering… while live).
      if (!this.isPeerLive()) this.callbacks.onStatus?.('connecting', 'Answering…');
      await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      this.currentRound = answeredRound;
      await this.flushPendingRemoteIce();
      // The offer created/matched the transceiver for its audio mid — put the
      // mic on THAT sender (never on an orphan) before createAnswer.
      await this.bindLocalTrackToSender();
      this.forceAudioSendRecv();
      const wasSend = captureSendTrackEnabledForSdp(this.localTrack);
      let answer: RTCSessionDescriptionInit;
      let restoreAfterPublish = wasSend;
      let dir = '';
      try {
        answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        dir = audioDirectionFromSdp(pc.localDescription?.sdp ?? answer.sdp) ?? '';
        if (dir === 'recvonly' || dir === 'inactive') {
          // Safari still emitted a non-send answer — keep track enabled and
          // force sendrecv; do not restore VAD mute until Live upgrade path.
          void this.publishVoiceDiag(`answer-dir-bad:${dir || 'none'}`);
          this.forceAudioSendRecv();
          if (this.localTrack) this.localTrack.enabled = true;
          restoreAfterPublish = null; // leave enabled
          try {
            answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            dir = audioDirectionFromSdp(pc.localDescription?.sdp ?? answer.sdp) ?? '';
          } catch (retryErr) {
            console.warn('voice answer sendrecv retry failed', retryErr);
          }
        } else if (dir) {
          void this.publishVoiceDiag(`answer-dir:${dir}`);
        }
      } finally {
        restoreSendTrackEnabledAfterSdp(this.localTrack, restoreAfterPublish);
      }
      // CRITICAL (MT22J): publish answer IMMEDIATELY — do not await ICE gather.
      const local = pc.localDescription ?? answer;
      try {
        await set(
          ref(getFirebaseDb(), `${voiceRootPath(this.code)}/answer`),
          buildSdpPayload(local, this.seat, Date.now(), {
            round: answeredRound,
            gsid: this.sid,
          }),
        );
      } catch (writeErr) {
        console.warn('voice answer RTDB write failed', writeErr);
        const wmsg = writeErr instanceof Error ? writeErr.message : 'Answer write failed';
        void this.publishVoiceDiag(`answer-write:${wmsg}`);
        this.callbacks.onStatus?.('error', `Answer write failed: ${wmsg}`);
        this.startAnswerRetryLoop();
        return;
      }
      this.rebindRemoteAudio('answer');
      // If a newer offer arrived mid-flight, do not clear it or claim done.
      if (!this.pendingRemoteOffer || this.pendingRemoteOffer.round === answeredRound) {
        this.wroteLocalAnswer = true;
        this.pendingRemoteOffer = null;
        this.clearAnswerRetryLoop();
        this.clearForceAnswer();
        void this.publishVoiceDiag(`answer-ok:${shortVoiceRound(answeredRound)}`);
        // Still not send-capable (stubborn Safari) → ask host for a fresh round.
        if (dir === 'recvonly' || dir === 'inactive') {
          void this.requestReoffer('answer-recvonly');
        }
      } else {
        this.wroteLocalAnswer = false;
        this.startAnswerRetryLoop();
      }
    } catch (e) {
      console.warn('voice answer failed', e);
      const msg = e instanceof Error ? e.message : 'Answer failed';
      const name = e instanceof Error ? e.name : '';
      void this.publishVoiceDiag(`createAnswer:${name || msg}:${msg}`);
      this.callbacks.onStatus?.('error', `Answer failed: ${msg}`);
      this.startAnswerRetryLoop();
    } finally {
      this.makingAnswer = false;
      this.reassertLiveStatus();
      // Immediately apply newer offer that arrived while we were answering.
      if (
        !this.disposed &&
        this.pendingRemoteOffer &&
        this.pendingRemoteOffer.round !== answeredRound &&
        !this.wroteLocalAnswer
      ) {
        void this.onRemoteOffer(this.pendingRemoteOffer);
      }
    }
  }

  private async onRemoteAnswer(payload: VoiceSdpPayload): Promise<void> {
    if (!this.pc || this.disposed) return;
    const pc = this.pc;
    const decision = decideAnswerForRound({
      mySeat: this.seat,
      answerFrom: payload.from,
      answerRound: payload.round ?? null,
      currentRound: this.currentRound,
      signalingState: pc.signalingState,
    });
    if (decision === 'not-mine') return;
    if (decision === 'no-round' || decision === 'stale-round') {
      // Old answer (earlier round / earlier host session / pre-round build).
      // Drop quietly — never an error, never applied to the new offer.
      void this.publishVoiceDiag(
        `answer-stale:${decision}:${shortVoiceRound(payload.round)}`,
      );
      return;
    }
    if (decision === 'not-waiting') {
      // Same round but we are stable: already applied (onValue re-fire) — or a
      // REFRESHED guest answered our still-published offer with a new PC.
      if (
        payload.gsid &&
        this.appliedGuestSid &&
        payload.gsid !== this.appliedGuestSid
      ) {
        this.rebuildHostPeerConnection('guest-new-session');
      }
      return;
    }
    this.rtdbAnswerPresent = true;
    this.seenRemoteAnswer = true;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      this.appliedGuestSid = payload.gsid ?? null;
      await this.flushPendingRemoteIce();
      void this.publishVoiceDiag(`answer-applied:${shortVoiceRound(payload.round)}`);
      this.rebindRemoteAudio('answer-applied');
      this.reassertLiveStatus();
      if (this.needsRenegotiate) {
        this.needsRenegotiate = false;
        await this.maybeNegotiate();
      } else {
        this.maybeHostReofferForReceive('answer');
      }
    } catch (e) {
      console.warn('voice apply answer failed', e);
      const msg = e instanceof Error ? e.message : 'Apply answer failed';
      void this.publishVoiceDiag(`apply-answer:${msg}`);
      this.callbacks.onStatus?.('error', `Apply answer: ${msg}`);
    }
  }

  /** Seat 0 only. Pass iceRestart=true after ICE failed / Hold stall. */
  private async maybeNegotiate(iceRestart = false): Promise<void> {
    if (!this.pc || this.disposed) return;
    // HARD GATE: seat 1 never creates or publishes an offer.
    if (!isInitialOffererSeat(this.seat)) return;
    if (!this.bothReady) return;
    if (!this.canCreateOffer() && !this.hasPublishedOffer()) return;
    // Prefer mic-on-sender before first offer. After HOST_OFFER_WITHOUT_MIC_MS
    // grace, offer anyway — audio transceiver already exists (sendrecv).
    if (!this.micAttached && !this.allowOfferWithoutMic) {
      this.needsRenegotiate = true;
      void this.publishVoiceDiag('offer-deferred-mic');
      return;
    }
    if (this.makingOffer) {
      // Mic adopt / replaceTrack raced the in-flight offer — retry after answer.
      this.needsRenegotiate = true;
      return;
    }
    const pc = this.pc;
    // Waiting for answer: re-touch the SAME local offer + round (new `at`) so
    // late guest listeners fire — NEVER createOffer + answer:null mid-round.
    if (pc.signalingState !== 'stable') {
      if (
        !iceRestart &&
        pc.signalingState === 'have-local-offer' &&
        pc.localDescription?.type === 'offer' &&
        this.currentRound
      ) {
        try {
          await update(voiceRootRef(this.code), {
            offer: buildSdpPayload(pc.localDescription, this.seat, Date.now(), {
              round: this.currentRound,
            }),
          });
        } catch (e) {
          console.warn('voice offer republish failed', e);
        }
      } else {
        this.needsRenegotiate = true;
        console.warn('voice offer deferred, signalingState=', pc.signalingState);
      }
      return;
    }
    this.makingOffer = true;
    this.needsRenegotiate = false;
    try {
      if (iceRestart) {
        // Drop this seat's published ICE only (never the peer's list).
        try {
          await remove(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ice/${this.seat}`));
        } catch (e) {
          console.warn('voice ice clear on restart', e);
        }
      }
      await this.bindLocalTrackToSender();
      this.forceAudioSendRecv();
      const wasSend = captureSendTrackEnabledForSdp(this.localTrack);
      let offer: RTCSessionDescriptionInit;
      let restoreOffer = wasSend;
      try {
        offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
        await pc.setLocalDescription(offer);
        const dir = audioDirectionFromSdp(pc.localDescription?.sdp ?? offer.sdp) ?? '';
        if (dir === 'recvonly' || dir === 'inactive') {
          void this.publishVoiceDiag(`offer-dir-bad:${dir || 'none'}`);
          this.forceAudioSendRecv();
          if (this.localTrack) this.localTrack.enabled = true;
          restoreOffer = null;
          try {
            offer = await pc.createOffer(
              iceRestart ? { iceRestart: true } : undefined,
            );
            await pc.setLocalDescription(offer);
          } catch (retryErr) {
            console.warn('voice offer sendrecv retry failed', retryErr);
          }
        }
      } finally {
        restoreSendTrackEnabledAfterSdp(this.localTrack, restoreOffer);
      }
      if (this.pc !== pc || this.disposed) return;
      // New round for every fresh createOffer. Clear the previous answer in the
      // SAME write; any late answer for an older round is round-filtered.
      this.roundSeq += 1;
      const round = makeVoiceRound(this.sid, this.roundSeq);
      this.currentRound = round;
      const local = pc.localDescription ?? offer;
      const offerPayload = buildSdpPayload(local, this.seat, Date.now(), { round });
      const clearAnswer = shouldClearAnswerOnOfferPublish({
        iceRestart,
        offerSdpChanged: this.lastPublishedOfferSdp !== offerPayload.sdp,
        hadRemoteAnswer: this.seenRemoteAnswer || this.rtdbAnswerPresent,
        newRound: true,
      });
      const updates: Record<string, unknown> = { offer: offerPayload };
      if (clearAnswer) {
        updates.answer = null;
        this.seenRemoteAnswer = false;
        this.rtdbAnswerPresent = false;
      }
      // Publish offer IMMEDIATELY — trickle ice/{0} carries candidates.
      await update(voiceRootRef(this.code), updates);
      this.lastPublishedOfferSdp = offerPayload.sdp;
      this.clearHostOfferPublishFail();
      void this.publishVoiceDiag(`offer-ok:${shortVoiceRound(round)}`);
    } catch (e) {
      console.warn('voice offer failed', e);
      const msg = e instanceof Error ? e.message : 'Offer failed';
      this.callbacks.onStatus?.('error', `Offer failed: ${msg}`);
    } finally {
      this.makingOffer = false;
      if (this.needsRenegotiate && !this.disposed) {
        this.needsRenegotiate = false;
        queueMicrotask(() => {
          void this.maybeNegotiate();
        });
      }
    }
  }

  /**
   * Tear down PC + listeners.
   * @param clearSignaling wipe rooms/{code}/voice
   * @param opts.stopMic default true — set false to keep Join-gesture mic for reconnect
   * @returns preserved local MediaStream when stopMic is false
   */
  async dispose(
    clearSignaling: boolean,
    opts: { stopMic?: boolean } = {},
  ): Promise<MediaStream | null> {
    if (this.disposed) return null;
    this.disposed = true;
    const stopMic = opts.stopMic !== false;
    this.clearLinkTimers();
    this.clearPeerWaitTimers();
    if (this.readyHeartbeatTimer != null) {
      clearInterval(this.readyHeartbeatTimer);
      this.readyHeartbeatTimer = null;
    }
    this.pendingRemoteOffer = null;
    this.wroteLocalAnswer = false;
    this.makingAnswer = false;
    this.rtdbAnswerPresent = false;
    this.lastPublishedOfferSdp = null;
    this.bothReadyAt = null;
    this.micAttached = false;
    this.signalingBound = false;
    this.currentRound = null;
    this.remoteSid = null;
    this.clearForceAnswer();
    if (this.statsTimer != null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];
    this.pendingRemoteIce = [];
    this.bothReady = false;
    this.stayReady = false;

    try {
      await this.writeTalking(false);
    } catch {
      /* ignore */
    }

    // Clear own ready only on intentional teardown. Effect remounts keep the
    // flag so we do not race a new session's announceReady with a late false.
    if (stopMic) {
      try {
        await set(ref(getFirebaseDb(), `${voiceRootPath(this.code)}/ready/${this.seat}`), false);
      } catch {
        /* ignore */
      }
    }

    // Detach sender track before closing PC (keep or stop mic below).
    if (this.pc && this.localTrack) {
      try {
        const sender = this.pc.getSenders().find((s) => s.track === this.localTrack);
        if (sender) await sender.replaceTrack(null);
      } catch {
        /* ignore */
      }
    }

    let preserved: MediaStream | null = null;
    if (stopMic) {
      if (this.localTrack) {
        try {
          this.localTrack.stop();
        } catch {
          /* ignore */
        }
      }
      this.localStream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    } else {
      preserved = this.localStream;
      // localTrack is a VAD sender clone and is not inside preserved. Stop it;
      // the next adoption creates a fresh clone from the preserved monitor mic.
      if (this.localTrack) {
        try {
          this.localTrack.stop();
        } catch {
          /* ignore */
        }
      }
      if (preserved) {
        // Keep monitor capture enabled so a remount VAD / re-clone is not silent.
        preserved.getAudioTracks().forEach((t) => {
          t.enabled = true;
        });
      }
    }
    this.localTrack = null;
    this.localStream = null;

    this.closeCurrentPeerConnection();

    this.remoteStream = null;
    this.callbacks.onRemoteStream?.(null);
    this.callbacks.onRemoteTalking?.(false);
    this.callbacks.onStatus?.('idle');

    if (clearSignaling) {
      // SEAT-SCOPED only — never remove the whole voice tree on Leave.
      // Prior remove(voiceRoot) wiped the peer's ready and stranded hosts at
      // ready=[null,true] with no offer (4DGBF / NCM5X pattern).
      try {
        await clearSeatVoiceSignaling(this.code, this.seat);
      } catch (e) {
        console.warn('clear seat voice signaling failed', e);
      }
    }
    return preserved;
  }
}

/**
 * Clear only this seat's voice keys. Does not touch the peer's ready/ICE.
 * Host also drops offer/answer so the next Join renegotiates cleanly.
 */
export async function clearSeatVoiceSignaling(
  code: string,
  seat: SeatRole,
): Promise<void> {
  const root = voiceRootPath(code);
  const db = getFirebaseDb();
  try {
    const updates: Record<string, unknown> = {
      [`${root}/ready/${seat}`]: false,
      [`${root}/talking/${seat}`]: false,
      [`${root}/ice/${seat}`]: null,
    };
    // Drop SDP on Leave: the next Join needs a fresh host PC/round either way
    // (host rebuilds on guest-rejoined / guest-no-offer).
    updates[`${root}/offer`] = null;
    updates[`${root}/answer`] = null;
    updates[`${root}/renegotiate`] = null;
    updates[`${root}/reoffer`] = null;
    updates[`${root}/diag/${seat}`] = null;
    await update(ref(db), updates);
  } catch (e) {
    console.warn('clearSeatVoiceSignaling failed', e);
  }
}

/** Clear entire voice signaling node (room leave / match end only). */
export async function clearVoiceSignaling(code: string): Promise<void> {
  try {
    await remove(voiceRootRef(code));
  } catch {
    /* ignore */
  }
}
