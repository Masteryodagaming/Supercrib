import { describe, it, expect } from 'vitest';
import {
  mergeFriends,
  mergeProfiles,
  isProfileShell,
  shouldDemoteLocalCache,
} from '../cloudSync';
import { SIGNIN_PROMO_ID, SIGNIN_PROMO_SC } from '../promos';
import { createDefaultProfile, emptyRecord, type Friend } from '../storage';

describe('mergeProfiles', () => {
  it('takes max career counts from either side', () => {
    const local = createDefaultProfile('Local');
    local.record = { wins: 3, losses: 1, gamesPlayed: 4 };
    local.onlineRecord = emptyRecord();
    local.updatedAt = 100;
    const cloud = createDefaultProfile('Cloud');
    cloud.record = { wins: 2, losses: 5, gamesPlayed: 7 };
    cloud.onlineRecord = { wins: 1, losses: 0, gamesPlayed: 1 };
    cloud.updatedAt = 200;
    const m = mergeProfiles(local, cloud);
    expect(m.record).toEqual({ wins: 3, losses: 5, gamesPlayed: 7 });
    expect(m.onlineRecord).toEqual({ wins: 1, losses: 0, gamesPlayed: 1 });
    expect(m.displayName).toBe('Cloud'); // newer updatedAt
  });
});

describe('mergeFriends', () => {
  it('keeps only uid friends and drops local-only name entries', () => {
    const local: Friend[] = [
      { id: 'a', name: 'Alex', status: 'local', addedAt: 1 },
      { id: 'uid1', uid: 'uid1', name: 'Alex', status: 'offline', addedAt: 2 },
    ];
    const cloud: Friend[] = [
      { id: 'uid1', uid: 'uid1', name: 'alex', status: 'offline', addedAt: 3 },
      { id: 'uid2', uid: 'uid2', name: 'Sam', status: 'offline', addedAt: 4 },
      { id: 'legacy', name: 'LocalOnly', status: 'local', addedAt: 5 },
    ];
    const m = mergeFriends(local, cloud);
    expect(m).toHaveLength(2);
    expect(m.every((f) => !!f.uid)).toBe(true);
    expect(m.find((f) => f.uid === 'uid1')?.addedAt).toBe(3);
    expect(m.some((f) => f.uid === 'uid2')).toBe(true);
    expect(m.some((f) => f.name === 'LocalOnly')).toBe(false);
  });
});

describe('mergeProfiles playerCode', () => {
  it('keeps playerCode from either side', () => {
    const local = createDefaultProfile('Local');
    local.updatedAt = 100;
    const cloud = createDefaultProfile('Cloud');
    cloud.playerCode = 'ABCDEF';
    cloud.updatedAt = 50;
    const m = mergeProfiles(local, cloud);
    expect(m.playerCode).toBe('ABCDEF');
  });
});

