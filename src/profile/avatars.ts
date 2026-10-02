/** Built-in avatar ids — rendered in UI; no external assets required. */
export interface BuiltinAvatar {
  id: string;
  label: string;
  /** Emoji or short glyph shown in the avatar circle. */
  glyph: string;
  /** CSS background for the circle. */
  bg: string;
  /** Optional public image path (e.g. /avatars/crib-master.png?v=1). */
  imageSrc?: string;
}

/** Josh’s exclusive owner-only signature avatar. */
export const CRIB_MASTER_ID = 'crib_master';

/**
 * @deprecated Legacy id — migrated to {@link CRIB_MASTER_ID}. Kept for cloud
 * profiles / storage that still store master_yoda.
 */
export const MASTER_YODA_ID = 'master_yoda';

/** Avatars only the app owner may select (still render for everyone when equipped). */
export const OWNER_ONLY_AVATAR_IDS = new Set<string>([CRIB_MASTER_ID]);

/** Free default suit/peg coin avatars (not owner-only / shop / prize). */
export const DEFAULT_BUILTIN_AVATAR_IDS = [
  'peg',
  'spade',
  'heart',
  'diamond',
  'club',
  'crown',
  'star',
  'felt',
] as const;

export const BUILTIN_AVATARS: BuiltinAvatar[] = [
  {
    id: 'peg',
    label: 'Gold peg',
    glyph: '♟',
    bg: 'linear-gradient(145deg,#3d2e10,#1a1408)',
    imageSrc: '/avatars/defaults/peg.png?v=1',
  },
  {
    id: 'spade',
    label: 'Spade',
    glyph: '♠',
    bg: 'linear-gradient(145deg,#1a2740,#0a1220)',
    imageSrc: '/avatars/defaults/spade.png?v=1',
  },
  {
    id: 'heart',
    label: 'Heart',
    glyph: '♥',
    bg: 'linear-gradient(145deg,#5a1a1a,#2a0a0a)',
    imageSrc: '/avatars/defaults/heart.png?v=1',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    glyph: '♦',
    bg: 'linear-gradient(145deg,#5a2a10,#2a1408)',
    imageSrc: '/avatars/defaults/diamond.png?v=1',
  },
  {
    id: 'club',
    label: 'Club',
    glyph: '♣',
    bg: 'linear-gradient(145deg,#1a3a28,#0a1a12)',
    imageSrc: '/avatars/defaults/club.png?v=1',
  },
  {
    id: 'crown',
    label: 'Crown',
    glyph: '♛',
    bg: 'linear-gradient(145deg,#4a3a10,#241a08)',
    imageSrc: '/avatars/defaults/crown.png?v=1',
  },
  {
    id: 'star',
    label: 'Star',
    glyph: '★',
    bg: 'linear-gradient(145deg,#2a2a40,#121220)',
    imageSrc: '/avatars/defaults/star.png?v=1',
  },
  {
    id: 'felt',
    label: 'Felt',
    glyph: '🃏',
    bg: 'linear-gradient(145deg,#0f4a3a,#08261e)',
    imageSrc: '/avatars/defaults/felt.png?v=1',
  },
  {
    id: CRIB_MASTER_ID,
    label: 'Crib Master',
    glyph: '🟢',
    bg: 'linear-gradient(145deg,#1a4a28,#0a2414)',
    imageSrc: '/avatars/crib-master.png?v=1',
  },
];

/** Free builtins that are not owner-only (peg → felt). */
export function isDefaultBuiltinAvatar(id: string | null | undefined): boolean {
  if (!id) return false;
  return (DEFAULT_BUILTIN_AVATAR_IDS as readonly string[]).includes(id);
}


/** True for crib_master or legacy master_yoda. */
export function isOwnerSignatureAvatarId(id: string | null | undefined): boolean {
  return id === CRIB_MASTER_ID || id === MASTER_YODA_ID;
}

/** Known builtin / legacy ids that must not be wiped on storage load. */
export function isKnownBuiltinAvatarId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (BUILTIN_AVATARS.some((a) => a.id === id)) return true;
  // Legacy alias — keep until migrateMasterYodaSelection runs.
  if (id === MASTER_YODA_ID) return true;
  return false;
}

