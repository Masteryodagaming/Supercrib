/**
 * Super Coins — owner-only test currency (no real money).
 * Pure helpers: never mutate coins without a ledger row.
 */

export type CoinReason =
  | 'admin_grant'
  | 'admin_set'
  | 'buy_emoji'
  | 'buy_avatar'
  | 'buy_board'
  | 'buy_felt'
  | 'create_tournament'
  | 'join_tournament'
  | 'bonus';

export interface CoinLedgerEntry {
  at: number;
  delta: number;
  reason: CoinReason;
  note?: string;
}

export interface CoinState {
  coins: number;
  ledger: CoinLedgerEntry[];
}

export const COIN_LEDGER_CAP = 100;
/** SC charged when the owner creates a tournament draft. Easy to change. */
export const TOURNAMENT_CREATE_COST = 5;

export const SUPER_COIN_PUBLIC_PATH = '/super-coin.png';

export type ShopItemKind = 'emoji' | 'avatar' | 'board' | 'felt';

export interface SuperCoinShopItem {
  id: string;
  kind: ShopItemKind;
  label: string;
  glyph: string;
  price: number;
  /** Optional store art (public path). */
  imageSrc?: string;
  /** Ownership id when different from the catalog id. */
  unlockId?: string;
}

/** Store catalog — Board/Felt/Emoji/Avatar shelves buy via Store; SuperCoin top-up stays locked. */
export const SUPER_COIN_SHOP: SuperCoinShopItem[] = [
  {
    id: 'avatar_dangler',
    kind: 'avatar',
    label: 'The Dangler',
    glyph: '🏒',
    price: 200,
    imageSrc: '/avatars/dangler.png?v=1',
  },
  {
    id: 'avatar_spade_cutter',
    kind: 'avatar',
    label: 'The Spade Cutter',
    glyph: '♠️',
    price: 200,
    imageSrc: '/avatars/spade-cutter.png?v=1',
  },
  {
    id: 'avatar_grandma',
    kind: 'avatar',
    label: 'Grandma',
    glyph: '👵',
    price: 200,
    imageSrc: '/avatars/grandma.png?v=1',
  },
  {
    id: 'avatar_uncle',
    kind: 'avatar',
    label: 'Uncle',
    glyph: '🧢',
    price: 200,
    imageSrc: '/avatars/uncle.png?v=1',
  },
  {
    id: 'avatar_chief',
    kind: 'avatar',
    label: 'Chief',
    glyph: '🪶',
    price: 200,
    imageSrc: '/avatars/chief.png?v=1',
  },
  {
    id: 'avatar_collector',
    kind: 'avatar',
    label: 'The Collector',
    glyph: '🪙',
    price: 1000,
    imageSrc: '/avatars/collector.png?v=1',
  },
  {
    id: 'avatar_garbage_man',
    kind: 'avatar',
    label: 'The Garbage Man',
    glyph: '🗑️',
    price: 1000,
    imageSrc: '/avatars/garbage-man.png?v=1',
  },
  {
    id: 'avatar_slugger',
    kind: 'avatar',
    label: 'The Slugger',
    glyph: '⚾',
    price: 1000,
    imageSrc: '/avatars/slugger.png?v=1',
  },
  {
    id: 'board_zero_forge',
    kind: 'board',
    label: 'Zero Forge',
    glyph: '⚒️',
    price: 200,
    imageSrc: '/boards/zero-forge.jpg?v=3',
    unlockId: 'zero_forge',
  },
  {
    id: 'felt_zero_forge',
    kind: 'felt',
    label: 'Zero Forge',
    glyph: '⚒️',
    price: 200,
    imageSrc: '/felts/zero-forge-thumb.jpg?v=8',
    unlockId: 'zero_forge',
  },
  {
    id: 'board_cj_dumpster',
    kind: 'board',
    label: 'C&J Dumpster',
    glyph: '🗑️',
    price: 500,
    imageSrc: '/boards/cj-dumpster-thumb.jpg?v=3',
    unlockId: 'cj_dumpster',
  },
  {
    id: 'board_arena',
    kind: 'board',
    label: 'Arena',
    glyph: '🏒',
    price: 500,
    imageSrc: '/boards/arena-thumb.jpg?v=2',
    unlockId: 'arena',
  },
  {
    id: 'board_gold',
    kind: 'board',
    label: 'Gold',
    glyph: '🥇',
    price: 500,
    imageSrc: '/boards/gold-thumb.jpg?v=1',
    unlockId: 'gold',
  },
  {
    id: 'felt_cj_dumpster',
    kind: 'felt',
    label: 'C&J Dumpster',
    glyph: '🗑️',
    price: 1000,
    imageSrc: '/felts/cj-dumpster-thumb.jpg?v=7',
    unlockId: 'cj_dumpster',
  },
  {
    id: 'emoji_mad_finger',
    kind: 'emoji',
    label: 'Mad Finger',
    glyph: '🖕',
    price: 200,
    imageSrc: '/reactions/mad_finger.png?v=5',
    unlockId: 'mad_finger',
  },
  {
    id: 'emoji_trash_toss',
    kind: 'emoji',
    label: 'Trash Toss',
    glyph: '🗑️',
    price: 200,
    imageSrc: '/reactions/trash_toss.png?v=2',
    unlockId: 'trash_toss',
  },
  {
    id: 'emoji_ace_spade',
    kind: 'emoji',
    label: 'Spade Wizard',
    glyph: '♠️',
    price: 200,
    imageSrc: '/reactions/ace_spade.png?v=5',
    unlockId: 'ace_spade',
  },
  {
    id: 'emoji_grandma_peggy',
    kind: 'emoji',
    label: 'Grandma Peggy',
    glyph: '👵',
    price: 200,
    imageSrc: '/reactions/grandma_peggy.png?v=3',
    unlockId: 'grandma_peggy',
  },
  {
    id: 'emoji_mad_father',
    kind: 'emoji',
    label: 'Mad Father',
    glyph: '😤',
    price: 200,
    imageSrc: '/reactions/mad_father.png?v=1',
    unlockId: 'mad_father',
  },
  {
    id: 'avatar_supercrib_father',
    kind: 'avatar',
    label: 'The SuperCrib Father',
    glyph: '👔',
    price: 1000,
    imageSrc: '/avatars/supercrib-father.png?v=1',
    unlockId: 'supercrib_father',
  },
  { id: 'avatar_gold_elite', kind: 'avatar', label: 'Gold Peg Elite', glyph: '🥇', price: 50 },
];

