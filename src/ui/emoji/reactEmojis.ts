/**
 * Supercrib reaction emoji catalog.
 * Default rail (free) order is the migrate/fallback loadout.
 * Store pack ids unlock later; may appear on the rail when owned + equipped.
 * Specials: mad_finger + trash_toss + ace_spade + grandma_peggy + mad_father = Dummy + Owner (Master Yoda).
 * Also purchasable in Store (Clash shelf) via SUPER_COIN_SHOP unlockIds.
 */

import { BOARD_SKIN_TEST_UID } from '../../profile/boards';
import { isOwner } from '../../tournament/isOwner';

// ASCII-safe code points (avoids Windows copy/encoding mangling literal emoji).
export const EMOJI_GLYPH = {
  laugh: '\u{1F602}',
  cry: '\u{1F622}',
  angry: '\u{1F621}', // rail currently uses angry face; keep send payload stable
  skunk: '\u{1F9A8}',
  facepalm: '\u{1F926}',
  handshake: '\u{1F91D}',
  /** Display + send payload is the words “good luck” (clover art retired). */
  clover: 'good luck',
} as const;

export type DefaultReactEmojiId = keyof typeof EMOJI_GLYPH;

/** Exactly 8 dock slots (4 left + 4 right). */
export const RAIL_SLOT_COUNT = 8;

/**
 * Default in-game loadout — 8 slots (4 left + 4 right).
 * Left: laugh/cry/angry/skunk · Right: facepalm/handshake/clover/go.
 * `go` is a free store stub (glyph “GO”) so every account can fill 8 unique slots.
 */
export const DEFAULT_RAIL_EMOJI_IDS = [
  'laugh',
  'cry',
  'angry',
  'skunk',
  'facepalm',
  'handshake',
  'clover',
  'go',
] as const;

/** Always-owned free reactions (default rail pack, incl. free `go` stub). */
export const FREE_REACT_EMOJI_IDS = [
  'laugh',
  'cry',
  'angry',
  'skunk',
  'facepalm',
  'handshake',
  'clover',
  'go',
] as const;

export const DEFAULT_RAIL_LABELS: Record<DefaultReactEmojiId, string> = {
  laugh: 'Laugh',
  cry: 'Cry',
  angry: 'Angry',
  skunk: 'Skunk',
  facepalm: 'Facepalm',
  handshake: 'Good game',
  clover: 'Good luck',
};

/** Ids that render as text chips instead of PNG art. */
export const TEXT_RAIL_EMOJI_IDS: readonly DefaultReactEmojiId[] = ['clover'] as const;

export function isTextRailEmoji(id: string): boolean {
  return (TEXT_RAIL_EMOJI_IDS as readonly string[]).includes(id);
}

/** Custom Supercrib art for the rail (system glyph still used for send/sync). */
export const EMOJI_ART: Partial<Record<DefaultReactEmojiId, string>> = {
  laugh: '/reactions/laugh.png?v=14',
  cry: '/reactions/cry.png?v=14',
  angry: '/reactions/angry.png?v=14',
  skunk: '/reactions/skunk.png?v=14',
  facepalm: '/reactions/facepalm.png?v=14',
  handshake: '/reactions/handshake.png?v=14',
};

/** Future store unlocks — equipable when owned; stubs until custom art ships. */
export const STORE_EMOJI_IDS = [
  'peg',
  'crib',
  'double_skunk',
  'his_nobs',
  'fifteen',
  'the_run',
  'pair',
  'flush',
  'perfect_29',
  'trap',
  'penalty_bomb',
  'peg_steal',
  'go',
  'muggins',
  'gold_peg',
  'ice_peg',
  'flame_peg',
  'wild_joker',
  'champion_crown',
] as const;

export type StoreReactEmojiId = (typeof STORE_EMOJI_IDS)[number];

/** Special unlock ids (not free rail defaults). */
export const MAD_FINGER_ID = 'mad_finger' as const;
export const TRASH_TOSS_ID = 'trash_toss' as const;
export const ACE_SPADE_ID = 'ace_spade' as const;
export const GRANDMA_PEGGY_ID = 'grandma_peggy' as const;
export const MAD_FATHER_ID = 'mad_father' as const;

/** Full specials catalog (Dummy set + Owner-shared Mad Finger). */
export const DUMMY_EMOJI_IDS = [MAD_FINGER_ID, TRASH_TOSS_ID, ACE_SPADE_ID, GRANDMA_PEGGY_ID, MAD_FATHER_ID] as const;
export type DummyReactEmojiId = (typeof DUMMY_EMOJI_IDS)[number];

