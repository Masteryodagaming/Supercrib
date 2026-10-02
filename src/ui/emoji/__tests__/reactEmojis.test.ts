import { describe, expect, it } from 'vitest';
import { BOARD_SKIN_TEST_UID } from '../../../profile/boards';
import {
  DEFAULT_RAIL_EMOJI_IDS,
  DUMMY_TEST_EMAIL,
  FREE_REACT_EMOJI_IDS,
  MAD_FINGER_ID,
  TRASH_TOSS_ID,
  ACE_SPADE_ID,
  GRANDMA_PEGGY_ID,
  MAD_FATHER_ID,
  RAIL_SLOT_COUNT,
  animMetaForReactEmojiId,
  artForReactEmojiId,
  canUseMadFinger,
  effectiveOwnedEmojiIds,
  glyphForReactEmojiId,
  idForReactionGlyph,
  isAnimReactEmojiId,
  isEmojiTestDummy,
  normalizeEquippedRailEmojiIds,
  ownedReactEmojiIds,
} from '../reactEmojis';
import { ownerEmail } from '../../../tournament/isOwner';

describe('normalizeEquippedRailEmojiIds', () => {
  it('falls back to defaults when missing', () => {
    expect(normalizeEquippedRailEmojiIds(undefined)).toEqual([...DEFAULT_RAIL_EMOJI_IDS]);
    expect(normalizeEquippedRailEmojiIds(null)).toEqual([...DEFAULT_RAIL_EMOJI_IDS]);
    expect(normalizeEquippedRailEmojiIds([])).toEqual([...DEFAULT_RAIL_EMOJI_IDS]);
  });

  it('keeps unique valid order and pads to slot count', () => {
    const next = normalizeEquippedRailEmojiIds(['skunk', 'laugh', 'bogus', 'laugh', 'peg']);
    expect(next).toHaveLength(RAIL_SLOT_COUNT);
    expect(next[0]).toBe('skunk');
    expect(next[1]).toBe('laugh');
    expect(next[2]).toBe('peg');
    expect(new Set(next).size).toBe(RAIL_SLOT_COUNT);
  });

  it('accepts mad_finger on the rail when present', () => {
    const next = normalizeEquippedRailEmojiIds([MAD_FINGER_ID, 'laugh', 'cry', 'angry', 'skunk', 'facepalm']);
    expect(next[0]).toBe(MAD_FINGER_ID);
    expect(next).toHaveLength(RAIL_SLOT_COUNT);
  });
});

