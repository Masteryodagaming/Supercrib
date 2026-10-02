import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROFILE_STORAGE_KEY,
  FRIENDS_STORAGE_KEY,
  createDefaultProfile,
  loadProfile,
  saveProfile,
  hasProfile,
  recordAiGameResult,
  recordOnlineGameResult,
  loadFriends,
  addFriend,
  addCloudFriend,
  cloudFriendsOnly,
  removeFriend,
  clearProfileStorage,
  emptyRecord,
} from '../storage';

/** Minimal localStorage mock for node vitest. */
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

describe('profile storage', () => {
  it('returns null when nothing saved', () => {
    expect(loadProfile()).toBeNull();
    expect(hasProfile()).toBe(false);
  });

  it('save then load round-trips', () => {
    const created = createDefaultProfile('Josh');
    created.avatarId = 'spade';
    const saved = saveProfile(created);
    expect(saved.displayName).toBe('Josh');
    expect(saved.updatedAt).toBeGreaterThanOrEqual(created.createdAt);

    const loaded = loadProfile();
    expect(loaded).not.toBeNull();
    expect(loaded!.displayName).toBe('Josh');
    expect(loaded!.avatarId).toBe('spade');
    expect(loaded!.record).toEqual(emptyRecord());
    expect(loaded!.onlineRecord).toEqual(emptyRecord());
    expect(hasProfile()).toBe(true);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeTruthy();
  });

  it('trims empty name to Player', () => {
    const saved = saveProfile(createDefaultProfile('   '));
    expect(saved.displayName).toBe('Player');
  });

  it('ignores corrupt JSON', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, '{not-json');
    expect(loadProfile()).toBeNull();
  });

  it('ignores invalid shape', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ displayName: 1 }));
    expect(loadProfile()).toBeNull();
  });

  it('recordAiGameResult updates wins/losses/gamesPlayed', () => {
    saveProfile(createDefaultProfile('Tester'));
    const afterWin = recordAiGameResult(true);
    expect(afterWin!.record).toEqual({ wins: 1, losses: 0, gamesPlayed: 1 });
    const afterLoss = recordAiGameResult(false);
    expect(afterLoss!.record).toEqual({ wins: 1, losses: 1, gamesPlayed: 2 });
  });

  it('recordAiGameResult returns null without profile', () => {
    expect(recordAiGameResult(true)).toBeNull();
  });

  it('recordOnlineGameResult updates onlineRecord only', () => {
    saveProfile(createDefaultProfile('Tester'));
    const afterWin = recordOnlineGameResult(true);
    expect(afterWin!.onlineRecord).toEqual({ wins: 1, losses: 0, gamesPlayed: 1 });
    expect(afterWin!.record).toEqual(emptyRecord());
    const afterLoss = recordOnlineGameResult(false);
    expect(afterLoss!.onlineRecord).toEqual({ wins: 1, losses: 1, gamesPlayed: 2 });
    expect(afterLoss!.record).toEqual(emptyRecord());
  });

  it('migrates legacy profiles missing onlineRecord', () => {
    const legacy = createDefaultProfile('Legacy');
    const { onlineRecord: _drop, ...rest } = legacy as typeof legacy & { onlineRecord?: unknown };
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({ ...rest, record: { wins: 2, losses: 1, gamesPlayed: 3 } }),
    );
    const loaded = loadProfile();
    expect(loaded).not.toBeNull();
    expect(loaded!.record).toEqual({ wins: 2, losses: 1, gamesPlayed: 3 });
    expect(loaded!.onlineRecord).toEqual(emptyRecord());
  });
});