describe('mergeProfiles Super Coins', () => {
  it('keeps high local when cloud is 0/missing (wipe pattern)', () => {
    const local = createDefaultProfile('Local');
    local.coins = 185;
    local.coinLedger = [{ at: 1, delta: 185, reason: 'admin_grant', note: 'paid' }];
    local.updatedAt = 100;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 0;
    cloud.coinLedger = [];
    cloud.updatedAt = 999; // newer settings save must not wipe
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(185);
    expect(m.coinLedger?.some((e) => e.delta === 185)).toBe(true);
  });

  it('keeps high cloud when local is 0/missing', () => {
    const local = createDefaultProfile('Local');
    local.coins = 0;
    local.coinLedger = [];
    local.updatedAt = 999;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 240;
    cloud.coinLedger = [{ at: 2, delta: 240, reason: 'admin_grant' }];
    cloud.updatedAt = 50;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(240);
  });

  it('keeps shared high when both sides high', () => {
    const local = createDefaultProfile('Local');
    local.coins = 100;
    local.coinLedger = [{ at: 1, delta: 100, reason: 'bonus' }];
    local.updatedAt = 10;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 100;
    cloud.coinLedger = [{ at: 1, delta: 100, reason: 'bonus' }];
    cloud.updatedAt = 20;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(100);
  });

  it('stays at 0 when both are 0', () => {
    const local = createDefaultProfile('Local');
    local.coins = 0;
    local.updatedAt = 10;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 0;
    cloud.updatedAt = 20;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(0);
  });

  it('accepts lower balance after legitimate spend with ledger evidence', () => {
    const grant = { at: 1, delta: 185, reason: 'admin_grant' as const };
    const spend = {
      at: 2,
      delta: -5,
      reason: 'create_tournament' as const,
      note: 'Create tournament (−5 SC)',
    };
    const local = createDefaultProfile('Local');
    local.coins = 180;
    local.coinLedger = [grant, spend];
    local.updatedAt = 200;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 185;
    cloud.coinLedger = [grant];
    cloud.updatedAt = 100;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(180);
    expect(m.coinLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: 185, reason: 'admin_grant' }),
        expect.objectContaining({ delta: -5, reason: 'create_tournament' }),
      ]),
    );
  });

  it('accepts Doctor admin_set to a lower balance with ledger evidence', () => {
    const local = createDefaultProfile('Local');
    local.coins = 50;
    local.coinLedger = [
      { at: 1, delta: 200, reason: 'admin_grant' },
      { at: 3, delta: -150, reason: 'admin_set', note: 'Doctor set balance' },
    ];
    local.updatedAt = 300;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 200;
    cloud.coinLedger = [{ at: 1, delta: 200, reason: 'admin_grant' }];
    cloud.updatedAt = 100;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(50);
  });

  it('unions ledgers when balances match via Math.max path', () => {
    const local = createDefaultProfile('Local');
    local.coins = 100;
    local.coinLedger = [{ at: 1, delta: 100, reason: 'bonus', note: 'a' }];
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 80;
    cloud.coinLedger = [{ at: 2, delta: 80, reason: 'bonus', note: 'b' }];
    // No exclusive spend explaining 100→80 → keep 100, union ledgers
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(100);
    expect(m.coinLedger).toHaveLength(2);
  });

  it('does not treat missing coins field as a wipe when other side has balance', () => {
    const local = createDefaultProfile('Local');
    local.updatedAt = 500;
    delete (local as { coins?: number }).coins;
    delete (local as { coinLedger?: unknown }).coinLedger;
    const cloud = createDefaultProfile('Cloud');
    cloud.coins = 77;
    cloud.coinLedger = [{ at: 1, delta: 77, reason: 'admin_grant' }];
    cloud.updatedAt = 1;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(77);
  });
});


describe('mergeProfiles sign-in promo wipe repair', () => {
  it('restores claimed signin_200 wipe (0/empty ledger) to 200', () => {
    const local = createDefaultProfile('Joe');
    local.coins = 0;
    local.coinLedger = [];
    local.claimedPromos = [SIGNIN_PROMO_ID];
    local.updatedAt = 100;
    const cloud = createDefaultProfile('Joe');
    cloud.coins = 0;
    cloud.coinLedger = [];
    cloud.claimedPromos = [SIGNIN_PROMO_ID];
    cloud.updatedAt = 200;
    const m = mergeProfiles(local, cloud);
    expect(m.coins).toBe(SIGNIN_PROMO_SC);
    expect(m.coinLedger?.some((e) => e.reason === 'admin_set' && e.note?.includes('Repair'))).toBe(
      true,
    );
  });
});


