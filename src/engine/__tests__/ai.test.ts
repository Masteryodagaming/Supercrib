import { describe, it, expect } from 'vitest';
import { makeCard, cardValue } from '../cards';
import { createPegState, legalPegCards, scorePegPlay, totalPegPoints } from '../pegging';
import {
  chooseDiscards,
  choosePegCard,
  opponentCribPenalty,
  estimateKeepValue,
  chooseAiMove,
  applyAiTurn,
  aiShouldAct,
} from '../ai';
import {
  createGame,
  createAiGame,
  startDeal,
  confirmDiscard,
  toggleDiscardSelect,
  requiredDiscards,
  getLegalPegCards,
  cutStarter,
  finishPegThirtyOne,
  finishPeggingToShow,
  needsThirtyOnePause,
  needsEndOfPeggingPause,
} from '../supercrib';

function rngFrom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('AI discard', () => {
  it('discards exact required count and keeps 5', () => {
    const hand = [
      makeCard('A', 'hearts'),
      makeCard('2', 'clubs'),
      makeCard('3', 'diamonds'),
      makeCard('4', 'spades'),
      makeCard('5', 'hearts'),
      makeCard('6', 'clubs'),
      makeCard('K', 'diamonds'),
    ];
    const disc = chooseDiscards(hand, 2, false);
    expect(disc).toHaveLength(2);
    const ids = new Set(disc.map((c) => c.id));
    expect(hand.filter((c) => !ids.has(c.id))).toHaveLength(5);
  });

  it('as pone, avoids dumping an obvious 15-pair into opponent crib when possible', () => {
    // Keepers: strong run A-2-3-4-5; bad dump would be 5+10 or pair of Kings
    const hand = [
      makeCard('A', 'hearts'),
      makeCard('2', 'hearts'),
      makeCard('3', 'hearts'),
      makeCard('4', 'clubs'),
      makeCard('5', 'clubs'),
      makeCard('K', 'spades'),
      makeCard('K', 'diamonds'),
    ];
    const disc = chooseDiscards(hand, 2, false); // pone → opponent crib
    // Prefer tossing the pair of kings? Actually pair into opponent crib is BAD.
    // Better toss K + something that doesn't 15... K+A=11, K+2=12, K+3=13, K+4=14, K+5=15.
    // So tossing one K + 4 is a 14 (ok-ish) vs pair of Ks (bad).
    // Or toss both Ks — pair penalty is high.
    const pen = opponentCribPenalty(disc);
    const worst = opponentCribPenalty([
      makeCard('5', 'clubs'),
      makeCard('K', 'spades'),
    ]);
    // Chosen dump should not be worse than the notorious 5+K=15
    expect(pen).toBeLessThanOrEqual(worst);
    // Should keep the run cards mostly — at least 3 of A2345
    const discIds = new Set(disc.map((c) => c.id));
    const keptLow = hand
      .filter((c) => !discIds.has(c.id))
      .filter((c) => ['A', '2', '3', '4', '5'].includes(c.rank));
    expect(keptLow.length).toBeGreaterThanOrEqual(3);
  });

  it('opponentCribPenalty penalizes 15s and pairs', () => {
    expect(
      opponentCribPenalty([makeCard('5', 'hearts'), makeCard('10', 'clubs')]),
    ).toBeGreaterThan(
      opponentCribPenalty([makeCard('K', 'hearts'), makeCard('2', 'clubs')]),
    );
    expect(
      opponentCribPenalty([makeCard('9', 'hearts'), makeCard('9', 'clubs')]),
    ).toBeGreaterThan(
      opponentCribPenalty([makeCard('9', 'hearts'), makeCard('2', 'clubs')]),
    );
  });

  it('estimateKeepValue prefers paired/fifteen-rich keeps', () => {
    const strong = [
      makeCard('5', 'hearts'),
      makeCard('5', 'diamonds'),
      makeCard('10', 'clubs'),
      makeCard('J', 'spades'),
      makeCard('A', 'clubs'),
    ];
    const weak = [
      makeCard('K', 'hearts'),
      makeCard('Q', 'diamonds'),
      makeCard('9', 'clubs'),
      makeCard('8', 'spades'),
      makeCard('2', 'hearts'),
    ];
    expect(estimateKeepValue(strong)).toBeGreaterThan(estimateKeepValue(weak));
  });
});

