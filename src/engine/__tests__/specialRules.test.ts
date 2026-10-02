import { describe, it, expect } from 'vitest';
import { makeCard, type Card } from '../cards';
import { scoreHand } from '../scoreHand';
import { createPegState } from '../pegging';
import {
  applyPoints,
  applyPenalty,
  isTrapped,
  TRAP_SCORE,
  TARGET,
  createGame,
  startDeal,
  withScores,
  finishPeggingToShow,
  cutStarter,
  resolveZeroHandOffer,
  playPegCard,
  type GameState,
  type PlayerState,
  type PlayerId,
} from '../supercrib';

/** Known dead hand + starter (no fifteens/pairs/runs/flush/nobs). */
function zeroShow() {
  return {
    hand: [
      makeCard('K', 'hearts'),
      makeCard('Q', 'diamonds'),
      makeCard('9', 'clubs'),
      makeCard('8', 'spades'),
      makeCard('2', 'hearts'),
    ],
    starter: makeCard('A', 'spades'),
  };
}


/** Scoring hand (>0) with A♠ starter; disjoint from zeroShow(). */
function scoringHand(): Card[] {
  return [
    makeCard('5', 'hearts'),
    makeCard('5', 'diamonds'),
    makeCard('5', 'clubs'),
    makeCard('J', 'spades'),
    makeCard('A', 'clubs'),
  ];
}

/** Second scoring hand (>0) with A♠ starter; disjoint from zeroShow + scoringHand. */
function scoringHandB(): Card[] {
  return [
    makeCard('6', 'hearts'),
    makeCard('6', 'diamonds'),
    makeCard('6', 'clubs'),
    makeCard('3', 'spades'),
    makeCard('4', 'hearts'),
  ];
}

/**
 * End-of-pegging GameState ready for finishPeggingToShow → beginShow.
 * Both hands empty, sequenceDone, count ≠ 31 so needsEndOfPeggingPause holds.
 */
function endOfPeggingForShow(opts: {
  dealer?: PlayerId;
  ponePlayed: Card[];
  dealerPlayed: Card[];
  crib: Card[];
  starter: Card;
  scores?: [number, number];
}): GameState {
  const dealer: PlayerId = opts.dealer ?? 0;
  const pone = (1 - dealer) as PlayerId;
  const scores = opts.scores ?? [40, 50];
  const peg = createPegState(pone);
  peg.sequenceDone = true;
  peg.count = 20; // not 31 — avoids thirty-one pause path

  const players: [PlayerState, PlayerState] = [
    { hand: [], played: [], score: scores[0], discardSel: [] },
    { hand: [], played: [], score: scores[1], discardSel: [] },
  ];
  players[dealer] = {
    hand: [],
    played: opts.dealerPlayed,
    score: scores[dealer],
    discardSel: [],
  };
  players[pone] = {
    hand: [],
    played: opts.ponePlayed,
    score: scores[pone],
    discardSel: [],
  };

  return {
    ...createGame('hotseat'),
    phase: 'pegging',
    dealer,
    pone,
    players,
    crib: opts.crib,
    starter: opts.starter,
    peg,
    winner: null,
    message: 'end of pegging fixture',
  };
}

describe('×2 vs spade', () => {
  it('non-spade doubles; spade does not', () => {
    const hand = [
      makeCard('A', 'clubs'),
      makeCard('A', 'diamonds'),
      makeCard('A', 'hearts'),
      makeCard('2', 'clubs'),
      makeCard('3', 'clubs'),
    ];
    const clubStarter = makeCard('4', 'clubs');
    const spadeStarter = makeCard('4', 'spades');
    const a = scoreHand(hand, clubStarter, false);
    const b = scoreHand(hand, spadeStarter, false);
    expect(a.multiplier).toBe(2);
    expect(b.multiplier).toBe(1);
    expect(a.total).toBe(a.raw * 2);
    expect(b.total).toBe(b.raw);
    expect(a.raw).toBe(b.raw);
  });
});

