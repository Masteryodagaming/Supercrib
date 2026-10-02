/**
 * Session-level negotiation tests: two real VoicePttSession instances (seat 0
 * host, seat 1 guest) over an in-memory RTDB and a fake RTCPeerConnection that
 * follows JSEP transceiver matching (RFC 9429 §5.10: a remote offer never
 * re-uses an addTransceiver() transceiver; unmatched m-lines create a new
 * recvonly transceiver).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- fake RTDB
const fakeDb = vi.hoisted(() => {
  type Snap = { val: () => unknown; key: string | null };
  type Listener = {
    path: string;
    kind: 'value' | 'child';
    cb: (snap: Snap) => void;
    last?: string;
    seen: Set<string>;
    active: boolean;
  };
  let root: Record<string, unknown> = {};
  let listeners: Listener[] = [];
  let idSeq = 0;
  const writes: Array<{ path: string; val: unknown }> = [];

  const split = (p: string) => p.split('/').filter(Boolean);
  const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  function assertNoUndefined(v: unknown, path: string): void {
    if (v === undefined) throw new Error(`RTDB write of undefined at ${path}`);
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        assertNoUndefined(x, `${path}/${k}`);
      }
    }
  }
  function getAt(path: string): unknown {
    let cur: unknown = root;
    for (const k of split(path)) {
      if (!cur || typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur === undefined ? null : cur;
  }
  function setAt(path: string, val: unknown): void {
    const keys = split(path);
    if (keys.length === 0) {
      root = (val as Record<string, unknown>) ?? {};
      return;
    }
    let cur = root as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) {
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1]!;
    if (val === null) delete cur[last];
    else cur[last] = clone(val);
  }
  function notify(): void {
    for (const l of listeners) {
      if (!l.active) continue;
      const v = getAt(l.path);
      if (l.kind === 'value') {
        const j = JSON.stringify(v);
        if (j === l.last) continue;
        l.last = j;
        const snapVal = clone(v);
        queueMicrotask(() => l.active && l.cb({ val: () => snapVal, key: null }));
      } else {
        const obj = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
        for (const [k, child] of Object.entries(obj)) {
          if (l.seen.has(k)) continue;
          l.seen.add(k);
          const snapVal = clone(child);
          queueMicrotask(() => l.active && l.cb({ val: () => snapVal, key: k }));
        }
        // Allow re-add after removal.
        for (const k of [...l.seen]) if (!(k in obj)) l.seen.delete(k);
      }
    }
  }
  const api = {
    ref: (_db: unknown, path = '') => ({ path }),
    set: async (r: { path: string }, val: unknown) => {
      assertNoUndefined(val, r.path);
      writes.push({ path: r.path, val: clone(val) });
      setAt(r.path, val);
      notify();
    },
    update: async (r: { path: string }, obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        const full = [r.path, k].filter(Boolean).join('/');
        assertNoUndefined(v, full);
        writes.push({ path: full, val: clone(v) });
        setAt(full, v);
      }
      notify();
    },
    remove: async (r: { path: string }) => {
      writes.push({ path: r.path, val: null });
      setAt(r.path, null);
      notify();
    },
    push: (r: { path: string }) => ({ path: `${r.path}/k${String(++idSeq).padStart(6, '0')}` }),
    onValue: (r: { path: string }, cb: (s: Snap) => void) => {
      const l: Listener = { path: r.path, kind: 'value', cb, seen: new Set(), active: true };
      listeners.push(l);
      const v = clone(getAt(r.path));
      l.last = JSON.stringify(getAt(r.path));
      queueMicrotask(() => l.active && cb({ val: () => v, key: null }));
      return () => {
        l.active = false;
      };
    },
    onChildAdded: (r: { path: string }, cb: (s: Snap) => void) => {
      const l: Listener = { path: r.path, kind: 'child', cb, seen: new Set(), active: true };
      listeners.push(l);
      notify();
      return () => {
        l.active = false;
      };
    },
  };
  return {
    api,
    getAt,
    setAt: (p: string, v: unknown) => {
      setAt(p, v);
      notify();
    },
    writes,
    reset: () => {
      root = {};
      listeners = [];
      idSeq = 0;
      writes.length = 0;
    },
  };
});

vi.mock('firebase/database', () => fakeDb.api);
vi.mock('../firebase', () => ({ getFirebaseDb: () => ({}) }));

import { VoicePttSession, type VoiceSessionStatus } from '../voicePtt';

// ------------------------------------------------------- fake media + WebRTC
let trackSeq = 0;
class FakeTrack {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  muted = false;
  id = `trk${++trackSeq}`;
  onunmute: (() => void) | null = null;
  clone(): FakeTrack {
    const t = new FakeTrack();
    t.enabled = this.enabled;
    return t;
  }
  stop(): void {
    this.readyState = 'ended';
  }
}
class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getTracks() {
    return [...this.tracks];
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}
class FakeSender {
  track: FakeTrack | null = null;
  async replaceTrack(t: FakeTrack | null) {
    this.track = t;
  }
}
class FakeTransceiver {
  mid: string | null = null;
  currentDirection: string | null = null;
  sender = new FakeSender();
  receiver = { track: new FakeTrack() };
  stopped = false;
  firedTrack = false;
  proposedMid: string | null = null;
  constructor(
    public createdBy: 'addTransceiver' | 'addTrack' | 'remote',
    public direction: string,
  ) {}
}
type Desc = { type: string; sdp: string };
const reverse = (d: string) =>
  d === 'sendonly' ? 'recvonly' : d === 'recvonly' ? 'sendonly' : d;
const hasSend = (d: string) => d === 'sendrecv' || d === 'sendonly';
const hasRecv = (d: string) => d === 'sendrecv' || d === 'recvonly';
function intersect(local: string, remoteReversed: string): string {
  const send = hasSend(local) && hasSend(remoteReversed);
  const recv = hasRecv(local) && hasRecv(remoteReversed);
  return send && recv ? 'sendrecv' : send ? 'sendonly' : recv ? 'recvonly' : 'inactive';
}
function parseMlines(sdp: string): Array<{ mid: string; dir: string }> {
  const out: Array<{ mid: string; dir: string }> = [];
  let cur: { mid: string; dir: string } | null = null;
  for (const line of sdp.split('\r\n')) {
    if (line.startsWith('m=')) {
      cur = { mid: '', dir: 'sendrecv' };
      out.push(cur);
    } else if (cur && line.startsWith('a=mid:')) cur.mid = line.slice(6);
    else if (cur && /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line)) cur.dir = line.slice(2);
  }
  return out;
}
let pcSeq = 0;
class FakePC {
  static all: FakePC[] = [];
  id = ++pcSeq;
  transceivers: FakeTransceiver[] = [];
  signalingState = 'stable';
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  currentLocalDescription: Desc | null = null;
  currentRemoteDescription: Desc | null = null;
  iceConnectionState = 'new';
  connectionState = 'new';
  onicecandidate: unknown = null;
  ontrack: ((ev: unknown) => void) | null = null;
  onnegotiationneeded: unknown = null;
  onconnectionstatechange: unknown = null;
  oniceconnectionstatechange: unknown = null;
  createOfferCalls = 0;
  createAnswerCalls = 0;
  setRemoteCalls: string[] = [];
  midSeq = 0;
  closed = false;
  constructor(_cfg?: unknown) {
    FakePC.all.push(this);
  }
  addTransceiver(_kind: string, init?: { direction?: string }) {
    const t = new FakeTransceiver('addTransceiver', init?.direction ?? 'sendrecv');
    this.transceivers.push(t);
    return t;
  }
  addTrack(track: FakeTrack) {
    const t = new FakeTransceiver('addTrack', 'sendrecv');
    t.sender.track = track;
    this.transceivers.push(t);
    return t.sender;
  }
  getTransceivers() {
    return [...this.transceivers];
  }
  getSenders() {
    return this.transceivers.map((t) => t.sender);
  }
  private sdpFor(type: string, lines: Array<{ mid: string; dir: string }>): Desc {
    const body = lines.map((l) => `m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:${l.mid}\r\na=${l.dir}`);
    return { type, sdp: [`v=0`, `o=- ${this.id} 2 IN IP4 127.0.0.1`, `a=fingerprint:fp-${this.id}`, ...body, ''].join('\r\n') };
  }
  async createOffer() {
    this.createOfferCalls += 1;
    const lines = this.transceivers
      .filter((t) => !t.stopped)
      .map((t) => {
        if (t.mid == null && t.proposedMid == null) t.proposedMid = String(this.midSeq++);
        return { mid: (t.mid ?? t.proposedMid)!, dir: t.direction };
      });
    return this.sdpFor('offer', lines);
  }
  async createAnswer() {
    if (this.signalingState !== 'have-remote-offer') throw new Error('InvalidStateError');
    this.createAnswerCalls += 1;
    const lines = parseMlines(this.remoteDescription!.sdp).map(({ mid, dir }) => {
      const t = this.transceivers.find((x) => x.mid === mid)!;
      return { mid, dir: intersect(t.direction, reverse(dir)) };
    });
    return this.sdpFor('answer', lines);
  }
  private fireTrack(t: FakeTransceiver) {
    if (t.firedTrack) return;
    t.firedTrack = true;
    queueMicrotask(() => this.ontrack?.({ track: t.receiver.track, transceiver: t, streams: [] }));
  }
  async setLocalDescription(desc: Desc) {
    if (desc.type === 'rollback') {
      this.transceivers.forEach((t) => (t.proposedMid = null));
      this.signalingState = 'stable';
      this.localDescription = this.currentLocalDescription;
      this.remoteDescription = this.currentRemoteDescription;
      return;
    }
    if (desc.type === 'offer') {
      if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') {
        throw new Error('InvalidStateError: setLocal offer in ' + this.signalingState);
      }
      for (const t of this.transceivers) {
        if (t.mid == null && t.proposedMid != null) t.mid = t.proposedMid;
        t.proposedMid = null;
      }
      this.signalingState = 'have-local-offer';
      this.localDescription = desc;
      return;
    }
    if (this.signalingState !== 'have-remote-offer') throw new Error('InvalidStateError');
    for (const { mid, dir } of parseMlines(desc.sdp)) {
      const t = this.transceivers.find((x) => x.mid === mid);
      if (t) t.currentDirection = dir;
    }
    this.signalingState = 'stable';
    this.localDescription = this.currentLocalDescription = desc;
    this.currentRemoteDescription = this.remoteDescription;
  }
  async setRemoteDescription(desc: Desc) {
    this.setRemoteCalls.push(desc.type);
    if (desc.type === 'offer') {
      if (this.signalingState !== 'stable' && this.signalingState !== 'have-remote-offer') {
        throw new Error('InvalidStateError: remote offer in ' + this.signalingState);
      }
      for (const { mid, dir } of parseMlines(desc.sdp)) {
        let t = this.transceivers.find((x) => x.mid === mid);
        // JSEP §5.10: only addTrack()-created, unassociated transceivers are re-used.
        if (!t) t = this.transceivers.find((x) => x.createdBy === 'addTrack' && x.mid == null && !x.stopped);
        if (!t) {
          t = new FakeTransceiver('remote', 'recvonly');
          this.transceivers.push(t);
        }
        t.mid = mid;
        if (hasSend(dir)) this.fireTrack(t);
      }
      this.signalingState = 'have-remote-offer';
      this.remoteDescription = desc;
      return;
    }
    if (this.signalingState !== 'have-local-offer') throw new Error('InvalidStateError: answer in ' + this.signalingState);
    for (const { mid, dir } of parseMlines(desc.sdp)) {
      const t = this.transceivers.find((x) => x.mid === mid);
      if (!t) continue;
      t.currentDirection = reverse(dir);
      if (hasSend(dir)) this.fireTrack(t);
    }
    this.signalingState = 'stable';
    this.remoteDescription = this.currentRemoteDescription = desc;
    this.currentLocalDescription = this.localDescription;
  }
  async addIceCandidate() {}
  setConfiguration() {}
  async getStats() {
    return new Map();
  }
  close() {
    this.closed = true;
    this.signalingState = 'closed';
  }
}

function micStream(): MediaStream {
  return new FakeMediaStream([new FakeTrack()]) as unknown as MediaStream;
}

const CODE = 'GLARE1';
const V = `rooms/${CODE}/voice`;

type Harness = {
  session: VoicePttSession;
  statuses: Array<{ s: VoiceSessionStatus; d?: string }>;
  streams: Array<MediaStream | null>;
};
function makeSession(seat: 0 | 1): Harness {
  const statuses: Harness['statuses'] = [];
  const streams: Harness['streams'] = [];
  const session = new VoicePttSession(CODE, seat, {
    onStatus: (s, d) => statuses.push({ s, d }),
    onRemoteStream: (st) => streams.push(st),
  });
  return { session, statuses, streams };
}
async function connect(h: Harness): Promise<void> {
  await h.session.start({ announceReady: false });
  await h.session.adoptMicStream(micStream(), false);
  await h.session.announceReady();
}
const pcOf = (s: VoicePttSession) => (s as unknown as { pc: FakePC | null }).pc!;
const offerWrites = () =>
  fakeDb.writes.filter((w) => w.path === `${V}/offer` && w.val !== null) as Array<{
    val: { from: number; round?: string };
  }>;
const settle = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

/** Host transceiver carrying the guest's audio, with the guest mic on the matching sender. */
function assertHostReceivesGuest(host: Harness, guest: Harness): void {
  const hpc = pcOf(host.session);
  const gpc = pcOf(guest.session);
  const hostTr = hpc.transceivers.find((t) => t.mid != null)!;
  expect(hostTr.currentDirection).toBe('sendrecv');
  const guestTr = gpc.transceivers.find((t) => t.mid === hostTr.mid)!;
  expect(guestTr).toBeTruthy();
  expect(guestTr.currentDirection).toBe('sendrecv');
  const guestMic = (guest.session as unknown as { localTrack: FakeTrack }).localTrack;
  expect(guestTr.sender.track).toBe(guestMic);
  // No orphan transceiver on the guest holding the mic.
  expect(gpc.transceivers.filter((t) => t.mid == null)).toHaveLength(0);
  // Host remote <audio> bound to the receiver track of that transceiver.
  const bound = host.streams.filter(Boolean).at(-1) as unknown as FakeMediaStream;
  expect(bound.getAudioTracks()[0]).toBe(hostTr.receiver.track);
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeDb.reset();
  FakePC.all = [];
  (globalThis as Record<string, unknown>).RTCPeerConnection = FakePC;
  (globalThis as Record<string, unknown>).MediaStream = FakeMediaStream;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).RTCPeerConnection;
  delete (globalThis as Record<string, unknown>).MediaStream;
});