/** Empty — AVATARS shelf is open (no locked teasers). */
export const STORE_TEASER_AVATARS: SuperCoinShopItem[] = [];

/** Purchasable Avatar shelf (unlocked in Store). Ownership via unlockId ?? id. */
export const STORE_AVATAR_ITEMS: SuperCoinShopItem[] = SUPER_COIN_SHOP.filter(
  (i) => i.kind === 'avatar',
);

/** Purchasable Emoji shelf (unlocked in Store). Rail unlock ids via unlockId. */
export const STORE_EMOJI_ITEMS: SuperCoinShopItem[] = SUPER_COIN_SHOP.filter(
  (i) => i.kind === 'emoji',
);

/** Purchasable Board shelf (unlocked in Store). */
export const STORE_BOARD_ITEMS: SuperCoinShopItem[] = SUPER_COIN_SHOP.filter(
  (i) => i.kind === 'board',
);

/** Purchasable Felt shelf (unlocked in Store). */
export const STORE_FELT_ITEMS: SuperCoinShopItem[] = SUPER_COIN_SHOP.filter(
  (i) => i.kind === 'felt',
);

export function normalizeCoins(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function normalizeLedger(raw: unknown): CoinLedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CoinLedgerEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<CoinLedgerEntry>;
    if (typeof r.at !== 'number' || typeof r.delta !== 'number') continue;
    if (typeof r.reason !== 'string') continue;
    const reason = r.reason as CoinReason;
    const allowed: CoinReason[] = [
      'admin_grant',
      'admin_set',
      'buy_emoji',
      'buy_avatar',
      'buy_board',
      'buy_felt',
      'create_tournament',
      'join_tournament',
      'bonus',
    ];
    if (!allowed.includes(reason)) continue;
    const entry: CoinLedgerEntry = {
      at: r.at,
      delta: Math.trunc(r.delta),
      reason,
    };
    if (typeof r.note === 'string' && r.note.trim()) {
      entry.note = r.note.trim().slice(0, 200);
    }
    out.push(entry);
  }
  return out.slice(-COIN_LEDGER_CAP);
}

