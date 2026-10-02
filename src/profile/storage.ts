import { BUILTIN_AVATARS, isKnownBuiltinAvatarId } from './avatars';
import { normalizeFeltId } from './felts';
import { normalizeBoardId } from './boards';
import { normalizeEquippedRailEmojiIds } from '../ui/emoji/reactEmojis';
import { normalizeCoins, normalizeLedger, type CoinLedgerEntry } from './coins';

export type { CoinLedgerEntry, CoinReason } from './coins';

export const PROFILE_STORAGE_KEY = 'supercrib.profile.v1';
export const FRIENDS_STORAGE_KEY = 'supercrib.friends.v1';
export const ONLINE_RECORDED_ROOMS_KEY = 'supercrib.onlineRecordedRooms.v1';
/** Last signed-in Firebase uid whose profile was mirrored to legacy PROFILE_STORAGE_KEY. */
export const PROFILE_ACTIVE_UID_KEY = 'supercrib.profile.activeUid.v1';

/** Per-account local mirror (cloud remains source of truth when signed in). */
export function profileStorageKeyForUid(uid: string): string {
  return `supercrib.profile.v1.uid.${uid.trim()}`;
}

export interface CareerRecord {
  wins: number;
  losses: number;
  gamesPlayed: number;
}

/** Club Night / tournament career stats (cloud + local). */
export interface TournamentRecord {
  played: number;
  wins: number;
  top4: number;
  gamePoints: number;
  skunksGiven: number;
  skunksReceived: number;
  bestFinish: number | null;
  lastName?: string;
  lastDate?: number;
  lastPlace?: number | null;
  hosted: number;
}

export interface ProfileSettings {
  sound: boolean;
  /**
   * Equipped table felt id (see profile/felts.ts).
   * Legacy: 'felt' = Classic green; 'classic' reserved; 'zero_forge' = Zero Forge ice/forge felt.
   */
  theme: string;
  /**
   * Equipped pegboard skin id (see profile/boards.ts).
   * Default: 'default' maple plank; 'zero_forge' = Zero Forge metal/ice.
   */
  board: string;
}

export interface Profile {
  displayName: string;
  /** Built-in avatar id from BUILTIN_AVATARS. */
  avatarId: string;
  /** Optional uploaded image as data URL; takes precedence over avatarId when set. */
  avatarDataUrl: string | null;
  /**
   * Short unique shareable code (signed-in users). Assigned on first cloud hydrate.
   * Guests do not get a code.
   */
  playerCode?: string;
  /** Career vs AI (seat 0 human). */
  record: CareerRecord;
  /** Career online (this device's seat vs remote opponent). */
  onlineRecord: CareerRecord;
  /** Club Night tournament career (optional until first event). */
  tournamentRecord?: TournamentRecord;
  /** Epoch ms of last global career wipe; higher wins over Math.max merge. */
  statsResetAt?: number;
  /**
   * Super Coins balance (owner-only test feature). Non-negative integer.
   * Synced on users/{uid}/profile when present.
   */
  coins?: number;
  /** Append-only coin history (capped); never mutate coins without a row. */
  coinLedger?: CoinLedgerEntry[];
  /** Dummy shop unlocks (emoji pack ids). */
  ownedEmojiIds?: string[];
  /** Dummy shop unlocks (avatar cosmetic ids). */
  ownedAvatarIds?: string[];
  /** Owned table felt ids (free 'felt' always available). */
  ownedFeltIds?: string[];
  /** Owned pegboard skin ids (free 'default' always available). */
  ownedBoardIds?: string[];
  /**
   * In-game reaction dock loadout — exactly 8 reaction ids (0–3 left, 4–7 right).
   * Missing/invalid entries migrate to DEFAULT_RAIL_EMOJI_IDS on save/load.
   */
  equippedRailEmojiIds?: string[];
  /** One-time promo ids already claimed (e.g. google_signin_200). */
  claimedPromos?: string[];
  settings: ProfileSettings;
  createdAt: number;
  updatedAt: number;
}

export type FriendStatus = 'offline' | 'local';

export interface Friend {
  id: string;
  name: string;
  status: FriendStatus;
  addedAt: number;
  /** Firebase uid when added by player code / email (signed-in). */
  uid?: string;
}

export function emptyRecord(): CareerRecord {
  return { wins: 0, losses: 0, gamesPlayed: 0 };
}

export function emptyTournamentRecord(): TournamentRecord {
  return {
    played: 0,
    wins: 0,
    top4: 0,
    gamePoints: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    bestFinish: null,
    hosted: 0,
  };
}

