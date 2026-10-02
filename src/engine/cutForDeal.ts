/**
 * Classic crib cut-for-deal helpers (Ace low).
 * Pure — no UI. Does not change Supercrib scoring.
 */

import { Card, createDeck, shuffle, rankOrder } from './cards';
import type { GameState, PlayerId } from './supercrib';

export type CutCompare = 'a' | 'b' | 'tie';

/**
 * Compare two cut cards for deal: lowest rank deals.
 * Ace is low (A=1 … K=13). Suit is ignored. Same rank → tie.
 */
export function compareCutRanks(a: Card, b: Card): CutCompare {
  const oa = rankOrder(a.rank);
  const ob = rankOrder(b.rank);
  if (oa < ob) return 'a';
  if (ob < oa) return 'b';
  return 'tie';
}

/**
 * Winner of the cut (lower card) becomes dealer.
 * Returns null on a tie (cut again).
 */
export function dealerFromCutCards(seat0: Card, seat1: Card): PlayerId | null {
  const c = compareCutRanks(seat0, seat1);
  if (c === 'tie') return null;
  return c === 'a' ? 0 : 1;
}

/** Fresh shuffled stock for a cut-for-deal round. */
export function createCutStock(rng: () => number = Math.random): Card[] {
  return shuffle(createDeck(), rng);
}

/** Remove one card at index from the stock (player/AI cut). */
export function takeCutCard(
  deck: Card[],
  index: number,
): { card: Card; remaining: Card[] } {
  if (deck.length === 0) {
    throw new Error('empty cut stock');
  }
  const i = Math.max(0, Math.min(deck.length - 1, Math.floor(index)));
  const card = deck[i];
  const remaining = [...deck.slice(0, i), ...deck.slice(i + 1)];
  return { card, remaining };
}

/** Assign dealer / pone from a resolved cut (no deal yet). */
export function withDealer(state: GameState, dealer: PlayerId): GameState {
  const pone = (1 - dealer) as PlayerId;
  return {
    ...state,
    dealer,
    pone,
    phase: 'deal',
    message:
      dealer === 0
        ? 'You won the cut — you deal first.'
        : 'Opponent won the cut — they deal first.',
  };
}