/** Legacy: no Dummy-only specials (trash_toss is Owner-shared). */
export const DUMMY_ONLY_EMOJI_IDS = [] as const;

/** Owner-shared specials (Dummy OR Owner via canUseMadFinger). */
export const OWNER_SHARED_EMOJI_IDS = [MAD_FINGER_ID, TRASH_TOSS_ID, ACE_SPADE_ID, GRANDMA_PEGGY_ID, MAD_FATHER_ID] as const;

/** Same Dummy account as Zero Forge board unlock. */
export const DUMMY_TEST_EMAIL = 'joshuamilliea@icloud.com';

export type ReactEmojiId = DefaultReactEmojiId | StoreReactEmojiId | DummyReactEmojiId;

export const DUMMY_EMOJI_GLYPH: Record<DummyReactEmojiId, string> = {
  mad_finger: 'mad finger',
  trash_toss: 'trash toss',
  ace_spade: 'spade wizard',
  grandma_peggy: 'grandma peggy',
  mad_father: 'mad father',
};

export const DUMMY_EMOJI_LABELS: Record<DummyReactEmojiId, string> = {
  mad_finger: 'Mad Finger',
  trash_toss: 'Trash Toss',
  ace_spade: 'Spade Wizard',
  grandma_peggy: 'Grandma Peggy',
  mad_father: 'Mad Father',
};

export const DUMMY_EMOJI_ART: Record<DummyReactEmojiId, string> = {
  mad_finger: '/reactions/mad_finger.png?v=5',
  trash_toss: '/reactions/trash_toss.png?v=2',
  ace_spade: '/reactions/ace_spade.png?v=5',
  grandma_peggy: '/reactions/grandma_peggy.png?v=3',
  mad_father: '/reactions/mad_father.png?v=1',
};

/** Stub glyphs for store ids (send payload + glyph fallback until art exists). */
export const STORE_EMOJI_GLYPH: Record<StoreReactEmojiId, string> = {
  peg: '\u{1F3AF}',
  crib: '\u{1F6CF}',
  double_skunk: '\u{1F9A8}\u{1F9A8}',
  his_nobs: '\u{1F451}',
  fifteen: '15',
  the_run: '\u{1F3C3}',
  pair: '\u{1F0CF}',
  flush: '\u{1F0A1}',
  perfect_29: '29',
  trap: '\u{1F578}',
  penalty_bomb: '\u{1F4A3}',
  peg_steal: '\u{1F37A}',
  go: 'GO',
  muggins: '\u{1F914}',
  gold_peg: '\u{1F948}',
  ice_peg: '\u{2744}',
  flame_peg: '\u{1F525}',
  wild_joker: '\u{1F0CF}',
  champion_crown: '\u{1F451}',
};

export const STORE_EMOJI_LABELS: Record<StoreReactEmojiId, string> = {
  peg: 'Peg',
  crib: 'Crib',
  double_skunk: 'Double skunk',
  his_nobs: "His nobs",
  fifteen: 'Fifteen',
  the_run: 'The run',
  pair: 'Pair',
  flush: 'Flush',
  perfect_29: 'Perfect 29',
  trap: 'Trap',
  penalty_bomb: 'Penalty',
  peg_steal: 'Peg steal',
  go: 'Go',
  muggins: 'Muggins',
  gold_peg: 'Gold peg',
  ice_peg: 'Ice peg',
  flame_peg: 'Flame peg',
  wild_joker: 'Wild joker',
  champion_crown: 'Champion',
};

export function isDefaultReactEmojiId(id: string): id is DefaultReactEmojiId {
  return Object.prototype.hasOwnProperty.call(EMOJI_GLYPH, id);
}

export function isStoreReactEmojiId(id: string): id is StoreReactEmojiId {
  return (STORE_EMOJI_IDS as readonly string[]).includes(id);
}

export function isDummyReactEmojiId(id: string): id is DummyReactEmojiId {
  return (DUMMY_EMOJI_IDS as readonly string[]).includes(id);
}

export function isReactEmojiId(id: string): id is ReactEmojiId {
  return isDefaultReactEmojiId(id) || isStoreReactEmojiId(id) || isDummyReactEmojiId(id);
}

/** Test Dummy uid or email — never grants Mad Finger to other accounts. */
export function isEmojiTestDummy(
  uid?: string | null,
  email?: string | null,
): boolean {
  if (uid && uid === BOARD_SKIN_TEST_UID) return true;
  const e = (email ?? '').trim().toLowerCase();
  if (e && e === DUMMY_TEST_EMAIL) return true;
  return false;
}

