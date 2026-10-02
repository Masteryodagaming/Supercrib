/** Pure card types and deck helpers — no UI. */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
  /** Stable id for React keys / equality: e.g. "AS", "10H" */
  id: string;
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS: Rank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];

/** Face value for pegging / fifteens (A=1, J/Q/K=10). */
export function cardValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return parseInt(card.rank, 10);
}

/** Order for runs: A=1 … K=13. */
export function rankOrder(rank: Rank): number {
  const map: Record<Rank, number> = {
    A: 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    J: 11,
    Q: 12,
    K: 13,
  };
  return map[rank];
}

export function makeCard(rank: Rank, suit: Suit): Card {
  const suitLetter =
    suit === 'hearts' ? 'H' : suit === 'diamonds' ? 'D' : suit === 'clubs' ? 'C' : 'S';
  return { rank, suit, id: `${rank}${suitLetter}` };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

/** Fisher–Yates shuffle; returns new array. Optional RNG for tests. */
export function shuffle(deck: Card[], rng: () => number = Math.random): Card[] {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isRed(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/** Starter suit applies show multiplier? Spades = raw only (no ×2). */
export function showMultiplier(starter: Card): number {
  return starter.suit === 'spades' ? 1 : 2;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.id === b.id;
}
