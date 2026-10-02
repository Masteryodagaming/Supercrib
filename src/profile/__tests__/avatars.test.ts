import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AVATARS,
  CRIB_MASTER_ID,
  DEFAULT_BUILTIN_AVATAR_IDS,
  MASTER_YODA_ID,
  SUPERCRIB_FATHER_ID,
  getBuiltinAvatar,
  getExclusiveGiftAvatar,
  getSelectableAvatars,
  isDefaultBuiltinAvatar,
  migrateMasterYodaSelection,
  OWNER_ONLY_AVATAR_IDS,
  splitSelectableAvatars,
} from '../avatars';
import { SUPER_COIN_SHOP, STORE_TEASER_AVATARS, getShopAvatarItem } from '../coins';

describe('Crib Master owner-only avatar', () => {
  it('replaces Master Yoda in builtins with Crib Master', () => {
    expect(BUILTIN_AVATARS.some((a) => a.id === MASTER_YODA_ID)).toBe(false);
    const crib = BUILTIN_AVATARS.find((a) => a.id === CRIB_MASTER_ID);
    expect(crib?.label).toBe('Crib Master');
    expect(crib?.imageSrc).toContain('/avatars/crib-master.png');
    expect(OWNER_ONLY_AVATAR_IDS.has(CRIB_MASTER_ID)).toBe(true);
  });

  it('excludes Crib Master from selectable list unless owner', () => {
    const free = getSelectableAvatars([], []);
    expect(free.some((a) => a.id === CRIB_MASTER_ID)).toBe(false);
    expect(free.some((a) => a.id === MASTER_YODA_ID)).toBe(false);

    const ownerList = getSelectableAvatars([], [], { owner: true });
    expect(ownerList.some((a) => a.id === CRIB_MASTER_ID)).toBe(true);
  });

  it('maps legacy master_yoda id to Crib Master art', () => {
    const builtin = getBuiltinAvatar(MASTER_YODA_ID);
    expect(builtin.id).toBe(CRIB_MASTER_ID);
    expect(builtin.imageSrc).toContain('crib-master.png');
  });

  it('migrates owner legacy yoda to crib_master; keeps peg when clearing orphan dataUrl', () => {
    const fromId = migrateMasterYodaSelection(
      { avatarId: MASTER_YODA_ID, avatarDataUrl: null },
      { owner: true },
    );
    expect(fromId).toEqual({ avatarId: CRIB_MASTER_ID, avatarDataUrl: null });

    const fromData = migrateMasterYodaSelection(
      { avatarId: 'peg', avatarDataUrl: 'data:image/png;base64,xx' },
      { owner: true },
    );
    expect(fromData).toEqual({ avatarId: 'peg', avatarDataUrl: null });
  });

  it('strips signature avatars for confirmed non-owners', () => {
    const stripped = migrateMasterYodaSelection(
      { avatarId: CRIB_MASTER_ID, avatarDataUrl: null },
      { owner: false },
    );
    expect(stripped.avatarId).toBe('peg');
  });
});

describe('default builtin 3D avatars', () => {
  it('wires PNG imageSrc for peg through felt', () => {
    for (const id of DEFAULT_BUILTIN_AVATAR_IDS) {
      const a = BUILTIN_AVATARS.find((x) => x.id === id);
      expect(a?.imageSrc).toBe(`/avatars/defaults/${id}.png?v=1`);
      expect(isDefaultBuiltinAvatar(id)).toBe(true);
    }
    expect(isDefaultBuiltinAvatar(CRIB_MASTER_ID)).toBe(false);
  });

  it('splits signature specials from free defaults', () => {
    const ownerList = getSelectableAvatars([], [], { owner: true });
    const { signature, defaults } = splitSelectableAvatars(ownerList);
    expect(signature.some((a) => a.id === CRIB_MASTER_ID)).toBe(true);
    expect(defaults.every((a) => isDefaultBuiltinAvatar(a.id))).toBe(true);
    expect(defaults).toHaveLength(DEFAULT_BUILTIN_AVATAR_IDS.length);
    expect(signature.every((a) => !isDefaultBuiltinAvatar(a.id))).toBe(true);
  });
});

describe('The SuperCrib Father in shop + gift catalog', () => {
  it('registers gift catalog and is sold via avatar_supercrib_father', () => {
    const a = getExclusiveGiftAvatar(SUPERCRIB_FATHER_ID);
    expect(a?.label).toBe('The SuperCrib Father');
    expect(a?.imageSrc).toContain('supercrib-father.png');
    // Catalog id is avatar_*; unlockId is supercrib_father (never raw SUPERCRIB_FATHER_ID as shop id).
    expect(SUPER_COIN_SHOP.some((i) => i.id === SUPERCRIB_FATHER_ID)).toBe(false);
    const shop = SUPER_COIN_SHOP.find((i) => i.id === 'avatar_supercrib_father');
    expect(shop?.unlockId).toBe(SUPERCRIB_FATHER_ID);
    expect(shop?.price).toBe(1000);
    expect(STORE_TEASER_AVATARS).toEqual([]);
  });

  it('is selectable when owned (shop unlockId path)', () => {
    expect(getSelectableAvatars([], SUPER_COIN_SHOP).some((x) => x.id === SUPERCRIB_FATHER_ID)).toBe(
      false,
    );
    const owned = getSelectableAvatars([SUPERCRIB_FATHER_ID], SUPER_COIN_SHOP);
    const row = owned.find((x) => x.id === SUPERCRIB_FATHER_ID);
    expect(row?.imageSrc).toContain('supercrib-father.png');
    expect(row?.label).toBe('The SuperCrib Father');
    expect(row?.builtin).toBe(false);
  });
});

describe('getShopAvatarItem unlockId lookup', () => {
  it('resolves Father by catalog id and unlockId', () => {
    const byId = getShopAvatarItem('avatar_supercrib_father');
    const byUnlock = getShopAvatarItem(SUPERCRIB_FATHER_ID);
    expect(byId?.imageSrc).toContain('supercrib-father.png');
    expect(byUnlock?.id).toBe('avatar_supercrib_father');
    expect(byUnlock?.imageSrc).toBe(byId?.imageSrc);
  });

  it('does not match board unlock ids', () => {
    expect(getShopAvatarItem('gold')).toBeUndefined();
    expect(getShopAvatarItem('zero_forge')).toBeUndefined();
  });

  it('resolves shop avatars without unlockId by catalog id', () => {
    expect(getShopAvatarItem('avatar_dangler')?.label).toBe('The Dangler');
  });
});
