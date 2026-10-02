/**
 * Cloud profile + friends under RTDB `users/{uid}/…` (free Spark).
 *
 * Paths:
 *   users/{uid}/profile  — displayName, avatar, playerCode, Vs AI + online records, settings
 *   users/{uid}/friends  — map of friendId → Friend (owner only; mutual via friend requests)
 *   users/{uid}/outgoingRequests — pending requests this user sent
 *   friendRequests/{toUid}/{fromUid} — pending inbox (cross-user; see friendRequests.ts)
 *   friendAccepts/{toUid}/{fromUid} — accept receipts for mutual list update
 *   coinInbox/{toUid}/{pushId} — Doctor SC gifts (see coinInbox.ts)
 *   avatarGift/{toUid}/{pushId} — Exclusive avatar gifts (see avatarGiftInbox.ts; Claim from Home)
 *   playerCodes/{code}   — { uid, displayName } for O(1) friend lookup
 *   emailIndex/{key}     — { uid, displayName } (key = lower email with `.` → `,`)
 *
 * Suggested RTDB rules — see README (Joshua must paste in Console; we cannot deploy rules).
 */
import { get, ref, remove, runTransaction, set, update } from 'firebase/database';
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '../multiplayer/firebase';
import {
  Friend,
  Profile,
  CareerRecord,
  TournamentRecord,
  cloudFriendsOnly,
  createDefaultProfile,
  defaultSettings,
  emptyRecord,
  emptyTournamentRecord,
  loadFriends,
  loadProfile,
  saveFriends,
  saveProfile,
} from './storage';
import { mergeCoinStates, normalizeCoins, normalizeLedger } from './coins';
import {
  applySignInPromoIfEligible,
  hasClaimedSignInPromo,
  normalizeClaimedPromos,
  repairSignInPromoWipe,
} from './promos';
import {
  emailIndexKey,
  generatePlayerCode,
  isValidPlayerCode,
  looksLikeEmail,
  normalizeEmail,
  normalizePlayerCode,
} from './playerCode';
import { drainFriendAccepts } from './friendRequests';
import { drainCoinInbox } from './coinInbox';
import { migrateMasterYodaSelection } from './avatars';
import { DEFAULT_FELT_ID, normalizeFeltId } from './felts';
import { DEFAULT_BOARD_ID, normalizeBoardId } from './boards';
import { BUILTIN_AVATARS } from './avatars';
import { isOwner } from '../tournament/isOwner';
import {
  DEFAULT_RAIL_EMOJI_IDS,
  effectiveOwnedEmojiIds,
  normalizeEquippedRailEmojiIds,
  type ReactEmojiId,
} from '../ui/emoji/reactEmojis';

export function userProfilePath(uid: string): string {
  return `users/${uid}/profile`;
}

export function userFriendsPath(uid: string): string {
  return `users/${uid}/friends`;
}

export function playerCodePath(code: string): string {
  return `playerCodes/${normalizePlayerCode(code)}`;
}

export function emailIndexPath(email: string): string {
  return `emailIndex/${emailIndexKey(email)}`;
}

function clampRec(r: CareerRecord | undefined | null): CareerRecord {
  const x = r ?? emptyRecord();
  return {
    wins: Math.max(0, Math.floor(x.wins ?? 0)),
    losses: Math.max(0, Math.floor(x.losses ?? 0)),
    gamesPlayed: Math.max(0, Math.floor(x.gamesPlayed ?? 0)),
  };
}


function isWeakDisplayName(name: string | null | undefined): boolean {
  const t = (name ?? '').trim();
  return !t || t === 'Player';
}

/** Prefer a real custom name over Player/empty; if both custom, prefer `preferred`. */
export function pickMergedDisplayName(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const a = (preferred ?? '').trim();
  const b = (fallback ?? '').trim();
  if (!isWeakDisplayName(a)) return a;
  if (!isWeakDisplayName(b)) return b;
  return a || b || 'Player';
}

/**
 * Newer side wins for avatarId (so intentional gold peg sticks).
 * When both sides share the same id, keep a dataUrl from either side (RTDB may
 * omit large data URLs). When ids differ, use the newer side's dataUrl.
 */
export function pickMergedAvatar(
  preferred: Pick<Profile, 'avatarId' | 'avatarDataUrl'>,
  fallback: Pick<Profile, 'avatarId' | 'avatarDataUrl'>,
): { avatarId: string; avatarDataUrl: string | null } {
  const prefId = (preferred.avatarId ?? '').trim();
  const fallId = (fallback.avatarId ?? '').trim();
  if (!prefId && fallId) {
    return {
      avatarId: fallId,
      avatarDataUrl: fallback.avatarDataUrl ?? null,
    };
  }
  const avatarId = prefId || fallId || BUILTIN_AVATARS[0].id;
  if (prefId && fallId && prefId === fallId) {
    return {
      avatarId,
      avatarDataUrl: preferred.avatarDataUrl || fallback.avatarDataUrl || null,
    };
  }
  return {
    avatarId,
    avatarDataUrl: preferred.avatarDataUrl ?? null,
  };
}

function isDefaultTheme(theme: string | null | undefined): boolean {
  return normalizeFeltId(theme) === DEFAULT_FELT_ID;
}

function isDefaultBoard(board: string | null | undefined): boolean {
  return normalizeBoardId(board) === DEFAULT_BOARD_ID;
}

