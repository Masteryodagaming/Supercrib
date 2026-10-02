import { describe, it, expect } from 'vitest';
import {
  applyCoinDelta,
  setCoinBalance,
  buyShopItemOnProfile,
  chargeTournamentCreateOnProfile,
  chargeTournamentJoinOnProfile,
  grantAvatarIdOnProfile,
  mergeCoinStates,
  unionCoinLedgers,
  ledgerHasMatchingGrant,
  TOURNAMENT_CREATE_COST,
  COIN_LEDGER_CAP,
  SUPER_COIN_SHOP,
  STORE_EMOJI_ITEMS,
  STORE_AVATAR_ITEMS,
  STORE_TEASER_AVATARS,
  STORE_BOARD_ITEMS,
  STORE_FELT_ITEMS,
  grantBoardIdOnProfile,
  grantFeltIdOnProfile,
  type CoinLedgerEntry,
  type CoinProfileSlice,
} from '../coins';

describe('applyCoinDelta', () => {
  it('adds coins and appends ledger', () => {
    const next = applyCoinDelta(10, [], 5, 'admin_grant', 'test grant', 1000);
    expect(next.coins).toBe(15);
    expect(next.ledger).toHaveLength(1);
    expect(next.ledger[0]).toMatchObject({
      at: 1000,
      delta: 5,
      reason: 'admin_grant',
      note: 'test grant',
    });
  });

  it('allows spend when sufficient', () => {
    const next = applyCoinDelta(100, [], -40, 'buy_emoji', 'Sparkle', 1);
    expect(next.coins).toBe(60);
    expect(next.ledger[0].delta).toBe(-40);
  });

  it('throws on insufficient funds and does not invent balance', () => {
    expect(() => applyCoinDelta(9, [], -10, 'buy_emoji')).toThrow(/Insufficient Super Coins/);
    expect(() => applyCoinDelta(0, [], -1, 'create_tournament')).toThrow(/Insufficient/);
  });

  it('caps ledger length', () => {
    let ledger: CoinLedgerEntry[] = [];
    let coins = 0;
    for (let i = 0; i < COIN_LEDGER_CAP + 25; i++) {
      const next = applyCoinDelta(coins, ledger, 1, 'bonus', undefined, i);
      coins = next.coins;
      ledger = next.ledger;
    }
    expect(ledger).toHaveLength(COIN_LEDGER_CAP);
    expect(ledger[0].at).toBe(25);
  });
});

describe('setCoinBalance', () => {
  it('sets absolute balance with admin_set ledger', () => {
    const next = setCoinBalance(40, [], 240, 'doctor set', 50);
    expect(next.coins).toBe(240);
    expect(next.ledger[0]).toMatchObject({
      delta: 200,
      reason: 'admin_set',
      note: 'doctor set',
      at: 50,
    });
  });

  it('clamps negative target to 0', () => {
    const next = setCoinBalance(10, [], -5, 'wipe');
    expect(next.coins).toBe(0);
    expect(next.ledger[0].delta).toBe(-10);
    expect(next.ledger[0].reason).toBe('admin_set');
  });

  it('logs zero delta when unchanged', () => {
    const next = setCoinBalance(12, [], 12, 'noop');
    expect(next.coins).toBe(12);
    expect(next.ledger[0].delta).toBe(0);
  });
});

describe('shop + tournament charge', () => {
  it('buys emoji and unlocks id via unlockId', () => {
    const start: CoinProfileSlice = {
      coins: 200,
      coinLedger: [],
      ownedEmojiIds: [],
    };
    const p = buyShopItemOnProfile(start, 'emoji_mad_finger');
    expect(p.coins).toBe(0);
    expect(p.ownedEmojiIds).toContain('mad_finger');
    expect(p.coinLedger[0].reason).toBe('buy_emoji');
  });

  it('blocks buy when short', () => {
    const start: CoinProfileSlice = { coins: 5, coinLedger: [] };
    expect(() => buyShopItemOnProfile(start, 'emoji_mad_finger')).toThrow(/Insufficient/);
  });

  it('charges tournament create cost', () => {
    const start: CoinProfileSlice = {
      coins: TOURNAMENT_CREATE_COST + 10,
      coinLedger: [],
    };
    const p = chargeTournamentCreateOnProfile(start);
    expect(p.coins).toBe(10);
    expect(p.coinLedger[0].reason).toBe('create_tournament');
    expect(p.coinLedger[0].delta).toBe(-TOURNAMENT_CREATE_COST);
  });

  it('blocks tournament create when insufficient', () => {
    const start: CoinProfileSlice = { coins: Math.max(0, TOURNAMENT_CREATE_COST - 1) };
    expect(() => chargeTournamentCreateOnProfile(start)).toThrow(/Insufficient/);
  });
});