describe('0-hand redeal', () => {
  it('detects zero hand show after starter rule', () => {
    const { hand, starter } = zeroShow();
    const s = scoreHand(hand, starter, false);
    expect(s.raw).toBe(0);
    expect(s.total).toBe(0);
  });

  it('zero-hand flag voids deal conceptually (engine beginShow path)', () => {
    const z = scoreHand(zeroShow().hand, zeroShow().starter, false);
    const other = scoreHand(
      [
        makeCard('5', 'hearts'),
        makeCard('5', 'diamonds'),
        makeCard('5', 'clubs'),
        makeCard('J', 'spades'),
        makeCard('A', 'clubs'),
      ],
      zeroShow().starter,
      false,
    );
    const zeroHandRedeal = z.total === 0 || other.total === 0;
    expect(z.total).toBe(0);
    expect(zeroHandRedeal).toBe(true);
  });
});

describe('0-crib −30', () => {
  it('dealer loses 30 floored at 0', () => {
    expect(applyPenalty(50, 30)).toBe(20);
    expect(applyPenalty(20, 30)).toBe(0);
    expect(applyPenalty(0, 30)).toBe(0);
  });

  it('zero crib total triggers −30 rule', () => {
    const { hand: crib, starter } = zeroShow();
    const s = scoreHand(crib, starter, true);
    expect(s.total).toBe(0);
    const dealerScore = applyPenalty(100, 30);
    expect(dealerScore).toBe(70);
  });
});


describe('beginShow via finishPeggingToShow — zero-hand redeal', () => {
  it('zero pone hand → redeal, scores unchanged, no show points', () => {
    const { hand: dead, starter } = zeroShow();
    const other = scoringHand();
    const crib = scoringHandB();

    // Confirm fixture math
    expect(scoreHand(dead, starter, false).total).toBe(0);
    expect(scoreHand(other, starter, false).total).toBeGreaterThan(0);

    const preScores: [number, number] = [55, 70];
    let g = endOfPeggingForShow({
      dealer: 0,
      ponePlayed: dead, // pone=1
      dealerPlayed: other,
      crib,
      starter,
      scores: preScores,
    });

    g = finishPeggingToShow(g);

    expect(g.phase).toBe('zeroHandOffer');
    expect(g.showResult).not.toBeNull();
    expect(g.showResult!.zeroHandRedeal).toBe(true);
    expect(g.showResult!.pone.total).toBe(0);
    expect(g.showResult!.dealer.total).toBeGreaterThan(0);
    g = resolveZeroHandOffer(g, 'redeal');
    expect(g.phase).toBe('discard');
    expect(g.showResult).toBeNull();
    expect(g.players[0].score).toBe(preScores[0]);
    expect(g.players[1].score).toBe(preScores[1]);
    expect(g.dealer).toBe(0); // same dealer
  });

  it('zero dealer hand → redeal even if pone scores', () => {
    const { hand: dead, starter } = zeroShow();
    let g = endOfPeggingForShow({
      dealer: 0,
      ponePlayed: scoringHand(),
      dealerPlayed: dead,
      crib: scoringHandB(),
      starter,
      scores: [12, 18],
    });
    g = finishPeggingToShow(g);
    expect(g.phase).toBe('zeroHandOffer');
    expect(g.showResult!.zeroHandRedeal).toBe(true);
    g = resolveZeroHandOffer(g, 'redeal');
    expect(g.phase).toBe('discard');
    expect(g.players[0].score).toBe(12);
    expect(g.players[1].score).toBe(18);
    expect(g.dealer).toBe(0);
  });
});