/** Prefer non-default felt/board from either side; sound follows newer. */
export function pickMergedSettings(
  preferred: Profile['settings'] | undefined,
  fallback: Profile['settings'] | undefined,
  preferredIsNewer: boolean,
): Profile['settings'] {
  const a = preferred ?? defaultSettings();
  const b = fallback ?? defaultSettings();
  const themeA = normalizeFeltId(a.theme);
  const themeB = normalizeFeltId(b.theme);
  const boardA = normalizeBoardId(a.board);
  const boardB = normalizeBoardId(b.board);
  const theme =
    !isDefaultTheme(themeA) && isDefaultTheme(themeB) ? themeA
    : !isDefaultTheme(themeB) && isDefaultTheme(themeA) ? themeB
    : preferredIsNewer ? themeA : themeB;
  const board =
    !isDefaultBoard(boardA) && isDefaultBoard(boardB) ? boardA
    : !isDefaultBoard(boardB) && isDefaultBoard(boardA) ? boardB
    : preferredIsNewer ? boardA : boardB;
  const sound = preferredIsNewer ? a.sound !== false : b.sound !== false;
  return { sound, theme, board };
}

export function isDefaultEquippedRail(raw: unknown): boolean {
  const rail = normalizeEquippedRailEmojiIds(raw);
  if (rail.length !== DEFAULT_RAIL_EMOJI_IDS.length) return false;
  return DEFAULT_RAIL_EMOJI_IDS.every((id, i) => rail[i] === id);
}

/**
 * Equipped rail: prefer non-default customization; if both customized (or both
 * default), prefer newer; when timestamps tie / absent, prefer local.
 */
export function pickMergedEquippedRail(
  localRail: unknown,
  cloudRail: unknown,
  localNewer: boolean,
): ReactEmojiId[] {
  const local = normalizeEquippedRailEmojiIds(localRail);
  const cloud = normalizeEquippedRailEmojiIds(cloudRail);
  const localDef = isDefaultEquippedRail(localRail);
  const cloudDef = isDefaultEquippedRail(cloudRail);
  if (!localDef && cloudDef) return local;
  if (!cloudDef && localDef) return cloud;
  return localNewer ? local : cloud;
}

/** Prefer higher career counts (devices may diverge); newest display/settings win by updatedAt. */
export function mergeProfiles(local: Profile, cloud: Profile): Profile {
  const localNewer = (local.updatedAt ?? 0) >= (cloud.updatedAt ?? 0);
  const base = localNewer ? local : cloud;
  const other = localNewer ? cloud : local;
  const localReset = local.statsResetAt ?? 0;
  const cloudReset = cloud.statsResetAt ?? 0;
  const statsResetAt = Math.max(localReset, cloudReset);
  // After a wipe, the side with the newer statsResetAt wins entirely (zeros stick).
  const mergeRec = (a: CareerRecord, b: CareerRecord): CareerRecord => {
    if (cloudReset > localReset) return clampRec(cloud.record);
    if (localReset > cloudReset) return clampRec(local.record);
    return {
      wins: Math.max(a.wins ?? 0, b.wins ?? 0),
      losses: Math.max(a.losses ?? 0, b.losses ?? 0),
      gamesPlayed: Math.max(a.gamesPlayed ?? 0, b.gamesPlayed ?? 0),
    };
  };
  const mergeOnline = (a: CareerRecord, b: CareerRecord): CareerRecord => {
    if (cloudReset > localReset) return clampRec(cloud.onlineRecord);
    if (localReset > cloudReset) return clampRec(local.onlineRecord);
    return {
      wins: Math.max(a.wins ?? 0, b.wins ?? 0),
      losses: Math.max(a.losses ?? 0, b.losses ?? 0),
      gamesPlayed: Math.max(a.gamesPlayed ?? 0, b.gamesPlayed ?? 0),
    };
  };
  const playerCode = base.playerCode || other.playerCode || undefined;
  const mergeTr = (a?: TournamentRecord, b?: TournamentRecord): TournamentRecord | undefined => {
    if (cloudReset > localReset) {
      return cloud.tournamentRecord
        ? { ...emptyTournamentRecord(), ...cloud.tournamentRecord }
        : emptyTournamentRecord();
    }
    if (localReset > cloudReset) {
      return local.tournamentRecord
        ? { ...emptyTournamentRecord(), ...local.tournamentRecord }
        : emptyTournamentRecord();
    }
    if (!a && !b) return undefined;
    const x = a ?? emptyTournamentRecord();
    const y = b ?? emptyTournamentRecord();
    const best =
      x.bestFinish == null ? y.bestFinish
      : y.bestFinish == null ? x.bestFinish
      : Math.min(x.bestFinish, y.bestFinish);
    const last = (x.lastDate ?? 0) >= (y.lastDate ?? 0) ? x : y;
    return {
      played: Math.max(x.played, y.played),
      wins: Math.max(x.wins, y.wins),
      top4: Math.max(x.top4, y.top4),
      gamePoints: Math.max(x.gamePoints, y.gamePoints),
      skunksGiven: Math.max(x.skunksGiven, y.skunksGiven),
      skunksReceived: Math.max(x.skunksReceived, y.skunksReceived),
      bestFinish: best ?? null,
      lastName: last.lastName,
      lastDate: last.lastDate,
      lastPlace: last.lastPlace ?? null,
      hosted: Math.max(x.hosted, y.hosted),
    };
  };
  const tr = mergeTr(local.tournamentRecord, cloud.tournamentRecord);
  // Coins: never drop a higher paid balance on newer updatedAt / missing field.
  // Prefer Math.max unless ledger evidence (spend/admin_set) justifies a decrease.
  const mergedCoins = mergeCoinStates(local, cloud);
  const coins = mergedCoins.coins;
  const coinLedger = mergedCoins.ledger;
  const unionIds = (a?: string[], b?: string[]): string[] | undefined => {
    const set = new Set<string>();
    for (const x of [...(a ?? []), ...(b ?? [])]) {
      if (typeof x === 'string' && x) set.add(x);
    }
    return set.size ? [...set] : undefined;
  };
  const ownedEmojiIds = unionIds(local.ownedEmojiIds, cloud.ownedEmojiIds);
  const ownedAvatarIds = unionIds(local.ownedAvatarIds, cloud.ownedAvatarIds);
  const ownedFeltIds = unionIds(local.ownedFeltIds, cloud.ownedFeltIds);
  const ownedBoardIds = unionIds(local.ownedBoardIds, cloud.ownedBoardIds);
  const claimedPromos = unionIds(local.claimedPromos, cloud.claimedPromos);

  // Identity / cosmetics: never let "Player"/pure defaults wipe real customizations.
  const displayName = pickMergedDisplayName(base.displayName, other.displayName);
  const { avatarId, avatarDataUrl } = pickMergedAvatar(base, other);
  // `base` is already the newer side — pass true (do not pass localNewer).
  const settings = pickMergedSettings(base.settings, other.settings, true);
  const equippedRailEmojiIds = pickMergedEquippedRail(
    local.equippedRailEmojiIds,
    cloud.equippedRailEmojiIds,
    localNewer,
  );

  const merged: Profile = {
    ...other,
    ...base,
    displayName,
    avatarId,
    avatarDataUrl,
    settings,
    record: mergeRec(clampRec(local.record), clampRec(cloud.record)),
    onlineRecord: mergeOnline(clampRec(local.onlineRecord), clampRec(cloud.onlineRecord)),
    ...(statsResetAt ? { statsResetAt } : {}),
    createdAt: Math.min(local.createdAt ?? Date.now(), cloud.createdAt ?? Date.now()),
    updatedAt: Math.max(local.updatedAt ?? 0, cloud.updatedAt ?? 0),
    ...(playerCode ? { playerCode } : {}),
    ...(tr ? { tournamentRecord: tr } : {}),
    coins,
    coinLedger,
    ...(ownedEmojiIds ? { ownedEmojiIds } : {}),
    ...(ownedAvatarIds ? { ownedAvatarIds } : {}),
    ...(ownedFeltIds ? { ownedFeltIds } : {}),
    ...(ownedBoardIds ? { ownedBoardIds } : {}),
    equippedRailEmojiIds,
    ...(claimedPromos ? { claimedPromos } : {}),
  };
  // Auto-heal sign-in promo wipe (claimed but coins 0, no spends).
  return repairSignInPromoWipe(merged);
}