describe('friends storage', () => {
  it('starts empty', () => {
    expect(loadFriends()).toEqual([]);
  });

  it('adds and removes friends', () => {
    const list = addFriend('Alex');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alex');
    expect(list[0].status).toBe('local');
    expect(localStorage.getItem(FRIENDS_STORAGE_KEY)).toBeTruthy();

    addFriend('alex'); // duplicate case-insensitive
    expect(loadFriends()).toHaveLength(1);

    const id = loadFriends()[0].id;
    removeFriend(id);
    expect(loadFriends()).toEqual([]);
  });

  it('skips blank names', () => {
    expect(addFriend('  ')).toEqual([]);
  });

  it('adds cloud friend by uid', () => {
    const list = addCloudFriend('uid123', 'Sam');
    expect(list).toHaveLength(1);
    expect(list[0].uid).toBe('uid123');
    expect(list[0].id).toBe('uid123');
    expect(list[0].name).toBe('Sam');
    expect(list[0].status).toBe('offline');
    addCloudFriend('uid123', 'Sam');
    expect(loadFriends()).toHaveLength(1);
  });

  it('cloudFriendsOnly drops legacy local-only entries', () => {
    addFriend('Alex');
    addCloudFriend('uid123', 'Sam');
    const filtered = cloudFriendsOnly(loadFriends());
    expect(filtered).toHaveLength(1);
    expect(filtered[0].uid).toBe('uid123');
  });
});

describe('profile coins persistence', () => {
  it('always persists coins and coinLedger on save', () => {
    const created = createDefaultProfile('Coiner');
    created.coins = 42;
    created.coinLedger = [{ at: 1, delta: 42, reason: 'admin_grant' }];
    const saved = saveProfile(created);
    expect(saved.coins).toBe(42);
    expect(saved.coinLedger).toHaveLength(1);
    const loaded = loadProfile();
    expect(loaded?.coins).toBe(42);
    expect(loaded?.coinLedger?.[0]?.delta).toBe(42);
  });

  it('preserves existing coins when save omits coins field (settings-style)', () => {
    const created = createDefaultProfile('Keep');
    created.coins = 99;
    created.coinLedger = [{ at: 1, delta: 99, reason: 'bonus' }];
    saveProfile(created);
    const draft = { ...loadProfile()! };
    delete (draft as { coins?: number }).coins;
    delete (draft as { coinLedger?: unknown }).coinLedger;
    draft.displayName = 'Renamed';
    const saved = saveProfile(draft);
    expect(saved.displayName).toBe('Renamed');
    expect(saved.coins).toBe(99);
    expect(saved.coinLedger?.[0]?.delta).toBe(99);
  });
});

describe('profile owned unlocks persistence', () => {
  it('saveProfile union preserves ownedAvatarIds when draft omits or clears them', () => {
    const created = createDefaultProfile('Joe');
    created.ownedAvatarIds = ['supercrib_father', 'avatar_shop_a'];
    saveProfile(created);

    const draftOmit = { ...loadProfile()! };
    delete (draftOmit as { ownedAvatarIds?: string[] }).ownedAvatarIds;
    draftOmit.displayName = 'Joe Renamed';
    const savedOmit = saveProfile(draftOmit);
    expect(savedOmit.displayName).toBe('Joe Renamed');
    expect(savedOmit.ownedAvatarIds).toEqual(
      expect.arrayContaining(['supercrib_father', 'avatar_shop_a']),
    );

    const draftEmpty = { ...loadProfile()!, ownedAvatarIds: [] as string[] };
    draftEmpty.displayName = 'Joe Again';
    const savedEmpty = saveProfile(draftEmpty);
    expect(savedEmpty.ownedAvatarIds).toEqual(
      expect.arrayContaining(['supercrib_father', 'avatar_shop_a']),
    );
  });

  it('saveProfile unions incoming ownedAvatarIds with stored unlocks', () => {
    saveProfile({
      ...createDefaultProfile('Union'),
      ownedAvatarIds: ['supercrib_father'],
    });
    const saved = saveProfile({
      ...loadProfile()!,
      ownedAvatarIds: ['avatar_shop_b'],
    });
    expect(saved.ownedAvatarIds).toEqual(
      expect.arrayContaining(['supercrib_father', 'avatar_shop_b']),
    );
  });
});