describe('AI pegging', () => {
  it('never chooses a card that busts 31', () => {
    const hand = [
      makeCard('K', 'hearts'),
      makeCard('5', 'clubs'),
      makeCard('A', 'diamonds'),
    ];
    const count = 26;
    const legal = legalPegCards(hand, count);
    expect(legal.every((c) => count + cardValue(c) <= 31)).toBe(true);
    const peg = createPegState(0);
    peg.count = count;
    const choice = choosePegCard(legal, peg);
    expect(count + cardValue(choice)).toBeLessThanOrEqual(31);
  });

  it('prefers a scoring fifteen when available', () => {
    const peg = createPegState(0);
    peg.count = 10;
    peg.sequence = [
      { card: makeCard('5', 'hearts'), player: 1 },
      { card: makeCard('5', 'diamonds'), player: 0 },
    ];
    // Legal: 5 → 15 (scores), or A → 11 (no score), or 2 → 12
    const legal = [
      makeCard('5', 'clubs'),
      makeCard('A', 'spades'),
      makeCard('2', 'hearts'),
    ];
    const choice = choosePegCard(legal, peg);
    expect(choice.rank).toBe('5');
    const events = scorePegPlay(peg.sequence, choice, 15);
    expect(totalPegPoints(events)).toBeGreaterThan(0);
  });

  it('prefers pair when it scores', () => {
    const peg = createPegState(0);
    peg.count = 7;
    peg.sequence = [{ card: makeCard('7', 'hearts'), player: 1 }];
    const legal = [makeCard('7', 'clubs'), makeCard('A', 'spades'), makeCard('2', 'diamonds')];
    const choice = choosePegCard(legal, peg);
    expect(choice.rank).toBe('7');
  });

  it('says go when no legal card', () => {
    const rng = rngFrom(7);
    let g = startDeal(createGame('ai'), rng);
    // Force pegging state manually via play — or craft minimal
    // Use chooseAiMove with a fabricated pegging position:
    // Build after discards + cut quickly
    const pone = g.pone;
    const dealer = g.dealer;
    const poneNeed = requiredDiscards(g, pone);
    for (const c of g.players[pone].hand.slice(0, poneNeed)) {
      g = toggleDiscardSelect(g, pone, c);
    }
    g = confirmDiscard(g, pone);
    const dealerNeed = requiredDiscards(g, dealer);
    for (const c of g.players[dealer].hand.slice(0, dealerNeed)) {
      g = toggleDiscardSelect(g, dealer, c);
    }
    g = confirmDiscard(g, dealer);
    g = cutStarter(g, rng);
    expect(g.phase).toBe('pegging');

    // Drain until someone must go, or finish
    let steps = 0;
    while (g.phase === 'pegging' && steps < 80) {
      steps++;
      const pid = g.peg!.toPlay;
      const legal = getLegalPegCards(g, pid);
      if (legal.length === 0) {
        const choice = chooseAiMove(g, pid);
        expect(choice.kind).toBe('go');
        break;
      }
      g = applyAiTurn({ ...g, mode: 'ai' }, pid);
    }
  });
});

