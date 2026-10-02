import { describe, it, expect } from 'vitest';
import { makeCard } from '../cards';
import { scoreHand, classic29Cards } from '../scoreHand';

describe('show scoring', () => {
  it('scores fifteens, pairs, runs, flush, nobs', () => {
    // Simple: 5H 5D 10C 10D AH + starter 5C
    // This is exploratory — classic 29 covered below
    const hand = [
      makeCard('A', 'hearts'),
      makeCard('2', 'hearts'),
      makeCard('3', 'hearts'),
      makeCard('4', 'hearts'),
      makeCard('4', 'diamonds'),
    ];
    const starter = makeCard('5', 'clubs'); // non-spade → ×2
    const s = scoreHand(hand, starter, false);
    // Run A-2-3-4-5 = 5, pair of 4s = 2, fifteens: A+4+5+5? values A2 3 4 4 5
    // fifteens with A,2,3,4,4,5:
    // 15s: (A+2+3+4+5)=15 twice (two 4s) = 4; (A+4+5+5? only one 5)
    // (2+3+4+6 no); (4+5+6 no); (A+5+9 no)
    // Actually: A+4+10 no. Cards: 1,2,3,4,4,5
    // 1+4+5+5 — only one 5. 1+2+3+4+5 = 15 (×2 for two 4s) = 4 pts
    // 2+4+4+5 = 15 → 2 pts
    // 3+4+...? 3+4+8 no; 3+5+7 no; 4+5+6 no
    // Total fifteens = 6
    // pairs: one pair of 4s = 2
    // runs: A-2-3-4-5 length 5 × mult(4 appears twice)=10
    // flush: hearts on 4 of 5 hand cards? hand has 4H and 4D — not flush
    // nobs: 0
    // raw = 6+2+10 = 18, ×2 = 36
    expect(s.fifteens).toBe(6);
    expect(s.pairs).toBe(2);
    expect(s.runs).toBe(10);
    expect(s.raw).toBe(18);
    expect(s.multiplier).toBe(2);
    expect(s.total).toBe(36);
  });

  it('classic 29 hand: raw 29', () => {
    const { hand, starter } = classic29Cards();
    const s = scoreHand(hand, starter, false);
    expect(s.raw).toBe(29);
    // 8 fifteens (16) + 6 pairs from 4 fives? 4 fives = C(4,2)*2 = 12 pairs pts
    // + nobs 1 = 29. No run/flush.
    expect(s.fifteens).toBe(16);
    expect(s.pairs).toBe(12);
    expect(s.nobs).toBe(1);
  });

  it('non-spade Supercrib show doubles classic 29 → 58', () => {
    const { hand, starter } = classic29Cards(); // starter 5C
    expect(starter.suit).not.toBe('spades');
    const s = scoreHand(hand, starter, false);
    expect(s.raw).toBe(29);
    expect(s.multiplier).toBe(2);
    expect(s.total).toBe(58);
  });

  it('spade starter mutes ×2 — classic 29 stays 29', () => {
    // Spade starter that still makes 29: need four 5s + JC nobs for clubs... 
    // Classic needs starter 5♣ for nobs on JC. For spade mute test use 5♠ as starter
    // but then we only have three 5s in hand + need fourth 5 elsewhere.
    // Spec: "spade 29" meaning raw 29 with spade starter → total 29.
    // Use hand 5H 5D 5C JC + starter 5S:
    // Four 5s + JC: fifteens 16, pairs 12, nobs? JC vs spade starter = no nobs → 28.
    // For exact 29 with spade starter: hand 5H 5D 5C JS + starter 5S → nobs yes (JS)
    const handSpade = [
      makeCard('5', 'hearts'),
      makeCard('5', 'diamonds'),
      makeCard('5', 'clubs'),
      makeCard('J', 'spades'),
    ];
    const starter = makeCard('5', 'spades');
    const s = scoreHand(handSpade, starter, false);
    expect(s.raw).toBe(29);
    expect(s.multiplier).toBe(1);
    expect(s.total).toBe(29);
  });

  it('crib flush only if all 5 crib + starter same suit', () => {
    const crib = [
      makeCard('2', 'hearts'),
      makeCard('4', 'hearts'),
      makeCard('6', 'hearts'),
      makeCard('8', 'hearts'),
      makeCard('10', 'hearts'),
    ];
    const starterMatch = makeCard('K', 'hearts');
    const starterMiss = makeCard('K', 'clubs');
    const withFlush = scoreHand(crib, starterMatch, true);
    const noFlush = scoreHand(crib, starterMiss, true);
    expect(withFlush.flush).toBe(6);
    expect(noFlush.flush).toBe(0);
  });
});