describe('ownedReactEmojiIds', () => {
  it('always includes free defaults (incl. good luck)', () => {
    const owned = ownedReactEmojiIds([]);
    expect(owned).toEqual([...FREE_REACT_EMOJI_IDS]);
    expect(owned).not.toContain(MAD_FINGER_ID);
  });

  it('appends owned store ids', () => {
    const owned = ownedReactEmojiIds(['peg', 'emoji_sparkle', 'flame_peg']);
    expect(owned).toContain('peg');
    expect(owned).toContain('flame_peg');
    expect(owned).not.toContain('emoji_sparkle');
    expect(owned).not.toContain(MAD_FINGER_ID);
  });

  it('grants Mad Finger to Dummy and Owner; strips for random users', () => {
    expect(ownedReactEmojiIds([], { uid: BOARD_SKIN_TEST_UID })).toContain(MAD_FINGER_ID);
    expect(
      ownedReactEmojiIds([], { email: DUMMY_TEST_EMAIL }),
    ).toContain(MAD_FINGER_ID);
    expect(
      ownedReactEmojiIds([], { email: ownerEmail() || 'j0shwa@hotmail.com' }),
    ).toContain(MAD_FINGER_ID);
    expect(ownedReactEmojiIds([MAD_FINGER_ID], { uid: 'other-uid' })).not.toContain(
      MAD_FINGER_ID,
    );
    expect(
      ownedReactEmojiIds([MAD_FINGER_ID], { email: 'random@example.com' }),
    ).not.toContain(MAD_FINGER_ID);
  });

  it('grants Trash Toss to Dummy and Owner; strips for random users', () => {
    expect(ownedReactEmojiIds([], { uid: BOARD_SKIN_TEST_UID })).toContain(TRASH_TOSS_ID);
    expect(ownedReactEmojiIds([], { email: DUMMY_TEST_EMAIL })).toContain(TRASH_TOSS_ID);
    expect(
      ownedReactEmojiIds([], { email: ownerEmail() || 'j0shwa@hotmail.com' }),
    ).toContain(TRASH_TOSS_ID);
    expect(ownedReactEmojiIds([TRASH_TOSS_ID], { uid: 'other-uid' })).not.toContain(
      TRASH_TOSS_ID,
    );
    expect(
      ownedReactEmojiIds([TRASH_TOSS_ID], { email: 'random@example.com' }),
    ).not.toContain(TRASH_TOSS_ID);
  });

  it('grants Spade Wizard to Dummy and Owner; strips for random users', () => {
    expect(ownedReactEmojiIds([], { uid: BOARD_SKIN_TEST_UID })).toContain(ACE_SPADE_ID);
    expect(ownedReactEmojiIds([], { email: DUMMY_TEST_EMAIL })).toContain(ACE_SPADE_ID);
    expect(
      ownedReactEmojiIds([], { email: ownerEmail() || 'j0shwa@hotmail.com' }),
    ).toContain(ACE_SPADE_ID);
    expect(ownedReactEmojiIds([ACE_SPADE_ID], { uid: 'other-uid' })).not.toContain(
      ACE_SPADE_ID,
    );
    expect(
      ownedReactEmojiIds([ACE_SPADE_ID], { email: 'random@example.com' }),
    ).not.toContain(ACE_SPADE_ID);
  });

  it('grants Grandma Peggy to Dummy and Owner; strips for random users', () => {
    expect(ownedReactEmojiIds([], { uid: BOARD_SKIN_TEST_UID })).toContain(GRANDMA_PEGGY_ID);
    expect(ownedReactEmojiIds([], { email: DUMMY_TEST_EMAIL })).toContain(GRANDMA_PEGGY_ID);
    expect(
      ownedReactEmojiIds([], { email: ownerEmail() || 'j0shwa@hotmail.com' }),
    ).toContain(GRANDMA_PEGGY_ID);
    expect(ownedReactEmojiIds([GRANDMA_PEGGY_ID], { uid: 'other-uid' })).not.toContain(
      GRANDMA_PEGGY_ID,
    );
    expect(
      ownedReactEmojiIds([GRANDMA_PEGGY_ID], { email: 'random@example.com' }),
    ).not.toContain(GRANDMA_PEGGY_ID);
  });

  it('grants Mad Father to Dummy and Owner; strips for random users', () => {
    expect(ownedReactEmojiIds([], { uid: BOARD_SKIN_TEST_UID })).toContain(MAD_FATHER_ID);
    expect(ownedReactEmojiIds([], { email: DUMMY_TEST_EMAIL })).toContain(MAD_FATHER_ID);
    expect(
      ownedReactEmojiIds([], { email: ownerEmail() || 'j0shwa@hotmail.com' }),
    ).toContain(MAD_FATHER_ID);
    expect(ownedReactEmojiIds([MAD_FATHER_ID], { uid: 'other-uid' })).not.toContain(
      MAD_FATHER_ID,
    );
    expect(
      ownedReactEmojiIds([MAD_FATHER_ID], { email: 'random@example.com' }),
    ).not.toContain(MAD_FATHER_ID);
  });
});

