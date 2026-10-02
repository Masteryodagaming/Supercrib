/** Table felt / cloth themes (Settings → Felt & Board). */

import { BOARD_SKIN_TEST_UID, isBoardSkinTestDummy } from './boards';
import { isOwner } from '../tournament/isOwner';

export interface FeltTheme {
  id: string;
  label: string;
  blurb: string;
  /** Full-bleed table background (public path). */
  imageSrc?: string;
  /** Settings swatch (optional; falls back to imageSrc). */
  thumbSrc?: string;
  /** Free default green felt — always owned. */
  free?: boolean;
  /** Coming soon / not selectable yet. */
  locked?: boolean;
}

export const DEFAULT_FELT_ID = 'felt';

export const ZERO_FORGE_FELT_ID = 'zero_forge';

/** C&J Dumpster felt — Dummy auto-unlock; purchase/gift via ownedFeltIds. */
export const CJ_DUMPSTER_FELT_ID = 'cj_dumpster';

export const FELT_THEMES: FeltTheme[] = [
  {
    id: DEFAULT_FELT_ID,
    label: 'Classic Felt',
    blurb: 'Default green table',
    free: true,
  },
  {
    id: ZERO_FORGE_FELT_ID,
    label: 'Zero Forge',
    blurb: 'Ice-forged metal rails & dark cloth',
    imageSrc: '/felts/zero-forge.jpg?v=8',
    thumbSrc: '/felts/zero-forge-thumb.jpg?v=8',
  },
  {
    id: CJ_DUMPSTER_FELT_ID,
    label: 'C&J Dumpster',
    blurb: 'Industrial dumpster cloth',
    imageSrc: '/felts/cj-dumpster.jpg?v=7',
    thumbSrc: '/felts/cj-dumpster-thumb.jpg?v=7',
  },
];

export type FeltThemeId = string;

export function getFeltTheme(id: string | null | undefined): FeltTheme {
  return FELT_THEMES.find((f) => f.id === id) ?? FELT_THEMES[0];
}

export function isKnownFeltId(id: string | null | undefined): boolean {
  if (!id) return false;
  return FELT_THEMES.some((f) => f.id === id && !f.locked);
}

/** Normalize equipped felt; unknown / locked → default green. */
export function normalizeFeltId(id: string | null | undefined): string {
  // Only remap zero_forge if it is missing from selectable themes.
  if (id === ZERO_FORGE_FELT_ID && !isKnownFeltId(ZERO_FORGE_FELT_ID)) {
    return DEFAULT_FELT_ID;
  }
  if (id && isKnownFeltId(id)) return id;
  return DEFAULT_FELT_ID;
}

export function ownsFelt(ownedFeltIds: string[] | undefined, feltId: string): boolean {
  const theme = getFeltTheme(feltId);
  if (theme.free) return true;
  if (theme.locked) return false;
  return (ownedFeltIds ?? []).includes(feltId);
}

/** Felts shown in Settings Owned Felts (free or owned only — no locked teasers). */
export function getSelectableFelts(ownedFeltIds: string[] | undefined): FeltTheme[] {
  const owned = new Set(ownedFeltIds ?? []);
  return FELT_THEMES.filter((f) => {
    if (f.locked) return false;
    if (f.free) return true;
    return owned.has(f.id);
  });
}

/** Zero Forge felt — Dummy + Owner unlock (re-enabled). */
export function canUseZeroForgeFelt(
  uid?: string | null,
  email?: string | null,
): boolean {
  if (uid && uid === BOARD_SKIN_TEST_UID) return true;
  return isOwner({ uid, email });
}

/**
 * C&J Dumpster felt Dummy auto-unlock (testing only).
 * Owner does NOT auto-get — buy/gift/cloud ownedFeltIds only.
 */
export function canUseCjDumpsterFelt(
  uid?: string | null,
  email?: string | null,
): boolean {
  return isBoardSkinTestDummy(uid, email);
}

/**
 * Merge cloud ownership with Dummy/Owner test unlocks.
 * zero_forge: Dummy + Owner auto-add.
 * cj_dumpster: Dummy auto-add OR anyone with it in ownedFeltIds (purchase/gift).
 * Never strips a legitimately owned dumpster felt for non-Dummy.
 */
export function effectiveOwnedFeltIds(
  uid: string | null | undefined,
  ownedFeltIds: string[] | undefined,
  email?: string | null,
): string[] {
  const ids = new Set(ownedFeltIds ?? []);
  ids.add(DEFAULT_FELT_ID);
  if (canUseZeroForgeFelt(uid, email)) ids.add(ZERO_FORGE_FELT_ID);
  if (canUseCjDumpsterFelt(uid, email)) ids.add(CJ_DUMPSTER_FELT_ID);
  return [...ids];
}

/** Equipped felt; falls back to default when not owned. */
export function effectiveFeltId(
  uid: string | null | undefined,
  theme: string | null | undefined,
  ownedFeltIds: string[] | undefined,
  email?: string | null,
): string {
  const owned = effectiveOwnedFeltIds(uid, ownedFeltIds, email);
  const id = normalizeFeltId(theme);
  return ownsFelt(owned, id) ? id : DEFAULT_FELT_ID;
}
