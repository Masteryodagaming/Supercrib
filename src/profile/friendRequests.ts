/**
 * Mutual friend requests via RTDB inboxes (works with owner-only users/{uid} rules).
 *
 * Paths:
 *   friendRequests/{toUid}/{fromUid}  — pending request B can read/accept/decline
 *   friendAccepts/{toUid}/{fromUid}   — accept receipt so A can add B (A is toUid)
 *   users/{uid}/outgoingRequests/{toUid} — A's own outgoing list (owner write)
 *
 * Accept flow (no Cloud Functions):
 *   1. A writes friendRequests/{b}/{a} + users/{a}/outgoingRequests/{b}
 *   2. B listens friendRequests/{b}
 *   3. B accept: writes users/{b}/friends/{a}, friendAccepts/{a}/{b}, deletes request
 *   4. A listens friendAccepts/{a}: writes users/{a}/friends/{b}, clears accept + outgoing
 *
 * See README for RTDB rules Joshua must paste.
 */
import {
  get,
  onValue,
  ref,
  remove,
  set,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from '../multiplayer/firebase';
import {
  Friend,
  addCloudFriend,
  loadFriends,
  loadProfile,
} from './storage';


export type FriendRequestStatus = 'pending';

export interface FriendRequest {
  fromUid: string;
  fromName: string;
  fromCode?: string;
  createdAt: number;
  status: FriendRequestStatus;
}

export interface FriendAccept {
  fromUid: string;
  fromName: string;
  createdAt: number;
}

export interface OutgoingRequest {
  toUid: string;
  toName: string;
  createdAt: number;
}

export type SendFriendRequestResult =
  | { ok: true; toName: string }
  | {
      ok: false;
      reason:
        | 'not_configured'
        | 'not_found'
        | 'self'
        | 'already_friends'
        | 'request_pending'
        | 'they_requested'
        | 'error';
      message: string;
    };

export function friendRequestPath(toUid: string, fromUid: string): string {
  return `friendRequests/${toUid}/${fromUid}`;
}

export function friendRequestsInboxPath(toUid: string): string {
  return `friendRequests/${toUid}`;
}

export function friendAcceptPath(toUid: string, fromUid: string): string {
  return `friendAccepts/${toUid}/${fromUid}`;
}

export function friendAcceptsInboxPath(toUid: string): string {
  return `friendAccepts/${toUid}`;
}

export function outgoingRequestPath(fromUid: string, toUid: string): string {
  return `users/${fromUid}/outgoingRequests/${toUid}`;
}

export function outgoingRequestsPath(fromUid: string): string {
  return `users/${fromUid}/outgoingRequests`;
}

function isFriendRequest(v: unknown): v is FriendRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as FriendRequest;
  return (
    typeof r.fromUid === 'string' &&
    typeof r.fromName === 'string' &&
    typeof r.createdAt === 'number' &&
    (r.status === 'pending' || r.status === undefined) &&
    (r.fromCode === undefined || typeof r.fromCode === 'string')
  );
}

function isFriendAccept(v: unknown): v is FriendAccept {
  if (!v || typeof v !== 'object') return false;
  const a = v as FriendAccept;
  return (
    typeof a.fromUid === 'string' &&
    typeof a.fromName === 'string' &&
    typeof a.createdAt === 'number'
  );
}

function isOutgoingRequest(v: unknown): v is OutgoingRequest {
  if (!v || typeof v !== 'object') return false;
  const o = v as OutgoingRequest;
  return (
    typeof o.toUid === 'string' &&
    typeof o.toName === 'string' &&
    typeof o.createdAt === 'number'
  );
}