function isFriendLike(v: unknown): v is Friend {
  if (!v || typeof v !== 'object') return false;
  const f = v as Friend;
  return (
    typeof f.id === 'string' &&
    typeof f.name === 'string' &&
    (f.status === 'offline' || f.status === 'local') &&
    typeof f.addedAt === 'number' &&
    (f.uid === undefined || typeof f.uid === 'string')
  );
}

export function mergeFriends(local: Friend[], cloud: Friend[]): Friend[] {
  const byUid = new Map<string, Friend>();
  // Cloud/mutual friends only — legacy local-only name entries (no uid) are dropped.
  for (const f of [...cloud, ...local]) {
    if (!isFriendLike(f)) continue;
    const uid = typeof f.uid === 'string' ? f.uid.trim() : '';
    if (!uid) continue;
    const prev = byUid.get(uid);
    const next: Friend = {
      ...f,
      id: uid,
      uid,
      status: f.status === 'local' ? 'offline' : f.status,
    };
    if (!prev || (next.addedAt ?? 0) >= (prev.addedAt ?? 0)) {
      byUid.set(uid, next);
    }
  }
  return [...byUid.values()].sort((a, b) => a.addedAt - b.addedAt);
}

function friendsToMap(friends: Friend[]): Record<string, Friend> {
  const out: Record<string, Friend> = {};
  for (const f of friends) {
    out[f.id] = {
      id: f.id,
      name: f.name,
      status: f.status,
      addedAt: f.addedAt,
      ...(f.uid ? { uid: f.uid } : {}),
    };
  }
  return out;
}

function friendsFromSnap(val: unknown): Friend[] {
  if (!val || typeof val !== 'object') return [];
  return Object.values(val as Record<string, unknown>).filter(isFriendLike);
}