export function defaultSettings(): ProfileSettings {
  return { sound: true, theme: 'felt', board: 'default' };
}

export function createDefaultProfile(displayName = ''): Profile {
  const now = Date.now();
  return {
    displayName: displayName.trim() || 'Player',
    avatarId: BUILTIN_AVATARS[0].id,
    avatarDataUrl: null,
    record: emptyRecord(),
    onlineRecord: emptyRecord(),
    coins: 0,
    coinLedger: [],
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
}

function isRecord(v: unknown): v is CareerRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as CareerRecord;
  return (
    typeof r.wins === 'number' &&
    typeof r.losses === 'number' &&
    typeof r.gamesPlayed === 'number'
  );
}

function isProfile(v: unknown): v is Profile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Profile;
  return (
    typeof p.displayName === 'string' &&
    typeof p.avatarId === 'string' &&
    (p.avatarDataUrl === null || typeof p.avatarDataUrl === 'string') &&
    isRecord(p.record) &&
    (p.onlineRecord === undefined || isRecord(p.onlineRecord)) &&
    !!p.settings &&
    typeof p.settings.sound === 'boolean' &&
    typeof p.settings.theme === 'string' && p.settings.theme.length > 0 &&
    typeof p.createdAt === 'number' &&
    typeof p.updatedAt === 'number'
  );
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function normalizeLoadedProfile(parsed: Profile): Profile {
  // Ensure avatarId is known (builtins + legacy master_yoda); fall back if removed.
  // Shop / prize ids are also kept when present (owned unlocks); only wipe truly unknown.
  if (
    !isKnownBuiltinAvatarId(parsed.avatarId) &&
    !parsed.avatarDataUrl &&
    !(Array.isArray(parsed.ownedAvatarIds) && parsed.ownedAvatarIds.includes(parsed.avatarId))
  ) {
    parsed.avatarId = BUILTIN_AVATARS[0].id;
  }
  if (!isRecord(parsed.onlineRecord)) {
    parsed.onlineRecord = emptyRecord();
  }
  parsed.equippedRailEmojiIds = normalizeEquippedRailEmojiIds(parsed.equippedRailEmojiIds);
  const settings = parsed.settings ?? defaultSettings();
  parsed.settings = {
    ...settings,
    theme: normalizeFeltId(settings.theme),
    board: normalizeBoardId(
      typeof (settings as { board?: string }).board === 'string'
        ? (settings as { board?: string }).board
        : 'default',
    ),
  };
  return parsed;
}

function readProfileRaw(raw: string | null): Profile | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isProfile(parsed)) return null;
    return normalizeLoadedProfile(parsed);
  } catch {
    return null;
  }
}

/**
 * Load profile from localStorage, or null if missing/corrupt.
 * When `accountUid` is set, prefer the per-uid mirror (avoids Dummy/guest wiping Owner).
 * Falls back to legacy `supercrib.profile.v1` for migration only.
 */
export function loadProfile(accountUid?: string | null): Profile | null {
  const store = getStorage();
  if (!store) return null;
  const uid = typeof accountUid === 'string' ? accountUid.trim() : '';
  if (uid) {
    const scoped = readProfileRaw(store.getItem(profileStorageKeyForUid(uid)));
    if (scoped) return scoped;
  }
  return readProfileRaw(store.getItem(PROFILE_STORAGE_KEY));
}