function appendLedger(
  ledger: CoinLedgerEntry[],
  entry: CoinLedgerEntry,
): CoinLedgerEntry[] {
  return [...ledger, entry].slice(-COIN_LEDGER_CAP);
}

/** Stable identity for ledger union / dedupe (at + delta + reason + note). */
export function coinLedgerEntryKey(entry: CoinLedgerEntry): string {
  return `${entry.at}|${entry.delta}|${entry.reason}|${entry.note ?? ''}`;
}

/** Union two ledgers by entry key; sort by at, cap length. */
export function unionCoinLedgers(
  a: CoinLedgerEntry[] | undefined,
  b: CoinLedgerEntry[] | undefined,
): CoinLedgerEntry[] {
  const map = new Map<string, CoinLedgerEntry>();
  for (const row of [...normalizeLedger(a), ...normalizeLedger(b)]) {
    map.set(coinLedgerEntryKey(row), row);
  }
  return [...map.values()]
    .sort((x, y) => x.at - y.at || x.delta - y.delta)
    .slice(-COIN_LEDGER_CAP);
}

/**
 * True when the lower-balance side has exclusive ledger rows (spends / admin_set
 * / other deltas) that explain moving from `high` → `low` when applied in order.
 */
export function ledgerJustifiesCoinDecrease(
  high: number,
  low: number,
  highLedger: CoinLedgerEntry[] | undefined,
  lowLedger: CoinLedgerEntry[] | undefined,
): boolean {
  const drop = normalizeCoins(high) - normalizeCoins(low);
  if (drop <= 0) return true;
  const highKeys = new Set(normalizeLedger(highLedger).map(coinLedgerEntryKey));
  const exclusive = normalizeLedger(lowLedger)
    .filter((e) => !highKeys.has(coinLedgerEntryKey(e)))
    .sort((x, y) => x.at - y.at || x.delta - y.delta);
  if (exclusive.length === 0) return false;
  // Must include at least one spend or admin_set (never trust empty / grant-only wipe).
  const hasSpendOrSet = exclusive.some(
    (e) => e.delta < 0 || e.reason === 'admin_set',
  );
  if (!hasSpendOrSet) return false;
  let bal = normalizeCoins(high);
  for (const e of exclusive) {
    bal = Math.max(0, bal + e.delta);
  }
  return bal === normalizeCoins(low);
}

export interface MergeableCoinSlice {
  coins?: number;
  coinLedger?: CoinLedgerEntry[];
}

/**
 * Merge paid balances safely:
 * - Missing/undefined coins never overwrite a known higher balance.
 * - Prefer Math.max unless both agree OR the lower side has ledger evidence
 *   (spend / admin_set) that justifies the decrease.
 * - Ledgers are unioned by at+delta+reason(+note).
 */
export function mergeCoinStates(
  local: MergeableCoinSlice,
  cloud: MergeableCoinSlice,
): CoinState {
  const localPresent =
    typeof local.coins === 'number' && Number.isFinite(local.coins);
  const cloudPresent =
    typeof cloud.coins === 'number' && Number.isFinite(cloud.coins);
  const localCoins = localPresent ? normalizeCoins(local.coins) : 0;
  const cloudCoins = cloudPresent ? normalizeCoins(cloud.coins) : 0;
  const localLedger = normalizeLedger(local.coinLedger);
  const cloudLedger = normalizeLedger(cloud.coinLedger);
  const ledger = unionCoinLedgers(localLedger, cloudLedger);

  if (!localPresent && !cloudPresent) {
    return { coins: 0, ledger };
  }
  if (!localPresent) {
    return { coins: cloudCoins, ledger: ledger.length ? ledger : cloudLedger };
  }
  if (!cloudPresent) {
    return { coins: localCoins, ledger: ledger.length ? ledger : localLedger };
  }

  if (localCoins === cloudCoins) {
    return { coins: localCoins, ledger };
  }

  const high = Math.max(localCoins, cloudCoins);
  const low = Math.min(localCoins, cloudCoins);
  const highLedger = localCoins >= cloudCoins ? localLedger : cloudLedger;
  const lowLedger = localCoins < cloudCoins ? localLedger : cloudLedger;

  if (ledgerJustifiesCoinDecrease(high, low, highLedger, lowLedger)) {
    return { coins: low, ledger };
  }

  // Default: never silently drop purchased balance (settings wipe / missing field).
  return {
    coins: high,
    ledger: ledger.length ? ledger : highLedger,
  };
}