describe('tournament join fee + prize avatar', () => {
  it('charges join fee when > 0', () => {
    const start: CoinProfileSlice = { coins: 20, coinLedger: [] };
    const p = chargeTournamentJoinOnProfile(start, 5);
    expect(p.coins).toBe(15);
    expect(p.coinLedger[0].reason).toBe('join_tournament');
    expect(p.coinLedger[0].delta).toBe(-5);
  });

  it('no-ops join charge when fee is 0', () => {
    const start: CoinProfileSlice = { coins: 20, coinLedger: [] };
    const p = chargeTournamentJoinOnProfile(start, 0);
    expect(p.coins).toBe(20);
    expect(p.coinLedger).toHaveLength(0);
  });

  it('blocks join when insufficient', () => {
    const start: CoinProfileSlice = { coins: 2 };
    expect(() => chargeTournamentJoinOnProfile(start, 5)).toThrow(/Insufficient/);
  });

  it('grants prize avatar idempotently', () => {
    const start: CoinProfileSlice = { ownedAvatarIds: [] };
    const p = grantAvatarIdOnProfile(start, 'prize_club_champ');
    expect(p.ownedAvatarIds).toEqual(['prize_club_champ']);
    const again = grantAvatarIdOnProfile(p, 'prize_club_champ');
    expect(again.ownedAvatarIds).toEqual(['prize_club_champ']);
  });
});

describe('mergeCoinStates', () => {
  it('prefers Math.max when no spend evidence', () => {
    const m = mergeCoinStates(
      { coins: 185, coinLedger: [{ at: 1, delta: 185, reason: 'admin_grant' }] },
      { coins: 0, coinLedger: [] },
    );
    expect(m.coins).toBe(185);
  });

  it('takes lower after exclusive spend', () => {
    const grant = { at: 1, delta: 20, reason: 'admin_grant' as const };
    const spend = { at: 2, delta: -5, reason: 'join_tournament' as const };
    const m = mergeCoinStates(
      { coins: 15, coinLedger: [grant, spend] },
      { coins: 20, coinLedger: [grant] },
    );
    expect(m.coins).toBe(15);
  });
});

describe('unionCoinLedgers + inbox guard', () => {
  it('dedupes by at+delta+reason+note', () => {
    const a: CoinLedgerEntry[] = [{ at: 1, delta: 5, reason: 'bonus' }];
    const b: CoinLedgerEntry[] = [
      { at: 1, delta: 5, reason: 'bonus' },
      { at: 2, delta: -1, reason: 'buy_emoji' },
    ];
    expect(unionCoinLedgers(a, b)).toHaveLength(2);
  });

  it('detects matching grant for inbox idempotency', () => {
    const ledger: CoinLedgerEntry[] = [
      { at: 99, delta: 50, reason: 'admin_grant', note: 'x' },
    ];
    expect(ledgerHasMatchingGrant(ledger, 99, 50)).toBe(true);
    expect(ledgerHasMatchingGrant(ledger, 99, 51)).toBe(false);
  });
});