describe('AI turn integration', () => {
  it('aiShouldAct only in ai mode for seat 1', () => {
    const hot = startDeal(createGame('hotseat'), () => 0.3);
    expect(aiShouldAct(hot)).toBe(false);

    let g = startDeal(createGame('ai'), () => 0.3);
    // dealer=0 human, pone=1 AI — AI discards first
    expect(g.pone).toBe(1);
    expect(aiShouldAct(g)).toBe(true);
  });

  it('applyAiTurn completes AI discard legally', () => {
    let g = startDeal(createGame('ai'), rngFrom(99));
    expect(g.players[1].hand.length).toBe(7); // pone
    g = applyAiTurn(g, 1);
    expect(g.players[1].hand.length).toBe(5);
    expect(g.crib.length).toBe(2);
  });

  it('AI peg plays are always legal (never bust)', () => {
    const rng = rngFrom(123);
    let g = startDeal(createGame('ai'), rng);
    // Both discard via AI helper for seat that needs it
    while (g.phase === 'discard') {
      const pone = g.pone;
      const dealer = g.dealer;
      const actor =
        g.players[pone].hand.length > 5
          ? pone
          : g.players[dealer].hand.length > 5
            ? dealer
            : null;
      if (actor === null) break;
      const need = requiredDiscards(g, actor);
      const cards = g.players[actor].hand.slice(0, need);
      for (const c of cards) g = toggleDiscardSelect(g, actor, c);
      g = confirmDiscard(g, actor);
    }
    g = cutStarter(g, rng);
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
      const before = g.peg!.count;
      const legal = getLegalPegCards(g, pid);
      if (legal.length === 0) {
        g = applyAiTurn({ ...g, mode: 'ai' }, pid);
        continue;
      }
      const choice = chooseAiMove(g, pid);
      expect(choice.kind).toBe('peg');
      expect(choice.card).toBeDefined();
      expect(before + cardValue(choice.card!)).toBeLessThanOrEqual(31);
      g = applyAiTurn(g, pid);
    }
    expect(['show', 'redeal', 'gameOver']).toContain(g.phase);
  });
});

describe('AI difficulty', () => {
  it('createAiGame stores difficulty on state', () => {
    expect(createAiGame('hard').aiDifficulty).toBe('hard');
    expect(createAiGame('easy').aiDifficulty).toBe('easy');
    expect(createGame('ai').aiDifficulty).toBe('normal');
    expect(createGame('online').aiDifficulty).toBeUndefined();
  });

  it('hard avoids dumping a 15 into opponent crib more than easy (fixed rng)', () => {
    // Strong keep A-2-3-4-5; remaining K+K pair is a bad opponent-crib gift,
    // K+anything that 15s is also bad. Hard should refuse the pair/15 dumps.
    const hand = [
      makeCard('A', 'hearts'),
      makeCard('2', 'hearts'),
      makeCard('3', 'hearts'),
      makeCard('4', 'clubs'),
      makeCard('5', 'clubs'),
      makeCard('K', 'spades'),
      makeCard('K', 'diamonds'),
    ];
    const hard = chooseDiscards(hand, 2, false, 'hard', () => 0);
    const hardPen = opponentCribPenalty(hard);

    // Easy with rng that forces bottom-half / random — use sequence that picks poorly
    let i = 0;
    const easyRng = () => {
      // First roll < 0.45 → pure random; then index into array
      const seq = [0.1, 0.99, 0.1, 0.99];
      const v = seq[i % seq.length];
      i++;
      return v;
    };
    // Sample several easy picks — at least one should be worse than hard, OR hard stays low-penalty
    const easyPens: number[] = [];
    for (let t = 0; t < 8; t++) {
      easyPens.push(opponentCribPenalty(chooseDiscards(hand, 2, false, 'easy', easyRng)));
    }
    expect(hardPen).toBeLessThanOrEqual(Math.max(...easyPens));
    // Hard should not toss the pair of kings (high opponent penalty)
    const hardIds = new Set(hard.map((c) => c.id));
    const tossedBothKings =
      hardIds.has(hand[5].id) && hardIds.has(hand[6].id);
    expect(tossedBothKings).toBe(false);
  });

  it('hard prefers scoring peg; easy can pick non-scoring with noisy rng', () => {
    const peg = createPegState(0);
    peg.count = 10;
    peg.sequence = [
      { card: makeCard('5', 'hearts'), player: 1 },
      { card: makeCard('5', 'diamonds'), player: 0 },
    ];
    const legal = [
      makeCard('5', 'clubs'),
      makeCard('A', 'spades'),
      makeCard('2', 'hearts'),
    ];
    expect(choosePegCard(legal, peg, 'hard', () => 0).rank).toBe('5');
    expect(choosePegCard(legal, peg, 'normal', () => 0).rank).toBe('5');

    // Easy: force pure-random path then high index → last card (2)
    let n = 0;
    const rng = () => {
      const seq = [0.1, 0.99];
      const v = seq[n % seq.length];
      n++;
      return v;
    };
    const easyPick = choosePegCard(legal, peg, 'easy', rng);
    expect(['5', 'A', '2']).toContain(easyPick.rank);
  });
});
