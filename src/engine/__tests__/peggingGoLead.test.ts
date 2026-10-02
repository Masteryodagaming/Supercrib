import { describe, it, expect } from 'vitest';
import { makeCard } from '../cards';
import { createPegState, applyGo, canPlayAny } from '../pegging';
import {
  createGame,
  sayGo,
  playPegCard,
  resolveForcedPegGoes,
  finishPegThirtyOne,
  finishPeggingToShow,
  needsThirtyOnePause,
  needsGoPause,
  needsEndOfPeggingPause,
  PlayerId,
  GameState,
  PlayerState,
} from '../supercrib';

/** Mid-hand pegging: count 28, AI last card; human to act but cannot play. */
function goLeadFixture(): GameState {
  const human: PlayerState = {
    hand: [makeCard('K', 'hearts'), makeCard('Q', 'clubs')],
    played: [makeCard('9', 'clubs')],
    score: 10,
    discardSel: [],
  };
  const ai: PlayerState = {
    hand: [makeCard('K', 'spades'), makeCard('Q', 'hearts')],
    played: [makeCard('9', 'diamonds'), makeCard('10', 'hearts')],
    score: 12,
    discardSel: [],
  };

  const peg = createPegState(0);
  peg.count = 28;
  peg.sequence = [
    { card: makeCard('9', 'clubs'), player: 0 },
    { card: makeCard('9', 'diamonds'), player: 1 },
    { card: makeCard('10', 'hearts'), player: 1 },
  ];
  peg.toPlay = 0;
  peg.saidGo = new Set();
  peg.sequenceDone = false;

  const base = createGame('ai');
  return {
    ...base,
    phase: 'pegging',
    dealer: 1,
    pone: 0,
    players: [human, ai],
    crib: [
      makeCard('A', 'clubs'),
      makeCard('2', 'clubs'),
      makeCard('3', 'clubs'),
      makeCard('4', 'clubs'),
      makeCard('6', 'clubs'),
    ],
    starter: makeCard('7', 'hearts'),
    peg,
    message: 'test pegging',
    winner: null,
  };
}