function profileFromSnap(val: unknown): Profile | null {
  if (!val || typeof val !== 'object') return null;
  const p = val as Partial<Profile>;
  if (typeof p.displayName !== 'string') return null;
  const base = createDefaultProfile(p.displayName);
  const code =
    typeof p.playerCode === 'string' && isValidPlayerCode(p.playerCode)
      ? normalizePlayerCode(p.playerCode)
      : undefined;
  return {
    ...base,
    displayName: p.displayName.trim() || 'Player',
    avatarId: typeof p.avatarId === 'string' ? p.avatarId : base.avatarId,
    avatarDataUrl:
      p.avatarDataUrl === null || typeof p.avatarDataUrl === 'string'
        ? p.avatarDataUrl
        : null,
    record: clampRec(p.record as CareerRecord | undefined),
    onlineRecord: clampRec(p.onlineRecord as CareerRecord | undefined),
    settings: {
      sound: typeof p.settings?.sound === 'boolean' ? p.settings.sound : true,
      theme: normalizeFeltId(typeof p.settings?.theme === 'string' ? p.settings.theme : 'felt'),
      board: normalizeBoardId(
        typeof p.settings?.board === 'string' ? p.settings.board : 'default',
      ),
    },
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : base.createdAt,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : base.updatedAt,
    ...(code ? { playerCode: code } : {}),
    ...(p.tournamentRecord && typeof p.tournamentRecord === 'object'
      ? { tournamentRecord: { ...emptyTournamentRecord(), ...(p.tournamentRecord as TournamentRecord) } }
      : {}),
    coins: normalizeCoins(p.coins ?? 0),
    coinLedger: normalizeLedger(p.coinLedger),
    ...(Array.isArray(p.ownedEmojiIds)
      ? { ownedEmojiIds: p.ownedEmojiIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(Array.isArray(p.ownedAvatarIds)
      ? { ownedAvatarIds: p.ownedAvatarIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(Array.isArray(p.ownedFeltIds)
      ? { ownedFeltIds: p.ownedFeltIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(Array.isArray(p.ownedBoardIds)
      ? { ownedBoardIds: p.ownedBoardIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    equippedRailEmojiIds: normalizeEquippedRailEmojiIds(p.equippedRailEmojiIds),
    ...(normalizeClaimedPromos(p.claimedPromos)
      ? { claimedPromos: normalizeClaimedPromos(p.claimedPromos) }
      : {}),
    ...(typeof p.statsResetAt === 'number' && Number.isFinite(p.statsResetAt)
      ? { statsResetAt: Math.floor(p.statsResetAt) }
      : {}),
  };
}

export type CloudProfileFetch =
  | { status: 'ok'; profile: Profile | null }
  | { status: 'error'; error: unknown };

/**
 * Distinguish missing profile vs RTDB read failure.
 * Callers MUST NOT push local over cloud when status === 'error'.
 */
export async function fetchCloudProfileStatus(uid: string): Promise<CloudProfileFetch> {
  if (!isFirebaseConfigured() || !uid) return { status: 'ok', profile: null };
  try {
    const snap = await get(ref(getFirebaseDb(), userProfilePath(uid)));
    return { status: 'ok', profile: profileFromSnap(snap.val()) };
  } catch (e) {
    console.warn('fetchCloudProfile failed', e);
    return { status: 'error', error: e };
  }
}

export async function fetchCloudProfile(uid: string): Promise<Profile | null> {
  const result = await fetchCloudProfileStatus(uid);
  return result.status === 'ok' ? result.profile : null;
}

/** True when profile looks like an empty default shell (not intentional progress). */
export function isProfileShell(p: Profile): boolean {
  const defSettings =
    isDefaultTheme(p.settings?.theme) && isDefaultBoard(p.settings?.board);
  const defRail = isDefaultEquippedRail(p.equippedRailEmojiIds);
  const noOwned =
    !(p.ownedEmojiIds && p.ownedEmojiIds.length) &&
    !(p.ownedAvatarIds && p.ownedAvatarIds.length) &&
    !(p.ownedFeltIds && p.ownedFeltIds.length) &&
    !(p.ownedBoardIds && p.ownedBoardIds.length);
  const noProgress =
    (p.record?.gamesPlayed ?? 0) === 0 &&
    (p.onlineRecord?.gamesPlayed ?? 0) === 0 &&
    !(p.tournamentRecord && (p.tournamentRecord.played ?? 0) > 0);
  const noCoins = (p.coins ?? 0) === 0;
  return defSettings && defRail && noOwned && noProgress && noCoins;
}

/**
 * Guest / Dummy / empty local cache must not beat this account's cloud on hydrate.
 * Demote by setting updatedAt=0 so mergeProfiles prefers cloud identity/presets.
 */
export function shouldDemoteLocalCache(local: Profile, cloud: Profile): boolean {
  const localCode = (local.playerCode ?? '').trim();
  const cloudCode = (cloud.playerCode ?? '').trim();
  if (cloudCode && localCode && localCode !== cloudCode) return true;
  if (cloudCode && !localCode) return true;
  if (isProfileShell(local) && !isProfileShell(cloud)) return true;
  if (isWeakDisplayName(local.displayName) && !isWeakDisplayName(cloud.displayName)) {
    return true;
  }
  return false;
}

/** Lightweight read of users/{uid}/profile/avatarId (for Live thumbs without full profile). */
export async function fetchCloudAvatarId(uid: string): Promise<string | null> {
  if (!isFirebaseConfigured() || !uid) return null;
  try {
    const snap = await get(ref(getFirebaseDb(), `${userProfilePath(uid)}/avatarId`));
    const v = snap.val();
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch (e) {
    console.warn('fetchCloudAvatarId failed', e);
    return null;
  }
}

/** Firebase RTDB `set` rejects `undefined` (and NaN) anywhere in the tree. */
function sanitizeForRtdb(value: unknown): unknown {
  if (value === undefined) return undefined; // caller drops key
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForRtdb(v)).filter((v) => v !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const next = sanitizeForRtdb(v);
    if (next === undefined) continue;
    out[k] = next;
  }
  return out;
}

function tournamentRecordPayload(tr: TournamentRecord): Record<string, unknown> {
  const base = { ...emptyTournamentRecord(), ...tr };
  const out: Record<string, unknown> = {
    played: Math.max(0, Math.floor(base.played ?? 0)),
    wins: Math.max(0, Math.floor(base.wins ?? 0)),
    top4: Math.max(0, Math.floor(base.top4 ?? 0)),
    gamePoints: Math.max(0, Math.floor(base.gamePoints ?? 0)),
    skunksGiven: Math.max(0, Math.floor(base.skunksGiven ?? 0)),
    skunksReceived: Math.max(0, Math.floor(base.skunksReceived ?? 0)),
    bestFinish: base.bestFinish == null ? null : Math.floor(base.bestFinish),
    hosted: Math.max(0, Math.floor(base.hosted ?? 0)),
  };
  if (typeof base.lastName === 'string' && base.lastName.trim()) {
    out.lastName = base.lastName.trim().slice(0, 48);
  }
  if (typeof base.lastDate === 'number' && Number.isFinite(base.lastDate)) {
    out.lastDate = Math.floor(base.lastDate);
  }
  if (base.lastPlace != null && Number.isFinite(base.lastPlace)) {
    out.lastPlace = Math.floor(base.lastPlace);
  }
  return out;
}

async function refreshAuthForRtdbWrite(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    await user.getIdToken(true);
  } catch (e) {
    console.warn('refreshAuthForRtdbWrite failed', e);
  }
}

function formatCloudSyncError(e: unknown): string {
  const any = e as { code?: string; message?: string } | null;
  const code = typeof any?.code === 'string' ? any.code : '';
  const msg = e instanceof Error ? e.message : String(e ?? 'unknown error');
  if (/permission_denied|PERMISSION_DENIED/i.test(code + msg)) {
    return 'Could not sync — signed out or account permission denied. Sign in again, then Save.';
  }
  if (/network|offline|unavailable|Failed to fetch/i.test(code + msg)) {
    return 'Could not sync — check your connection and try Save again.';
  }
  // Keep short; include code when present for support.
  const short = code ? `${code}: ${msg}` : msg;
  return `Saved on this device, but could not sync (${short.slice(0, 160)}).`;
}

function unionOwnedIds(incoming?: string[], stored?: string[]): string[] | undefined {
  const set = new Set<string>();
  for (const x of [...(stored ?? []), ...(incoming ?? [])]) {
    if (typeof x === 'string' && x) set.add(x);
  }
  return set.size ? [...set] : undefined;
}

/** Build RTDB profile payload; never drops local unlocks when the in-memory draft omitted them. */
export function cloudProfilePayload(profile: Profile) {
  // Prefer in-memory ids; union with localStorage so a stale draft cannot omit unlocks on set().
  const stored = loadProfile();
  const ownedEmojiIds = unionOwnedIds(
    Array.isArray(profile.ownedEmojiIds) ? profile.ownedEmojiIds : undefined,
    stored?.ownedEmojiIds,
  );
  const ownedAvatarIds = unionOwnedIds(
    Array.isArray(profile.ownedAvatarIds) ? profile.ownedAvatarIds : undefined,
    stored?.ownedAvatarIds,
  );
  const ownedFeltIds = unionOwnedIds(
    Array.isArray(profile.ownedFeltIds) ? profile.ownedFeltIds : undefined,
    stored?.ownedFeltIds,
  );
  const ownedBoardIds = unionOwnedIds(
    Array.isArray(profile.ownedBoardIds) ? profile.ownedBoardIds : undefined,
    stored?.ownedBoardIds,
  );
  const raw = {
    displayName: profile.displayName,
    avatarId: profile.avatarId,
    // Skip huge data URLs in RTDB free tier — keep local only if very large
    avatarDataUrl:
      profile.avatarDataUrl && profile.avatarDataUrl.length < 80_000
        ? profile.avatarDataUrl
        : null,
    ...(profile.playerCode ? { playerCode: profile.playerCode } : {}),
    record: clampRec(profile.record),
    onlineRecord: clampRec(profile.onlineRecord),
    ...(profile.tournamentRecord
      ? { tournamentRecord: tournamentRecordPayload(profile.tournamentRecord) }
      : {}),
    ...(typeof profile.statsResetAt === 'number' && Number.isFinite(profile.statsResetAt)
      ? { statsResetAt: Math.floor(profile.statsResetAt) }
      : {}),
    coins: normalizeCoins(profile.coins ?? 0),
    coinLedger: normalizeLedger(profile.coinLedger),
    ...(ownedEmojiIds ? { ownedEmojiIds } : {}),
    ...(ownedAvatarIds ? { ownedAvatarIds } : {}),
    ...(ownedFeltIds ? { ownedFeltIds } : {}),
    ...(ownedBoardIds ? { ownedBoardIds } : {}),
    equippedRailEmojiIds: normalizeEquippedRailEmojiIds(profile.equippedRailEmojiIds),
    ...(Array.isArray(profile.claimedPromos) && profile.claimedPromos.length
      ? { claimedPromos: profile.claimedPromos }
      : {}),
    settings: {
      sound: (profile.settings ?? { sound: true, theme: 'felt', board: 'default' }).sound !== false,
      theme: normalizeFeltId((profile.settings ?? { sound: true, theme: 'felt', board: 'default' }).theme),
      board: normalizeBoardId((profile.settings ?? { sound: true, theme: 'felt', board: 'default' }).board),
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
  return sanitizeForRtdb(raw) as Record<string, unknown>;
}

export interface PlayerLookup {
  uid: string;
  displayName: string;
}

type IndexPayload = { uid: string; displayName: string };

function indexFromSnap(val: unknown): PlayerLookup | null {
  // Legacy: value was just a uid string
  if (typeof val === 'string' && val) {
    return { uid: val, displayName: 'Player' };
  }
  if (!val || typeof val !== 'object') return null;
  const o = val as Record<string, unknown>;
  if (typeof o.uid !== 'string' || !o.uid) return null;
  const displayName =
    typeof o.displayName === 'string' && o.displayName.trim()
      ? o.displayName.trim()
      : 'Player';
  return { uid: o.uid, displayName };
}

/**
 * Claim playerCodes/{code} for this uid (transaction). Returns true if we own it.
 */
async function claimPlayerCodeIndex(
  code: string,
  uid: string,
  displayName: string,
): Promise<boolean> {
  const db = getFirebaseDb();
  const r = ref(db, playerCodePath(code));
  const payload: IndexPayload = { uid, displayName: displayName.trim() || 'Player' };
  try {
    const result = await runTransaction(r, (current) => {
      if (current === null || current === undefined) {
        return payload;
      }
      if (typeof current === 'string') {
        return current === uid ? payload : undefined;
      }
      if (typeof current === 'object' && current && (current as IndexPayload).uid === uid) {
        return payload;
      }
      return; // collision — abort
    });
    return result.committed;
  } catch (e) {
    console.warn('claimPlayerCodeIndex failed', e);
    return false;
  }
}

/**
 * Ensure profile has a unique playerCode and playerCodes/{code} index entry.
 * Retries on collision. Returns profile (possibly with new code).
 */
export async function ensurePlayerCode(
  uid: string,
  profile: Profile,
): Promise<Profile> {
  if (!isFirebaseConfigured() || !uid) return profile;
  const displayName = profile.displayName.trim() || 'Player';

  const tryCodes: string[] = [];
  if (profile.playerCode && isValidPlayerCode(profile.playerCode)) {
    tryCodes.push(normalizePlayerCode(profile.playerCode));
  }
  for (let i = 0; i < 8; i++) {
    tryCodes.push(generatePlayerCode());
  }

  for (const code of tryCodes) {
    const ok = await claimPlayerCodeIndex(code, uid, displayName);
    if (ok) {
      if (profile.playerCode === code) return profile;
      return { ...profile, playerCode: code };
    }
  }
  console.warn('ensurePlayerCode: could not claim a unique code');
  return profile;
}

/** Write / refresh emailIndex/{key} → { uid, displayName }. */
export async function ensureEmailIndex(
  uid: string,
  email: string | null | undefined,
  displayName: string,
): Promise<void> {
  if (!isFirebaseConfigured() || !uid || !email?.trim()) return;
  const keyPath = emailIndexPath(email);
  const payload: IndexPayload = {
    uid,
    displayName: displayName.trim() || 'Player',
  };
  try {
    const r = ref(getFirebaseDb(), keyPath);
    const snap = await get(r);
    const existing = indexFromSnap(snap.val());
    if (existing && existing.uid !== uid) {
      // Another account already owns this email key — do not overwrite.
      console.warn('ensureEmailIndex: email already claimed by another uid');
      return;
    }
    await set(r, payload);
  } catch (e) {
    console.warn('ensureEmailIndex failed', e);
  }
}

/** Soft write — used by hydrate / background sync (never throws). */
export async function pushCloudProfile(uid: string, profile: Profile): Promise<void> {
  if (!isFirebaseConfigured() || !uid) return;
  // Repair before push so stale clients cannot keep rewriting wiped 0 SC.
  const toPush = repairSignInPromoWipe(profile);
  try {
    await set(ref(getFirebaseDb(), userProfilePath(uid)), cloudProfilePayload(toPush));
    if (toPush.playerCode) {
      await claimPlayerCodeIndex(toPush.playerCode, uid, toPush.displayName);
    }
  } catch (e) {
    console.warn('pushCloudProfile failed', e);
  }
}

/** Strict write — throws so Settings / claim can surface sync errors. */
export async function writeCloudProfile(uid: string, profile: Profile): Promise<void> {
  if (!isFirebaseConfigured() || !uid) {
    throw new Error('Cloud sync is not available.');
  }
  const authUid = getFirebaseAuth().currentUser?.uid;
  if (!authUid) {
    throw new Error('PERMISSION_DENIED: not signed in');
  }
  if (authUid !== uid) {
    throw new Error('PERMISSION_DENIED: account mismatch — sign in again');
  }
  const toWrite = repairSignInPromoWipe(profile);
  const payload = cloudProfilePayload(toWrite);
  const path = userProfilePath(uid);
  const doSet = async () => {
    await refreshAuthForRtdbWrite();
    await set(ref(getFirebaseDb(), path), payload);
  };
  try {
    await doSet();
  } catch (e) {
    const blob = `${(e as { code?: string })?.code || ''} ${e instanceof Error ? e.message : e}`;
    if (/permission_denied|PERMISSION_DENIED|unauthenticated/i.test(blob)) {
      // One retry after forced token refresh (Safari / backgrounded tabs).
      await doSet();
    } else {
      throw e;
    }
  }
  if (toWrite.playerCode) {
    const ok = await claimPlayerCodeIndex(toWrite.playerCode, uid, toWrite.displayName);
    if (!ok) {
      // Code collision on save — try to mint a new one (never fail the profile write).
      try {
        const withCode = await ensurePlayerCode(uid, { ...toWrite, playerCode: undefined });
        if (withCode.playerCode && withCode.playerCode !== toWrite.playerCode) {
          await set(ref(getFirebaseDb(), path), cloudProfilePayload(withCode));
        }
      } catch (e) {
        console.warn('writeCloudProfile: playerCode remint failed', e);
      }
    }
  }
}

export async function fetchCloudFriends(uid: string): Promise<Friend[]> {
  if (!isFirebaseConfigured() || !uid) return [];
  try {
    const snap = await get(ref(getFirebaseDb(), userFriendsPath(uid)));
    return friendsFromSnap(snap.val());
  } catch (e) {
    console.warn('fetchCloudFriends failed', e);
    return [];
  }
}

/** Soft write — used by hydrate / background sync (never throws). */
export async function pushCloudFriends(uid: string, friends: Friend[]): Promise<void> {
  if (!isFirebaseConfigured() || !uid) return;
  try {
    await set(
      ref(getFirebaseDb(), userFriendsPath(uid)),
      friendsToMap(cloudFriendsOnly(friends)),
    );
  } catch (e) {
    console.warn('pushCloudFriends failed', e);
  }
}

async function writeCloudFriends(uid: string, friends: Friend[]): Promise<void> {
  if (!isFirebaseConfigured() || !uid) {
    throw new Error('Cloud sync is not available.');
  }
  await set(ref(getFirebaseDb(), userFriendsPath(uid)), friendsToMap(friends));
}

export async function lookupByPlayerCode(code: string): Promise<PlayerLookup | null> {
  if (!isFirebaseConfigured()) return null;
  const normalized = normalizePlayerCode(code);
  if (!isValidPlayerCode(normalized)) return null;
  try {
    const snap = await get(ref(getFirebaseDb(), playerCodePath(normalized)));
    return indexFromSnap(snap.val());
  } catch (e) {
    console.warn('lookupByPlayerCode failed', e);
    return null;
  }
}

export async function lookupByEmail(email: string): Promise<PlayerLookup | null> {
  if (!isFirebaseConfigured()) return null;
  const normalized = normalizeEmail(email);
  if (!normalized.includes('@')) return null;
  try {
    const snap = await get(ref(getFirebaseDb(), emailIndexPath(normalized)));
    return indexFromSnap(snap.val());
  } catch (e) {
    console.warn('lookupByEmail failed', e);
    return null;
  }
}

/** Resolve “player code or email” input to a cloud player. */
export async function resolveFriendQuery(raw: string): Promise<PlayerLookup | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (looksLikeEmail(trimmed)) {
    return lookupByEmail(trimmed);
  }
  return lookupByPlayerCode(trimmed);
}

/**
 * On sign-in: merge local + cloud profile/friends, assign player code + email index.
 * Seeds Google displayName into empty/default local names.
 */
export async function hydrateAccountFromCloud(
  uid: string,
  googleDisplayName: string | null,
  googleEmail: string | null = null,
  providerId: string | null = null,
): Promise<{ profile: Profile; friends: Friend[]; googlePromoGranted?: boolean }> {
  // Prefer per-uid local mirror so Dummy/guest cache cannot masquerade as Owner.
  const existingLocal = loadProfile(uid);
  // Fresh device / empty shell: createDefaultProfile uses Date.now() updatedAt which
  // would beat cloud and wipe Master Yoda / presets — pin updatedAt to 0 so cloud wins.
  let seed = existingLocal ?? {
    ...createDefaultProfile(googleDisplayName ?? 'Player'),
    updatedAt: 0,
  };
  if (!existingLocal || isProfileShell(seed)) {
    seed = { ...seed, updatedAt: 0 };
  }
  if (
    googleDisplayName &&
    (seed.displayName === 'Player' || !seed.displayName.trim())
  ) {
    seed = { ...seed, displayName: googleDisplayName.trim().slice(0, 24) };
  }

  const [cloudResult, cloudFriends] = await Promise.all([
    fetchCloudProfileStatus(uid),
    fetchCloudFriends(uid),
  ]);

  // CRITICAL: never push local over cloud when the RTDB read failed (would wipe Master Yoda).
  if (cloudResult.status === 'error') {
    console.warn(
      'hydrateAccountFromCloud: cloud read failed — using local cache only, skip push',
      cloudResult.error,
    );
    const owner = isOwner({
      uid,
      email: googleEmail,
      displayName: googleDisplayName ?? seed.displayName,
    });
    const withYoda = migrateMasterYodaSelection(seed, { owner });
    const withMadFinger = {
      ...withYoda,
      ownedEmojiIds: effectiveOwnedEmojiIds(uid, googleEmail, withYoda.ownedEmojiIds),
    };
    const savedProfile = saveProfile(withMadFinger, uid);
    const localFriends = cloudFriendsOnly(loadFriends());
    return { profile: savedProfile, friends: localFriends, googlePromoGranted: false };
  }

  const cloudProfile = cloudResult.profile;
  if (cloudProfile && shouldDemoteLocalCache(seed, cloudProfile)) {
    seed = { ...seed, updatedAt: 0 };
  }

  const mergedProfile = cloudProfile ? mergeProfiles(seed, cloudProfile) : seed;
  // Seed Google name only when still on the weak default — never overwrite Master Yoda.
  const withGoogleName =
    googleDisplayName &&
    isWeakDisplayName(mergedProfile.displayName) &&
    (!cloudProfile || isWeakDisplayName(cloudProfile.displayName))
      ? { ...mergedProfile, displayName: googleDisplayName.trim().slice(0, 24) }
      : mergedProfile;

  const withCode = await ensurePlayerCode(uid, withGoogleName);
  const owner = isOwner({
    uid,
    email: googleEmail,
    displayName: googleDisplayName ?? withCode.displayName,
  });
  const withYoda = migrateMasterYodaSelection(withCode, { owner });
  // Auto-union specials: mad_finger + trash_toss + ace_spade + grandma_peggy + mad_father (Dummy|Owner) into ownedEmojiIds.
  const withMadFinger = {
    ...withYoda,
    ownedEmojiIds: effectiveOwnedEmojiIds(uid, googleEmail, withYoda.ownedEmojiIds),
  };
  const savedProfile = saveProfile(withMadFinger, uid);
  await pushCloudProfile(uid, savedProfile);
  await ensureEmailIndex(uid, googleEmail, savedProfile.displayName);

  const localFriends = loadFriends();
  const mergedFriends = cloudFriendsOnly(mergeFriends(localFriends, cloudFriends));
  saveFriends(mergedFriends);
  await pushCloudFriends(uid, mergedFriends);

  // Apply any accept receipts that arrived while offline
  const afterAccepts = cloudFriendsOnly(await drainFriendAccepts(uid));
  saveFriends(afterAccepts);
  await pushCloudFriends(uid, afterAccepts);

  // Apply Doctor SC gifts waiting in coinInbox/{uid}
  let afterCoins = await drainCoinInbox(uid, savedProfile);
  if (afterCoins !== savedProfile) {
    afterCoins = saveProfile(afterCoins, uid);
    await pushCloudProfile(uid, afterCoins);
  }

  // One-time sign-in promo (200 SC) — Google or email/password
  const beforePromo = afterCoins;
  const withPromo = applySignInPromoIfEligible(afterCoins, providerId);
  // Auto-heal claimed-but-wiped promo (even when already claimed / ineligible provider).
  const afterRepair = repairSignInPromoWipe(withPromo);
  let googlePromoGranted = false;
  if (withPromo !== beforePromo || afterRepair !== withPromo) {
    afterCoins = saveProfile(afterRepair, uid);
    await pushCloudProfile(uid, afterCoins);
    googlePromoGranted = withPromo !== beforePromo && hasClaimedSignInPromo(afterCoins);
  } else {
    afterCoins = withPromo;
  }

  return { profile: afterCoins, friends: afterAccepts, googlePromoGranted };
}

export interface AccountSaveResult<T> {
  value: T;
  /** True when signed in and RTDB write succeeded. */
  synced: boolean;
  /** User-facing sync failure (local write still applied). */
  syncError: string | null;
}

/** Persist profile locally and to RTDB when signed in. */
export async function saveProfileForAccount(
  profile: Profile,
  uid: string | null,
): Promise<Profile> {
  const { value } = await saveProfileForAccountDetailed(profile, uid);
  return value;
}

/** Local + optional cloud; always returns saved profile and sync outcome. */
export async function saveProfileForAccountDetailed(
  profile: Profile,
  uid: string | null,
  email: string | null = null,
): Promise<AccountSaveResult<Profile>> {
  // Repair wiped sign-in promo before local+cloud persist.
  let toSave = repairSignInPromoWipe(profile);
  if (uid && isFirebaseConfigured()) {
    toSave = await ensurePlayerCode(uid, toSave);
  }
  const saved = saveProfile(toSave, uid);
  if (!uid) {
    return { value: saved, synced: false, syncError: null };
  }
  try {
    await writeCloudProfile(uid, saved);
    if (email) {
      await ensureEmailIndex(uid, email, saved.displayName);
    }
    return { value: saved, synced: true, syncError: null };
  } catch (e) {
    console.warn('saveProfileForAccount cloud failed', e);
    return {
      value: saved,
      synced: false,
      syncError: formatCloudSyncError(e),
    };
  }
}

/** Persist friends locally and to RTDB when signed in. */
export async function saveFriendsForAccount(
  friends: Friend[],
  uid: string | null,
): Promise<Friend[]> {
  const { value } = await saveFriendsForAccountDetailed(friends, uid);
  return value;
}

export async function saveFriendsForAccountDetailed(
  friends: Friend[],
  uid: string | null,
): Promise<AccountSaveResult<Friend[]>> {
  // Signed-in accounts never persist legacy local-only (no uid) entries.
  const toSave = uid ? cloudFriendsOnly(friends) : friends;
  const saved = saveFriends(toSave);
  if (!uid) {
    return { value: saved, synced: false, syncError: null };
  }
  try {
    await writeCloudFriends(uid, saved);
    return { value: saved, synced: true, syncError: null };
  } catch (e) {
    console.warn('saveFriendsForAccount cloud failed', e);
    return {
      value: saved,
      synced: false,
      syncError:
        'Saved on this device, but could not sync friends. Check connection or RTDB rules.',
    };
  }
}

/** Patch only career records on cloud (after a finished match). */
export async function pushCloudRecords(uid: string, profile: Profile): Promise<void> {
  if (!isFirebaseConfigured() || !uid) return;
  try {
    await update(ref(getFirebaseDb(), userProfilePath(uid)), {
      record: clampRec(profile.record),
      onlineRecord: clampRec(profile.onlineRecord),
      updatedAt: profile.updatedAt,
    });
  } catch (e) {
    console.warn('pushCloudRecords failed', e);
  }
}

/** Unused helper kept for potential cleanup of abandoned codes — soft. */
export async function releasePlayerCode(code: string, uid: string): Promise<void> {
  if (!isFirebaseConfigured() || !code || !uid) return;
  try {
    const r = ref(getFirebaseDb(), playerCodePath(code));
    const snap = await get(r);
    const cur = indexFromSnap(snap.val());
    if (cur?.uid === uid) {
      await remove(r);
    }
  } catch (e) {
    console.warn('releasePlayerCode failed', e);
  }
}