/** Dummy OR Master Yoda (isOwner) may use / keep Mad Finger. */
export function canUseMadFinger(
  uid?: string | null,
  email?: string | null,
): boolean {
  if (isEmojiTestDummy(uid, email)) return true;
  return isOwner({ uid, email });
}

/** Alias — Trash Toss unlocks the same way as Mad Finger (Dummy|Owner). */
export function canUseTrashToss(
  uid?: string | null,
  email?: string | null,
): boolean {
  return canUseMadFinger(uid, email);
}

/** Per-id special unlock: mad_finger + trash_toss + ace_spade + grandma_peggy + mad_father = dummy|owner. */
export function canUseSpecialEmoji(
  id: string,
  uid?: string | null,
  email?: string | null,
): boolean {
  if ((OWNER_SHARED_EMOJI_IDS as readonly string[]).includes(id)) {
    return canUseMadFinger(uid, email);
  }
  if ((DUMMY_ONLY_EMOJI_IDS as readonly string[]).includes(id)) {
    return isEmojiTestDummy(uid, email);
  }
  if (isDummyReactEmojiId(id)) return canUseMadFinger(uid, email);
  return true;
}

/**
 * Merge cloud ownership with special unlocks (never grants specials to others).
 * mad_finger + trash_toss + ace_spade + grandma_peggy + mad_father → Dummy|Owner. Mirrors Zero Forge board gating.
 */
export function effectiveOwnedEmojiIds(
  uid: string | null | undefined,
  email: string | null | undefined,
  ownedEmojiIds: string[] | undefined,
): string[] {
  const ids = new Set<string>();
  for (const id of ownedEmojiIds ?? []) {
    if (typeof id !== 'string' || !id) continue;
    if (isDummyReactEmojiId(id) && !canUseSpecialEmoji(id, uid, email)) continue;
    ids.add(id);
  }
  if (canUseMadFinger(uid, email)) {
    for (const id of OWNER_SHARED_EMOJI_IDS) ids.add(id);
  }
  if (isEmojiTestDummy(uid, email)) {
    for (const id of DUMMY_ONLY_EMOJI_IDS) ids.add(id);
  }
  return [...ids];
}

/** Frame-sequence anim packs. Idle still uses EMOJI_ART / DUMMY_EMOJI_ART. */
export const EMOJI_ANIM_IDS = ['laugh', 'cry', 'angry', 'skunk', 'mad_finger', 'trash_toss', 'ace_spade', 'grandma_peggy', 'mad_father'] as const;
export type AnimReactEmojiId = (typeof EMOJI_ANIM_IDS)[number];

export function isAnimReactEmojiId(id: string): id is AnimReactEmojiId {
  return (EMOJI_ANIM_IDS as readonly string[]).includes(id);
}

export interface ReactEmojiAnimMeta {
  id: AnimReactEmojiId;
  durationMs: number;
  /** Absolute public URLs for frames (cache-busted). */
  frames: string[];
  /**
   * Optional per-frame hold times (ms). When set, playClip / EmoteFrameClip
   * use these instead of equal durationMs / n splits.
   */
  frameDurationsMs?: number[];
}

const ANIM_V = 14;
/** Bump when mad_finger playback / frame set changes. */
const ANIM_V_MAD = 5;
/** Bump when trash_toss playback / frame set changes. */
const ANIM_V_TRASH = 3;
/** Bump when ace_spade playback / frame set changes. */
const ANIM_V_ACE = 6;
/** Bump when grandma_peggy playback / frame set changes. */
const ANIM_V_PEGGY = 3;
/** Bump when mad_father playback / frame set changes. */
const ANIM_V_FATHER = 1;

const ANIM_SPECS: Record<AnimReactEmojiId, { durationMs: number; frameCount: number; v: number }> = {
  laugh: { durationMs: 1000, frameCount: 6, v: ANIM_V },
  cry: { durationMs: 1000, frameCount: 6, v: ANIM_V },
  angry: { durationMs: 1000, frameCount: 6, v: ANIM_V },
  skunk: { durationMs: 1000, frameCount: 6, v: ANIM_V },
  mad_finger: { durationMs: 1000, frameCount: 4, v: ANIM_V_MAD },
  trash_toss: { durationMs: 1710, frameCount: 4, v: ANIM_V_TRASH },
  ace_spade: { durationMs: 2100, frameCount: 4, v: ANIM_V_ACE },
  grandma_peggy: { durationMs: 2100, frameCount: 4, v: ANIM_V_PEGGY },
  mad_father: { durationMs: 2100, frameCount: 4, v: ANIM_V_FATHER },
};