describe('CRITICAL: pair after opponent Go (sequence must stay)', () => {
  /** Yoda (0) plays 5 at count 20→25; Mando (1) cannot play; Yoda pairs with second 5. */
  function pairAfterGoFixture(): GameState {
    const yoda: PlayerState = {
      hand: [makeCard('5', 'hearts'), makeCard('5', 'clubs'), makeCard('A', 'spades')],
      played: [makeCard('10', 'clubs'), makeCard('K', 'diamonds')],
      score: 4,
      discardSel: [],
    };
    const mando: PlayerState = {
      hand: [makeCard('K', 'hearts'), makeCard('Q', 'spades')], // 10s — illegal at 25
      played: [makeCard('10', 'hearts')],
      score: 6,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 20;
    peg.sequence = [
      { card: makeCard('10', 'clubs'), player: 0 },
      { card: makeCard('10', 'hearts'), player: 1 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    return {
      ...createGame('online'),
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [yoda, mando],
      crib: [
        makeCard('2', 'clubs'),
        makeCard('3', 'clubs'),
        makeCard('4', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('8', 'clubs'),
      ],
      starter: makeCard('9', 'hearts'),
      peg,
      message: 'pair-after-go',
      winner: null,
      dealNumber: 2,
    };
  }

  it('P0 plays 5, P1 says Go (P0 still has legal 5), P0 pairs → +2 and flash', () => {
    let g = pairAfterGoFixture();
    const first5 = makeCard('5', 'hearts');
    const second5 = makeCard('5', 'clubs');

    g = playPegCard(g, 0, first5);
    expect(g.peg!.count).toBe(25);
    expect(g.peg!.sequence.map((p) => p.card.rank)).toEqual(['10', '10', '5']);
    expect(g.peg!.toPlay).toBe(1);
    expect(g.players[0].score).toBe(4);
    expect(needsGoPause(g)).toBe(true);
    expect(canPlayAny(g.players[1].hand, g.peg!.count)).toBe(false);
    expect(canPlayAny(g.players[0].hand, g.peg!.count)).toBe(true);

    // Mando says Go — sequence must NOT reset; Yoda toPlay
    g = sayGo(g, 1);
    expect(g.peg!.sequenceDone).toBe(false);
    expect(g.peg!.sequence.length).toBe(3);
    expect(g.peg!.count).toBe(25);
    expect(g.peg!.toPlay).toBe(0);
    expect(g.peg!.saidGo.has(1)).toBe(true);
    expect(g.peg!.saidGo.has(0)).toBe(false);
    expect(needsGoPause(g)).toBe(false);

    // Yoda plays matching 5 → PAIR +2
    g = playPegCard(g, 0, second5);
    expect(g.peg!.count).toBe(30);
    expect(g.peg!.sequence.length).toBe(4);
    expect(g.players[0].score).toBe(6); // 4 + 2 pair
    expect(g.lastPegFlash).not.toBeNull();
    expect(g.lastPegFlash!.points).toBe(2);
    expect(g.lastPegFlash!.events.some((e) => e.kind === 'pair')).toBe(true);
    expect(g.lastPegFlash!.kindLabel).toMatch(/pair/i);
  });

  it('applyGo with opponentCanPlay true keeps sequence and count', () => {
    const peg = createPegState(1);
    peg.count = 25;
    peg.sequence = [
      { card: makeCard('10', 'clubs'), player: 0 },
      { card: makeCard('10', 'hearts'), player: 1 },
      { card: makeCard('5', 'hearts'), player: 0 },
    ];
    peg.toPlay = 1;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const { state, events, lastCardPlayer } = applyGo(peg, 1, true);
    expect(events).toEqual([]);
    expect(lastCardPlayer).toBeNull();
    expect(state.sequenceDone).toBe(false);
    expect(state.sequence.length).toBe(3);
    expect(state.count).toBe(25);
    expect(state.toPlay).toBe(0);
    expect(state.saidGo.has(1)).toBe(true);
  });

  it('after sayGo (opponent can play), serialize round-trip still allows pair', () => {
    // Imported lazily via dynamic path — use engine only here; serialize test below in serialize.test
    let g = pairAfterGoFixture();
    g = playPegCard(g, 0, makeCard('5', 'hearts'));
    g = sayGo(g, 1);
    expect(g.peg!.sequence.length).toBe(3);
    expect(g.peg!.count).toBe(25);

    // Simulate Firebase saidGo as array (common after JSON) — must not break .has
    const broken = {
      ...g,
      peg: {
        ...g.peg!,
        saidGo: [1] as unknown as Set<0 | 1>,
      },
    };
    // playPegCard must still work (defensive Set coerce) and score the pair
    const next = playPegCard(broken, 0, makeCard('5', 'clubs'));
    // If saidGo.has throws or sequence was lost, score stays 4 / flash null
    expect(next.players[0].score).toBe(6);
    expect(next.lastPegFlash?.events.some((e) => e.kind === 'pair')).toBe(true);
  });
});


describe('pegging Go lead — who starts next series', () => {
  it('applyGo: Go-caller becomes toPlay when sequence ends (not the go scorer)', () => {
    const state = createPegState(0);
    state.count = 28;
    state.sequence = [
      { card: makeCard('9', 'clubs'), player: 0 },
      { card: makeCard('9', 'diamonds'), player: 1 },
      { card: makeCard('10', 'hearts'), player: 1 },
    ];
    state.toPlay = 0;

    // Human (0) says go; AI cannot play either → AI scores last-card/go
    const { state: after, events, lastCardPlayer } = applyGo(state, 0, false);

    expect(after.sequenceDone).toBe(true);
    expect(events.some((e) => e.kind === 'go' && e.points === 1)).toBe(true);
    expect(lastCardPlayer).toBe(1); // AI scored
    // CRITICAL: human who said Go leads next — not AI who scored
    expect(after.toPlay).toBe(0);
  });

  it('sayGo: human says go → AI scores → next toPlay is human', () => {
    let g = goLeadFixture();
    const human: PlayerId = 0;
    const aiScoreBefore = g.players[1].score;

    expect(g.peg!.toPlay).toBe(human);
    g = sayGo(g, human);

    // AI got the go/last-card point
    expect(g.players[1].score).toBe(aiScoreBefore + 1);
    expect(g.message).toMatch(/Last card/);

    // Still mid-hand pegging with a fresh series
    expect(g.phase).toBe('pegging');
    expect(g.peg).not.toBeNull();
    expect(g.peg!.count).toBe(0);
    expect(g.peg!.sequence).toEqual([]);
    // Human (who said Go) must lead — old bug had AI (scorer) leading
    expect(g.peg!.toPlay).toBe(human);
  });
});

/** Room C6U6S-style: count 27, toPlay has only illegal face cards. */
function forcedGoFixture(opts: {
  toPlayHand: ReturnType<typeof makeCard>[];
  oppHand: ReturnType<typeof makeCard>[];
  toPlay?: PlayerId;
}): GameState {
  const toPlay = opts.toPlay ?? 0;
  const p0: PlayerState = {
    hand: toPlay === 0 ? opts.toPlayHand : opts.oppHand,
    played: [
      makeCard('2', 'clubs'),
      makeCard('2', 'hearts'),
      makeCard('A', 'hearts'),
    ],
    score: 20,
    discardSel: [],
  };
  const p1: PlayerState = {
    hand: toPlay === 1 ? opts.toPlayHand : opts.oppHand,
    played: [
      makeCard('J', 'hearts'),
      makeCard('2', 'diamonds'),
      makeCard('10', 'diamonds'),
    ],
    score: 18,
    discardSel: [],
  };

  const peg = createPegState(toPlay);
  peg.count = 27;
  peg.sequence = [
    { card: makeCard('2', 'clubs'), player: 0 },
    { card: makeCard('J', 'hearts'), player: 1 },
    { card: makeCard('2', 'diamonds'), player: 1 },
    { card: makeCard('10', 'diamonds'), player: 1 },
    { card: makeCard('2', 'hearts'), player: 0 },
    { card: makeCard('A', 'hearts'), player: 0 },
  ];
  peg.toPlay = toPlay;
  peg.saidGo = new Set();
  peg.sequenceDone = false;

  const base = createGame('online');
  return {
    ...base,
    phase: 'pegging',
    dealer: 1,
    pone: 0,
    players: [p0, p1],
    crib: [
      makeCard('3', 'clubs'),
      makeCard('4', 'clubs'),
      makeCard('5', 'clubs'),
      makeCard('6', 'clubs'),
      makeCard('6', 'diamonds'),
    ],
    starter: makeCard('7', 'hearts'),
    peg,
    message: 'forced go fixture',
    winner: null,
  };
}

describe('resolveForcedPegGoes — auto-Go when no legal card', () => {
  it('says Go when toPlay has only illegal cards; opponent with Ace can then play', () => {
    const ace = makeCard('A', 'diamonds');
    let g = forcedGoFixture({
      toPlayHand: [
        makeCard('7', 'clubs'),
        makeCard('8', 'diamonds'),
        makeCard('9', 'diamonds'),
      ],
      oppHand: [ace],
      toPlay: 0,
    });

    expect(canPlayAny(g.players[0].hand, 27)).toBe(false);
    expect(canPlayAny(g.players[1].hand, 27)).toBe(true);

    g = resolveForcedPegGoes(g);

    expect(g.phase).toBe('pegging');
    expect(g.peg).not.toBeNull();
    expect(g.peg!.count).toBe(27); // opponent can still play — sequence continues
    expect(g.peg!.toPlay).toBe(1);
    expect(g.peg!.saidGo.has(0)).toBe(true);
    expect(g.message).toMatch(/says go/i);

    // Legal Ace at 27 still plays via playPegCard — no instant forced Go
    const before = g.players[1].score;
    g = playPegCard(g, 1, ace);
    expect(g.players[1].hand.some((c) => c.id === ace.id)).toBe(false);
    expect(g.players[1].played.some((c) => c.id === ace.id)).toBe(true);
    expect(g.phase).toBe('pegging');
    expect(g.peg!.count).toBe(28);
    expect(g.peg!.toPlay).toBe(0);
    expect(needsGoPause(g)).toBe(true);
    // Pair of aces (+2) scored on play; go point only after sayGo
    expect(g.players[1].score).toBe(before + 2);

    g = resolveForcedPegGoes(g);
    expect(g.peg!.count).toBe(0);
    expect(g.peg!.sequence).toEqual([]);
    expect(g.players[1].score).toBe(before + 3);
  });

  it('both cannot play → sequence resets + go point to last player in sequence', () => {
    let g = forcedGoFixture({
      toPlayHand: [
        makeCard('K', 'clubs'),
        makeCard('Q', 'diamonds'),
      ],
      oppHand: [
        makeCard('K', 'hearts'),
        makeCard('Q', 'spades'),
      ],
      toPlay: 0,
    });

    const lastPlayer = g.peg!.sequence[g.peg!.sequence.length - 1]!.player;
    const scorerBefore = g.players[lastPlayer].score;

    g = resolveForcedPegGoes(g);

    expect(g.phase).toBe('pegging');
    expect(g.peg).not.toBeNull();
    expect(g.peg!.count).toBe(0);
    expect(g.peg!.sequence).toEqual([]);
    // Go point to last player who played in the finished sequence
    expect(g.players[lastPlayer].score).toBe(scorerBefore + 1);
    // Go-caller (0) leads next series per existing rules
    expect(g.peg!.toPlay).toBe(0);
  });

  it('legal Ace at 27 plays via playPegCard and count becomes 28', () => {
    const ace = makeCard('A', 'diamonds');
    let g = forcedGoFixture({
      toPlayHand: [ace],
      oppHand: [makeCard('2', 'spades')], // legal continuation at 28
      toPlay: 0,
    });
    expect(g.peg!.count).toBe(27);
    expect(g.peg!.toPlay).toBe(0);
    g = playPegCard(g, 0, ace);
    expect(g.players[0].played.some((c) => c.id === ace.id)).toBe(true);
    expect(g.peg!.count).toBe(28);
    expect(g.peg!.toPlay).toBe(1);
  });

  it('playPegCard does NOT auto-Go; opponent with only illegals waits for sayGo', () => {
    const seven = makeCard('7', 'spades');
    const ace = makeCard('A', 'diamonds');
    const human: PlayerState = {
      hand: [seven, ace],
      played: [makeCard('2', 'clubs'), makeCard('5', 'hearts')],
      score: 10,
      discardSel: [],
    };
    const opp: PlayerState = {
      hand: [makeCard('K', 'clubs'), makeCard('Q', 'diamonds')],
      played: [makeCard('10', 'hearts'), makeCard('8', 'clubs')],
      score: 12,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 20;
    peg.sequence = [
      { card: makeCard('2', 'clubs'), player: 0 },
      { card: makeCard('10', 'hearts'), player: 1 },
      { card: makeCard('8', 'clubs'), player: 1 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const base = createGame('hotseat');
    let g: GameState = {
      ...base,
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [human, opp],
      crib: [
        makeCard('3', 'clubs'),
        makeCard('4', 'clubs'),
        makeCard('5', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('6', 'diamonds'),
      ],
      starter: makeCard('9', 'hearts'),
      peg,
      message: 'no auto-go test',
      winner: null,
    };

    // Play 7 → count 27; card leaves hand; opp toPlay but NO auto-Go yet
    g = playPegCard(g, 0, seven);
    expect(g.phase).toBe('pegging');
    expect(g.peg!.count).toBe(27);
    expect(g.peg!.toPlay).toBe(1);
    expect(g.peg!.saidGo.has(1)).toBe(false);
    expect(g.players[0].hand.some((c) => c.id === seven.id)).toBe(false);
    expect(g.peg!.sequence.some((p) => p.card.id === seven.id)).toBe(true);
    expect(needsGoPause(g)).toBe(true);

    g = sayGo(g, 1);
    expect(g.peg!.toPlay).toBe(0);
    expect(g.peg!.saidGo.has(1)).toBe(true);
    expect(canPlayAny(g.players[0].hand, g.peg!.count)).toBe(true);

    g = playPegCard(g, 0, ace);
    expect(g.players[0].played.some((c) => c.id === ace.id)).toBe(true);
    expect(g.players[0].hand.some((c) => c.id === ace.id)).toBe(false);
    expect(g.peg!.count).toBe(28);
    expect(needsGoPause(g)).toBe(true);
  });

  it('play to 31 leaves sequenceDone until finishPegThirtyOne', () => {
    const three = makeCard('3', 'spades');
    const human: PlayerState = {
      hand: [three, makeCard('K', 'hearts')],
      played: [makeCard('10', 'clubs'), makeCard('8', 'hearts')],
      score: 10,
      discardSel: [],
    };
    const opp: PlayerState = {
      hand: [makeCard('Q', 'clubs'), makeCard('J', 'diamonds')],
      played: [makeCard('5', 'hearts'), makeCard('5', 'clubs')],
      score: 12,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 28;
    peg.sequence = [
      { card: makeCard('10', 'clubs'), player: 0 },
      { card: makeCard('8', 'hearts'), player: 0 },
      { card: makeCard('5', 'hearts'), player: 1 },
      { card: makeCard('5', 'clubs'), player: 1 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const base = createGame('hotseat');
    let g: GameState = {
      ...base,
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [human, opp],
      crib: [
        makeCard('2', 'clubs'),
        makeCard('4', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('7', 'clubs'),
        makeCard('9', 'clubs'),
      ],
      starter: makeCard('A', 'hearts'),
      peg,
      message: '31 pause test',
      winner: null,
    };

    g = playPegCard(g, 0, three);
    expect(g.phase).toBe('pegging');
    expect(g.peg!.count).toBe(31);
    expect(g.peg!.sequenceDone).toBe(true);
    expect(g.peg!.sequence.some((p) => p.card.id === three.id)).toBe(true);
    expect(g.players[0].hand.some((c) => c.id === three.id)).toBe(false);
    expect(needsThirtyOnePause(g)).toBe(true);
    expect(
      g.lastPegFlash?.events.some((e) => e.kind === 'thirtyone' && e.points === 2),
    ).toBe(true);

    g = finishPegThirtyOne(g);
    expect(g.phase).toBe('pegging');
    expect(g.peg!.count).toBe(0);
    expect(g.peg!.sequence).toEqual([]);
    expect(g.peg!.sequenceDone).toBe(false);
    expect(g.peg!.toPlay).toBe(1); // opponent leads
    expect(needsThirtyOnePause(g)).toBe(false);
  });
});


describe('last-card go at end of pegging', () => {
  /** Both hands empty after one last play; count < 31. */
  function lastCardGoFixture(): { state: GameState; card: ReturnType<typeof makeCard> } {
    const last = makeCard('5', 'hearts');
    const human: PlayerState = {
      hand: [last],
      played: [
        makeCard('9', 'clubs'),
        makeCard('8', 'hearts'),
        makeCard('7', 'diamonds'),
        makeCard('6', 'spades'),
      ],
      score: 20,
      discardSel: [],
    };
    const opp: PlayerState = {
      hand: [],
      played: [
        makeCard('A', 'clubs'),
        makeCard('2', 'hearts'),
        makeCard('3', 'diamonds'),
        makeCard('4', 'spades'),
        makeCard('10', 'clubs'),
      ],
      score: 18,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 20;
    peg.sequence = [
      { card: makeCard('10', 'clubs'), player: 1 },
      { card: makeCard('9', 'clubs'), player: 0 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const base = createGame('hotseat');
    const state: GameState = {
      ...base,
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [human, opp],
      crib: [
        makeCard('J', 'clubs'),
        makeCard('Q', 'clubs'),
        makeCard('K', 'clubs'),
        makeCard('A', 'spades'),
        makeCard('2', 'spades'),
      ],
      starter: makeCard('3', 'hearts'),
      peg,
      message: 'last card go test',
      winner: null,
    };
    return { state, card: last };
  }

  it('last play emptying both hands (count < 31) awards +1 go and stays pegging', () => {
    let { state: g, card } = lastCardGoFixture();
    const scoreBefore = g.players[0].score;

    g = playPegCard(g, 0, card);

    expect(g.phase).toBe('pegging');
    expect(g.players[0].hand).toHaveLength(0);
    expect(g.players[1].hand).toHaveLength(0);
    expect(g.peg!.sequenceDone).toBe(true);
    expect(g.peg!.count).toBe(25); // 20 + 5
    expect(g.players[0].score).toBe(scoreBefore + 1); // go only (no 15/run/pair)
    expect(g.lastPegFlash).not.toBeNull();
    expect(g.lastPegFlash!.events.some((e) => e.kind === 'go' && e.points === 1)).toBe(true);
    expect(g.lastPegFlash!.kindLabel).toMatch(/go/i);
    expect(needsEndOfPeggingPause(g)).toBe(true);
    expect(needsThirtyOnePause(g)).toBe(false);
  });

  it('finishPeggingToShow after pause advances to show', () => {
    let { state: g, card } = lastCardGoFixture();
    g = playPegCard(g, 0, card);
    expect(needsEndOfPeggingPause(g)).toBe(true);

    g = finishPeggingToShow(g);
    expect(g.phase).toBe('show');
    expect(g.peg).toBeNull();
    expect(g.showResult).not.toBeNull();
    expect(needsEndOfPeggingPause(g)).toBe(false);
  });

  it('last play with concurrent run includes go in kindLabel and stays pegging', () => {
    // Count 10; play 4 onto 2-5-3 → run of 4 + maybe nothing else; both empty
    const last = makeCard('4', 'spades');
    const human: PlayerState = {
      hand: [last],
      played: [
        makeCard('2', 'hearts'),
        makeCard('9', 'clubs'),
        makeCard('8', 'diamonds'),
        makeCard('7', 'spades'),
      ],
      score: 10,
      discardSel: [],
    };
    const opp: PlayerState = {
      hand: [],
      played: [
        makeCard('5', 'clubs'),
        makeCard('3', 'diamonds'),
        makeCard('A', 'clubs'),
        makeCard('6', 'hearts'),
        makeCard('K', 'hearts'),
      ],
      score: 10,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 10; // 2+5+3 = 10
    peg.sequence = [
      { card: makeCard('2', 'hearts'), player: 0 },
      { card: makeCard('5', 'clubs'), player: 1 },
      { card: makeCard('3', 'diamonds'), player: 1 },
    ];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const base = createGame('hotseat');
    let g: GameState = {
      ...base,
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [human, opp],
      crib: [
        makeCard('J', 'clubs'),
        makeCard('Q', 'clubs'),
        makeCard('K', 'clubs'),
        makeCard('A', 'spades'),
        makeCard('2', 'spades'),
      ],
      starter: makeCard('9', 'hearts'),
      peg,
      message: 'run+go test',
      winner: null,
    };

    const before = g.players[0].score;
    g = playPegCard(g, 0, last);
    expect(g.phase).toBe('pegging');
    expect(g.peg!.sequenceDone).toBe(true);
    // run of 4 (+4) + go (+1) = +5
    expect(g.players[0].score).toBe(before + 5);
    expect(g.lastPegFlash!.kindLabel).toBe('run of 4 · go');
    expect(needsEndOfPeggingPause(g)).toBe(true);
  });

  it('sayGo awarding go with both hands empty stays pegging until finishPeggingToShow', () => {
    const human: PlayerState = {
      hand: [],
      played: [
        makeCard('9', 'clubs'),
        makeCard('8', 'hearts'),
        makeCard('7', 'diamonds'),
        makeCard('6', 'spades'),
        makeCard('5', 'clubs'),
      ],
      score: 20,
      discardSel: [],
    };
    const opp: PlayerState = {
      hand: [],
      played: [
        makeCard('A', 'clubs'),
        makeCard('2', 'hearts'),
        makeCard('3', 'diamonds'),
        makeCard('4', 'spades'),
        makeCard('10', 'hearts'),
      ],
      score: 18,
      discardSel: [],
    };
    const peg = createPegState(1);
    peg.count = 28;
    peg.sequence = [
      { card: makeCard('9', 'clubs'), player: 0 },
      { card: makeCard('10', 'hearts'), player: 1 },
      { card: makeCard('9', 'diamonds'), player: 0 },
    ];
    peg.toPlay = 1;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    const base = createGame('hotseat');
    let g: GameState = {
      ...base,
      phase: 'pegging',
      dealer: 0,
      pone: 1,
      players: [human, opp],
      crib: [
        makeCard('J', 'clubs'),
        makeCard('Q', 'clubs'),
        makeCard('A', 'spades'),
        makeCard('2', 'spades'),
        makeCard('3', 'spades'),
      ],
      starter: makeCard('4', 'hearts'),
      peg,
      message: 'sayGo end test',
      winner: null,
    };

    // Both empty; toPlay=1 says go → last-card go to player 0 (last in sequence)
    const scorerBefore = g.players[0].score;
    g = sayGo(g, 1);

    expect(g.phase).toBe('pegging');
    expect(g.peg!.sequenceDone).toBe(true);
    expect(g.players[0].score).toBe(scorerBefore + 1);
    expect(g.lastPegFlash?.kindLabel).toMatch(/go/i);
    expect(needsEndOfPeggingPause(g)).toBe(true);

    g = finishPeggingToShow(g);
    expect(g.phase).toBe('show');
  });
});


describe('playPegCard pair scoring + flash', () => {
  it('consecutive same-rank peg plays award +2 and lastPegFlash has pair kindLabel', () => {
    const p0: PlayerState = {
      hand: [makeCard('7', 'hearts'), makeCard('3', 'clubs')],
      played: [],
      score: 10,
      discardSel: [],
    };
    const p1: PlayerState = {
      hand: [makeCard('7', 'spades'), makeCard('4', 'diamonds')],
      played: [],
      score: 8,
      discardSel: [],
    };
    const peg = createPegState(0);
    peg.count = 0;
    peg.sequence = [];
    peg.toPlay = 0;
    peg.saidGo = new Set();
    peg.sequenceDone = false;

    let g: GameState = {
      ...createGame('online'),
      phase: 'pegging',
      dealer: 1,
      pone: 0,
      players: [p0, p1],
      crib: [
        makeCard('A', 'clubs'),
        makeCard('2', 'clubs'),
        makeCard('5', 'clubs'),
        makeCard('6', 'clubs'),
        makeCard('9', 'clubs'),
      ],
      starter: makeCard('K', 'hearts'),
      peg,
      message: 'pair test',
      winner: null,
      dealNumber: 2,
    };

    g = playPegCard(g, 0, makeCard('7', 'hearts'));
    expect(g.players[0].score).toBe(10); // lead 7 — no score yet
    expect(g.peg!.count).toBe(7);
    expect(g.lastPegFlash).toBeNull();

    g = playPegCard(g, 1, makeCard('7', 'spades'));
    expect(g.players[1].score).toBe(10); // 8 + 2 pair
    expect(g.peg!.count).toBe(14);
    expect(g.lastPegFlash).not.toBeNull();
    expect(g.lastPegFlash!.points).toBe(2);
    expect(g.lastPegFlash!.events.some((e) => e.kind === 'pair' && e.points === 2)).toBe(true);
    expect(g.lastPegFlash!.kindLabel).toMatch(/pair/i);
    expect(typeof g.lastPegFlash!.id).toBe('number');
    expect(g.lastPegFlash!.id).toBeGreaterThan(0);
  });

  it('second-round style: two pair flashes get distinct ids (no flashSeen collision)', () => {
    const mk = (toPlay: 0 | 1, score0: number, score1: number): GameState => {
      const peg = createPegState(toPlay);
      return {
        ...createGame('online'),
        phase: 'pegging',
        dealer: 0,
        pone: 1,
        players: [
          {
            hand: [makeCard('5', 'hearts'), makeCard('5', 'clubs'), makeCard('2', 'spades')],
            played: [],
            score: score0,
            discardSel: [],
          },
          {
            hand: [makeCard('5', 'diamonds'), makeCard('5', 'spades'), makeCard('3', 'hearts')],
            played: [],
            score: score1,
            discardSel: [],
          },
        ],
        crib: [
          makeCard('A', 'clubs'),
          makeCard('4', 'clubs'),
          makeCard('6', 'clubs'),
          makeCard('8', 'clubs'),
          makeCard('9', 'clubs'),
        ],
        starter: makeCard('K', 'spades'),
        peg,
        dealNumber: 2,
        winner: null,
      };
    };

    let g = mk(0, 0, 0);
    g = playPegCard(g, 0, makeCard('5', 'hearts'));
    g = playPegCard(g, 1, makeCard('5', 'diamonds'));
    const id1 = g.lastPegFlash!.id;
    expect(g.players[1].score).toBe(2);

    // Continue: third 5 → trips (+6) and count 15 (+2)
    g = playPegCard(g, 0, makeCard('5', 'clubs'));
    expect(g.lastPegFlash!.events.some((e) => e.kind === 'trips')).toBe(true);
    expect(g.lastPegFlash!.events.some((e) => e.kind === 'fifteen')).toBe(true);
    const id2 = g.lastPegFlash!.id;
    expect(id2).not.toBe(id1);
    expect(g.players[0].score).toBe(8); // trips 6 + fifteen 2
    expect(g.lastPegFlash!.kindLabel).toMatch(/trips/i);
  });
});