export function getBuiltinAvatar(id: string | null | undefined): BuiltinAvatar {
  const resolved = id === MASTER_YODA_ID ? CRIB_MASTER_ID : id;
  return BUILTIN_AVATARS.find((a) => a.id === resolved) ?? BUILTIN_AVATARS[0];
}

/** Shop / unlockable avatar shown in the picker grid (glyph from SUPER_COIN_SHOP). */
export interface SelectableAvatar {
  id: string;
  label: string;
  glyph: string;
  bg: string;
  imageSrc?: string;
  /** True when this is a free builtin (always shown). */
  builtin: boolean;
}

/** Split picker list: signature/specials first, free defaults second. */
export function splitSelectableAvatars(avatars: SelectableAvatar[]): {
  signature: SelectableAvatar[];
  defaults: SelectableAvatar[];
} {
  const signature: SelectableAvatar[] = [];
  const defaults: SelectableAvatar[] = [];
  for (const a of avatars) {
    if (isDefaultBuiltinAvatar(a.id)) defaults.push(a);
    else signature.push(a);
  }
  return { signature, defaults };
}

const SHOP_AVATAR_BG = 'linear-gradient(145deg,#4a3a10,#241a08)';


/**
 * Tournament 1st-place prize avatars (unlock on complete via prizeFirstAvatarId).
 * Limited editions: maxSupply caps how many can ever be granted (tracked in RTDB).
 */
export interface TournamentPrizeAvatar {
  id: string;
  label: string;
  /** Optional until art is attached. */
  imageSrc?: string;
  glyph?: string;
  /**
   * Max copies that may ever be granted. Once grantedCount hits this, no more
   * enter circulation. Omit = unlimited.
   */
  maxSupply?: number;
}

export const FIRST_EVER_WINNER_AVATAR_ID = 'first_ever_winner';
/** Limited "Tester God" prize — 5 copies max. */
export const TESTER_GOD_AVATAR_ID = 'tester_god';

export const TOURNAMENT_PRIZE_AVATARS: TournamentPrizeAvatar[] = [
  {
    id: FIRST_EVER_WINNER_AVATAR_ID,
    label: '1st Ever Winner',
    glyph: '👑',
    imageSrc: '/avatars/first-ever-winner.png?v=2',
    maxSupply: 1,
  },
  {
    id: TESTER_GOD_AVATAR_ID,
    label: 'Tester God',
    glyph: '🧪',
    imageSrc: '/avatars/tester-god.png?v=1',
    maxSupply: 5,
  },
];

export function getTournamentPrizeAvatar(
  id: string | null | undefined,
): TournamentPrizeAvatar | undefined {
  if (!id) return undefined;
  return TOURNAMENT_PRIZE_AVATARS.find((a) => a.id === id);
}

/** Display label with remaining supply, e.g. "Tester God · 3/5 left". */
export function formatPrizeAvatarOption(
  avatar: TournamentPrizeAvatar,
  grantedCount: number | undefined,
): string {
  const max = avatar.maxSupply;
  if (max == null || max <= 0) return avatar.label;
  const granted = Math.max(0, Math.floor(grantedCount ?? 0));
  const left = Math.max(0, max - granted);
  if (left <= 0) return `${avatar.label} · sold out (${max}/${max})`;
  return `${avatar.label} · ${left}/${max} left`;
}

export interface SelectableAvatarOpts {
  /** When true, include owner-only signature avatars (Crib Master). */
  owner?: boolean;
}

/**
 * Avatars available in Settings / Login grids:
 * free builtins + owned shop / prize avatar ids.
 * Owner-only builtins (Crib Master) are included only when opts.owner is true.
 * Never includes shop teasers the user does not own.
 */