/**
 * Mad Finger: f0.png === f1.png (same hold art), so drop the duplicate.
 * hold → peak yell → smirk settle (end on smirk, hold it longer).
 * Canonical Clash format: hold 150 → peak 400 → smirk 550 (ending on smirk).
 */
function madFingerAnimMeta(v: number): ReactEmojiAnimMeta {
  const frameIdx = [1, 2, 3] as const;
  const frames = frameIdx.map((i) => `/reactions/anim/mad_finger/f${i}.png?v=${v}`);
  // Canonical Clash format
  const frameDurationsMs = [150, 400, 550];
  return {
    id: 'mad_finger',
    durationMs: frameDurationsMs.reduce((a, b) => a + b, 0),
    frames,
    frameDurationsMs,
  };
}

/**
 * Trash Toss: crouch → mid → peak throw → follow-through settle (end on f4).
 * Slowed ~1.4× for clearer windup→hold→peak→settle: 180 → 280 → 500 → 750 (~1.71s).
 */
function trashTossAnimMeta(v: number): ReactEmojiAnimMeta {
  const frameIdx = [1, 2, 3, 4] as const;
  const frames = frameIdx.map((i) => `/reactions/anim/trash_toss/f${i}.png?v=${v}`);
  const frameDurationsMs = [180, 280, 500, 750];
  return {
    id: 'trash_toss',
    durationMs: frameDurationsMs.reduce((a, b) => a + b, 0),
    frames,
    frameDurationsMs,
  };
}

/**
 * Spade Wizard: hands → cloud → ace reveal → laugh settle (hold f4 ~1250ms).
 * Sequence: 180 → 220 → 280 → 1000 (~1.68s), play once.
 */
function aceSpadeAnimMeta(v: number): ReactEmojiAnimMeta {
  const frameIdx = [1, 2, 3, 4] as const;
  const frames = frameIdx.map((i) => `/reactions/anim/ace_spade/f${i}.png?v=${v}`);
  const frameDurationsMs = [225, 275, 350, 1250];
  return {
    id: 'ace_spade',
    durationMs: frameDurationsMs.reduce((a, b) => a + b, 0),
    frames,
    frameDurationsMs,
  };
}

/**
 * Grandma Peggy: peg show → pegging board → wrist twinge → laugh clap (hold f4 ~1250ms).
 * Same timing as Spade Wizard: 225 → 275 → 350 → 1250 (=2100ms), play once.
 */
function grandmaPeggyAnimMeta(v: number): ReactEmojiAnimMeta {
  const frameIdx = [1, 2, 3, 4] as const;
  const frames = frameIdx.map((i) => `/reactions/anim/grandma_peggy/f${i}.png?v=${v}`);
  const frameDurationsMs = [225, 275, 350, 1250];
  return {
    id: 'grandma_peggy',
    durationMs: frameDurationsMs.reduce((a, b) => a + b, 0),
    frames,
    frameDurationsMs,
  };
}

/**
 * Mad Father: calm → shock → red mad → steam ears hold (hold f4 ~1250ms).
 * Same timing as Spade Wizard / Grandma Peggy: 225 → 275 → 350 → 1250 (=2100ms), play once.
 */
function madFatherAnimMeta(v: number): ReactEmojiAnimMeta {
  const frameIdx = [1, 2, 3, 4] as const;
  const frames = frameIdx.map((i) => `/reactions/anim/mad_father/f${i}.png?v=${v}`);
  const frameDurationsMs = [225, 275, 350, 1250];
  return {
    id: 'mad_father',
    durationMs: frameDurationsMs.reduce((a, b) => a + b, 0),
    frames,
    frameDurationsMs,
  };
}

export function animMetaForReactEmojiId(id: string): ReactEmojiAnimMeta | null {
  if (!isAnimReactEmojiId(id)) return null;
  const spec = ANIM_SPECS[id];
  if (id === 'mad_finger') return madFingerAnimMeta(spec.v);
  if (id === 'trash_toss') return trashTossAnimMeta(spec.v);
  if (id === 'ace_spade') return aceSpadeAnimMeta(spec.v);
  if (id === 'grandma_peggy') return grandmaPeggyAnimMeta(spec.v);
  if (id === 'mad_father') return madFatherAnimMeta(spec.v);
  const frames = Array.from(
    { length: spec.frameCount },
    (_, i) => `/reactions/anim/${id}/f${i}.png?v=${spec.v}`,
  );
  return { id, durationMs: spec.durationMs, frames };
}

