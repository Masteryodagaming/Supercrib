import { describe, expect, it } from 'vitest';
import { makeCard } from '../cards';
import { scoreHand } from '../scoreHand';
import {
  GameState,
  PlayerState,
  ackShowContinue,
  createGame,
  nextRound,
  redealSameDealer,
} from '../supercrib';

function fiveCards() {
  return [
    makeCard('5', 'hearts'),
    makeCard('5', 'diamonds'),
    makeCard('5', 'clubs'),
    makeCard('J', 'spades'),
    makeCard('A', 'clubs'),
  ];
}

function showBreakdown() {
  return scoreHand(fiveCards(), makeCard('4', 'hearts'), false);
}

function showState(mode: GameState['mode']): GameState {
  const p: PlayerState = {
    hand: [],
    played: fiveCards(),
    score: 30,
    discardSel: [],
  };
  const base = createGame(mode);
  const bd = showBreakdown();
  return {
    ...base,
    phase: 'show',
    dealer: 0,
    pone: 1,
    players: [
      { ...p, score: 33 },
      { ...p, score: 36 },
    ],
    crib: fiveCards(),
    starter: makeCard('4', 'hearts'),
    showResult: {
      pone: bd,
      dealer: bd,
      crib: bd,
      zeroHandRedeal: false,
      zeroCribPenalty: 0,
      scoresAfter: [33, 36],
    },
    showReady: [false, false],
    dealNumber: 2,
  };
}

function redealState(mode: GameState['mode']): GameState {
  const g = showState(mode);
  return {
    ...g,
    phase: 'redeal',
    showResult: {
      ...g.showResult!,
      zeroHandRedeal: true,
      scoresAfter: [g.players[0].score, g.players[1].score],
    },
  };
}

describe('ackShowContinue — online dual ack', () => {
  it('one online ack stays in show with that seat ready', () => {
    let g = showState('online');
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('show');
    expect(g.showReady).toEqual([true, false]);
    expect(g.showResult).not.toBeNull();
  });

  it('second online ack advances to next deal', () => {
    let g = showState('online');
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('show');
    g = ackShowContinue(g, 1);
    expect(g.phase).toBe('discard');
    expect(g.showResult).toBeNull();
    expect(g.showReady).toEqual([false, false]);
    expect(g.dealNumber).toBe(3);
    // Dealer rotated
    expect(g.dealer).toBe(1);
  });

  it('duplicate ack from same seat is a no-op', () => {
    let g = showState('online');
    g = ackShowContinue(g, 1);
    const again = ackShowContinue(g, 1);
    expect(again).toEqual(g);
    expect(again.showReady).toEqual([false, true]);
  });

  it('online zero-hand redeal also requires both acks', () => {
    let g = redealState('online');
    g = ackShowContinue(g, 1);
    expect(g.phase).toBe('redeal');
    expect(g.showReady).toEqual([false, true]);
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('discard');
    expect(g.dealer).toBe(0); // same dealer
    expect(g.showReady).toEqual([false, false]);
  });
});

describe('ackShowContinue — hotseat / AI one-click', () => {
  it('hotseat single ack advances', () => {
    let g = showState('hotseat');
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('discard');
    expect(g.showReady).toEqual([false, false]);
  });

  it('AI mode single ack advances (AI does not need a second click)', () => {
    let g = showState('ai');
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('discard');
  });

  it('hotseat redeal one-click works', () => {
    let g = redealState('hotseat');
    g = ackShowContinue(g, 0);
    expect(g.phase).toBe('discard');
    expect(g.dealer).toBe(0);
  });
});

describe('showReady cleared on enter / leave show', () => {
  it('nextRound clears showReady', () => {
    const g = showState('online');
    g.showReady = [true, true];
    const n = nextRound(g);
    expect(n.showReady).toEqual([false, false]);
  });

  it('redealSameDealer clears showReady', () => {
    const g = redealState('online');
    g.showReady = [true, false];
    const n = redealSameDealer(g);
    expect(n.showReady).toEqual([false, false]);
  });
});