describe('Clash special emojis in Store', () => {
  const specials = [
    {
      id: 'emoji_mad_finger',
      unlockId: 'mad_finger',
      label: 'Mad Finger',
      image: '/reactions/mad_finger.png',
    },
    {
      id: 'emoji_trash_toss',
      unlockId: 'trash_toss',
      label: 'Trash Toss',
      image: '/reactions/trash_toss.png',
    },
    {
      id: 'emoji_ace_spade',
      unlockId: 'ace_spade',
      label: 'Spade Wizard',
      image: '/reactions/ace_spade.png',
    },
    {
      id: 'emoji_grandma_peggy',
      unlockId: 'grandma_peggy',
      label: 'Grandma Peggy',
      image: '/reactions/grandma_peggy.png',
    },
    {
      id: 'emoji_mad_father',
      unlockId: 'mad_father',
      label: 'Mad Father',
      image: '/reactions/mad_father.png',
    },
  ] as const;

  it('lists all five Clash specials in SUPER_COIN_SHOP / STORE_EMOJI_ITEMS at 200 SC', () => {
    for (const s of specials) {
      const item = SUPER_COIN_SHOP.find((i) => i.id === s.id);
      expect(item).toBeTruthy();
      expect(item?.kind).toBe('emoji');
      expect(item?.price).toBe(200);
      expect(item?.unlockId).toBe(s.unlockId);
      expect(item?.label).toBe(s.label);
      expect(item?.imageSrc).toContain(s.image);
      expect(STORE_EMOJI_ITEMS.some((i) => i.id === s.id)).toBe(true);
    }
  });

  it('buy grants ownedEmojiIds via unlockId for each special', () => {
    for (const s of specials) {
      const start: CoinProfileSlice = { coins: 200, coinLedger: [], ownedEmojiIds: [] };
      const p = buyShopItemOnProfile(start, s.id);
      expect(p.coins).toBe(0);
      expect(p.ownedEmojiIds).toEqual([s.unlockId]);
      expect(p.coinLedger[0].reason).toBe('buy_emoji');
      expect(() =>
        buyShopItemOnProfile({ ...start, ownedEmojiIds: [s.unlockId] }, s.id),
      ).toThrow(/Already owned/);
    }
  });
});

