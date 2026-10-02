/**
 * Exclusive avatar + skin gifts via RTDB inbox (works with owner-only users/{uid} rules).
 *
 * Paths:
 *   avatarGift/{toUid}/{pushId} — pending gift
 *     { fromUid, fromName?, avatarId, avatarLabel, imageSrc?, note?, at }
 *
 * Skin gifts reuse the same path (production already has avatarGift rules requiring avatarId):
 *   Board: avatarId "board:{boardId}"  e.g. "board:cj_dumpster"
 *   Felt:  avatarId "felt:{feltId}"    e.g. "felt:cj_dumpster"
 *   Else:  exclusive avatar id as before
 *
 * Recipient claims from Home notifications (Claim button) — not auto-drained on hydrate.
 * Claim: grant local, writeCloudProfile (strict), only then delete inbox.
 * If cloud push fails, inbox stays so the user can Claim again (local grant is idempotent).
 * See README for RTDB rules.
 */
import {
  get,
  onValue,
  push,
  ref,
  remove,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from '../multiplayer/firebase';
import {
  getExclusiveGiftAvatar,
  SUPERCRIB_FATHER_ID,
} from './avatars';
import {
  grantAvatarIdOnProfile,
  grantBoardIdOnProfile,
  grantFeltIdOnProfile,
} from './coins';
import { loadProfile, saveProfile, type Profile } from './storage';

export interface AvatarGiftEntry {
  fromUid: string;
  fromName?: string;
  avatarId: string;
  avatarLabel: string;
  imageSrc?: string;
  note?: string;
  at: number;
}

/** Encoded skin gift kinds over the avatarGift avatarId field. */
export type GiftGrantKind = 'avatar' | 'board' | 'felt';

export type ParsedGiftTarget =
  | { kind: 'avatar'; id: string }
  | { kind: 'board'; id: string }
  | { kind: 'felt'; id: string };

/** Parse board:/felt: prefixes; anything else is an exclusive avatar id. */
export function parseGiftAvatarId(avatarId: string): ParsedGiftTarget {
  const raw = avatarId.trim();
  if (raw.startsWith('board:')) {
    const id = raw.slice('board:'.length).trim();
    return { kind: 'board', id: id || raw };
  }
  if (raw.startsWith('felt:')) {
    const id = raw.slice('felt:'.length).trim();
    return { kind: 'felt', id: id || raw };
  }
  return { kind: 'avatar', id: raw };
}

export function encodeBoardGiftId(boardId: string): string {
  return `board:${boardId.trim()}`;
}

export function encodeFeltGiftId(feltId: string): string {
  return `felt:${feltId.trim()}`;
}

export function avatarGiftPath(toUid: string, pushId: string): string {
  return `avatarGift/${toUid}/${pushId}`;
}

export function avatarGiftInboxPath(toUid: string): string {
  return `avatarGift/${toUid}`;
}

function isAvatarGiftEntry(v: unknown): v is AvatarGiftEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<AvatarGiftEntry>;
  return (
    typeof e.fromUid === 'string' &&
    typeof e.avatarId === 'string' &&
    e.avatarId.trim().length > 0 &&
    typeof e.avatarLabel === 'string' &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at)
  );
}

function entriesFromSnap(val: unknown): Array<{ id: string; entry: AvatarGiftEntry }> {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val as Record<string, unknown>)
    .map(([id, raw]) => {
      if (!isAvatarGiftEntry(raw)) return null;
      return { id, entry: raw };
    })
    .filter((x): x is { id: string; entry: AvatarGiftEntry } => x !== null)
    .sort((a, b) => a.entry.at - b.entry.at);
}

export type SendAvatarGiftResult =
  | { ok: true; pushId?: string; avatarId: string; toUid: string }
  | {
      ok: false;
      reason: 'invalid' | 'not_configured' | 'error';
      message: string;
    };

/**
 * Push an exclusive avatar (or encoded board/felt) gift into the recipient's inbox.
 * Does not grant locally — recipient must Claim.
 */
