import { describe, it, expect } from 'vitest';
import { makeCard } from '../cards';
import {
  compareCutRanks,
  dealerFromCutCards,
  takeCutCard,
  createCutStock,
  withDealer,
} from '../cutForDeal';
import { createGame } from '../supercrib';

describe('cut for deal (Ace low)', () => {
  it('Ace beats every higher rank (Ace is low)', () => {
    const ace = makeCard('A', 'spades');
    const two = makeCard('2', 'hearts');
    const king = makeCard('K', 'clubs');
    expect(compareCutRanks(ace, two)).toBe('a');
    expect(compareCutRanks(two, ace)).toBe('b');
    expect(compareCutRanks(ace, king)).toBe('a');
    expect(dealerFromCutCards(ace, king)).toBe(0);
    expect(dealerFromCutCards(king, ace)).toBe(1);
  });

  it('lower middle ranks beat higher; suit ignored', () => {
    const fiveH = makeCard('5', 'hearts');
    const fiveS = makeCard('5', 'spades');
    const six = makeCard('6', 'clubs');
    expect(compareCutRanks(fiveH, six)).toBe('a');
    expect(dealerFromCutCards(six, fiveH)).toBe(1);
    // Same rank → tie regardless of suit
    expect(compareCutRanks(fiveH, fiveS)).toBe('tie');
    expect(dealerFromCutCards(fiveH, fiveS)).toBeNull();
  });

  it('tie when same rank (cut again)', () => {
    const qh = makeCard('Q', 'hearts');
    const qd = makeCard('Q', 'diamonds');
    expect(compareCutRanks(qh, qd)).toBe('tie');
    expect(dealerFromCutCards(qh, qd)).toBeNull();
  });

  it('takeCutCard removes the chosen index', () => {
    const deck = createCutStock(() => 0.42);
    expect(deck.length).toBe(52);
    const { card, remaining } = takeCutCard(deck, 10);
    expect(remaining.length).toBe(51);
    expect(remaining.some((c) => c.id === card.id)).toBe(false);
    expect(card.id).toBe(deck[10].id);
  });

  it('withDealer sets dealer and pone without dealing', () => {
    const g = withDealer(createGame('ai'), 1);
    expect(g.dealer).toBe(1);
    expect(g.pone).toBe(0);
    expect(g.dealNumber).toBe(0);
    expect(g.players[0].hand).toEqual([]);
  });
});
