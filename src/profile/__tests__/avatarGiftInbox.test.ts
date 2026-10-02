import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUPERCRIB_FATHER_ID,
  getExclusiveGiftAvatar,
  getSelectableAvatars,
  EXCLUSIVE_GIFT_AVATARS,
} from '../avatars';
import { SUPER_COIN_SHOP, STORE_TEASER_AVATARS, grantAvatarIdOnProfile } from '../coins';
import {
  avatarGiftInboxPath,
  avatarGiftPath,
  grantAvatarGiftOnProfile,
} from '../avatarGiftInbox';
import { clearProfileStorage, createDefaultProfile, saveProfile } from '../storage';

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installMemoryStorage();
  clearProfileStorage();
});

describe('SuperCrib Father exclusive catalog', () => {
  it('registers The SuperCrib Father with imageSrc', () => {
    expect(SUPERCRIB_FATHER_ID).toBe('supercrib_father');
    const a = getExclusiveGiftAvatar(SUPERCRIB_FATHER_ID);
    expect(a?.label).toBe('The SuperCrib Father');
    expect(a?.imageSrc).toBe('/avatars/supercrib-father.png?v=1');
    expect(a?.glyph).toBe('🎩');
    expect(EXCLUSIVE_GIFT_AVATARS.some((x) => x.id === SUPERCRIB_FATHER_ID)).toBe(true);
  });

  it('is sold as avatar_supercrib_father (not raw id); teasers empty', () => {
    expect(SUPER_COIN_SHOP.some((i) => i.id === SUPERCRIB_FATHER_ID)).toBe(false);
    expect(SUPER_COIN_SHOP.some((i) => i.unlockId === SUPERCRIB_FATHER_ID)).toBe(true);
    expect(STORE_TEASER_AVATARS).toEqual([]);
  });

  it('appears in selectable Signature only when owned', () => {
    const locked = getSelectableAvatars([], SUPER_COIN_SHOP);
    expect(locked.some((a) => a.id === SUPERCRIB_FATHER_ID)).toBe(false);

    const owned = getSelectableAvatars([SUPERCRIB_FATHER_ID], SUPER_COIN_SHOP);
    const row = owned.find((a) => a.id === SUPERCRIB_FATHER_ID);
    expect(row?.label).toBe('The SuperCrib Father');
    expect(row?.imageSrc).toContain('supercrib-father.png');
    expect(row?.builtin).toBe(false);
  });
});

describe('avatar gift claim grant', () => {
  it('builds inbox paths', () => {
    expect(avatarGiftInboxPath('uidA')).toBe('avatarGift/uidA');
    expect(avatarGiftPath('uidA', 'push1')).toBe('avatarGift/uidA/push1');
  });

  it('grants avatar on claim (idempotent if already owned)', () => {
    const start = createDefaultProfile('Tester');
    const granted = grantAvatarGiftOnProfile(start, SUPERCRIB_FATHER_ID);
    expect(granted.ownedAvatarIds).toContain(SUPERCRIB_FATHER_ID);

    const again = grantAvatarGiftOnProfile(granted, SUPERCRIB_FATHER_ID);
    expect(again.ownedAvatarIds).toEqual(granted.ownedAvatarIds);
    expect(again.ownedAvatarIds.filter((id) => id === SUPERCRIB_FATHER_ID)).toHaveLength(1);
  });

  it('grantAvatarIdOnProfile matches gift helper', () => {
    const p = grantAvatarIdOnProfile({ ownedAvatarIds: [] }, SUPERCRIB_FATHER_ID);
    expect(p.ownedAvatarIds).toEqual([SUPERCRIB_FATHER_ID]);
    const saved = saveProfile({
      ...createDefaultProfile('X'),
      ownedAvatarIds: p.ownedAvatarIds,
    });
    expect(saved.ownedAvatarIds).toContain(SUPERCRIB_FATHER_ID);
  });
});

