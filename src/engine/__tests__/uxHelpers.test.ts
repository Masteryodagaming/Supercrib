import { describe, it, expect } from 'vitest';
import {
  createGame,
  startDeal,
  toggleDiscardSelect,
  confirmDiscard,
  cutStarter,
  reorderHand,
  swapHandCards,
  requiredDiscards,
  sortHandByRank,
  sortHumanHands,
} from '../supercrib';
import { rankOrder } from '../cards';

function rngFrom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('hand rearrange (cosmetic)', () => {
  it('reorderHand moves a card without changing set membership or discardSel ids', () => {
    let g = startDeal(createGame('hotseat'), rngFrom(5));
    const pid = g.pone;
    const before = g.players[pid].hand.map((c) => c.id);
    expect(before.length).toBe(7);

    // Select first two for discard, then reorder
    g = toggleDiscardSelect(g, pid, g.players[pid].hand[0]);
    g = toggleDiscardSelect(g, pid, g.players[pid].hand[1]);
    const selIds = g.players[pid].discardSel.map((c) => c.id).sort();

    g = reorderHand(g, pid, 0, 4);
    const after = g.players[pid].hand.map((c) => c.id);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after[4]).toBe(before[0]);
    expect(g.players[pid].discardSel.map((c) => c.id).sort()).toEqual(selIds);
  });

  it('swapHandCards swaps two positions', () => {
    let g = startDeal(createGame('hotseat'), rngFrom(8));
    const pid = g.dealer;
    const a = g.players[pid].hand[1].id;
    const b = g.players[pid].hand[3].id;
    g = swapHandCards(g, pid, 1, 3);
    expect(g.players[pid].hand[1].id).toBe(b);
    expect(g.players[pid].hand[3].id).toBe(a);
  });
});

describe('fun cut by index', () => {
  it('cutStarter(state, index) uses that stock card as starter', () => {
    const rng = rngFrom(11);
    let g = startDeal(createGame('hotseat'), rng);
    // Both discard
    for (const pid of [g.pone, g.dealer]) {
      const need = requiredDiscards(g, pid);
      const cards = g.players[pid].hand.slice(0, need);
      for (const c of cards) g = toggleDiscardSelect(g, pid, c);
      g = confirmDiscard(g, pid);
    }
    expect(g.phase).toBe('cut');
    expect(g.deck.length).toBeGreaterThan(5);
    const idx = 3;
    const expected = g.deck[idx];
    g = cutStarter(g, idx);
    expect(g.starter?.id).toBe(expected.id);
    expect(g.deck.some((c) => c.id === expected.id)).toBe(false);
    expect(g.phase === 'pegging' || g.phase === 'gameOver').toBe(true);
  });

  it('cutStarter still accepts rng function (AI / tests)', () => {
    const rng = rngFrom(22);
    let g = startDeal(createGame('hotseat'), rng);
    for (const pid of [g.pone, g.dealer]) {
      const need = requiredDiscards(g, pid);
      for (const c of g.players[pid].hand.slice(0, need)) {
        g = toggleDiscardSelect(g, pid, c);
      }
      g = confirmDiscard(g, pid);
    }
    g = cutStarter(g, rng);
    expect(g.starter).not.toBeNull();
  });
});


describe('auto-sort hand (cosmetic)', () => {
  it('sortHandByRank orders A low … K high', () => {
    let g = startDeal(createGame('hotseat'), rngFrom(42));
    const pid = 0 as const;
    g = sortHandByRank(g, pid);
    const orders = g.players[pid].hand.map((c) => rankOrder(c.rank));
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
  });

  it('sortHumanHands sorts only seat 0 in AI mode', () => {
    let g = startDeal(createGame('ai'), rngFrom(7));
    const before1 = g.players[1].hand.map((c) => c.id).join(',');
    g = sortHumanHands(g);
    const orders0 = g.players[0].hand.map((c) => rankOrder(c.rank));
    for (let i = 1; i < orders0.length; i++) {
      expect(orders0[i]).toBeGreaterThanOrEqual(orders0[i - 1]);
    }
    expect(g.players[1].hand.map((c) => c.id).join(',')).toBe(before1);
  });
});