export function artForReactEmojiId(id: string): string | null {
  if (isDefaultReactEmojiId(id)) return EMOJI_ART[id] ?? null;
  if (isDummyReactEmojiId(id)) return DUMMY_EMOJI_ART[id] ?? null;
  return null;
}

export function glyphForReactEmojiId(id: ReactEmojiId | string): string {
  if (isDefaultReactEmojiId(id)) return EMOJI_GLYPH[id];
  if (isStoreReactEmojiId(id)) return STORE_EMOJI_GLYPH[id];
  if (isDummyReactEmojiId(id)) return DUMMY_EMOJI_GLYPH[id];
  return id;
}

export function labelForReactEmojiId(id: ReactEmojiId | string): string {
  if (isDefaultReactEmojiId(id)) return DEFAULT_RAIL_LABELS[id];
  if (isStoreReactEmojiId(id)) return STORE_EMOJI_LABELS[id];
  if (isDummyReactEmojiId(id)) return DUMMY_EMOJI_LABELS[id];
  return id;
}

/**
 * Normalize a saved loadout to exactly 8 unique known ids.
 * Missing / invalid / short arrays → fill from DEFAULT_RAIL_EMOJI_IDS.
 */
export function normalizeEquippedRailEmojiIds(raw: unknown): ReactEmojiId[] {
  const defaults = [...DEFAULT_RAIL_EMOJI_IDS] as ReactEmojiId[];
  if (!Array.isArray(raw)) return defaults;

  const out: ReactEmojiId[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string' || !isReactEmojiId(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= RAIL_SLOT_COUNT) break;
  }
  for (const id of DEFAULT_RAIL_EMOJI_IDS) {
    if (out.length >= RAIL_SLOT_COUNT) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, RAIL_SLOT_COUNT);
}

export type ReactEmojiViewer = {
  uid?: string | null;
  email?: string | null;
};

/**
 * Owned reaction ids for Settings: free pack always,
 * Mad Finger + Trash Toss + Spade Wizard + Grandma Peggy + Mad Father when Dummy/Owner,
 * plus any valid catalog ids in ownedEmojiIds (specials stripped for others).
 * Order: free pack, then DUMMY_EMOJI_IDS (if owned), then STORE_EMOJI_IDS that are owned.
 */
export function ownedReactEmojiIds(
  ownedEmojiIds?: readonly string[] | null,
  viewer?: ReactEmojiViewer | null,
): ReactEmojiId[] {
  const owned = new Set<string>(FREE_REACT_EMOJI_IDS);
  for (const id of ownedEmojiIds ?? []) {
    if (typeof id !== 'string' || !isReactEmojiId(id)) continue;
    if (isDummyReactEmojiId(id) && !canUseSpecialEmoji(id, viewer?.uid, viewer?.email)) continue;
    owned.add(id);
  }
  if (canUseMadFinger(viewer?.uid, viewer?.email)) {
    for (const id of OWNER_SHARED_EMOJI_IDS) owned.add(id);
  }
  if (isEmojiTestDummy(viewer?.uid, viewer?.email)) {
    for (const id of DUMMY_ONLY_EMOJI_IDS) owned.add(id);
  }
  const out: ReactEmojiId[] = [...FREE_REACT_EMOJI_IDS];
  const seen = new Set<string>(out);
  for (const id of DUMMY_EMOJI_IDS) {
    if (owned.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of STORE_EMOJI_IDS) {
    if (owned.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function idForReactionGlyph(glyph: string): ReactEmojiId | null {
  const normalized = glyph.trim().toLowerCase();
  for (const id of FREE_REACT_EMOJI_IDS) {
    const g = glyphForReactEmojiId(id);
    if (g === glyph) return id;
    if (g.toLowerCase() === normalized) return id;
  }
  for (const id of DUMMY_EMOJI_IDS) {
    if (DUMMY_EMOJI_GLYPH[id] === glyph) return id;
    if (DUMMY_EMOJI_GLYPH[id].toLowerCase() === normalized) return id;
  }
  for (const id of STORE_EMOJI_IDS) {
    if (STORE_EMOJI_GLYPH[id] === glyph) return id;
    if (STORE_EMOJI_GLYPH[id].toLowerCase() === normalized) return id;
  }
  // Back-compat: old clover glyph still maps to good-luck slot
  if (glyph === '\u{1F340}') return 'clover';
  return null;
}