export function getSelectableAvatars(
  ownedAvatarIds: string[] | undefined,
  shopAvatarItems: ReadonlyArray<{
    id: string;
    kind: string;
    label: string;
    glyph: string;
    imageSrc?: string;
    unlockId?: string;
  }>,
  opts?: SelectableAvatarOpts,
): SelectableAvatar[] {
  const includeOwnerOnly = opts?.owner === true;
  const builtins: SelectableAvatar[] = BUILTIN_AVATARS.filter(
    (a) => includeOwnerOnly || !OWNER_ONLY_AVATAR_IDS.has(a.id),
  ).map((a) => ({
    id: a.id,
    label: a.label,
    glyph: a.glyph,
    bg: a.bg,
    ...(a.imageSrc ? { imageSrc: a.imageSrc } : {}),
    builtin: true,
  }));
  const owned = new Set(ownedAvatarIds ?? []);
  const shop: SelectableAvatar[] = [];
  for (const item of shopAvatarItems) {
    if (item.kind !== 'avatar') continue;
    // Ownership / picker id is unlockId when set (e.g. supercrib_father), else catalog id.
    const unlockId = (item.unlockId ?? item.id).trim();
    if (!unlockId || !owned.has(unlockId)) continue;
    shop.push({
      id: unlockId,
      label: item.label,
      glyph: item.glyph,
      bg: SHOP_AVATAR_BG,
      ...(item.imageSrc ? { imageSrc: item.imageSrc } : {}),
      builtin: false,
    });
  }
  const shown = new Set([...builtins, ...shop].map((a) => a.id));
  const prizeExtras: SelectableAvatar[] = [];
  for (const id of owned) {
    if (shown.has(id)) continue;
    const catalog = getTournamentPrizeAvatar(id) ?? getExclusiveGiftAvatar(id);
    // Placeholder only — no fabricated imageSrc until art is registered.
    prizeExtras.push({
      id,
      label: catalog?.label ?? 'Prize avatar',
      glyph: catalog?.glyph ?? '🏆',
      bg: SHOP_AVATAR_BG,
      ...(catalog?.imageSrc ? { imageSrc: catalog.imageSrc } : {}),
      builtin: false,
    });
  }
  return [...builtins, ...shop, ...prizeExtras];
}

/**
 * Migrate legacy Master Yoda id → Crib Master, or strip signature ids from
 * confirmed non-owner profiles. Never force crib_master over an intentional
 * builtin choice (e.g. gold peg).
 *
 * - `owner: true`: `master_yoda` → `crib_master`; clear orphaned `avatarDataUrl`
 *   when a known builtin is selected (keep avatarId).
 * - `owner: false`: `crib_master` / `master_yoda` → first free builtin (peg), clear data URL.
 * - `owner` omitted: upgrade legacy `master_yoda` → crib_master only (do not strip).
 */
export function migrateMasterYodaSelection<T extends { avatarId: string; avatarDataUrl: string | null }>(
  profile: T,
  opts?: SelectableAvatarOpts,
): T {
  const fallbackId = BUILTIN_AVATARS[0].id;

  if (opts?.owner === false) {
    if (isOwnerSignatureAvatarId(profile.avatarId)) {
      return { ...profile, avatarId: fallbackId, avatarDataUrl: null };
    }
    return profile;
  }

  // Legacy id → Crib Master (owner or unknown).
  if (profile.avatarId === MASTER_YODA_ID) {
    return { ...profile, avatarId: CRIB_MASTER_ID, avatarDataUrl: null };
  }

  // Orphaned custom photo while a known builtin is equipped → drop data URL only
  // (do not override peg / crib_master / other builtins).
  if (profile.avatarDataUrl && isKnownBuiltinAvatarId(profile.avatarId)) {
    return { ...profile, avatarDataUrl: null };
  }

  // owner omitted + leftover photo with unknown id: prefer stylized Crib Master once.
  if (opts?.owner !== true && profile.avatarDataUrl) {
    return { ...profile, avatarId: CRIB_MASTER_ID, avatarDataUrl: null };
  }

  return profile;
}

/** Catalog for gift / prize exclusive avatars (may also be sold in SUPER_COIN_SHOP). */
export interface ExclusiveGiftAvatar {
  id: string;
  label: string;
  glyph: string;
  imageSrc: string;
  bg?: string;
}

/** The SuperCrib Father — also sold in Store (avatar_supercrib_father → unlockId). */
export const SUPERCRIB_FATHER_ID = 'supercrib_father';

export const EXCLUSIVE_GIFT_AVATARS: ExclusiveGiftAvatar[] = [
  {
    id: SUPERCRIB_FATHER_ID,
    label: 'The SuperCrib Father',
    glyph: '🎩',
    imageSrc: '/avatars/supercrib-father.png?v=1',
    bg: 'linear-gradient(145deg,#3a2a10,#1a1408)',
  },
];

export function getExclusiveGiftAvatar(
  id: string | null | undefined,
): ExclusiveGiftAvatar | undefined {
  if (!id) return undefined;
  return EXCLUSIVE_GIFT_AVATARS.find((a) => a.id === id);
}