export async function sendAvatarGift(args: {
  fromUid: string;
  fromName?: string;
  toUid: string;
  avatarId: string;
  avatarLabel: string;
  imageSrc?: string;
  note?: string;
}): Promise<SendAvatarGiftResult> {
  const avatarId = args.avatarId.trim();
  const toUid = args.toUid.trim();
  if (!args.fromUid || !toUid || !avatarId || !args.avatarLabel.trim()) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Missing sender, recipient, or avatar fields.',
    };
  }
  if (!isFirebaseConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Cloud sync is not available.',
    };
  }

  const catalog = getExclusiveGiftAvatar(avatarId);
  const payload: AvatarGiftEntry = {
    fromUid: args.fromUid,
    fromName: args.fromName?.trim() || undefined,
    avatarId,
    avatarLabel: args.avatarLabel.trim(),
    at: Date.now(),
    ...(args.imageSrc?.trim()
      ? { imageSrc: args.imageSrc.trim() }
      : catalog?.imageSrc
        ? { imageSrc: catalog.imageSrc }
        : {}),
    ...(args.note?.trim() ? { note: args.note.trim().slice(0, 200) } : {}),
  };

  try {
    const inboxRef = ref(getFirebaseDb(), avatarGiftInboxPath(toUid));
    const pushed = await push(inboxRef, payload);
    return {
      ok: true,
      pushId: pushed.key ?? undefined,
      avatarId,
      toUid,
    };
  } catch (e) {
    console.warn('sendAvatarGift failed', e);
    return {
      ok: false,
      reason: 'error',
      message:
        e instanceof Error
          ? e.message
          : 'Could not send avatar gift. Check connection or RTDB avatarGift rules.',
    };
  }
}

/**
 * Convenience: gift The SuperCrib Father (or another exclusive catalog id).
 */
export async function sendExclusiveAvatarGift(args: {
  fromUid: string;
  fromName?: string;
  toUid: string;
  note?: string;
  avatarId?: string;
}): Promise<SendAvatarGiftResult> {
  const avatarId = (args.avatarId ?? SUPERCRIB_FATHER_ID).trim();
  const catalog = getExclusiveGiftAvatar(avatarId);
  if (!catalog) {
    return {
      ok: false,
      reason: 'invalid',
      message: `Unknown exclusive avatar: ${avatarId}`,
    };
  }
  return sendAvatarGift({
    fromUid: args.fromUid,
    fromName: args.fromName,
    toUid: args.toUid,
    avatarId: catalog.id,
    avatarLabel: catalog.label,
    imageSrc: catalog.imageSrc,
    note: args.note,
  });
}

export function subscribeAvatarGifts(
  uid: string,
  cb: (gifts: Array<{ id: string; entry: AvatarGiftEntry }>) => void,
): Unsubscribe {
  if (!isFirebaseConfigured() || !uid) {
    cb([]);
    return () => {};
  }
  const r = ref(getFirebaseDb(), avatarGiftInboxPath(uid));
  return onValue(
    r,
    (snap) => cb(entriesFromSnap(snap.val())),
    (err) => {
      console.warn('subscribeAvatarGifts failed', err);
      cb([]);
    },
  );
}

/**
 * Pure grant helper (no RTDB). Idempotent if already owned.
 * Routes board:/felt: prefixes to board/felt ownership; else avatar.
 */
export function grantAvatarGiftOnProfile<
  T extends {
    ownedAvatarIds?: string[];
    ownedBoardIds?: string[];
    ownedFeltIds?: string[];
  },
>(
  profile: T,
  avatarId: string,
): T & {
  ownedAvatarIds: string[];
  ownedBoardIds: string[];
  ownedFeltIds: string[];
} {
  const target = parseGiftAvatarId(avatarId);
  if (target.kind === 'board') {
    const next = grantBoardIdOnProfile(profile, target.id);
    return {
      ...next,
      ownedAvatarIds: [...(next.ownedAvatarIds ?? [])],
      ownedBoardIds: [...(next.ownedBoardIds ?? [])],
      ownedFeltIds: [...(next.ownedFeltIds ?? [])],
    };
  }
  if (target.kind === 'felt') {
    const next = grantFeltIdOnProfile(profile, target.id);
    return {
      ...next,
      ownedAvatarIds: [...(next.ownedAvatarIds ?? [])],
      ownedBoardIds: [...(next.ownedBoardIds ?? [])],
      ownedFeltIds: [...(next.ownedFeltIds ?? [])],
    };
  }
  const next = grantAvatarIdOnProfile(profile, target.id);
  return {
    ...next,
    ownedAvatarIds: [...(next.ownedAvatarIds ?? [])],
    ownedBoardIds: [...(next.ownedBoardIds ?? [])],
    ownedFeltIds: [...(next.ownedFeltIds ?? [])],
  };
}