function requestsFromSnap(val: unknown): FriendRequest[] {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val as Record<string, unknown>)
    .map(([key, raw]) => {
      if (!isFriendRequest(raw)) return null;
      // Prefer path key as fromUid if payload missing / mismatched
      return {
        ...raw,
        fromUid: raw.fromUid || key,
        status: 'pending' as const,
      };
    })
    .filter((r): r is FriendRequest => r !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function acceptsFromSnap(val: unknown): FriendAccept[] {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val as Record<string, unknown>)
    .map(([key, raw]) => {
      if (!isFriendAccept(raw)) return null;
      return { ...raw, fromUid: raw.fromUid || key };
    })
    .filter((a): a is FriendAccept => a !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function outgoingFromSnap(val: unknown): OutgoingRequest[] {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val as Record<string, unknown>)
    .map(([key, raw]) => {
      if (!isOutgoingRequest(raw)) return null;
      return { ...raw, toUid: raw.toUid || key };
    })
    .filter((o): o is OutgoingRequest => o !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function alreadyFriendsWith(uid: string): boolean {
  return loadFriends().some((f) => f.uid === uid || f.id === uid);
}

function friendPayload(uid: string, name: string): Friend {
  return {
    id: uid,
    uid,
    name: name.trim() || 'Player',
    status: 'offline',
    addedAt: Date.now(),
  };
}

/** Write a single friend entry under the caller's own friends map. */
async function writeOwnFriendEntry(
  myUid: string,
  friendUid: string,
  friendName: string,
): Promise<Friend[]> {
  const next = addCloudFriend(friendUid, friendName);
  if (!isFirebaseConfigured()) return next;
  try {
    await set(
      ref(getFirebaseDb(), `users/${myUid}/friends/${friendUid}`),
      friendPayload(friendUid, friendName),
    );
  } catch (e) {
    console.warn('writeOwnFriendEntry failed', e);
    // Local list still updated
  }
  return next;
}

/**
 * A sends a friend request to B (by resolved uid/name).
 * Does not instantly add to friends — creates pending request only.
 */
export async function sendFriendRequest(args: {
  fromUid: string;
  fromName: string;
  fromCode?: string | null;
  toUid: string;
  toName: string;
}): Promise<SendFriendRequestResult> {
  const { fromUid, toUid } = args;
  const fromName = args.fromName.trim() || 'Player';
  const toName = args.toName.trim() || 'Player';
  const fromCode = args.fromCode?.trim() || undefined;

  if (!fromUid || !toUid) {
    return { ok: false, reason: 'not_found', message: 'No player found.' };
  }
  if (fromUid === toUid) {
    return {
      ok: false,
      reason: 'self',
      message: "That's your own code — share it with a friend instead.",
    };
  }
  if (alreadyFriendsWith(toUid)) {
    return {
      ok: false,
      reason: 'already_friends',
      message: 'Already friends.',
    };
  }
  if (!isFirebaseConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Cloud sync is not available.',
    };
  }

  const db = getFirebaseDb();
  try {
    // They already sent us a request?
    const reverseSnap = await get(ref(db, friendRequestPath(fromUid, toUid)));
    if (reverseSnap.exists()) {
      return {
        ok: false,
        reason: 'they_requested',
        message: 'They already sent you a request — check Incoming.',
      };
    }

    const existingSnap = await get(ref(db, friendRequestPath(toUid, fromUid)));
    if (existingSnap.exists()) {
      return {
        ok: false,
        reason: 'request_pending',
        message: 'Request already pending.',
      };
    }

    const createdAt = Date.now();
    const request: FriendRequest = {
      fromUid,
      fromName,
      ...(fromCode ? { fromCode } : {}),
      createdAt,
      status: 'pending',
    };
    const outgoing: OutgoingRequest = { toUid, toName, createdAt };

    await set(ref(db, friendRequestPath(toUid, fromUid)), request);
    await set(ref(db, outgoingRequestPath(fromUid, toUid)), outgoing);

    return { ok: true, toName };
  } catch (e) {
    console.warn('sendFriendRequest failed', e);
    return {
      ok: false,
      reason: 'error',
      message:
        e instanceof Error
          ? e.message
          : 'Could not send request. Check connection or RTDB rules.',
    };
  }
}

/** B declines: delete the inbox request. A's outgoing watcher will clear. */
export async function declineFriendRequest(
  myUid: string,
  fromUid: string,
): Promise<void> {
  if (!isFirebaseConfigured() || !myUid || !fromUid) return;
  try {
    await remove(ref(getFirebaseDb(), friendRequestPath(myUid, fromUid)));
  } catch (e) {
    console.warn('declineFriendRequest failed', e);
    throw e instanceof Error ? e : new Error('Could not decline request.');
  }
}

/**
 * B accepts: add A to B's friends, write accept receipt for A, delete request.
 */
export async function acceptFriendRequest(
  myUid: string,
  myName: string,
  request: FriendRequest,
): Promise<Friend[]> {
  if (!isFirebaseConfigured() || !myUid || !request.fromUid) {
    throw new Error('Cloud sync is not available.');
  }
  if (myUid === request.fromUid) {
    throw new Error('Invalid request.');
  }

  const db = getFirebaseDb();
  const fromUid = request.fromUid;
  const fromName = request.fromName.trim() || 'Player';
  const myDisplay = myName.trim() || loadProfile()?.displayName || 'Player';

  // 1. Add requester to our friends list
  const next = await writeOwnFriendEntry(myUid, fromUid, fromName);

  // 2. Accept receipt so A can add us
  const accept: FriendAccept = {
    fromUid: myUid,
    fromName: myDisplay,
    createdAt: Date.now(),
  };
  await set(ref(db, friendAcceptPath(fromUid, myUid)), accept);

  // 3. Clear the pending request
  await remove(ref(db, friendRequestPath(myUid, fromUid)));

  return next;
}

/**
 * A processes an accept receipt: add B to friends, delete receipt + outgoing.
 */
export async function processFriendAccept(
  myUid: string,
  accept: FriendAccept,
): Promise<Friend[]> {
  if (!myUid || !accept.fromUid) return loadFriends();
  const next = await writeOwnFriendEntry(
    myUid,
    accept.fromUid,
    accept.fromName.trim() || 'Player',
  );
  if (!isFirebaseConfigured()) return next;
  const db = getFirebaseDb();
  try {
    await remove(ref(db, friendAcceptPath(myUid, accept.fromUid)));
  } catch (e) {
    console.warn('processFriendAccept: clear accept failed', e);
  }
  try {
    await remove(ref(db, outgoingRequestPath(myUid, accept.fromUid)));
  } catch (e) {
    console.warn('processFriendAccept: clear outgoing failed', e);
  }
  return next;
}

/** A cancels an outgoing request (optional). */
export async function cancelOutgoingRequest(
  myUid: string,
  toUid: string,
): Promise<void> {
  if (!isFirebaseConfigured() || !myUid || !toUid) return;
  const db = getFirebaseDb();
  try {
    await remove(ref(db, friendRequestPath(toUid, myUid)));
  } catch (e) {
    console.warn('cancelOutgoingRequest: inbox remove failed', e);
  }
  try {
    await remove(ref(db, outgoingRequestPath(myUid, toUid)));
  } catch (e) {
    console.warn('cancelOutgoingRequest: outgoing remove failed', e);
  }
}

export function subscribeIncomingRequests(
  uid: string,
  cb: (requests: FriendRequest[]) => void,
): Unsubscribe {
  if (!isFirebaseConfigured() || !uid) {
    cb([]);
    return () => {};
  }
  const r = ref(getFirebaseDb(), friendRequestsInboxPath(uid));
  return onValue(
    r,
    (snap) => cb(requestsFromSnap(snap.val())),
    (err) => {
      console.warn('subscribeIncomingRequests failed', err);
      cb([]);
    },
  );
}

export function subscribeFriendAccepts(
  uid: string,
  cb: (accepts: FriendAccept[]) => void,
): Unsubscribe {
  if (!isFirebaseConfigured() || !uid) {
    cb([]);
    return () => {};
  }
  const r = ref(getFirebaseDb(), friendAcceptsInboxPath(uid));
  return onValue(
    r,
    (snap) => cb(acceptsFromSnap(snap.val())),
    (err) => {
      console.warn('subscribeFriendAccepts failed', err);
      cb([]);
    },
  );
}

export function subscribeOutgoingRequests(
  uid: string,
  cb: (outgoing: OutgoingRequest[]) => void,
): Unsubscribe {
  if (!isFirebaseConfigured() || !uid) {
    cb([]);
    return () => {};
  }
  const r = ref(getFirebaseDb(), outgoingRequestsPath(uid));
  return onValue(
    r,
    (snap) => cb(outgoingFromSnap(snap.val())),
    (err) => {
      console.warn('subscribeOutgoingRequests failed', err);
      cb([]);
    },
  );
}

/**
 * When an outgoing inbox entry disappears (decline or accept), clear our
 * outgoingRequests row if we are not already friends (accept path clears too).
 */
export function watchOutgoingRequestStatus(
  myUid: string,
  toUid: string,
  onGone: () => void,
): Unsubscribe {
  if (!isFirebaseConfigured() || !myUid || !toUid) {
    return () => {};
  }
  const r = ref(getFirebaseDb(), friendRequestPath(toUid, myUid));
  return onValue(
    r,
    (snap) => {
      if (!snap.exists()) {
        onGone();
      }
    },
    (err) => {
      console.warn('watchOutgoingRequestStatus failed', err);
    },
  );
}

/** Clear stale outgoing row after remote decline (or accept already handled). */
export async function clearOutgoingIfNeeded(
  myUid: string,
  toUid: string,
): Promise<void> {
  if (!isFirebaseConfigured() || !myUid || !toUid) return;
  // If accept already made us friends, processFriendAccept clears outgoing.
  // If declined, still clear.
  try {
    await remove(ref(getFirebaseDb(), outgoingRequestPath(myUid, toUid)));
  } catch (e) {
    console.warn('clearOutgoingIfNeeded failed', e);
  }
}


const processingAcceptKeys = new Set<string>();

/**
 * Listen for accept receipts and apply them (idempotent across multiple subscribers).
 */
export function subscribeAndProcessAccepts(
  uid: string,
  onUpdated?: (friends: Friend[]) => void,
): Unsubscribe {
  return subscribeFriendAccepts(uid, (accepts) => {
    void (async () => {
      const live = new Set(accepts.map((a) => `${uid}:${a.fromUid}`));
      for (const key of [...processingAcceptKeys]) {
        if (key.startsWith(`${uid}:`) && !live.has(key)) {
          processingAcceptKeys.delete(key);
        }
      }
      for (const a of accepts) {
        const key = `${uid}:${a.fromUid}`;
        if (processingAcceptKeys.has(key)) continue;
        processingAcceptKeys.add(key);
        try {
          const next = await processFriendAccept(uid, a);
          onUpdated?.(next);
        } catch (e) {
          processingAcceptKeys.delete(key);
          console.warn('subscribeAndProcessAccepts failed', e);
        }
      }
    })();
  });
}

/**
 * Drain any accept receipts left while offline / not listening.
 * Call on sign-in hydrate.
 */
export async function drainFriendAccepts(uid: string): Promise<Friend[]> {
  if (!isFirebaseConfigured() || !uid) return loadFriends();
  try {
    const snap = await get(ref(getFirebaseDb(), friendAcceptsInboxPath(uid)));
    const accepts = acceptsFromSnap(snap.val());
    let friends = loadFriends();
    for (const a of accepts) {
      friends = await processFriendAccept(uid, a);
    }
    return friends;
  } catch (e) {
    console.warn('drainFriendAccepts failed', e);
    return loadFriends();
  }
}