describe('voice negotiation — single deterministic offerer (seat 0)', () => {
  it('seat1 never publishes an offer while seat0 is present (incl. slow host past the old 2s backup window)', async () => {
    // Stale ready/0 from an earlier session: guest sees bothReady before the
    // host even starts — exactly when the old backup offerer fired.
    fakeDb.setAt(`${V}/ready/0`, true);
    const guest = makeSession(1);
    await connect(guest);
    await settle(3000); // past BACKUP_OFFER_WAIT_MS
    expect(offerWrites()).toHaveLength(0);
    const reoffer = fakeDb.getAt(`${V}/reoffer`) as { from: number; reason: string } | null;
    expect(reoffer?.from).toBe(1);
    expect(reoffer?.reason).toBe('no-offer');

    const host = makeSession(0);
    await connect(host);
    await settle(10_000);

    const offers = offerWrites();
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((w) => w.val.from === 0)).toBe(true);
    expect(offers.every((w) => typeof w.val.round === 'string')).toBe(true);
    expect(pcOf(guest.session).createOfferCalls).toBe(0);
    // Host never answered anything.
    expect(pcOf(host.session).createAnswerCalls).toBe(0);
    expect(fakeDb.writes.some((w) => w.path === `${V}/answer` && (w.val as { from?: number })?.from === 0)).toBe(false);
    expect(pcOf(host.session).signalingState).toBe('stable');
    assertHostReceivesGuest(host, guest);
    expect(host.statuses.some((x) => x.s === 'error')).toBe(false);

    // A rogue/stale offer from seat 1 cannot pull seat 0 into answering.
    fakeDb.setAt(`${V}/offer`, { type: 'offer', sdp: 'v=0\r\nm=audio 9 X 111\r\na=mid:0\r\na=sendrecv\r\n', from: 1, at: Date.now(), round: 'rogue.1' });
    await settle(3000);
    expect(pcOf(host.session).setRemoteCalls.filter((t) => t === 'offer')).toHaveLength(0);
    expect(pcOf(host.session).createAnswerCalls).toBe(0);

    await host.session.dispose(false, { stopMic: false });
    await guest.session.dispose(false, { stopMic: false });
  });

  it('drops a stale answer from an earlier round without error and never applies it to the new offer', async () => {
    const host = makeSession(0);
    const guest = makeSession(1);
    await connect(host);
    await connect(guest);
    await settle(500);
    const round1 = host.session.getCurrentRound()!;
    expect(round1).toMatch(/\.1$/);
    const answerR1 = fakeDb.getAt(`${V}/answer`) as { round: string };
    expect(answerR1.round).toBe(round1);
    expect(pcOf(host.session).signalingState).toBe('stable');

    // Guest goes silent (no ready=false write), then asks for a re-offer.
    await guest.session.dispose(false, { stopMic: false });
    fakeDb.setAt(`${V}/reoffer`, { from: 1, at: Date.now() + 1, reason: 'late-mic' });
    await settle(200);
    const round2 = host.session.getCurrentRound()!;
    expect(round2).not.toBe(round1);
    expect(round2).toMatch(/\.2$/);
    expect(fakeDb.getAt(`${V}/answer`)).toBeNull(); // cleared with the new offer
    expect(pcOf(host.session).signalingState).toBe('have-local-offer');
    const setRemoteBefore = pcOf(host.session).setRemoteCalls.length;

    // Late delivery of the round-1 answer, plus a pre-round answer.
    fakeDb.setAt(`${V}/answer`, answerR1);
    await settle(200);
    fakeDb.setAt(`${V}/answer`, { type: 'answer', sdp: 'v=0\r\n', from: 1, at: Date.now() });
    await settle(200);

    expect(pcOf(host.session).setRemoteCalls.length).toBe(setRemoteBefore);
    expect(pcOf(host.session).signalingState).toBe('have-local-offer');
    expect(host.session.getCurrentRound()).toBe(round2);
    expect(host.statuses.some((x) => x.s === 'error')).toBe(false);
    expect(host.session.getDebugSnapshot().diag).toMatch(/^answer-stale:/);

    await host.session.dispose(false, { stopMic: false });
  });

  it('late guest mic after a recvonly negotiation triggers a host re-offer that ends sendrecv on the host transceiver', async () => {
    const host = makeSession(0);
    const guest = makeSession(1);
    await connect(host);
    await connect(guest);
    await settle(500);
    const round1 = host.session.getCurrentRound()!;
    const hpc = pcOf(host.session);
    const gpc = pcOf(guest.session);
    // Model the residue we saw on iOS: the guest's audio negotiated recvonly
    // (host transceiver sendonly = host deaf) and the guest's sender lost its mic.
    const hostTr = hpc.transceivers.find((t) => t.mid != null)!;
    const guestTr = gpc.transceivers.find((t) => t.mid === hostTr.mid)!;
    hostTr.currentDirection = 'sendonly';
    guestTr.currentDirection = 'recvonly';
    guestTr.sender.track = null;
    const offersBefore = offerWrites().length;

    // Late mic: guest (re)attaches its mic.
    await guest.session.adoptMicStream(micStream(), false);
    await settle(1000);

    const reoffer = fakeDb.writes.filter((w) => w.path === `${V}/reoffer`).at(-1)?.val as
      | { from: number; reason: string }
      | undefined;
    expect(reoffer?.from).toBe(1);
    expect(reoffer?.reason).toBe('late-mic');
    const newOffers = offerWrites().slice(offersBefore);
    expect(newOffers.length).toBeGreaterThan(0);
    expect(newOffers.every((w) => w.val.from === 0)).toBe(true);
    expect(host.session.getCurrentRound()).not.toBe(round1);
    expect(gpc.createOfferCalls).toBe(0);
    expect(hpc.signalingState).toBe('stable');
    assertHostReceivesGuest(host, guest);
    const snap = host.session.getDebugSnapshot();
    expect(snap.recvDir).toBe('sendrecv');
    expect(snap.remTracks).toBe(1);

    await host.session.dispose(false, { stopMic: false });
    await guest.session.dispose(false, { stopMic: false });
  });

  it('host refresh (new host sid) makes the guest rebuild its PC instead of re-using the dead DTLS session', async () => {
    const host = makeSession(0);
    const guest = makeSession(1);
    await connect(host);
    await connect(guest);
    await settle(500);
    const oldGuestPc = pcOf(guest.session);
    // Host page refresh: old session vanishes without cleanup; ready/0 stays true.
    await host.session.dispose(false, { stopMic: false });
    const host2 = makeSession(0);
    await connect(host2);
    await settle(1000);
    const newGuestPc = pcOf(guest.session);
    expect(newGuestPc).not.toBe(oldGuestPc);
    expect(oldGuestPc.closed).toBe(true);
    assertHostReceivesGuest(host2, guest);
    await host2.session.dispose(false, { stopMic: false });
    await guest.session.dispose(false, { stopMic: false });
  });
});