describe('claimAvatarGift (mocked RTDB)', () => {
  it('grants, pushes cloud, then removes inbox; idempotent when already owned', async () => {
    const get = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const writeCloudProfile = vi.fn().mockResolvedValue(undefined);
    const callOrder: string[] = [];
    writeCloudProfile.mockImplementation(async () => {
      callOrder.push('write');
    });
    remove.mockImplementation(async () => {
      callOrder.push('remove');
    });

    vi.resetModules();
    vi.doMock('../../multiplayer/firebase', () => ({
      isFirebaseConfigured: () => true,
      getFirebaseDb: () => ({}),
    }));
    vi.doMock('firebase/database', () => ({
      get,
      ref: (_db: unknown, path: string) => ({ path }),
      remove,
      push: vi.fn(),
      onValue: vi.fn(),
    }));
    vi.doMock('../cloudSync', () => ({
      writeCloudProfile,
    }));

    const { claimAvatarGift } = await import('../avatarGiftInbox');

    const profile = saveProfile({
      ...createDefaultProfile('Mrcool'),
      ownedAvatarIds: [],
    });

    get.mockResolvedValue({
      val: () => ({
        fromUid: 'owner',
        fromName: 'Joshwa Milliea',
        avatarId: SUPERCRIB_FATHER_ID,
        avatarLabel: 'The SuperCrib Father',
        imageSrc: '/avatars/supercrib-father.png?v=1',
        at: 1,
      }),
    });

    const first = await claimAvatarGift('uid-mrcool', 'push1', profile);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.alreadyOwned).toBe(false);
      expect(first.profile.ownedAvatarIds).toContain(SUPERCRIB_FATHER_ID);
    }
    expect(writeCloudProfile).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(callOrder).toEqual(['write', 'remove']);

    get.mockResolvedValue({
      val: () => ({
        fromUid: 'owner',
        fromName: 'Joshwa Milliea',
        avatarId: SUPERCRIB_FATHER_ID,
        avatarLabel: 'The SuperCrib Father',
        at: 2,
      }),
    });
    const second = await claimAvatarGift(
      'uid-mrcool',
      'push2',
      first.ok ? first.profile : profile,
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadyOwned).toBe(true);
      expect(
        second.profile.ownedAvatarIds!.filter((id) => id === SUPERCRIB_FATHER_ID),
      ).toHaveLength(1);
    }
  });

  it('keeps inbox and returns cloud_sync when writeCloudProfile fails', async () => {
    const get = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const writeCloudProfile = vi
      .fn()
      .mockRejectedValue(new Error('PERMISSION_DENIED: not signed in'));

    vi.resetModules();
    vi.doMock('../../multiplayer/firebase', () => ({
      isFirebaseConfigured: () => true,
      getFirebaseDb: () => ({}),
    }));
    vi.doMock('firebase/database', () => ({
      get,
      ref: (_db: unknown, path: string) => ({ path }),
      remove,
      push: vi.fn(),
      onValue: vi.fn(),
    }));
    vi.doMock('../cloudSync', () => ({
      writeCloudProfile,
    }));

    const { claimAvatarGift } = await import('../avatarGiftInbox');
    const { loadProfile } = await import('../storage');

    const profile = saveProfile({
      ...createDefaultProfile('Rayzor'),
      ownedAvatarIds: [],
    });

    get.mockResolvedValue({
      val: () => ({
        fromUid: 'owner',
        avatarId: SUPERCRIB_FATHER_ID,
        avatarLabel: 'The SuperCrib Father',
        at: 1,
      }),
    });

    const result = await claimAvatarGift('uid-rayzor', 'push-fail', profile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cloud_sync');
      expect(result.profile?.ownedAvatarIds).toContain(SUPERCRIB_FATHER_ID);
    }
    expect(remove).not.toHaveBeenCalled();
    // Local grant persisted for retry / Settings after onProfileUpdate
    expect(loadProfile()?.ownedAvatarIds).toContain(SUPERCRIB_FATHER_ID);
  });
});

