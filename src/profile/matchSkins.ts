/**
 * Match-scoped felt + board skins (cut-for-deal winner picks for that match only).
 * Does not mutate profile equip.
 */

import {
  DEFAULT_FELT_ID,
  FELT_THEMES,
  effectiveOwnedFeltIds,
  normalizeFeltId,
  ownsFelt,
  type FeltTheme,
} from './felts';
import {
  DEFAULT_BOARD_ID,
  BOARD_SKINS,
  effectiveBoardId,
  effectiveOwnedBoardIds,
  normalizeBoardId,
  ownsBoard,
  type BoardSkin,
} from './boards';

export const MATCH_SKIN_PICK_TIMEOUT_MS = 12_000;

export interface MatchSkinChoice {
  feltId: string;
  boardSkinId: string;
}

/** Felts the winner may pick (owned / free; no locked teasers). */
export function getMatchPickerFelts(
  ownedFeltIds: string[] | undefined,
  uid?: string | null,
  email?: string | null,
): FeltTheme[] {
  const owned = effectiveOwnedFeltIds(uid, ownedFeltIds, email);
  return FELT_THEMES.filter((f) => !f.locked && ownsFelt(owned, f.id));
}

/** Boards the winner may pick (owned / free / Dummy+Owner gate; no locked teasers). */
export function getMatchPickerBoards(
  uid: string | null | undefined,
  ownedBoardIds: string[] | undefined,
  email?: string | null,
): BoardSkin[] {
  const owned = effectiveOwnedBoardIds(uid, ownedBoardIds, email);
  return BOARD_SKINS.filter((b) => !b.locked && ownsBoard(owned, b.id));
}

/** Winner's currently equipped profile skins (clamped to what they may use). */
export function winnerEquippedMatchSkins(
  uid: string | null | undefined,
  settings: { theme?: string; board?: string } | null | undefined,
  ownedFeltIds: string[] | undefined,
  ownedBoardIds: string[] | undefined,
  email?: string | null,
): MatchSkinChoice {
  const ownedFelts = effectiveOwnedFeltIds(uid, ownedFeltIds, email);
  let feltId = normalizeFeltId(settings?.theme);
  if (!ownsFelt(ownedFelts, feltId)) feltId = DEFAULT_FELT_ID;
  const boardSkinId = effectiveBoardId(uid, settings?.board, ownedBoardIds, email);
  return { feltId, boardSkinId };
}

/** Default felt + board (fallback / clamp target). */
export function defaultMatchSkins(): MatchSkinChoice {
  return { feltId: DEFAULT_FELT_ID, boardSkinId: DEFAULT_BOARD_ID };
}

/** Clamp a submitted choice to owned/allowed ids. */
export function clampMatchSkinChoice(
  uid: string | null | undefined,
  choice: MatchSkinChoice,
  ownedFeltIds: string[] | undefined,
  ownedBoardIds: string[] | undefined,
  email?: string | null,
): MatchSkinChoice {
  const ownedFelts = effectiveOwnedFeltIds(uid, ownedFeltIds, email);
  let feltId = normalizeFeltId(choice.feltId);
  if (!ownsFelt(ownedFelts, feltId)) feltId = DEFAULT_FELT_ID;
  const ownedBoards = effectiveOwnedBoardIds(uid, ownedBoardIds, email);
  let boardSkinId = normalizeBoardId(choice.boardSkinId);
  if (!ownsBoard(ownedBoards, boardSkinId)) boardSkinId = DEFAULT_BOARD_ID;
  return { feltId, boardSkinId };
}

/**
 * Resolve display skins for the table.
 * - Online: pass room/local matchFeltId + matchBoardSkinId (winner pick) — paint
 *   shows even if the viewer does not own that board.
 * - vs-AI / local play: pass null match* so boardId comes from effectiveBoardId
 *   (live equipped owned board). A truthy matchBoardSkinId of "default" would
 *   otherwise freeze maple for the whole match after a stale cut snapshot.
 */
export function resolveTableSkins(args: {
  matchFeltId?: string | null;
  matchBoardSkinId?: string | null;
  uid?: string | null;
  email?: string | null;
  profileTheme?: string | null;
  profileBoard?: string | null;
  ownedBoardIds?: string[];
}): { feltId: string; boardId: string } {
  const feltId = args.matchFeltId
    ? normalizeFeltId(args.matchFeltId)
    : normalizeFeltId(args.profileTheme);

  // Match board: show winner's paint even if viewer doesn't own it.
  // Falsy matchBoardSkinId → live equipped (with retired boards clamped).
  const boardId = args.matchBoardSkinId
    ? normalizeBoardId(args.matchBoardSkinId)
    : effectiveBoardId(args.uid, args.profileBoard, args.ownedBoardIds, args.email);

  return { feltId, boardId };
}