describe('Dummy / Owner emoji gate', () => {
  it('matches Zero Forge test uid and Dummy email', () => {
    expect(isEmojiTestDummy(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(isEmojiTestDummy(null, DUMMY_TEST_EMAIL)).toBe(true);
    expect(isEmojiTestDummy('nope', 'someone@else.com')).toBe(false);
  });

  it('canUseMadFinger allows Dummy and Owner email', () => {
    expect(canUseMadFinger(BOARD_SKIN_TEST_UID, null)).toBe(true);
    expect(canUseMadFinger(null, DUMMY_TEST_EMAIL)).toBe(true);
    expect(canUseMadFinger(null, 'j0shwa@hotmail.com')).toBe(true);
    expect(canUseMadFinger(null, ownerEmail())).toBe(true);
    expect(canUseMadFinger('other', 'random@example.com')).toBe(false);
  });

  it('effectiveOwnedEmojiIds injects mad_finger for Dummy and Owner; strips others', () => {
    expect(effectiveOwnedEmojiIds(BOARD_SKIN_TEST_UID, null, [])).toContain(MAD_FINGER_ID);
    expect(effectiveOwnedEmojiIds(null, 'j0shwa@hotmail.com', [])).toContain(MAD_FINGER_ID);
    expect(effectiveOwnedEmojiIds('other', null, [MAD_FINGER_ID])).not.toContain(MAD_FINGER_ID);
    expect(
      effectiveOwnedEmojiIds('other', 'random@example.com', [MAD_FINGER_ID]),
    ).not.toContain(MAD_FINGER_ID);
  });

  it('effectiveOwnedEmojiIds injects trash_toss for Dummy and Owner; strips others', () => {
    expect(effectiveOwnedEmojiIds(BOARD_SKIN_TEST_UID, null, [])).toContain(TRASH_TOSS_ID);
    expect(effectiveOwnedEmojiIds(null, DUMMY_TEST_EMAIL, [])).toContain(TRASH_TOSS_ID);
    expect(effectiveOwnedEmojiIds(null, 'j0shwa@hotmail.com', [])).toContain(TRASH_TOSS_ID);
    expect(effectiveOwnedEmojiIds('other', null, [TRASH_TOSS_ID])).not.toContain(TRASH_TOSS_ID);
    expect(
      effectiveOwnedEmojiIds('other', 'random@example.com', [TRASH_TOSS_ID]),
    ).not.toContain(TRASH_TOSS_ID);
  });

  it('effectiveOwnedEmojiIds injects ace_spade for Dummy and Owner; strips others', () => {
    expect(effectiveOwnedEmojiIds(BOARD_SKIN_TEST_UID, null, [])).toContain(ACE_SPADE_ID);
    expect(effectiveOwnedEmojiIds(null, DUMMY_TEST_EMAIL, [])).toContain(ACE_SPADE_ID);
    expect(effectiveOwnedEmojiIds(null, 'j0shwa@hotmail.com', [])).toContain(ACE_SPADE_ID);
    expect(effectiveOwnedEmojiIds('other', null, [ACE_SPADE_ID])).not.toContain(ACE_SPADE_ID);
    expect(
      effectiveOwnedEmojiIds('other', 'random@example.com', [ACE_SPADE_ID]),
    ).not.toContain(ACE_SPADE_ID);
  });

  it('effectiveOwnedEmojiIds injects grandma_peggy for Dummy and Owner; strips others', () => {
    expect(effectiveOwnedEmojiIds(BOARD_SKIN_TEST_UID, null, [])).toContain(GRANDMA_PEGGY_ID);
    expect(effectiveOwnedEmojiIds(null, DUMMY_TEST_EMAIL, [])).toContain(GRANDMA_PEGGY_ID);
    expect(effectiveOwnedEmojiIds(null, 'j0shwa@hotmail.com', [])).toContain(GRANDMA_PEGGY_ID);
    expect(effectiveOwnedEmojiIds('other', null, [GRANDMA_PEGGY_ID])).not.toContain(GRANDMA_PEGGY_ID);
    expect(
      effectiveOwnedEmojiIds('other', 'random@example.com', [GRANDMA_PEGGY_ID]),
    ).not.toContain(GRANDMA_PEGGY_ID);
  });

  it('effectiveOwnedEmojiIds injects mad_father for Dummy and Owner; strips others', () => {
    expect(effectiveOwnedEmojiIds(BOARD_SKIN_TEST_UID, null, [])).toContain(MAD_FATHER_ID);
    expect(effectiveOwnedEmojiIds(null, DUMMY_TEST_EMAIL, [])).toContain(MAD_FATHER_ID);
    expect(effectiveOwnedEmojiIds(null, 'j0shwa@hotmail.com', [])).toContain(MAD_FATHER_ID);
    expect(effectiveOwnedEmojiIds('other', null, [MAD_FATHER_ID])).not.toContain(MAD_FATHER_ID);
    expect(
      effectiveOwnedEmojiIds('other', 'random@example.com', [MAD_FATHER_ID]),
    ).not.toContain(MAD_FATHER_ID);
  });
});

describe('mad_finger art + anim', () => {
  it('has art, hold→peak→smirk clip (ends on smirk), and glyph round-trip', () => {
    expect(artForReactEmojiId(MAD_FINGER_ID)).toContain('/reactions/mad_finger.png');
    expect(isAnimReactEmojiId(MAD_FINGER_ID)).toBe(true);
    const meta = animMetaForReactEmojiId(MAD_FINGER_ID);
    expect(meta?.durationMs).toBe(1100);
    expect(meta?.frames).toHaveLength(3);
    // f0===f1 duplicate dropped: sequence f1 → f2 → f3 (end on smirk)
    expect(meta?.frames[0]).toContain('/reactions/anim/mad_finger/f1.png');
    expect(meta?.frames[1]).toContain('/reactions/anim/mad_finger/f2.png');
    expect(meta?.frames[2]).toContain('/reactions/anim/mad_finger/f3.png');
    expect(meta?.frameDurationsMs).toEqual([150, 400, 550]);
    expect(idForReactionGlyph(glyphForReactEmojiId(MAD_FINGER_ID))).toBe(MAD_FINGER_ID);
    expect(idForReactionGlyph('mad finger')).toBe(MAD_FINGER_ID);
  });
});

describe('trash_toss art + anim', () => {
  it('has art, crouch→mid→peak→follow clip (ends on f4 settle), and glyph round-trip', () => {
    expect(artForReactEmojiId(TRASH_TOSS_ID)).toContain('/reactions/trash_toss.png');
    expect(isAnimReactEmojiId(TRASH_TOSS_ID)).toBe(true);
    const meta = animMetaForReactEmojiId(TRASH_TOSS_ID);
    expect(meta?.durationMs).toBe(1710);
    expect(meta?.frames).toHaveLength(4);
    expect(meta?.frames[0]).toContain('/reactions/anim/trash_toss/f1.png');
    expect(meta?.frames[1]).toContain('/reactions/anim/trash_toss/f2.png');
    expect(meta?.frames[2]).toContain('/reactions/anim/trash_toss/f3.png');
    expect(meta?.frames[3]).toContain('/reactions/anim/trash_toss/f4.png');
    expect(meta?.frameDurationsMs).toEqual([180, 280, 500, 750]);
    expect(idForReactionGlyph(glyphForReactEmojiId(TRASH_TOSS_ID))).toBe(TRASH_TOSS_ID);
    expect(idForReactionGlyph('trash toss')).toBe(TRASH_TOSS_ID);
  });
});

describe('spade wizard (ace_spade) art + anim', () => {
  it('has art, hands→cloud→ace→laugh clip (hold f4 ~1250ms), and glyph round-trip', () => {
    expect(artForReactEmojiId(ACE_SPADE_ID)).toContain('/reactions/ace_spade.png');
    expect(isAnimReactEmojiId(ACE_SPADE_ID)).toBe(true);
    const meta = animMetaForReactEmojiId(ACE_SPADE_ID);
    expect(meta?.durationMs).toBe(2100);
    expect(meta?.frames).toHaveLength(4);
    expect(meta?.frames[0]).toContain('/reactions/anim/ace_spade/f1.png');
    expect(meta?.frames[1]).toContain('/reactions/anim/ace_spade/f2.png');
    expect(meta?.frames[2]).toContain('/reactions/anim/ace_spade/f3.png');
    expect(meta?.frames[3]).toContain('/reactions/anim/ace_spade/f4.png');
    expect(meta?.frameDurationsMs).toEqual([225, 275, 350, 1250]);
    expect(meta?.frameDurationsMs?.[3]).toBe(1250);
    expect(idForReactionGlyph(glyphForReactEmojiId(ACE_SPADE_ID))).toBe(ACE_SPADE_ID);
    expect(idForReactionGlyph('spade wizard')).toBe(ACE_SPADE_ID);
  });
});

describe('grandma peggy (grandma_peggy) art + anim', () => {
  it('has art, peg→board→wrist→laugh clip (hold f4 ~1250ms, same as Spade Wizard), and glyph round-trip', () => {
    expect(artForReactEmojiId(GRANDMA_PEGGY_ID)).toContain('/reactions/grandma_peggy.png');
    expect(isAnimReactEmojiId(GRANDMA_PEGGY_ID)).toBe(true);
    const meta = animMetaForReactEmojiId(GRANDMA_PEGGY_ID);
    expect(meta?.durationMs).toBe(2100);
    expect(meta?.frames).toHaveLength(4);
    expect(meta?.frames[0]).toContain('/reactions/anim/grandma_peggy/f1.png');
    expect(meta?.frames[1]).toContain('/reactions/anim/grandma_peggy/f2.png');
    expect(meta?.frames[2]).toContain('/reactions/anim/grandma_peggy/f3.png');
    expect(meta?.frames[3]).toContain('/reactions/anim/grandma_peggy/f4.png');
    expect(meta?.frameDurationsMs).toEqual([225, 275, 350, 1250]);
    expect(meta?.frameDurationsMs?.[3]).toBe(1250);
    expect(idForReactionGlyph(glyphForReactEmojiId(GRANDMA_PEGGY_ID))).toBe(GRANDMA_PEGGY_ID);
    expect(idForReactionGlyph('grandma peggy')).toBe(GRANDMA_PEGGY_ID);
  });
});

describe('mad father (mad_father) art + anim', () => {
  it('has art, calm→shock→mad→steam clip (hold f4 ~1250ms, same as Spade Wizard), and glyph round-trip', () => {
    expect(artForReactEmojiId(MAD_FATHER_ID)).toContain('/reactions/mad_father.png');
    expect(isAnimReactEmojiId(MAD_FATHER_ID)).toBe(true);
    const meta = animMetaForReactEmojiId(MAD_FATHER_ID);
    expect(meta?.durationMs).toBe(2100);
    expect(meta?.frames).toHaveLength(4);
    expect(meta?.frames[0]).toContain('/reactions/anim/mad_father/f1.png');
    expect(meta?.frames[1]).toContain('/reactions/anim/mad_father/f2.png');
    expect(meta?.frames[2]).toContain('/reactions/anim/mad_father/f3.png');
    expect(meta?.frames[3]).toContain('/reactions/anim/mad_father/f4.png');
    expect(meta?.frameDurationsMs).toEqual([225, 275, 350, 1250]);
    expect(meta?.frameDurationsMs?.[3]).toBe(1250);
    expect(idForReactionGlyph(glyphForReactEmojiId(MAD_FATHER_ID))).toBe(MAD_FATHER_ID);
    expect(idForReactionGlyph('mad father')).toBe(MAD_FATHER_ID);
  });
});

describe('glyph round-trip', () => {
  it('resolves default and store glyphs', () => {
    expect(idForReactionGlyph(glyphForReactEmojiId('laugh'))).toBe('laugh');
    expect(idForReactionGlyph(glyphForReactEmojiId('peg'))).toBe('peg');
    expect(idForReactionGlyph('good luck')).toBe('clover');
  });
});

describe('8-slot rail defaults', () => {
  it('exposes 8 default slots (4+4) including free go stub', () => {
    expect(RAIL_SLOT_COUNT).toBe(8);
    expect(DEFAULT_RAIL_EMOJI_IDS).toHaveLength(8);
    expect(DEFAULT_RAIL_EMOJI_IDS[6]).toBe('clover');
    expect(DEFAULT_RAIL_EMOJI_IDS[7]).toBe('go');
    expect(normalizeEquippedRailEmojiIds(['laugh', 'cry'])).toHaveLength(8);
  });
});
