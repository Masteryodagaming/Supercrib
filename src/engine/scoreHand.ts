/**
 * Hand / crib show scoring (pure).
 * Classic cribbage combinations on hand cards + starter,
 * then Supercrib starter ×2 (spade starter = raw only).
 * Competitive uses the same totals; only claim UX differs.
 */

import { Card, cardValue, rankOrder, showMultiplier, Rank } from './cards';
import { type ScoringMode } from './competitiveScoring';

export interface ScoreBreakdown {
  fifteens: number;
  pairs: number;
  runs: number;
  flush: number;
  nobs: number;
  /** Sum before starter multiplier. */
  raw: number;
  /** 1 for spade starter; 2 otherwise (SuperCrib). */
  multiplier: number;
  /** Final show points after ×2 rule. */
  total: number;
}

export interface ScoreHandOptions {
  /** Kept for API/call-site compatibility; does not change SuperCrib totals. */
  scoringMode?: ScoringMode;
}

/**
 * Score a hand or crib with starter.
 * Game uses 5-card hands/cribs. Classic 29 test may pass 4 cards.
 * @param isCrib Flush only if all hand cards AND starter same suit (then 5+1 or handLen+1 pts).
 */
export function scoreHand(
  hand: Card[],
  starter: Card,
  isCrib = false,
  _opts?: ScoreHandOptions,
): ScoreBreakdown {
  if (hand.length < 4) {
    throw new Error(`scoreHand expects at least 4 cards, got ${hand.length}`);
  }

  const all = [...hand, starter];
  const fifteens = scoreFifteens(all);
  const pairs = scorePairs(all);
  const runs = scoreRuns(all);
  const flush = scoreFlush(hand, starter, isCrib);
  const nobs = scoreNobs(hand, starter);
  const raw = fifteens + pairs + runs + flush + nobs;
  const multiplier = showMultiplier(starter);
  const total = raw * multiplier;

  return { fifteens, pairs, runs, flush, nobs, raw, multiplier, total };
}

export function applyStarterMultiplier(
  raw: number,
  starter: Card,
  _opts?: ScoreHandOptions,
): number {
  return raw * showMultiplier(starter);
}

function scoreFifteens(cards: Card[]): number {
  let points = 0;
  const n = cards.length;
  const limit = 1 << n;
  for (let mask = 1; mask < limit; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += cardValue(cards[i]);
    }
    if (sum === 15) points += 2;
  }
  return points;
}

function scorePairs(cards: Card[]): number {
  const byRank = new Map<Rank, number>();
  for (const c of cards) {
    byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1);
  }
  let points = 0;
  for (const count of byRank.values()) {
    if (count === 2) points += 2;
    else if (count === 3) points += 6;
    else if (count === 4) points += 12;
  }
  return points;
}

function scoreRuns(cards: Card[]): number {
  const orders = cards.map((c) => rankOrder(c.rank)).sort((a, b) => a - b);
  // Group identical ranks for multiplicity, then walk consecutive sequences.
  const groups: { order: number; mult: number }[] = [];
  for (const o of orders) {
    const last = groups[groups.length - 1];
    if (last && last.order === o) last.mult += 1;
    else groups.push({ order: o, mult: 1 });
  }
  let points = 0;
  let i = 0;
  while (i < groups.length) {
    let j = i;
    while (j + 1 < groups.length && groups[j + 1].order === groups[j].order + 1) {
      j += 1;
    }
    const len = j - i + 1;
    if (len >= 3) {
      let mult = 1;
      for (let k = i; k <= j; k++) mult *= groups[k].mult;
      points += len * mult;
    }
    i = j + 1;
  }
  return points;
}

function scoreFlush(hand: Card[], starter: Card, isCrib: boolean): number {
  const suit = hand[0]?.suit;
  if (!suit || !hand.every((c) => c.suit === suit)) return 0;
  if (isCrib) {
    return starter.suit === suit ? hand.length + 1 : 0;
  }
  return starter.suit === suit ? hand.length + 1 : hand.length;
}

function scoreNobs(hand: Card[], starter: Card): number {
  for (const c of hand) {
    if (c.rank === 'J' && c.suit === starter.suit) return 1;
  }
  return 0;
}

/**
 * 5♥ 5♦ 5♠ J♣, starter 5♣ → raw 29.
 */
export function classic29Cards(): { hand: Card[]; starter: Card } {
  return {
    hand: [
      { rank: '5', suit: 'hearts', id: '5H' },
      { rank: '5', suit: 'diamonds', id: '5D' },
      { rank: '5', suit: 'spades', id: '5S' },
      { rank: 'J', suit: 'clubs', id: 'JC' },
    ],
    starter: { rank: '5', suit: 'clubs', id: '5C' },
  };
}
