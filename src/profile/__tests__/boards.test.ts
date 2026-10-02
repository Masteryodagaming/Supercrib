import { describe, expect, it } from 'vitest';
import {
  ARENA_BOARD_ID,
  GOLD_BOARD_ID,
  BOARD_SKIN_TEST_EMAIL,
  BOARD_SKIN_TEST_UID,
  CJ_DUMPSTER_BOARD_ID,
  ZERO_FORGE_BOARD_ID,
  canUseCjDumpsterBoard,
  canUseZeroForgeBoard,
  effectiveBoardId,
  effectiveOwnedBoardIds,
  getSelectableBoards,
  normalizeBoardId,
  ownsBoard,
} from '../boards';
import { ownerEmail } from '../../tournament/isOwner';

describe('C&J Dumpster board (Dummy auto + ownedBoardIds gift)', () => {
  it('allows Dummy uid/email auto-unlock; Owner and random stay locked without ownedBoardIds', () => {
    expect(canUseCjDumpsterBoard(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(canUseCjDumpsterBoard(null, BOARD_SKIN_TEST_EMAIL)).toBe(true);
    expect(canUseCjDumpsterBoard(null, ownerEmail())).toBe(false);
    expect(canUseCjDumpsterBoard('other', 'random@example.com')).toBe(false);
  });

  it('auto-adds Dumpster for Dummy while preserving Zero Forge', () => {
    const owned = effectiveOwnedBoardIds(
      BOARD_SKIN_TEST_UID,
      [],
      BOARD_SKIN_TEST_EMAIL,
    );
    expect(owned).toContain('default');
    expect(owned).toContain(ZERO_FORGE_BOARD_ID);
    expect(owned).toContain(CJ_DUMPSTER_BOARD_ID);
    expect(ownsBoard(owned, CJ_DUMPSTER_BOARD_ID)).toBe(true);
  });

  it('keeps Dumpster ownership from cloud for non-Dummy (Owner/Joe gift path)', () => {
    const ownerOwned = effectiveOwnedBoardIds(
      'owner-uid-xyz',
      [CJ_DUMPSTER_BOARD_ID],
      ownerEmail(),
    );
    expect(ownerOwned).toContain(ZERO_FORGE_BOARD_ID);
    expect(ownerOwned).toContain(CJ_DUMPSTER_BOARD_ID);

    const joeOwned = effectiveOwnedBoardIds(
      '1b99N2vTZgfWC6xBCOlCp5OJDSa2',
      [CJ_DUMPSTER_BOARD_ID],
      'joe@example.com',
    );
    expect(joeOwned).toContain(CJ_DUMPSTER_BOARD_ID);

    const randomOwned = effectiveOwnedBoardIds('someone-else', [CJ_DUMPSTER_BOARD_ID]);
    expect(randomOwned).toContain(CJ_DUMPSTER_BOARD_ID);
  });

  it('does not auto-add Dumpster for Owner/Joe without ownedBoardIds', () => {
    expect(
      effectiveOwnedBoardIds('owner-uid-xyz', [], ownerEmail()),
    ).not.toContain(CJ_DUMPSTER_BOARD_ID);
    expect(
      effectiveOwnedBoardIds('1b99N2vTZgfWC6xBCOlCp5OJDSa2', [], 'joe@x.com'),
    ).not.toContain(CJ_DUMPSTER_BOARD_ID);
  });

  it('shows Dumpster as selectable (not locked) when owned', () => {
    const dumpster = getSelectableBoards([CJ_DUMPSTER_BOARD_ID]).find(
      (board) => board.id === CJ_DUMPSTER_BOARD_ID,
    );
    expect(dumpster?.locked).toBeFalsy();
    expect(dumpster?.blurb).not.toMatch(/unavailable/i);
  });

  it('Dummy can normalize/equip Dumpster; gifted Owner/Joe can equip; ungifted cannot', () => {
    expect(normalizeBoardId(CJ_DUMPSTER_BOARD_ID)).toBe(CJ_DUMPSTER_BOARD_ID);
    expect(effectiveBoardId(BOARD_SKIN_TEST_UID, CJ_DUMPSTER_BOARD_ID, [])).toBe(
      CJ_DUMPSTER_BOARD_ID,
    );
    expect(
      effectiveBoardId(
        'owner-uid-xyz',
        CJ_DUMPSTER_BOARD_ID,
        [CJ_DUMPSTER_BOARD_ID],
        ownerEmail(),
      ),
    ).toBe(CJ_DUMPSTER_BOARD_ID);
    expect(
      effectiveBoardId('random', CJ_DUMPSTER_BOARD_ID, [CJ_DUMPSTER_BOARD_ID]),
    ).toBe(CJ_DUMPSTER_BOARD_ID);
    // Without ownedBoardIds, Owner falls back to Zero Forge default; random to maple.
    expect(
      effectiveBoardId('owner-uid-xyz', CJ_DUMPSTER_BOARD_ID, [], ownerEmail()),
    ).toBe(ZERO_FORGE_BOARD_ID);
    expect(effectiveBoardId('random', CJ_DUMPSTER_BOARD_ID, [])).toBe('default');
  });

  it('keeps explicit Zero Forge for Dummy and Owner', () => {
    expect(canUseZeroForgeBoard(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(effectiveBoardId(BOARD_SKIN_TEST_UID, ZERO_FORGE_BOARD_ID, [])).toBe(ZERO_FORGE_BOARD_ID);
    expect(effectiveBoardId('owner-uid-xyz', ZERO_FORGE_BOARD_ID, [], ownerEmail())).toBe(
      ZERO_FORGE_BOARD_ID,
    );
  });
});

describe('Arena board (store/gift ownedBoardIds only)', () => {
  it('does not auto-add Arena for Dummy/Owner without ownedBoardIds', () => {
    expect(
      effectiveOwnedBoardIds(BOARD_SKIN_TEST_UID, [], BOARD_SKIN_TEST_EMAIL),
    ).not.toContain(ARENA_BOARD_ID);
    expect(
      effectiveOwnedBoardIds('owner-uid-xyz', [], ownerEmail()),
    ).not.toContain(ARENA_BOARD_ID);
  });

  it('keeps Arena ownership from cloud for anyone (Yoda gift / store buy)', () => {
    const yodaOwned = effectiveOwnedBoardIds(
      'CphdDQWSDQbCf58rAMpo78wtFFm2',
      [ARENA_BOARD_ID],
      ownerEmail(),
    );
    expect(yodaOwned).toContain(ARENA_BOARD_ID);
    expect(ownsBoard(yodaOwned, ARENA_BOARD_ID)).toBe(true);
  });

  it('shows Arena as selectable when owned; equip works', () => {
    const skin = getSelectableBoards([ARENA_BOARD_ID]).find((b) => b.id === ARENA_BOARD_ID);
    expect(skin?.label).toBe('Arena');
    expect(skin?.locked).toBeFalsy();
    expect(normalizeBoardId(ARENA_BOARD_ID)).toBe(ARENA_BOARD_ID);
    expect(
      effectiveBoardId('CphdDQWSDQbCf58rAMpo78wtFFm2', ARENA_BOARD_ID, [ARENA_BOARD_ID], ownerEmail()),
    ).toBe(ARENA_BOARD_ID);
    expect(effectiveBoardId('random', ARENA_BOARD_ID, [])).toBe('default');
  });
});

describe('Gold board (store/gift ownedBoardIds only)', () => {
  it('does not auto-add Gold for Dummy/Owner without ownedBoardIds', () => {
    expect(
      effectiveOwnedBoardIds(BOARD_SKIN_TEST_UID, [], BOARD_SKIN_TEST_EMAIL),
    ).not.toContain(GOLD_BOARD_ID);
    expect(
      effectiveOwnedBoardIds('owner-uid-xyz', [], ownerEmail()),
    ).not.toContain(GOLD_BOARD_ID);
  });

  it('keeps Gold ownership from cloud for anyone (Yoda gift / store buy)', () => {
    const yodaOwned = effectiveOwnedBoardIds(
      'CphdDQWSDQbCf58rAMpo78wtFFm2',
      [GOLD_BOARD_ID],
      ownerEmail(),
    );
    expect(yodaOwned).toContain(GOLD_BOARD_ID);
    expect(ownsBoard(yodaOwned, GOLD_BOARD_ID)).toBe(true);
  });

  it('shows Gold as selectable when owned; equip works', () => {
    const skin = getSelectableBoards([GOLD_BOARD_ID]).find((b) => b.id === GOLD_BOARD_ID);
    expect(skin?.label).toBe('Gold');
    expect(skin?.blurb).toMatch(/gold/i);
    expect(skin?.locked).toBeFalsy();
    expect(normalizeBoardId(GOLD_BOARD_ID)).toBe(GOLD_BOARD_ID);
    expect(
      effectiveBoardId('CphdDQWSDQbCf58rAMpo78wtFFm2', GOLD_BOARD_ID, [GOLD_BOARD_ID], ownerEmail()),
    ).toBe(GOLD_BOARD_ID);
    expect(effectiveBoardId('random', GOLD_BOARD_ID, [])).toBe('default');
  });
});
