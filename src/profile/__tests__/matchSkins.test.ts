import { describe, expect, it } from 'vitest';
import {
  clampMatchSkinChoice,
  defaultMatchSkins,
  getMatchPickerBoards,
  getMatchPickerFelts,
  resolveTableSkins,
  winnerEquippedMatchSkins,
} from '../matchSkins';
import { BOARD_SKIN_TEST_UID, CJ_DUMPSTER_BOARD_ID, ZERO_FORGE_BOARD_ID, effectiveOwnedBoardIds } from '../boards';
import { CJ_DUMPSTER_FELT_ID, ZERO_FORGE_FELT_ID, effectiveOwnedFeltIds } from '../felts';
import { ownerEmail } from '../../tournament/isOwner';

describe('matchSkins', () => {
  it('defaultMatchSkins returns base felt and board', () => {
    expect(defaultMatchSkins()).toEqual({ feltId: 'felt', boardSkinId: 'default' });
  });

  it('picker felts exclude locked teasers', () => {
    const ids = getMatchPickerFelts([]).map((f) => f.id);
    expect(ids).toContain('felt');
    expect(ids).not.toContain('classic');
    expect(ids).not.toContain(ZERO_FORGE_FELT_ID);
  });

  it('picker felts include Zero Forge when owned', () => {
    const ids = getMatchPickerFelts([ZERO_FORGE_FELT_ID]).map((f) => f.id);
    expect(ids).toContain(ZERO_FORGE_FELT_ID);
  });

  it('Dummy uid can pick Zero Forge board; others cannot', () => {
    const dummy = getMatchPickerBoards(BOARD_SKIN_TEST_UID, []).map((b) => b.id);
    expect(dummy).toContain(ZERO_FORGE_BOARD_ID);
    const other = getMatchPickerBoards('someone-else', []).map((b) => b.id);
    expect(other).not.toContain(ZERO_FORGE_BOARD_ID);
  });

  it('owner email unlocks Zero Forge board and felt', () => {
    const email = ownerEmail();
    const boards = getMatchPickerBoards('owner-uid-xyz', [], email).map((b) => b.id);
    expect(boards).toContain(ZERO_FORGE_BOARD_ID);
    const felts = getMatchPickerFelts([], 'owner-uid-xyz', email).map((f) => f.id);
    expect(felts).toContain(ZERO_FORGE_FELT_ID);
    expect(effectiveOwnedBoardIds('owner-uid-xyz', [], email)).toContain(ZERO_FORGE_BOARD_ID);
    expect(effectiveOwnedFeltIds('owner-uid-xyz', [], email)).toContain(ZERO_FORGE_FELT_ID);
  });

  it('clamps illegal choices to defaults', () => {
    expect(
      clampMatchSkinChoice(null, { feltId: 'nope', boardSkinId: ZERO_FORGE_BOARD_ID }, [], []),
    ).toEqual({ feltId: 'felt', boardSkinId: 'default' });
  });

  it('resolveTableSkins prefers match override for both seats', () => {
    const r = resolveTableSkins({
      matchFeltId: ZERO_FORGE_FELT_ID,
      matchBoardSkinId: ZERO_FORGE_BOARD_ID,
      uid: 'viewer-without-ownership',
      profileTheme: 'felt',
      profileBoard: 'default',
      ownedBoardIds: [],
    });
    // Match-scoped felt paints for viewers even without ownership.
    expect(r.feltId).toBe(ZERO_FORGE_FELT_ID);
    expect(r.boardId).toBe(ZERO_FORGE_BOARD_ID);
  });


  it('Dummy can pick C&J Dumpster board; Owner and others cannot', () => {
    const dummy = getMatchPickerBoards(BOARD_SKIN_TEST_UID, []).map((b) => b.id);
    expect(dummy).toContain(CJ_DUMPSTER_BOARD_ID);
    expect(dummy).toContain(ZERO_FORGE_BOARD_ID);
    const email = ownerEmail();
    const ownerBoards = getMatchPickerBoards('owner-uid-xyz', [], email).map((b) => b.id);
    expect(ownerBoards).toContain(ZERO_FORGE_BOARD_ID);
    expect(ownerBoards).not.toContain(CJ_DUMPSTER_BOARD_ID);
    const other = getMatchPickerBoards('someone-else', []).map((b) => b.id);
    expect(other).not.toContain(CJ_DUMPSTER_BOARD_ID);
  });


  it('Dummy gets cj_dumpster + zero_forge felts in picker; random without ownership does not', () => {
    const dummy = getMatchPickerFelts([], BOARD_SKIN_TEST_UID).map((f) => f.id);
    expect(dummy).toContain(CJ_DUMPSTER_FELT_ID);
    expect(dummy).toContain(ZERO_FORGE_FELT_ID);
    const other = getMatchPickerFelts([], 'someone-else').map((f) => f.id);
    expect(other).not.toContain(CJ_DUMPSTER_FELT_ID);
    expect(other).not.toContain(ZERO_FORGE_FELT_ID);
    expect(
      getMatchPickerFelts([CJ_DUMPSTER_FELT_ID], 'someone-else').map((f) => f.id),
    ).toContain(CJ_DUMPSTER_FELT_ID);
  });

  it('winnerEquippedMatchSkins uses profile when owned', () => {
    const w = winnerEquippedMatchSkins(
      BOARD_SKIN_TEST_UID,
      { theme: ZERO_FORGE_FELT_ID, board: ZERO_FORGE_BOARD_ID },
      [ZERO_FORGE_FELT_ID],
      [],
    );
    expect(w.feltId).toBe(ZERO_FORGE_FELT_ID);
    expect(w.boardSkinId).toBe(ZERO_FORGE_BOARD_ID);
  });

  it('Dummy Dumpster profile settings equip Dumpster board + felt', () => {
    const w = winnerEquippedMatchSkins(
      BOARD_SKIN_TEST_UID,
      { theme: 'cj_dumpster', board: CJ_DUMPSTER_BOARD_ID },
      [],
      [],
    );
    expect(w.boardSkinId).toBe(CJ_DUMPSTER_BOARD_ID);
    expect(w.feltId).toBe(CJ_DUMPSTER_FELT_ID);
  });


  it('stale matchBoardSkinId default freezes maple; null match uses live equipped', () => {
    // Documents the vs-AI bug: truthy "default" snapshot wins over profile cj_dumpster.
    const stale = resolveTableSkins({
      matchFeltId: 'cj_dumpster',
      matchBoardSkinId: 'default',
      uid: BOARD_SKIN_TEST_UID,
      profileTheme: 'cj_dumpster',
      profileBoard: CJ_DUMPSTER_BOARD_ID,
      ownedBoardIds: [],
    });
    expect(stale.feltId).toBe(CJ_DUMPSTER_FELT_ID);
    expect(stale.boardId).toBe('default');

    // Local play must pass null matchBoardSkinId so equip paints.
    const live = resolveTableSkins({
      matchFeltId: null,
      matchBoardSkinId: null,
      uid: BOARD_SKIN_TEST_UID,
      profileTheme: 'cj_dumpster',
      profileBoard: CJ_DUMPSTER_BOARD_ID,
      ownedBoardIds: [],
    });
    expect(live.feltId).toBe(CJ_DUMPSTER_FELT_ID);
    expect(live.boardId).toBe(CJ_DUMPSTER_BOARD_ID);
  });

  it('equip-during-match: null match picks up new profile board without snapshot', () => {
    const before = resolveTableSkins({
      matchBoardSkinId: null,
      uid: BOARD_SKIN_TEST_UID,
      profileBoard: ZERO_FORGE_BOARD_ID,
      ownedBoardIds: [],
    });
    expect(before.boardId).toBe(ZERO_FORGE_BOARD_ID);

    const afterEquip = resolveTableSkins({
      matchBoardSkinId: null,
      uid: BOARD_SKIN_TEST_UID,
      profileBoard: CJ_DUMPSTER_BOARD_ID,
      ownedBoardIds: [],
    });
    expect(afterEquip.boardId).toBe(CJ_DUMPSTER_BOARD_ID);
  });


});