/** True when a ledger already contains this grant (inbox re-drain guard). */
export function ledgerHasMatchingGrant(
  ledger: CoinLedgerEntry[] | undefined,
  at: number,
  amount: number,
  reason: CoinReason = 'admin_grant',
): boolean {
  const target = Math.trunc(amount);
  return normalizeLedger(ledger).some(
    (e) => e.at === at && e.delta === target && e.reason === reason,
  );
}

/**
 * Apply a signed delta. Throws if the spend would go negative.
 * Always appends a ledger row (including zero deltas from admin_set).
 */
export function applyCoinDelta(
  coins: number,
  ledger: CoinLedgerEntry[] | undefined,
  delta: number,
  reason: CoinReason,
  note?: string,
  at: number = Date.now(),
): CoinState {
  const current = normalizeCoins(coins);
  const d = Math.trunc(delta);
  if (!Number.isFinite(d)) {
    throw new Error('Invalid coin delta.');
  }
  const next = current + d;
  if (next < 0) {
    throw new Error(
      `Insufficient Super Coins (need ${Math.abs(d)} SC, have ${current} SC).`,
    );
  }
  const entry: CoinLedgerEntry = {
    at,
    delta: d,
    reason,
  };
  if (note?.trim()) {
    entry.note = note.trim().slice(0, 200);
  }
  return {
    coins: next,
    ledger: appendLedger(normalizeLedger(ledger), entry),
  };
}

/**
 * Set absolute balance (≥0). Ledger reason is always `admin_set`.
 * Delta may be zero (still logged).
 */
export function setCoinBalance(
  coins: number,
  ledger: CoinLedgerEntry[] | undefined,
  nextBalance: number,
  note?: string,
  at: number = Date.now(),
): CoinState {
  const current = normalizeCoins(coins);
  const target = normalizeCoins(nextBalance);
  const delta = target - current;
  return applyCoinDelta(current, ledger, delta, 'admin_set', note, at);
}

export function getShopItem(id: string): SuperCoinShopItem | undefined {
  return SUPER_COIN_SHOP.find((i) => i.id === id);
}

/**
 * Resolve a shop avatar by catalog id (`avatar_*`) OR ownership unlockId
 * (e.g. `supercrib_father` for `avatar_supercrib_father`).
 * Avatar-kind only — does not collide with board/felt unlock ids.
 */
export function getShopAvatarItem(id: string): SuperCoinShopItem | undefined {
  const t = (id ?? '').trim();
  if (!t) return undefined;
  return SUPER_COIN_SHOP.find(
    (i) =>
      i.kind === 'avatar' &&
      (i.id === t || (i.unlockId != null && i.unlockId === t)),
  );
}

export function formatSc(n: number): string {
  return `SC ${normalizeCoins(n)}`;
}

/** Minimal profile slice used by coin mutations (avoids circular import with storage). */
export interface CoinProfileSlice {
  coins?: number;
  coinLedger?: CoinLedgerEntry[];
  ownedEmojiIds?: string[];
  ownedAvatarIds?: string[];
  ownedBoardIds?: string[];
  ownedFeltIds?: string[];
}

export function profileCoinState(p: CoinProfileSlice): CoinState {
  return {
    coins: normalizeCoins(p.coins ?? 0),
    ledger: normalizeLedger(p.coinLedger),
  };
}

export function applyDeltaToProfile<T extends CoinProfileSlice>(
  profile: T,
  delta: number,
  reason: CoinReason,
  note?: string,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } {
  const next = applyCoinDelta(profile.coins ?? 0, profile.coinLedger, delta, reason, note);
  return { ...profile, coins: next.coins, coinLedger: next.ledger };
}

export function setBalanceOnProfile<T extends CoinProfileSlice>(
  profile: T,
  nextBalance: number,
  note?: string,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } {
  const next = setCoinBalance(profile.coins ?? 0, profile.coinLedger, nextBalance, note);
  return { ...profile, coins: next.coins, coinLedger: next.ledger };
}

export function shopUnlockId(item: SuperCoinShopItem): string {
  return (item.unlockId ?? item.id).trim();
}