describe('Zero Forge + C&J Dumpster board/felt shop', () => {
  it('lists board ZF 200, Dumpster board 500, felt ZF 200 on STORE shelves', () => {
    const boardZf = SUPER_COIN_SHOP.find((i) => i.id === 'board_zero_forge');
    expect(boardZf).toBeTruthy();
    expect(boardZf?.kind).toBe('board');
    expect(boardZf?.price).toBe(200);
    expect(boardZf?.unlockId).toBe('zero_forge');
    expect(boardZf?.imageSrc).toContain('/boards/zero-forge.jpg');

    const boardDump = SUPER_COIN_SHOP.find((i) => i.id === 'board_cj_dumpster');
    expect(boardDump).toBeTruthy();
    expect(boardDump?.kind).toBe('board');
    expect(boardDump?.price).toBe(500);
    expect(boardDump?.unlockId).toBe('cj_dumpster');
    expect(boardDump?.imageSrc).toContain('/boards/cj-dumpster-thumb.jpg');

    const feltZf = SUPER_COIN_SHOP.find((i) => i.id === 'felt_zero_forge');
    expect(feltZf).toBeTruthy();
    expect(feltZf?.kind).toBe('felt');
    expect(feltZf?.price).toBe(200);
    expect(feltZf?.unlockId).toBe('zero_forge');
    expect(feltZf?.imageSrc).toContain('/felts/zero-forge-thumb.jpg');

    expect(STORE_BOARD_ITEMS.map((i) => i.id).sort()).toEqual(
      ['board_arena', 'board_cj_dumpster', 'board_gold', 'board_zero_forge'].sort(),
    );
    expect(STORE_FELT_ITEMS.some((i) => i.id === 'felt_zero_forge')).toBe(true);
    expect(STORE_FELT_ITEMS.some((i) => i.id === 'felt_cj_dumpster')).toBe(true);
  });

  it('buys Zero Forge board and grants ownedBoardIds via unlockId', () => {
    const start: CoinProfileSlice = { coins: 200, coinLedger: [], ownedBoardIds: [] };
    const p = buyShopItemOnProfile(start, 'board_zero_forge');
    expect(p.coins).toBe(0);
    expect(p.ownedBoardIds).toEqual(['zero_forge']);
    expect(p.coinLedger[0].reason).toBe('buy_board');
  });

  it('buys C&J Dumpster board at 500 SC and grants ownedBoardIds', () => {
    const start: CoinProfileSlice = { coins: 500, coinLedger: [], ownedBoardIds: [] };
    const p = buyShopItemOnProfile(start, 'board_cj_dumpster');
    expect(p.coins).toBe(0);
    expect(p.ownedBoardIds).toEqual(['cj_dumpster']);
    expect(p.coinLedger[0].reason).toBe('buy_board');
    expect(() =>
      buyShopItemOnProfile({ ...start, ownedBoardIds: ['cj_dumpster'] }, 'board_cj_dumpster'),
    ).toThrow(/Already owned/);
  });

  it('lists Arena board at 500 SC and grants ownedBoardIds via unlockId', () => {
    const boardArena = SUPER_COIN_SHOP.find((i) => i.id === 'board_arena');
    expect(boardArena).toBeTruthy();
    expect(boardArena?.kind).toBe('board');
    expect(boardArena?.price).toBe(500);
    expect(boardArena?.unlockId).toBe('arena');
    expect(boardArena?.imageSrc).toContain('/boards/arena-thumb.jpg');
    expect(STORE_BOARD_ITEMS.some((i) => i.id === 'board_arena')).toBe(true);

    const start: CoinProfileSlice = { coins: 500, coinLedger: [], ownedBoardIds: [] };
    const p = buyShopItemOnProfile(start, 'board_arena');
    expect(p.coins).toBe(0);
    expect(p.ownedBoardIds).toEqual(['arena']);
    expect(p.coinLedger[0].reason).toBe('buy_board');
    expect(() =>
      buyShopItemOnProfile({ ...start, ownedBoardIds: ['arena'] }, 'board_arena'),
    ).toThrow(/Already owned/);
  });


  it('lists Gold board at 500 SC and grants ownedBoardIds via unlockId', () => {
    const boardGold = SUPER_COIN_SHOP.find((i) => i.id === 'board_gold');
    expect(boardGold).toBeTruthy();
    expect(boardGold?.kind).toBe('board');
    expect(boardGold?.price).toBe(500);
    expect(boardGold?.unlockId).toBe('gold');
    expect(boardGold?.glyph).toBe('🥇');
    expect(boardGold?.imageSrc).toContain('/boards/gold-thumb.jpg');
    expect(STORE_BOARD_ITEMS.some((i) => i.id === 'board_gold')).toBe(true);

    const start: CoinProfileSlice = { coins: 500, coinLedger: [], ownedBoardIds: [] };
    const p = buyShopItemOnProfile(start, 'board_gold');
    expect(p.coins).toBe(0);
    expect(p.ownedBoardIds).toEqual(['gold']);
    expect(p.coinLedger[0].reason).toBe('buy_board');
    expect(() =>
      buyShopItemOnProfile({ ...start, ownedBoardIds: ['gold'] }, 'board_gold'),
    ).toThrow(/Already owned/);
  });

  it('buys Zero Forge felt at 200 SC and grants ownedFeltIds', () => {
    const start: CoinProfileSlice = { coins: 200, coinLedger: [], ownedFeltIds: [] };
    const p = buyShopItemOnProfile(start, 'felt_zero_forge');
    expect(p.coins).toBe(0);
    expect(p.ownedFeltIds).toEqual(['zero_forge']);
    expect(p.coinLedger[0].reason).toBe('buy_felt');
  });

  it('lists felt_cj_dumpster at 1000 SC and grants ownedFeltIds', () => {
    const item = SUPER_COIN_SHOP.find((i) => i.id === 'felt_cj_dumpster');
    expect(item).toBeTruthy();
    expect(item?.kind).toBe('felt');
    expect(item?.price).toBe(1000);
    expect(item?.unlockId).toBe('cj_dumpster');
    expect(item?.imageSrc).toContain('/felts/cj-dumpster-thumb.jpg');
    expect(STORE_FELT_ITEMS.some((i) => i.id === 'felt_cj_dumpster')).toBe(true);

    const start: CoinProfileSlice = { coins: 1000, coinLedger: [], ownedFeltIds: [] };
    const p = buyShopItemOnProfile(start, 'felt_cj_dumpster');
    expect(p.coins).toBe(0);
    expect(p.ownedFeltIds).toEqual(['cj_dumpster']);
    expect(p.coinLedger[0].reason).toBe('buy_felt');
    expect(() =>
      buyShopItemOnProfile({ ...start, ownedFeltIds: ['cj_dumpster'] }, 'felt_cj_dumpster'),
    ).toThrow(/Already owned/);
  });

  it('grantBoardIdOnProfile / grantFeltIdOnProfile merge idempotently', () => {
    const b = grantBoardIdOnProfile({ ownedBoardIds: [] }, 'cj_dumpster');
    expect(b.ownedBoardIds).toEqual(['cj_dumpster']);
    expect(grantBoardIdOnProfile(b, 'cj_dumpster').ownedBoardIds).toEqual(['cj_dumpster']);

    const f = grantFeltIdOnProfile({ ownedFeltIds: ['felt'] }, 'cj_dumpster');
    expect(f.ownedFeltIds).toEqual(['felt', 'cj_dumpster']);
    expect(grantFeltIdOnProfile(f, 'cj_dumpster').ownedFeltIds).toEqual(['felt', 'cj_dumpster']);
  });
});