/** Persist profile; returns the saved copy with updatedAt refreshed. */
export function saveProfile(profile: Profile, accountUid?: string | null): Profile {
  const rec = profile.record ?? emptyRecord();
  const online = profile.onlineRecord ?? emptyRecord();
  const settings = profile.settings ?? defaultSettings();
  const clampRec = (r: CareerRecord): CareerRecord => ({
    wins: Math.max(0, Math.floor(r.wins ?? 0)),
    losses: Math.max(0, Math.floor(r.losses ?? 0)),
    gamesPlayed: Math.max(0, Math.floor(r.gamesPlayed ?? 0)),
  });
  const code =
    typeof profile.playerCode === 'string' && profile.playerCode.trim()
      ? profile.playerCode.trim().toUpperCase()
      : undefined;
  const tr = profile.tournamentRecord;
  // Always persist coins + ledger so settings/avatar saves cannot strip balances.
  // If caller omitted coins, preserve any existing local balance rather than writing 0.
  // Always load prior profile so unlocks (ownedAvatarIds / ownedEmojiIds) can be unioned —
  // a stale Settings draft must not wipe gift/store unlocks.
  const uid = typeof accountUid === 'string' ? accountUid.trim() : '';
  const prevStored = loadProfile(uid || null);
  const coins =
    typeof profile.coins === 'number' && Number.isFinite(profile.coins)
      ? normalizeCoins(profile.coins)
      : normalizeCoins(prevStored?.coins ?? 0);
  const coinLedger = Array.isArray(profile.coinLedger)
    ? normalizeLedger(profile.coinLedger)
    : normalizeLedger(prevStored?.coinLedger);
  const unionIdList = (incoming?: string[], stored?: string[]): string[] | undefined => {
    const set = new Set<string>();
    for (const x of [...(stored ?? []), ...(incoming ?? [])]) {
      if (typeof x === 'string' && x) set.add(x);
    }
    return set.size ? [...set] : undefined;
  };
  const ownedEmojiIds = unionIdList(
    Array.isArray(profile.ownedEmojiIds) ? profile.ownedEmojiIds : undefined,
    prevStored?.ownedEmojiIds,
  );
  const ownedAvatarIds = unionIdList(
    Array.isArray(profile.ownedAvatarIds) ? profile.ownedAvatarIds : undefined,
    prevStored?.ownedAvatarIds,
  );
  const ownedFeltIds = unionIdList(
    Array.isArray(profile.ownedFeltIds) ? profile.ownedFeltIds : undefined,
    prevStored?.ownedFeltIds,
  );
  const ownedBoardIds = unionIdList(
    Array.isArray(profile.ownedBoardIds) ? profile.ownedBoardIds : undefined,
    prevStored?.ownedBoardIds,
  );
  const equippedRailEmojiIds = normalizeEquippedRailEmojiIds(profile.equippedRailEmojiIds);
  const claimedPromos = Array.isArray(profile.claimedPromos)
    ? [...new Set(profile.claimedPromos.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
    : undefined;
  const next: Profile = {
    ...profile,
    displayName: (profile.displayName ?? '').trim() || 'Player',
    updatedAt: Date.now(),
    record: clampRec(rec),
    onlineRecord: clampRec(online),
    settings: {
      ...settings,
      theme: normalizeFeltId(settings.theme),
      board: normalizeBoardId(settings.board),
    },
    ...(code ? { playerCode: code } : {}),
    ...(tr ? { tournamentRecord: tr } : {}),
    coins,
    coinLedger,
    ...(ownedEmojiIds ? { ownedEmojiIds } : {}),
    ...(ownedAvatarIds ? { ownedAvatarIds } : {}),
    ...(ownedFeltIds ? { ownedFeltIds } : {}),
    ...(ownedBoardIds ? { ownedBoardIds } : {}),
    equippedRailEmojiIds,
    ...(claimedPromos && claimedPromos.length ? { claimedPromos } : {}),
  };
  const store = getStorage();
  if (store) {
    const payload = JSON.stringify(next);
    // Legacy key: guest + boot mirror (active signed-in account when uid provided).
    store.setItem(PROFILE_STORAGE_KEY, payload);
    if (uid) {
      store.setItem(profileStorageKeyForUid(uid), payload);
      store.setItem(PROFILE_ACTIVE_UID_KEY, uid);
    }
  }
  return next;
}

/** True when a usable local profile exists (has been created/saved). */
export function hasProfile(): boolean {
  return loadProfile() !== null;
}

/**
 * Record a completed Vs AI game on the primary profile.
 * humanWon === true → win; false → loss. Hot-seat should not call this.
 */
export function recordAiGameResult(humanWon: boolean): Profile | null {
  const profile = loadProfile();
  if (!profile) return null;
  const prev = profile.record ?? emptyRecord();
  const record: CareerRecord = {
    wins: (prev.wins ?? 0) + (humanWon ? 1 : 0),
    losses: (prev.losses ?? 0) + (humanWon ? 0 : 1),
    gamesPlayed: (prev.gamesPlayed ?? 0) + 1,
  };
  return saveProfile({ ...profile, record });
}

/**
 * Record a completed online game for this device's seat.
 * humanWon === true → win; false → loss. Hot-seat / AI should not call this.
 */

/** Rooms whose online W/L was already counted on this device (prevents link-rejoin double wins). */
export function wasOnlineRoomRecorded(roomCode: string): boolean {
  const store = getStorage();
  if (!store || !roomCode) return false;
  try {
    const raw = store.getItem(ONLINE_RECORDED_ROOMS_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.includes(roomCode);
  } catch {
    return false;
  }
}

export function markOnlineRoomRecorded(roomCode: string): void {
  const store = getStorage();
  if (!store || !roomCode) return;
  try {
    const raw = store.getItem(ONLINE_RECORDED_ROOMS_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = Array.isArray(list) ? list : [];
    if (next.includes(roomCode)) return;
    next.push(roomCode);
    // Cap growth — keep most recent 100
    const trimmed = next.length > 100 ? next.slice(-100) : next;
    store.setItem(ONLINE_RECORDED_ROOMS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function recordOnlineGameResult(humanWon: boolean): Profile | null {
  const profile = loadProfile();
  if (!profile) return null;
  const prev = profile.onlineRecord ?? emptyRecord();
  const onlineRecord: CareerRecord = {
    wins: (prev.wins ?? 0) + (humanWon ? 1 : 0),
    losses: (prev.losses ?? 0) + (humanWon ? 0 : 1),
    gamesPlayed: (prev.gamesPlayed ?? 0) + 1,
  };
  return saveProfile({ ...profile, onlineRecord });
}

export function loadFriends(): Friend[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(FRIENDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f): f is Friend => {
      if (!f || typeof f !== 'object') return false;
      const fr = f as Friend;
      if (
        typeof fr.id !== 'string' ||
        typeof fr.name !== 'string' ||
        (fr.status !== 'offline' && fr.status !== 'local') ||
        typeof fr.addedAt !== 'number'
      ) {
        return false;
      }
      if (fr.uid !== undefined && typeof fr.uid !== 'string') return false;
      return true;
    });
  } catch {
    return [];
  }
}

export function saveFriends(friends: Friend[]): Friend[] {
  const store = getStorage();
  if (store) {
    store.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(friends));
  }
  return friends;
}

/** True when friend is a real cloud/mutual entry (has Firebase uid). */
export function isCloudFriend(f: Friend): boolean {
  return typeof f.uid === 'string' && f.uid.trim().length > 0;
}

/** Drop legacy local-only name entries (no uid). */
export function cloudFriendsOnly(friends: Friend[]): Friend[] {
  return friends.filter(isCloudFriend);
}

/**
 * @deprecated Local name-only friends are gone from UI. Kept for unit tests only —
 * do not call from product UI. Prefer addCloudFriend / friend requests.
 */
export function addFriend(name: string): Friend[] {
  const trimmed = name.trim();
  if (!trimmed) return loadFriends();
  const friends = loadFriends();
  if (friends.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    return friends;
  }
  const friend: Friend = {
    id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    status: 'local',
    addedAt: Date.now(),
  };
  return saveFriends([...friends, friend]);
}

/**
 * Add a friend resolved from player code / email (signed-in).
 * Dedupes by uid (preferred) or display name.
 */
export function addCloudFriend(uid: string, displayName: string): Friend[] {
  const id = uid.trim();
  const name = displayName.trim() || 'Player';
  if (!id) return loadFriends();
  const friends = loadFriends();
  if (friends.some((f) => f.uid === id || f.id === id)) {
    return friends;
  }
  if (friends.some((f) => f.name.toLowerCase() === name.toLowerCase() && !f.uid)) {
    // Upgrade local name-only entry to cloud friend
    const next = friends.map((f) =>
      f.name.toLowerCase() === name.toLowerCase() && !f.uid
        ? { ...f, id, uid: id, name, status: 'offline' as FriendStatus }
        : f,
    );
    return saveFriends(next);
  }
  const friend: Friend = {
    id,
    uid: id,
    name,
    status: 'offline',
    addedAt: Date.now(),
  };
  return saveFriends([...friends, friend]);
}

export function removeFriend(id: string): Friend[] {
  return saveFriends(loadFriends().filter((f) => f.id !== id));
}

/** Clear profile + friends (tests / reset). */
export function clearProfileStorage(): void {
  const store = getStorage();
  if (!store) return;
  const activeUid = store.getItem(PROFILE_ACTIVE_UID_KEY);
  store.removeItem(PROFILE_STORAGE_KEY);
  store.removeItem(FRIENDS_STORAGE_KEY);
  store.removeItem(PROFILE_ACTIVE_UID_KEY);
  if (activeUid) {
    store.removeItem(profileStorageKeyForUid(activeUid));
  }
  // Also drop any uid-scoped keys we can see (test / reset hygiene).
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith('supercrib.profile.v1.uid.')) toRemove.push(k);
    }
    for (const k of toRemove) store.removeItem(k);
  } catch {
    // ignore
  }
}
