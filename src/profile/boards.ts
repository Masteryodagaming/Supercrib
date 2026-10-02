/** Pegboard skins (Settings → Felt & Board → Owned Boards). */

import { isOwner } from '../tournament/isOwner';

export interface BoardSkin {
  id: string;
  label: string;
  blurb: string;
  /** Settings swatch hint (CSS class suffix or freeform). */
  thumbClass?: string;
  /** Free default wood plank — always owned. */
  free?: boolean;
  /** Coming soon / not selectable yet. */
  locked?: boolean;
}

export const DEFAULT_BOARD_ID = 'default';

export const ZERO_FORGE_BOARD_ID = 'zero_forge';

/** C&J Dumpster board — Dummy auto-unlock; others via ownedBoardIds (gift/store). */
export const CJ_DUMPSTER_BOARD_ID = 'cj_dumpster';

/** Hockey Arena board — store purchase / gift via ownedBoardIds (no Dummy auto). */
export const ARENA_BOARD_ID = 'arena';

/** Polished Gold board — store purchase / gift via ownedBoardIds (no Dummy auto). */
export const GOLD_BOARD_ID = 'gold';

export const BOARD_SKINS: BoardSkin[] = [
  {
    id: DEFAULT_BOARD_ID,
    label: 'Default Board',
    blurb: 'Classic maple plank',
    free: true,
    thumbClass: 'owned-board-swatch-default',
  },
  {
    id: ZERO_FORGE_BOARD_ID,
    label: 'Zero Forge',
    blurb: 'Ice & forge metal plank',
    thumbClass: 'owned-board-swatch-zero-forge',
  },
  {
    id: CJ_DUMPSTER_BOARD_ID,
    label: 'C&J Dumpster',
    blurb: 'Neon industrial dumpster plank',
    thumbClass: 'owned-board-swatch-cj-dumpster',
  },
  {
    id: ARENA_BOARD_ID,
    label: 'Arena',
    blurb: 'Hockey rink pegboard',
    thumbClass: 'owned-board-swatch-arena',
  },
  {
    id: GOLD_BOARD_ID,
    label: 'Gold',
    blurb: 'Polished gold plank',
    thumbClass: 'owned-board-swatch-gold',
  },
];

export type BoardSkinId = string;

export function getBoardSkin(id: string | null | undefined): BoardSkin {
  return BOARD_SKINS.find((b) => b.id === id) ?? BOARD_SKINS[0];
}

export function isKnownBoardId(id: string | null | undefined): boolean {
  if (!id) return false;
  return BOARD_SKINS.some((b) => b.id === id && !b.locked);
}

/** Normalize equipped board; unknown / locked / retired → default wood. */
export function normalizeBoardId(id: string | null | undefined): string {
  if (id && isKnownBoardId(id)) return id;
  return DEFAULT_BOARD_ID;
}

export function ownsBoard(ownedBoardIds: string[] | undefined, boardId: string): boolean {
  const skin = getBoardSkin(boardId);
  if (skin.free) return true;
  if (skin.locked) return false;
  return (ownedBoardIds ?? []).includes(boardId);
}

/** Boards shown in Settings Owned Boards (owned or free; locked teasers last). */
export function getSelectableBoards(ownedBoardIds: string[] | undefined): BoardSkin[] {
  const owned = new Set(ownedBoardIds ?? []);
  return BOARD_SKINS.filter((b) => {
    if (b.locked) return true; // show as locked teaser
    if (b.free) return true;
    return owned.has(b.id);
  });
}

/** Test Dummy uid — Zero Forge board unlock while skins are in test. */
export const BOARD_SKIN_TEST_UID = 'cHYLDPXD6cSdZCtNmxv7hmg0VSI2';

/** Dummy tester email — same account as emoji Dummy (trash_toss style). */
export const BOARD_SKIN_TEST_EMAIL = 'joshuamilliea@icloud.com';

/** Dummy uid or email — never grants Dummy-only skins to Owner/others. */
export function isBoardSkinTestDummy(
  uid?: string | null,
  email?: string | null,
): boolean {
  if (uid && uid === BOARD_SKIN_TEST_UID) return true;
  const e = (email ?? '').trim().toLowerCase();
  if (e && e === BOARD_SKIN_TEST_EMAIL) return true;
  return false;
}

/** Dummy OR Master Yoda (owner) may use Zero Forge board. */
export function canUseZeroForgeBoard(
  uid?: string | null,
  email?: string | null,
): boolean {
  if (uid && uid === BOARD_SKIN_TEST_UID) return true;
  return isOwner({ uid, email });
}

/**
 * Dummy auto-unlock for C&J Dumpster board (testing).
 * Owner/Joe do NOT auto-get — gift/cloud ownedBoardIds only.
 */
export function canUseCjDumpsterBoard(
  uid?: string | null,
  email?: string | null,
): boolean {
  return isBoardSkinTestDummy(uid, email);
}

/**
 * Merge cloud ownership with Dummy/Owner test unlocks.
 * cj_dumpster: Dummy auto-add OR anyone with it in ownedBoardIds (purchase/gift).
 * arena / gold: purchase/gift via ownedBoardIds only (no Dummy auto).
 * Never strips a legitimately owned dumpster/arena/gold board for non-Dummy.
 * Maple default + Zero Forge auto-unlocks unchanged.
 */
export function effectiveOwnedBoardIds(
  uid: string | null | undefined,
  ownedBoardIds: string[] | undefined,
  email?: string | null,
): string[] {
  const ids = new Set(ownedBoardIds ?? []);
  ids.add(DEFAULT_BOARD_ID);
  if (canUseZeroForgeBoard(uid, email)) ids.add(ZERO_FORGE_BOARD_ID);
  if (canUseCjDumpsterBoard(uid, email)) ids.add(CJ_DUMPSTER_BOARD_ID);
  return [...ids];
}

/**
 * Equipped board for render.
 * Dummy/Owner ZF test defaults to Zero Forge when unset.
 * Prefer cloud settings.board when owned (incl. explicit cj_dumpster / default wood).
 */
export function effectiveBoardId(
  uid: string | null | undefined,
  board: string | null | undefined,
  ownedBoardIds: string[] | undefined,
  email?: string | null,
): string {
  const owned = effectiveOwnedBoardIds(uid, ownedBoardIds, email);
  if (canUseZeroForgeBoard(uid, email)) {
    const want = normalizeBoardId(board ?? ZERO_FORGE_BOARD_ID);
    // Prefer an explicit cloud choice when it is still owned (incl. Dumpster for Dummy).
    if (want !== DEFAULT_BOARD_ID && owned.includes(want)) return want;
    if (board === DEFAULT_BOARD_ID) return DEFAULT_BOARD_ID;
    return ZERO_FORGE_BOARD_ID;
  }
  const id = normalizeBoardId(board);
  return ownsBoard(owned, id) ? id : DEFAULT_BOARD_ID;
}