describe('mergeProfiles identity + presets', () => {
  it('never replaces Master Yoda with Player from a newer default shell', () => {
    const local = createDefaultProfile('Player');
    local.updatedAt = 999;
    local.avatarId = 'peg';
    const cloud = createDefaultProfile('Master Yoda');
    cloud.updatedAt = 100;
    cloud.avatarId = 'peg';
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    cloud.equippedRailEmojiIds = ['laugh', 'cry', 'angry', 'skunk', 'mad_finger', 'handshake'];
    const m = mergeProfiles(local, cloud);
    expect(m.displayName).toBe('Master Yoda');
    expect(m.settings.theme).toBe('zero_forge');
    expect(m.settings.board).toBe('zero_forge');
    expect(m.equippedRailEmojiIds).toContain('mad_finger');
  });

  it('keeps newer intentional gold peg over older crib_master', () => {
    const local = createDefaultProfile('Master Yoda');
    local.updatedAt = 500;
    local.avatarId = 'peg';
    local.avatarDataUrl = null;
    const cloud = createDefaultProfile('Master Yoda');
    cloud.updatedAt = 100;
    cloud.avatarId = 'crib_master';
    cloud.avatarDataUrl = null;
    const m = mergeProfiles(local, cloud);
    expect(m.displayName).toBe('Master Yoda');
    expect(m.avatarId).toBe('peg');
  });

  it('fresh local updatedAt 0 loses to cloud Master Yoda + custom rail', () => {
    const local = createDefaultProfile('Joshua');
    local.updatedAt = 0;
    local.avatarId = 'peg';
    const cloud = createDefaultProfile('Master Yoda');
    cloud.updatedAt = 200;
    cloud.avatarId = 'peg';
    cloud.equippedRailEmojiIds = ['mad_finger', 'laugh', 'cry', 'angry', 'skunk', 'facepalm'];
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    const m = mergeProfiles(local, cloud);
    expect(m.displayName).toBe('Master Yoda');
    expect(m.avatarId).toBe('peg');
    expect(m.settings.theme).toBe('zero_forge');
    expect(m.equippedRailEmojiIds?.[0]).toBe('mad_finger');
  });
});


describe('isProfileShell + shouldDemoteLocalCache', () => {
  it('detects default createDefaultProfile as a shell', () => {
    expect(isProfileShell(createDefaultProfile('Player'))).toBe(true);
  });

  it('detects Master Yoda with Zero Forge as non-shell', () => {
    const cloud = createDefaultProfile('Master Yoda');
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    cloud.ownedFeltIds = ['zero_forge'];
    expect(isProfileShell(cloud)).toBe(false);
  });

  it('demotes guest local (no playerCode) when cloud has a code', () => {
    const local = createDefaultProfile('Player');
    local.updatedAt = 9999;
    local.settings = { sound: true, theme: 'felt', board: 'default' };
    const cloud = createDefaultProfile('Master Yoda');
    cloud.playerCode = 'YODA01';
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    expect(shouldDemoteLocalCache(local, cloud)).toBe(true);
  });

  it('demotes Dummy local when playerCodes differ from Owner cloud', () => {
    const local = createDefaultProfile('Dummy');
    local.playerCode = 'DUMMY1';
    local.updatedAt = 9999;
    local.settings = { sound: true, theme: 'zero_forge', board: 'default' };
    local.avatarId = 'peg';
    const cloud = createDefaultProfile('Master Yoda');
    cloud.playerCode = 'YODA01';
    cloud.updatedAt = 100;
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    cloud.avatarId = 'crib_master';
    expect(shouldDemoteLocalCache(local, cloud)).toBe(true);
    const demoted = { ...local, updatedAt: 0 };
    const m = mergeProfiles(demoted, cloud);
    expect(m.displayName).toBe('Master Yoda');
    expect(m.settings.board).toBe('zero_forge');
    expect(m.avatarId).toBe('crib_master');
  });

  it('does not demote same-account local with matching playerCode and customizations', () => {
    const local = createDefaultProfile('Master Yoda');
    local.playerCode = 'YODA01';
    local.updatedAt = 500;
    local.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    const cloud = createDefaultProfile('Master Yoda');
    cloud.playerCode = 'YODA01';
    cloud.updatedAt = 100;
    cloud.settings = { sound: true, theme: 'zero_forge', board: 'zero_forge' };
    expect(shouldDemoteLocalCache(local, cloud)).toBe(false);
  });
});
