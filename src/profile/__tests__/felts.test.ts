import { describe, expect, it } from 'vitest';
import {
  BOARD_SKIN_TEST_EMAIL,
  BOARD_SKIN_TEST_UID,
} from '../boards';
import {
  CJ_DUMPSTER_FELT_ID,
  ZERO_FORGE_FELT_ID,
  canUseCjDumpsterFelt,
  canUseZeroForgeFelt,
  effectiveFeltId,
  effectiveOwnedFeltIds,
  normalizeFeltId,
  ownsFelt,
} from '../felts';
import { ownerEmail } from '../../tournament/isOwner';

describe('C&J Dumpster felt (Dummy auto + purchase/gift)', () => {
  it('canUseCjDumpsterFelt true only for Dummy uid/email (auto-unlock)', () => {
    expect(canUseCjDumpsterFelt(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(canUseCjDumpsterFelt(null, BOARD_SKIN_TEST_EMAIL)).toBe(true);
    expect(canUseCjDumpsterFelt(null, 'j0shwa@hotmail.com')).toBe(false);
    expect(canUseCjDumpsterFelt(null, ownerEmail())).toBe(false);
    expect(canUseCjDumpsterFelt('other', 'random@example.com')).toBe(false);
  });

  it('Dummy gets cj_dumpster felt; Owner/random without ownedFeltIds do not', () => {
    expect(effectiveOwnedFeltIds(BOARD_SKIN_TEST_UID, [])).toContain(CJ_DUMPSTER_FELT_ID);
    expect(effectiveOwnedFeltIds(null, [], BOARD_SKIN_TEST_EMAIL)).toContain(
      CJ_DUMPSTER_FELT_ID,
    );
    expect(effectiveOwnedFeltIds(null, [], 'j0shwa@hotmail.com')).not.toContain(
      CJ_DUMPSTER_FELT_ID,
    );
    expect(effectiveOwnedFeltIds('owner-uid-xyz', [], ownerEmail())).not.toContain(
      CJ_DUMPSTER_FELT_ID,
    );
    expect(effectiveOwnedFeltIds('random', [], 'random@example.com')).not.toContain(
      CJ_DUMPSTER_FELT_ID,
    );
  });

  it('purchase/gift ownedFeltIds unlocks dumpster felt for anyone (no strip)', () => {
    expect(
      effectiveOwnedFeltIds('random', [CJ_DUMPSTER_FELT_ID], 'random@example.com'),
    ).toContain(CJ_DUMPSTER_FELT_ID);
    expect(
      effectiveOwnedFeltIds('joe-uid', [CJ_DUMPSTER_FELT_ID], 'joejacobfrancis@hotmail.ca'),
    ).toContain(CJ_DUMPSTER_FELT_ID);
    const email = ownerEmail();
    expect(
      effectiveOwnedFeltIds('owner-uid-xyz', [CJ_DUMPSTER_FELT_ID], email),
    ).toContain(CJ_DUMPSTER_FELT_ID);
  });

  it('normalize/owns/effectiveFeltId can select cj_dumpster for Dummy', () => {
    expect(normalizeFeltId(CJ_DUMPSTER_FELT_ID)).toBe(CJ_DUMPSTER_FELT_ID);
    const owned = effectiveOwnedFeltIds(BOARD_SKIN_TEST_UID, []);
    expect(ownsFelt(owned, CJ_DUMPSTER_FELT_ID)).toBe(true);
    expect(
      effectiveFeltId(BOARD_SKIN_TEST_UID, CJ_DUMPSTER_FELT_ID, []),
    ).toBe(CJ_DUMPSTER_FELT_ID);
    expect(effectiveFeltId(BOARD_SKIN_TEST_UID, 'felt', [])).toBe('felt');
  });

  it('Owner without ownership cannot equip cj_dumpster; with ownedFeltIds can', () => {
    const email = ownerEmail();
    expect(
      effectiveFeltId('owner-uid-xyz', CJ_DUMPSTER_FELT_ID, [], email),
    ).toBe('felt');
    expect(
      effectiveFeltId(
        'owner-uid-xyz',
        CJ_DUMPSTER_FELT_ID,
        [CJ_DUMPSTER_FELT_ID],
        email,
      ),
    ).toBe(CJ_DUMPSTER_FELT_ID);
  });

  it('gifted/purchased user can equip cj_dumpster felt', () => {
    expect(
      effectiveFeltId('joe-uid', CJ_DUMPSTER_FELT_ID, [CJ_DUMPSTER_FELT_ID], 'joe@x.com'),
    ).toBe(CJ_DUMPSTER_FELT_ID);
    expect(effectiveFeltId('joe-uid', CJ_DUMPSTER_FELT_ID, [], 'joe@x.com')).toBe(
      'felt',
    );
  });
});

describe('Zero Forge felt (Dummy + Owner unlock)', () => {
  it('canUseZeroForgeFelt true for Dummy uid and Owner email', () => {
    expect(canUseZeroForgeFelt(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(canUseZeroForgeFelt(null, ownerEmail())).toBe(true);
    expect(canUseZeroForgeFelt('other', 'random@example.com')).toBe(false);
  });

  it('Dummy and Owner auto-own zero_forge; random does not', () => {
    const email = ownerEmail();
    expect(effectiveOwnedFeltIds(BOARD_SKIN_TEST_UID, [])).toContain(ZERO_FORGE_FELT_ID);
    expect(effectiveOwnedFeltIds('owner-uid-xyz', [], email)).toContain(ZERO_FORGE_FELT_ID);
    expect(effectiveOwnedFeltIds('random', [], 'random@example.com')).not.toContain(
      ZERO_FORGE_FELT_ID,
    );
  });

  it('normalizeFeltId keeps zero_forge when theme is registered', () => {
    expect(normalizeFeltId(ZERO_FORGE_FELT_ID)).toBe(ZERO_FORGE_FELT_ID);
    expect(normalizeFeltId('nope')).toBe('felt');
  });

  it('Dummy/Owner can equip zero_forge; random cannot without ownedFeltIds', () => {
    const email = ownerEmail();
    expect(effectiveFeltId(BOARD_SKIN_TEST_UID, ZERO_FORGE_FELT_ID, [])).toBe(
      ZERO_FORGE_FELT_ID,
    );
    expect(effectiveFeltId('owner-uid-xyz', ZERO_FORGE_FELT_ID, [], email)).toBe(
      ZERO_FORGE_FELT_ID,
    );
    expect(
      effectiveFeltId('random', ZERO_FORGE_FELT_ID, [], 'random@example.com'),
    ).toBe('felt');
    expect(
      effectiveFeltId('random', ZERO_FORGE_FELT_ID, [ZERO_FORGE_FELT_ID], 'random@example.com'),
    ).toBe(ZERO_FORGE_FELT_ID);
  });
});