describe('board/felt skin gifts via avatarGift encoding', () => {
  it('parseGiftAvatarId / encode helpers', async () => {
    const {
      parseGiftAvatarId,
      encodeBoardGiftId,
      encodeFeltGiftId,
    } = await import('../avatarGiftInbox');
    expect(parseGiftAvatarId('board:cj_dumpster')).toEqual({
      kind: 'board',
      id: 'cj_dumpster',
    });
    expect(parseGiftAvatarId('felt:cj_dumpster')).toEqual({
      kind: 'felt',
      id: 'cj_dumpster',
    });
    expect(parseGiftAvatarId(SUPERCRIB_FATHER_ID)).toEqual({
      kind: 'avatar',
      id: SUPERCRIB_FATHER_ID,
    });
    expect(encodeBoardGiftId('cj_dumpster')).toBe('board:cj_dumpster');
    expect(encodeFeltGiftId('cj_dumpster')).toBe('felt:cj_dumpster');
  });

  it('grants board and felt on claim helpers (idempotent)', () => {
    const start = createDefaultProfile('Yoda');
    const withBoard = grantAvatarGiftOnProfile(start, 'board:cj_dumpster');
    expect(withBoard.ownedBoardIds).toContain('cj_dumpster');
    expect(withBoard.ownedAvatarIds ?? []).not.toContain('board:cj_dumpster');

    const withFelt = grantAvatarGiftOnProfile(withBoard, 'felt:cj_dumpster');
    expect(withFelt.ownedFeltIds).toContain('cj_dumpster');
    expect(withFelt.ownedBoardIds).toContain('cj_dumpster');

    const again = grantAvatarGiftOnProfile(withFelt, 'board:cj_dumpster');
    expect(again.ownedBoardIds!.filter((id) => id === 'cj_dumpster')).toHaveLength(1);
  });

  it('claimAvatarGift grants board then felt via encoded avatarId', async () => {
    const get = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const writeCloudProfile = vi.fn().mockResolvedValue(undefined);

    vi.resetModules();
    vi.doMock('../../multiplayer/firebase', () => ({
      isFirebaseConfigured: () => true,
      getFirebaseDb: () => ({}),
    }));
    vi.doMock('firebase/database', () => ({
      get,
      ref: (_db: unknown, path: string) => ({ path }),
      remove,
      push: vi.fn(),
      onValue: vi.fn(),
    }));
    vi.doMock('../cloudSync', () => ({
      writeCloudProfile,
    }));

    const { claimAvatarGift } = await import('../avatarGiftInbox');
    const { saveProfile: save, createDefaultProfile: def } = await import('../storage');

    const profile = save({
      ...def('Joe'),
      ownedBoardIds: [],
      ownedFeltIds: [],
    });

    get.mockResolvedValue({
      val: () => ({
        fromUid: 'CphdDQWSDQbCf58rAMpo78wtFFm2',
        fromName: 'Zero Forge Labs',
        avatarId: 'board:cj_dumpster',
        avatarLabel: 'C&J Dumpster Board',
        imageSrc: '/boards/cj-dumpster.jpg?v=17',
        at: 1,
      }),
    });

    const boardClaim = await claimAvatarGift('joe-uid', 'push-board', profile);
    expect(boardClaim.ok).toBe(true);
    if (boardClaim.ok) {
      expect(boardClaim.kind).toBe('board');
      expect(boardClaim.profile.ownedBoardIds).toContain('cj_dumpster');
      expect(boardClaim.avatarLabel).toBe('C&J Dumpster Board');
    }

    get.mockResolvedValue({
      val: () => ({
        fromUid: 'CphdDQWSDQbCf58rAMpo78wtFFm2',
        fromName: 'Zero Forge Labs',
        avatarId: 'felt:cj_dumpster',
        avatarLabel: 'C&J Dumpster Felt',
        imageSrc: '/felts/cj-dumpster-thumb.jpg?v=7',
        at: 2,
      }),
    });

    const feltClaim = await claimAvatarGift(
      'joe-uid',
      'push-felt',
      boardClaim.ok ? boardClaim.profile : profile,
    );
    expect(feltClaim.ok).toBe(true);
    if (feltClaim.ok) {
      expect(feltClaim.kind).toBe('felt');
      expect(feltClaim.profile.ownedFeltIds).toContain('cj_dumpster');
      expect(feltClaim.profile.ownedBoardIds).toContain('cj_dumpster');
    }
  });
});