describe('voice negotiation — pure helpers', () => {
  it('decideAnswerForRound applies only the current round while have-local-offer', async () => {
    const { decideAnswerForRound } = await import('../voicePtt');
    const base = { mySeat: 0 as const, answerFrom: 1 as const, currentRound: 's.2', signalingState: 'have-local-offer' };
    expect(decideAnswerForRound({ ...base, answerRound: 's.2' })).toBe('apply');
    expect(decideAnswerForRound({ ...base, answerRound: 's.1' })).toBe('stale-round');
    expect(decideAnswerForRound({ ...base, answerRound: 'old.2' })).toBe('stale-round');
    expect(decideAnswerForRound({ ...base, answerRound: undefined })).toBe('no-round');
    expect(decideAnswerForRound({ ...base, answerRound: 's.2', signalingState: 'stable' })).toBe('not-waiting');
    expect(decideAnswerForRound({ ...base, mySeat: 1, answerFrom: 0, answerRound: 's.2' })).toBe('not-mine');
  });

  it('round ids embed the host sid', async () => {
    const { makeVoiceRound, sidFromRound, shortVoiceRound } = await import('../voicePtt');
    const r = makeVoiceRound('abc123xyz', 3);
    expect(r).toBe('abc123xyz.3');
    expect(sidFromRound(r)).toBe('abc123xyz');
    expect(shortVoiceRound(r)).toBe('3xyz.3');
    expect(shortVoiceRound(null)).toBe('-');
  });

  it('shouldRequestReoffer: seat1 only, after negotiation without a send direction', async () => {
    const { shouldRequestReoffer } = await import('../voicePtt');
    const b = { seat: 1 as const, micAttached: true, hasNegotiated: true };
    expect(shouldRequestReoffer({ ...b, negotiatedDir: 'recvonly' })).toBe(true);
    expect(shouldRequestReoffer({ ...b, negotiatedDir: 'inactive' })).toBe(true);
    expect(shouldRequestReoffer({ ...b, negotiatedDir: 'sendrecv' })).toBe(false);
    expect(shouldRequestReoffer({ ...b, seat: 0, negotiatedDir: 'recvonly' })).toBe(false);
    expect(shouldRequestReoffer({ ...b, hasNegotiated: false, negotiatedDir: null })).toBe(false);
  });

  it('transceiver selection never picks an orphan (mid=null) and binds the receiving one', async () => {
    const { selectNegotiatedAudioTransceiver, selectReceiveAudioTransceiver, countReceivingAudioTransceivers } =
      await import('../voicePtt');
    const orphan = new FakeTransceiver('addTransceiver', 'sendrecv');
    const neg = new FakeTransceiver('remote', 'sendrecv');
    neg.mid = '0';
    neg.currentDirection = 'sendrecv';
    const trs = [orphan, neg] as unknown as RTCRtpTransceiver[];
    const sdp = 'v=0\r\nm=audio 9 X 111\r\na=mid:0\r\na=sendrecv\r\n';
    expect(selectNegotiatedAudioTransceiver(trs, sdp)).toBe(neg);
    expect(selectReceiveAudioTransceiver(trs, sdp)).toBe(neg);
    expect(countReceivingAudioTransceivers(trs)).toBe(1);
    expect(selectNegotiatedAudioTransceiver([orphan] as unknown as RTCRtpTransceiver[], null)).toBeNull();
  });

  it('extractInboundAudioStats reads inbound-rtp audio bytes + level (prefers bound track)', async () => {
    const { extractInboundAudioStats } = await import('../voicePtt');
    const report = new Map<string, unknown>([
      ['a', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 900, audioLevel: 0.02, trackIdentifier: 'x' }],
      ['b', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 50, audioLevel: 0.3, trackIdentifier: 'bound' }],
      ['c', { type: 'outbound-rtp', kind: 'audio', bytesSent: 9999 }],
    ]);
    expect(extractInboundAudioStats(report, 'bound')).toEqual({ bytesReceived: 50, audioLevel: 0.3 });
    expect(extractInboundAudioStats(report, null)).toEqual({ bytesReceived: 900, audioLevel: 0.02 });
    expect(extractInboundAudioStats(new Map(), null)).toEqual({ bytesReceived: null, audioLevel: null });
  });

  it('formatVoiceLinkDebug shows recvDir / inBytes / audioLevel / remTracks / audioPaused / round', async () => {
    const { formatVoiceLinkDebug } = await import('../voicePtt');
    const line = formatVoiceLinkDebug({
      readyMe: true, peerReady: true, bothReady: true, hasOffer: true, hasAnswer: true,
      seenOffer: true, wroteAnswer: true, rtdbAnswer: true, ice: 'connected', conn: 'connected',
      micAttached: true, seat: 0, sendDir: 'sendrecv', sendEnabled: false,
      recvDir: 'sendrecv', inBytes: 12345.4, audioLevel: 0.0421, remTracks: 1, txc: 1,
      audioPaused: false, round: 'k2abcd.2',
    });
    expect(line).toContain('recvDir=sendrecv');
    expect(line).toContain('inBytes=12345');
    expect(line).toContain('audioLevel=0.042');
    expect(line).toContain('remTracks=1');
    expect(line).toContain('txc=1');
    expect(line).toContain('audioPaused=0');
    expect(line).toContain('round=abcd.2');
  });
});