describe('beginShow via finishPeggingToShow — zero-crib −30', () => {
  it('both hands >0 and zero crib → show, dealer −30', () => {
    const { hand: deadCrib, starter } = zeroShow();
    const poneH = scoringHand();
    const dealerH = scoringHandB();

    expect(scoreHand(poneH, starter, false).total).toBeGreaterThan(0);
    expect(scoreHand(dealerH, starter, false).total).toBeGreaterThan(0);
    expect(scoreHand(deadCrib, starter, true).total).toBe(0);

    const dealerStart = 100;
    const poneStart = 80;
    // dealer=0 score 100, pone=1 score 80
    let g = endOfPeggingForShow({
      dealer: 0,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib: deadCrib,
      starter,
      scores: [dealerStart, poneStart],
    });

    const ponePts = scoreHand(poneH, starter, false).total;
    const dealerPts = scoreHand(dealerH, starter, false).total;

    g = finishPeggingToShow(g);

    expect(g.phase).toBe('show');
    expect(g.showResult!.zeroHandRedeal).toBe(false);
    expect(g.showResult!.zeroCribPenalty).toBe(30);
    expect(g.showResult!.crib.total).toBe(0);
    // Order: pone then dealer then crib penalty
    expect(g.players[1].score).toBe(poneStart + ponePts);
    expect(g.players[0].score).toBe(dealerStart + dealerPts - 30);
    expect(g.message).toMatch(/Zero crib/i);
  });

  it('dealer at 20 before crib penalty floors at 0', () => {
    const { hand: deadCrib, starter } = zeroShow();
    const poneH = scoringHand();
    const dealerH = scoringHandB();
    const dealerPts = scoreHand(dealerH, starter, false).total;

    // Choose pre-show dealer score so after hand show points they sit at 20
    // before crib −30: dealerStart + dealerPts === 20
    const dealerStart = 20 - dealerPts;
    expect(dealerStart).toBeGreaterThanOrEqual(0);

    let g = endOfPeggingForShow({
      dealer: 0,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib: deadCrib,
      starter,
      scores: [dealerStart, 50],
    });

    g = finishPeggingToShow(g);

    expect(g.phase).toBe('show');
    expect(g.showResult!.zeroCribPenalty).toBe(30);
    expect(g.players[0].score).toBe(0);
    expect(g.showResult!.scoresAfter[0]).toBe(0);
  });
});