function alreadyOwnsGiftTarget(
  profile: {
    ownedAvatarIds?: string[];
    ownedBoardIds?: string[];
    ownedFeltIds?: string[];
  },
  avatarId: string,
): boolean {
  const target = parseGiftAvatarId(avatarId);
  if (target.kind === 'board') {
    return (profile.ownedBoardIds ?? []).includes(target.id);
  }
  if (target.kind === 'felt') {
    return (profile.ownedFeltIds ?? []).includes(target.id);
  }
  return (profile.ownedAvatarIds ?? []).includes(target.id);
}

export type ClaimAvatarGiftResult =
  | {
      ok: true;
      profile: Profile;
      alreadyOwned: boolean;
      avatarId: string;
      avatarLabel: string;
      kind: GiftGrantKind;
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_configured' | 'no_profile' | 'cloud_sync' | 'error';
      message: string;
      /** Present when local grant succeeded but cloud sync / cleanup failed. */
      profile?: Profile;
    };

/**
 * Claim one pending gift: grant owned avatar/board/felt locally, strict cloud write, then remove inbox.
 * Idempotent if already owned. Inbox is only removed after cloud push succeeds (retry-friendly).
 */
export async function claimAvatarGift(
  uid: string,
  pushId: string,
  profile?: Profile | null,
): Promise<ClaimAvatarGiftResult> {
  const base = profile ?? loadProfile(uid);
  if (!base) {
    return { ok: false, reason: 'no_profile', message: 'No local profile to update.' };
  }
  if (!isFirebaseConfigured() || !uid || !pushId) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Cloud sync is not available.',
    };
  }

  try {
    const giftPath = avatarGiftPath(uid, pushId);
    const snap = await get(ref(getFirebaseDb(), giftPath));
    const raw = snap.val();
    if (!isAvatarGiftEntry(raw)) {
      // Row already gone — treat as not found for UI (may already have been claimed).
      return {
        ok: false,
        reason: 'not_found',
        message: 'This gift is no longer available.',
      };
    }

    const target = parseGiftAvatarId(raw.avatarId);
    const alreadyOwned = alreadyOwnsGiftTarget(base, raw.avatarId);
    const granted = grantAvatarGiftOnProfile(base, raw.avatarId);
    const updated: Profile = {
      ...granted,
      updatedAt: Date.now(),
    };
    // 1) Local grant first (idempotent on retry).
    const saved = saveProfile(updated, uid);

    // 2) Strict cloud write — surface permission/network errors; keep inbox on failure.
    try {
      const { writeCloudProfile } = await import('./cloudSync');
      await writeCloudProfile(uid, saved);
    } catch (e) {
      console.warn('claimAvatarGift writeCloudProfile failed', e);
      return {
        ok: false,
        reason: 'cloud_sync',
        message:
          e instanceof Error
            ? e.message
            : 'Saved on this device, but could not sync. Try Claim again.',
        profile: saved,
      };
    }

    // 3) Only remove inbox after cloud unlock is persisted.
    try {
      await remove(ref(getFirebaseDb(), giftPath));
    } catch (e) {
      console.warn('claimAvatarGift delete failed', pushId, e);
      // Cloud already has the unlock; leave inbox so user can retry cleanup (idempotent grant).
      return {
        ok: false,
        reason: 'error',
        message: 'Gift unlocked, but gift inbox cleanup failed. Try Claim again.',
        profile: saved,
      };
    }

    return {
      ok: true,
      profile: saved,
      alreadyOwned,
      avatarId: raw.avatarId,
      avatarLabel: raw.avatarLabel,
      kind: target.kind,
    };
  } catch (e) {
    console.warn('claimAvatarGift failed', e);
    return {
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : 'Could not claim avatar gift.',
    };
  }
}

/** List pending gifts once (no live subscription). Does not grant. */
export async function listAvatarGifts(
  uid: string,
): Promise<Array<{ id: string; entry: AvatarGiftEntry }>> {
  if (!isFirebaseConfigured() || !uid) return [];
  try {
    const snap = await get(ref(getFirebaseDb(), avatarGiftInboxPath(uid)));
    return entriesFromSnap(snap.val());
  } catch (e) {
    console.warn('listAvatarGifts failed', e);
    return [];
  }
}