describe('voice negotiation — status label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeDb.reset();
    (globalThis as Record<string, unknown>).RTCPeerConnection = FakePC;
    (globalThis as Record<string, unknown>).MediaStream = FakeMediaStream;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it("a re-answer while connected does not leave the guest on 'Answering…'", async () => {
    const host = makeSession(0);
    const guest = makeSession(1);
    await connect(host);
    await connect(guest);
    await settle(500);
    // Mark both links connected (fake ICE).
    for (const h of [host, guest]) {
      const pc = pcOf(h.session);
      pc.iceConnectionState = 'connected';
      pc.connectionState = 'connected';
      (pc.onconnectionstatechange as () => void)?.();
    }
    expect(guest.statuses.at(-1)?.s).toBe('live');
    const roundBefore = host.session.getCurrentRound();
    const mark = guest.statuses.length;
    // Host re-offers (new round) while live; guest re-answers.
    fakeDb.setAt(`${V}/reoffer`, { from: 1, at: Date.now() + 1, reason: 'live-recvonly' });
    await settle(500);
    expect(host.session.getCurrentRound()).not.toBe(roundBefore);
    expect(guest.session.getCurrentRound()).toBe(host.session.getCurrentRound());
    const after = guest.statuses.slice(mark);
    expect(after.some((x) => x.d === 'Answering…')).toBe(false);
    expect(guest.statuses.at(-1)?.s).toBe('live');
    expect(host.statuses.at(-1)?.s).toBe('live');
    await host.session.dispose(false, { stopMic: false });
    await guest.session.dispose(false, { stopMic: false });
  });
});