export function buyShopItemOnProfile<T extends CoinProfileSlice>(
  profile: T,
  itemId: string,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } {
  const item = getShopItem(itemId);
  if (!item) throw new Error('Unknown shop item.');
  const unlockId = shopUnlockId(item);
  if (!unlockId) throw new Error('Unknown shop item.');
  const ownedKey =
    item.kind === 'emoji'
      ? 'ownedEmojiIds'
      : item.kind === 'board'
        ? 'ownedBoardIds'
        : item.kind === 'felt'
          ? 'ownedFeltIds'
          : 'ownedAvatarIds';
  const owned = profile[ownedKey] ?? [];
  if (owned.includes(unlockId)) {
    throw new Error('Already owned.');
  }
  const reason: CoinReason =
    item.kind === 'emoji'
      ? 'buy_emoji'
      : item.kind === 'board'
        ? 'buy_board'
        : item.kind === 'felt'
          ? 'buy_felt'
          : 'buy_avatar';
  const afterPay = applyCoinDelta(
    profile.coins ?? 0,
    profile.coinLedger,
    -item.price,
    reason,
    item.label,
  );
  return {
    ...profile,
    coins: afterPay.coins,
    coinLedger: afterPay.ledger,
    [ownedKey]: [...owned, unlockId],
  } as T & { coins: number; coinLedger: CoinLedgerEntry[] };
}

export function chargeTournamentCreateOnProfile<T extends CoinProfileSlice>(
  profile: T,
  cost: number = TOURNAMENT_CREATE_COST,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } {
  return applyDeltaToProfile(
    profile,
    -Math.abs(cost),
    'create_tournament',
    `Create tournament (−${Math.abs(cost)} SC)`,
  );
}

export function chargeTournamentJoinOnProfile<T extends CoinProfileSlice>(
  profile: T,
  cost: number,
): T & { coins: number; coinLedger: CoinLedgerEntry[] } {
  const fee = Math.max(0, Math.floor(Math.abs(cost)));
  if (fee <= 0) {
    return {
      ...profile,
      coins: normalizeCoins(profile.coins ?? 0),
      coinLedger: normalizeLedger(profile.coinLedger),
    };
  }
  return applyDeltaToProfile(
    profile,
    -fee,
    'join_tournament',
    `Tournament entry (−${fee} SC)`,
  );
}

/** Unlock an avatar id on a profile (tournament prize / grant). Idempotent. */
export function grantAvatarIdOnProfile<T extends CoinProfileSlice>(
  profile: T,
  avatarId: string,
): T & { ownedAvatarIds: string[] } {
  const id = avatarId.trim();
  if (!id) {
    return {
      ...profile,
      ownedAvatarIds: [...(profile.ownedAvatarIds ?? [])],
    };
  }
  const owned = profile.ownedAvatarIds ?? [];
  if (owned.includes(id)) {
    return { ...profile, ownedAvatarIds: [...owned] };
  }
  return { ...profile, ownedAvatarIds: [...owned, id] };
}

/** Unlock a board skin id on a profile (store purchase / gift). Idempotent. */
export function grantBoardIdOnProfile<T extends CoinProfileSlice>(
  profile: T,
  boardId: string,
): T & { ownedBoardIds: string[] } {
  const id = boardId.trim();
  if (!id) {
    return {
      ...profile,
      ownedBoardIds: [...(profile.ownedBoardIds ?? [])],
    };
  }
  const owned = profile.ownedBoardIds ?? [];
  if (owned.includes(id)) {
    return { ...profile, ownedBoardIds: [...owned] };
  }
  return { ...profile, ownedBoardIds: [...owned, id] };
}

/** Unlock a felt id on a profile (store purchase / gift). Idempotent. */
export function grantFeltIdOnProfile<T extends CoinProfileSlice>(
  profile: T,
  feltId: string,
): T & { ownedFeltIds: string[] } {
  const id = feltId.trim();
  if (!id) {
    return {
      ...profile,
      ownedFeltIds: [...(profile.ownedFeltIds ?? [])],
    };
  }
  const owned = profile.ownedFeltIds ?? [];
  if (owned.includes(id)) {
    return { ...profile, ownedFeltIds: [...owned] };
  }
  return { ...profile, ownedFeltIds: [...owned, id] };
}