describe('Avatar shelf open + SuperCrib Father shop', () => {
  it('STORE_TEASER_AVATARS is empty; STORE_AVATAR_ITEMS is all shop avatars', () => {
    expect(STORE_TEASER_AVATARS).toEqual([]);
    const fromShop = SUPER_COIN_SHOP.filter((i) => i.kind === 'avatar');
    expect(STORE_AVATAR_ITEMS.map((i) => i.id).sort()).toEqual(
      fromShop.map((i) => i.id).sort(),
    );
    expect(STORE_AVATAR_ITEMS.some((i) => i.id === 'avatar_dangler')).toBe(true);
    expect(STORE_AVATAR_ITEMS.some((i) => i.id === 'avatar_gold_elite')).toBe(true);
    expect(STORE_AVATAR_ITEMS.some((i) => i.id === 'avatar_supercrib_father')).toBe(true);
  });

  it('does not sell tester_god or first_ever_winner', () => {
    expect(SUPER_COIN_SHOP.some((i) => i.id === 'tester_god' || i.unlockId === 'tester_god')).toBe(
      false,
    );
    expect(
      SUPER_COIN_SHOP.some(
        (i) => i.id === 'first_ever_winner' || i.unlockId === 'first_ever_winner',
      ),
    ).toBe(false);
  });

  it('lists The SuperCrib Father at 1000 SC with unlockId supercrib_father', () => {
    const item = SUPER_COIN_SHOP.find((i) => i.id === 'avatar_supercrib_father');
    expect(item).toBeTruthy();
    expect(item?.kind).toBe('avatar');
    expect(item?.price).toBe(1000);
    expect(item?.unlockId).toBe('supercrib_father');
    expect(item?.glyph).toBe('👔');
    expect(item?.imageSrc).toContain('/avatars/supercrib-father.png');
  });

  it('buy Father grants ownedAvatarIds supercrib_father', () => {
    const start: CoinProfileSlice = { coins: 1000, coinLedger: [], ownedAvatarIds: [] };
    const p = buyShopItemOnProfile(start, 'avatar_supercrib_father');
    expect(p.coins).toBe(0);
    expect(p.ownedAvatarIds).toEqual(['supercrib_father']);
    expect(p.coinLedger[0].reason).toBe('buy_avatar');
    expect(() =>
      buyShopItemOnProfile(
        { ...start, ownedAvatarIds: ['supercrib_father'] },
        'avatar_supercrib_father',
      ),
    ).toThrow(/Already owned/);
  });

  it('buy dangler grants ownedAvatarIds via catalog id', () => {
    const start: CoinProfileSlice = { coins: 200, coinLedger: [], ownedAvatarIds: [] };
    const p = buyShopItemOnProfile(start, 'avatar_dangler');
    expect(p.coins).toBe(0);
    expect(p.ownedAvatarIds).toEqual(['avatar_dangler']);
    expect(p.coinLedger[0].reason).toBe('buy_avatar');
  });

  it('emoji shelf has Clash specials only (no sparkle/fire stubs)', () => {
    expect(SUPER_COIN_SHOP.some((i) => i.id === 'emoji_sparkle')).toBe(false);
    expect(SUPER_COIN_SHOP.some((i) => i.id === 'emoji_fire')).toBe(false);
    expect(STORE_EMOJI_ITEMS.map((i) => i.id).sort()).toEqual(
      [
        'emoji_ace_spade',
        'emoji_grandma_peggy',
        'emoji_mad_father',
        'emoji_mad_finger',
        'emoji_trash_toss',
      ].sort(),
    );
  });
});
