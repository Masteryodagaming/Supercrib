import { describe, it, expect } from 'vitest';
import {
  createGame,
  startDeal,
  toggleDiscardSelect,
  confirmDiscard,
  cutStarter,
  playPegCard,
  sayGo,
  finishPegThirtyOne,
  finishPeggingToShow,
  needsThirtyOnePause,
  needsEndOfPeggingPause,
  getLegalPegCards,
  requiredDiscards,
} from '../supercrib';

function rngFrom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('hot-seat deal end-to-end', () => {
  it('deals 8 to dealer and 7 to pone, discard to 5+5 crib, cut, peg, show', () => {
    const rng = rngFrom(42);
    let g = startDeal(createGame('hotseat'), rng);

    expect(g.phase).toBe('discard');
    expect(g.players[g.dealer].hand.length).toBe(8);
    expect(g.players[g.pone].hand.length).toBe(7);
    expect(g.crib.length).toBe(0);

    const poneNeed = requiredDiscards(g, g.pone);
    expect(poneNeed).toBe(2);
    const poneCards = g.players[g.pone].hand.slice(0, 2);
    for (const c of poneCards) {
      g = toggleDiscardSelect(g, g.pone, c);
    }
    expect(g.players[g.pone].discardSel.length).toBe(2);
    g = confirmDiscard(g, g.pone);
    expect(g.players[g.pone].hand.length).toBe(5);
    expect(g.crib.length).toBe(2);

    const dealerCards = g.players[g.dealer].hand.slice(0, 3);
    for (const c of dealerCards) {
      g = toggleDiscardSelect(g, g.dealer, c);
    }
    g = confirmDiscard(g, g.dealer);
    expect(g.players[g.dealer].hand.length).toBe(5);
    expect(g.crib.length).toBe(5);
    expect(g.phase).toBe('cut');

    g = cutStarter(g, rng);
    expect(g.starter).not.toBeNull();
    expect(g.phase === 'pegging' || g.phase === 'gameOver').toBe(true);

    if (g.phase === 'gameOver') {
      return;
    }

    let steps = 0;
    while (g.phase === 'pegging' && steps < 200) {
      steps++;
      if (needsThirtyOnePause(g)) {
        g = finishPegThirtyOne(g);
        continue;
      }
      if (needsEndOfPeggingPause(g)) {
        g = finishPeggingToShow(g);
        continue;
      }
      const pid = g.peg!.toPlay;
      const legal = getLegalPegCards(g, pid);
      if (legal.length === 0) {
        g = sayGo(g, pid);
      } else {
        g = playPegCard(g, pid, legal[0]);
      }
    }

    expect(['show', 'redeal', 'gameOver']).toContain(g.phase);
    if (g.phase === 'show' || g.phase === 'redeal') {
      expect(g.showResult).not.toBeNull();
      expect(g.players[0].played.length + g.players[0].hand.length).toBe(5);
      expect(g.players[1].played.length + g.players[1].hand.length).toBe(5);
    }
  });

  it('requiredDiscards: dealer 3 / pone 2; either seat can confirm first → crib 5 → cut', () => {
    const rng = rngFrom(99);
    let g = startDeal(createGame('hotseat'), rng);
    expect(requiredDiscards(g, g.dealer)).toBe(3);
    expect(requiredDiscards(g, g.pone)).toBe(2);

    // Dealer confirms first (online-style independent discard)
    const dealerCards = g.players[g.dealer].hand.slice(0, 3);
    for (const c of dealerCards) g = toggleDiscardSelect(g, g.dealer, c);
    g = confirmDiscard(g, g.dealer);
    expect(g.players[g.dealer].hand.length).toBe(5);
    expect(g.crib.length).toBe(3);
    expect(g.phase).toBe('discard');

    const poneCards = g.players[g.pone].hand.slice(0, 2);
    for (const c of poneCards) g = toggleDiscardSelect(g, g.pone, c);
    g = confirmDiscard(g, g.pone);
    expect(g.players[g.pone].hand.length).toBe(5);
    expect(g.crib.length).toBe(5);
    expect(g.phase).toBe('cut');
  });

});