describe('240 trap last-card-31', () => {
  it('is trapped at exactly 240', () => {
    expect(isTrapped(TRAP_SCORE)).toBe(true);
    expect(isTrapped(239)).toBe(false);
    expect(isTrapped(241)).toBe(false);
  });

  it('cannot win via normal pegging or show from 240', () => {
    const blocked = applyPoints(240, 2, { trapEscape: false });
    expect(blocked.score).toBe(240);
    expect(blocked.won).toBe(false);
    expect(blocked.trapBlocked).toBe(true);

    const showBlocked = applyPoints(240, 58, { trapEscape: false });
    expect(showBlocked.score).toBe(240);
    expect(showBlocked.won).toBe(false);
  });

  it('ONLY wins from 240 via last-card exact 31 (trapEscape)', () => {
    const esc = applyPoints(240, 2, { trapEscape: true });
    expect(esc.won).toBe(true);
    expect(esc.score).toBe(TARGET);
    expect(esc.trapBlocked).toBe(false);
  });

  it('can land on 240 without winning', () => {
    const r = applyPoints(238, 2, {});
    expect(r.score).toBe(240);
    expect(r.won).toBe(false);
  });

  it('from 239, +2 wins at 241', () => {
    const r = applyPoints(239, 2, {});
    expect(r.won).toBe(true);
    expect(r.score).toBe(TARGET);
  });

  it('opponent can win normally while you are trapped', () => {
    let g = startDeal(createGame('hotseat'), () => 0.5);
    g = withScores(g, 240, 230);
    expect(g.trapped[0]).toBe(true);
    const opp = applyPoints(g.players[1].score, 12, {});
    expect(opp.won).toBe(true);
  });

  /** Player 0 at 240, count 30, plays Ace → exact 31 with cards still in hand. */
  function stinkHoleThirtyOneFixture(remainingExtras: number): GameState {
    const escapeAce = makeCard('A', 'hearts');
    const extras = [
      makeCard('2', 'clubs'),
      makeCard('3', 'diamonds'),
      makeCard('4', 'spades'),
      makeCard('6', 'hearts'),
    ].slice(0, remainingExtras);
    const p0: PlayerState = {
      hand: [escapeAce, ...extras],
      played: [makeCard('10', 'clubs'), makeCard('K', 'diamonds')],
      score: TRAP_SCORE,
      discardSel: [],
    };
    const p1: PlayerState = {
      hand: [makeCard('K', 'hearts'), makeCard('Q', 'spades')],
      played: [makeCard('10', 'hearts')],
      score: 200,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 30;
    peg.sequence = [
      { card: makeCard('10', 'clubs'), player: 0 },
      { card: makeCard('10', 'hearts'), player: 1 },
      { card: makeCard('K', 'diamonds'), player: 0 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;
    return {
      ...createGame('hotseat'),
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [p0, p1],
      crib: [
        makeCard('2', 'hearts'),
        makeCard('3', 'clubs'),
        makeCard('4', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('8', 'clubs'),
      ],
      starter: makeCard('9', 'hearts'),
      peg,
      message: 'stinkhole-31',
      winner: null,
      trapped: [true, false],
      dealNumber: 3,
    };
  }

  it('escapes StinkHole by pegging exact 31 even with cards still in hand', () => {
    let g = stinkHoleThirtyOneFixture(2);
    expect(g.players[0].score).toBe(TRAP_SCORE);
    expect(g.players[0].hand.length).toBe(3);
    const ace = makeCard('A', 'hearts');
    g = playPegCard(g, 0, ace);
    expect(g.peg!.count).toBe(31);
    expect(g.players[0].score).toBe(TARGET);
    expect(g.winner).toBe(0);
    expect(g.trapEscapeWin).toBe(true);
    expect(g.phase).toBe('gameOver');
    expect(g.players[0].hand.length).toBe(2); // still had cards — escape still counts
  });

  it('escapes StinkHole by pegging exact 31 as last card in hand', () => {
    let g = stinkHoleThirtyOneFixture(0);
    const ace = makeCard('A', 'hearts');
    g = playPegCard(g, 0, ace);
    expect(g.winner).toBe(0);
    expect(g.trapEscapeWin).toBe(true);
    expect(g.players[0].score).toBe(TARGET);
  });

  it('blocks non-31 peg points while in StinkHole (pair at count < 31)', () => {
    const seven = makeCard('7', 'hearts');
    const p0: PlayerState = {
      hand: [seven, makeCard('2', 'clubs')],
      played: [makeCard('7', 'clubs')],
      score: TRAP_SCORE,
      discardSel: [],
    };
    const p1: PlayerState = {
      hand: [makeCard('K', 'hearts')],
      played: [],
      score: 100,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 7;
    peg.sequence = [{ card: makeCard('7', 'clubs'), player: 0 }];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    let g: GameState = {
      ...createGame('hotseat'),
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [p0, p1],
      crib: [
        makeCard('2', 'hearts'),
        makeCard('3', 'clubs'),
        makeCard('4', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('8', 'clubs'),
      ],
      starter: makeCard('9', 'hearts'),
      peg,
      message: 'stinkhole-pair-blocked',
      winner: null,
      trapped: [true, false],
    };
    g = playPegCard(g, 0, seven);
    expect(g.peg!.count).toBe(14);
    expect(g.players[0].score).toBe(TRAP_SCORE); // pair +2 blocked
    expect(g.winner).toBeNull();
    expect(g.lastPegFlash?.blocked).toBe(true);
  });
});

describe('0-hand redeal right after cut', () => {
  it('voids the deal before pegging when a hand is 0 with starter', () => {
    const { hand: dead, starter } = zeroShow();
    const other = scoringHand();
    const crib = scoringHandB();

    let g = startDeal(createGame('ai'));
    g = {
      ...g,
      phase: 'cut',
      dealer: 0,
      pone: 1,
      crib,
      starter: null,
      deck: [starter, ...g.deck.filter((c) => c.id !== starter.id)],
      players: [
        { ...g.players[0], hand: other, played: [], discardSel: [] },
        { ...g.players[1], hand: dead, played: [], discardSel: [] },
      ],
    };

    g = cutStarter(g, 0);
    expect(g.starter?.id).toBe(starter.id);
    expect(g.phase).toBe('zeroHandOffer');
    expect(g.showResult?.zeroHandRedeal).toBe(true);

    const continued = resolveZeroHandOffer(g, 'continue');
    expect(continued.phase).toBe('pegging');
    expect(continued.showResult).toBeNull();

    const voided = resolveZeroHandOffer(g, 'redeal');
    expect(voided.phase).toBe('discard');
    expect(voided.dealer).toBe(g.dealer);
    expect(voided.showResult).toBeNull();
  });
});
