import { describe, it, expect } from 'vitest';
import { makeCard } from '../cards';
import { scoreHand } from '../scoreHand';
import {
  resolveClaim,
  isCompetitiveMode,
  normalizeScoringMode,
  canOfferCompetitiveOnline,
  refereeAdjustKeep,
  wrongCorrectorPenaltyRaw,
} from '../competitiveScoring';
import {
  createGame,
  createAiGame,
  finishPeggingToShow,
  submitShowClaim,
  confirmShowClaim,
  adjustShowClaim,
  acknowledgeCompetitiveRef,
  resolveMugginsChoice,
  advanceCompetitiveAi,
  competitiveClaimant,
  applyPoints,
  applyPenalty,
  type GameState,
  type PlayerState,
  type PlayerId,
} from '../supercrib';
import { createPegState } from '../pegging';

function endOfPeggingForShow(opts: {
  dealer?: PlayerId;
  ponePlayed: ReturnType<typeof makeCard>[];
  dealerPlayed: ReturnType<typeof makeCard>[];
  crib: ReturnType<typeof makeCard>[];
  starter: ReturnType<typeof makeCard>;
  scores?: [number, number];
  scoringMode?: 'auto' | 'competitive';
}): GameState {
  const dealer: PlayerId = opts.dealer ?? 0;
  const pone = (1 - dealer) as PlayerId;
  const scores = opts.scores ?? [40, 50];
  const peg = createPegState(pone);
  peg.sequenceDone = true;
  peg.count = 20;

  const players: [PlayerState, PlayerState] = [
    { hand: [], played: [], score: scores[0], discardSel: [] },
    { hand: [], played: [], score: scores[1], discardSel: [] },
  ];
  players[pone] = {
    hand: [],
    played: opts.ponePlayed,
    score: scores[pone],
    discardSel: [],
  };
  players[dealer] = {
    hand: [],
    played: opts.dealerPlayed,
    score: scores[dealer],
    discardSel: [],
  };

  const base = createGame('ai', {
    aiDifficulty: 'normal',
    scoringMode: opts.scoringMode ?? 'competitive',
  });

  return {
    ...base,
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


/** Claimant announces then opponent Confirm (keeps claim) — common test path. */
function claimAndConfirm(g: GameState, claimed: number): GameState {
  return confirmShowClaim(submitShowClaim(g, claimed));
}
/** Pair of 5s + starter 5 = 6 (pairs) + fifteens; keep simple known totals. */
function handRaw8(): ReturnType<typeof makeCard>[] {
  // 5H 5D 4C 3S 2H + starter AH → fifteens: 5+5+A? values: 5+5+4+3+2+1
  // Simpler: two 5s and a 5 starter = pair 2 + three 5s trips? 
  // Use scoreHand to discover — for tests we assert via scoreHand.
  return [
    makeCard('5', 'hearts'),
    makeCard('5', 'diamonds'),
    makeCard('4', 'clubs'),
    makeCard('3', 'spades'),
    makeCard('2', 'hearts'),
  ];
}

function deadishHand(): ReturnType<typeof makeCard>[] {
  return [
    makeCard('K', 'hearts'),
    makeCard('Q', 'diamonds'),
    makeCard('9', 'clubs'),
    makeCard('8', 'spades'),
    makeCard('2', 'clubs'),
  ];
}

describe('resolveClaim', () => {
  it('exact claim applies true total', () => {
    const r = resolveClaim(8, 8);
    expect(r.kind).toBe('exact');
    expect(r.applyToScorer).toBe(8);
    expect(r.overclaimPenalty).toBe(0);
    expect(r.mugginsAvailable).toBe(0);
  });

  it('overclaim: raw steal only (8 claim 12 → penalty 4); apply path × multiplier', () => {
    const r = resolveClaim(8, 12);
    expect(r.kind).toBe('overclaim');
    expect(r.applyToScorer).toBe(8);
    expect(r.overclaimPenalty).toBe(4); // raw; applyCompetitiveBucket × showMultiplier
    expect(r.mugginsAvailable).toBe(0);
    // Raw-only net (no show ×2): 40+8-4 = 44
    let s = 40;
    const applied = applyPoints(s, r.applyToScorer);
    s = applied.score;
    s = applyPenalty(s, r.overclaimPenalty);
    expect(s).toBe(44);
  });

  it('underclaim: apply claimed; muggins = missed', () => {
    const r = resolveClaim(8, 5);
    expect(r.kind).toBe('underclaim');
    expect(r.applyToScorer).toBe(5);
    expect(r.mugginsAvailable).toBe(3);
    expect(r.overclaimPenalty).toBe(0);
  });
});

describe('competitive keeps SuperCrib Spade ×2 / raw', () => {
  it('auto and competitive both double non-spade starters', () => {
    const hand = [
      makeCard('A', 'clubs'),
      makeCard('A', 'diamonds'),
      makeCard('A', 'hearts'),
      makeCard('2', 'clubs'),
      makeCard('3', 'clubs'),
    ];
    const clubStarter = makeCard('4', 'clubs');
    const auto = scoreHand(hand, clubStarter, false, { scoringMode: 'auto' });
    const comp = scoreHand(hand, clubStarter, false, {
      scoringMode: 'competitive',
    });
    expect(auto.multiplier).toBe(2);
    expect(comp.multiplier).toBe(2);
    expect(comp.total).toBe(comp.raw * 2);
    expect(auto.total).toBe(auto.raw * 2);
    expect(auto.raw).toBe(comp.raw);
    expect(auto.total).toBe(comp.total);
  });

  it('competitive preserves spade-raw (×1) vs non-spade ×2', () => {
    const hand = [
      makeCard('A', 'clubs'),
      makeCard('A', 'diamonds'),
      makeCard('A', 'hearts'),
      makeCard('2', 'clubs'),
      makeCard('3', 'clubs'),
    ];
    const club = scoreHand(hand, makeCard('4', 'clubs'), false, {
      scoringMode: 'competitive',
    });
    const spade = scoreHand(hand, makeCard('4', 'spades'), false, {
      scoringMode: 'competitive',
    });
    expect(club.multiplier).toBe(2);
    expect(spade.multiplier).toBe(1);
    expect(club.raw).toBe(spade.raw);
    expect(club.total).toBe(spade.raw * 2);
    expect(spade.total).toBe(spade.raw);
  });

  it('isCompetitiveMode helper', () => {
    expect(isCompetitiveMode('competitive')).toBe(true);
    expect(isCompetitiveMode('auto')).toBe(false);
    expect(isCompetitiveMode(undefined)).toBe(false);
  });
});

describe('competitive show engine flow', () => {
  it('exact RAW claims peg SuperCrib totals (raw then ×2); AI claims raw', () => {
    const starter = makeCard('A', 'hearts'); // non-spade → ×2
    const poneH = handRaw8();
    const dealerH = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('7', 'clubs'),
      makeCard('8', 'spades'),
      makeCard('9', 'hearts'),
    ];
    const crib = deadishHand();
    const poneBd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    const dealerBd = scoreHand(dealerH, starter, false, {
      scoringMode: 'competitive',
    });
    const cribBd = scoreHand(crib, starter, true, {
      scoringMode: 'competitive',
    });
    expect(poneBd.raw).toBeGreaterThan(0);
    expect(poneBd.multiplier).toBe(2);
    expect(poneBd.total).toBe(poneBd.raw * 2);

    let g = endOfPeggingForShow({
      dealer: 0,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [40, 50],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    expect(g.phase).toBe('show');
    expect(g.competitiveShow?.step).toBe('pone');
    expect(g.players[0].score).toBe(40);
    expect(g.players[1].score).toBe(50);

    // pone is seat 1 — AI claims RAW (not doubled); human Confirm
    g = advanceCompetitiveAi(g);
    expect(g.competitiveShow?.pendingReview?.claimed).toBe(poneBd.raw);
    g = confirmShowClaim(g);
    expect(g.competitiveShow?.log[0]?.claimed).toBe(poneBd.raw);
    expect(g.competitiveShow?.log[0]?.trueTotal).toBe(poneBd.raw);
    expect(g.players[1].score).toBe(50 + poneBd.total);
    expect(g.competitiveShow?.step).toBe('dealer');

    // dealer is seat 0 — human exact RAW claim; Dummy2 review is human-driven
    g = submitShowClaim(g, dealerBd.raw);
    expect(g.competitiveShow?.pendingReview?.claimed).toBe(dealerBd.raw);
    // advanceCompetitiveAi must NOT auto-Approve (UI shows Approve/Adjust)
    g = advanceCompetitiveAi(g);
    expect(g.competitiveShow?.pendingReview?.claimed).toBe(dealerBd.raw);
    g = confirmShowClaim(g);
    expect(g.players[0].score).toBe(40 + dealerBd.total);
    expect(g.competitiveShow?.step).toBe('crib');

    g = submitShowClaim(g, cribBd.raw);
    expect(g.competitiveShow?.pendingReview).not.toBeNull();
    g = confirmShowClaim(g);
    expect(g.competitiveShow?.step).toBe('done');
    if (cribBd.raw === 0) {
      expect(g.players[0].score).toBe(40 + dealerBd.total - 30);
    } else {
      expect(g.players[0].score).toBe(40 + dealerBd.total + cribBd.total);
    }
  });

  it('claiming exact RAW on ×2 starter is NOT an underclaim / muggins', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('7', 'clubs'),
      makeCard('8', 'spades'),
      makeCard('9', 'hearts'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    expect(bd.multiplier).toBe(2);
    expect(bd.total).toBe(bd.raw * 2);
    expect(bd.raw).toBeGreaterThan(0);

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;
    g = claimAndConfirm(g, bd.raw);
    expect(g.competitiveShow?.pendingMuggins).toBeNull();
    expect(g.competitiveShow?.log[0]?.kind).toBe('exact');
    expect(g.players[0].score).toBe(before + bd.total);
    // Claiming the doubled total would be an overclaim of +raw; steal ×2 on non-spade
    g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before2 = g.players[0].score;
    g = claimAndConfirm(g, bd.total); // typed ×2 by mistake
    expect(g.competitiveShow?.log[0]?.kind).toBe('overclaim');
    expect(g.competitiveShow?.log[0]?.overclaimPenalty).toBe(bd.raw * 2);
    expect(g.players[0].score).toBe(before2 + bd.total - bd.raw * 2);
  });

  it('overclaim: raw then ×2 then −(steal ×2) on non-spade (8 claim 12 → penalty 8)', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('7', 'clubs'),
      makeCard('8', 'spades'),
      makeCard('9', 'hearts'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    expect(bd.raw).toBeGreaterThan(0);
    expect(bd.multiplier).toBe(2);

    let g = endOfPeggingForShow({
      dealer: 1, // human is pone (seat 0)
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    expect(g.phase).toBe('show');
    expect(g.competitiveShow?.step).toBe('pone');
    expect(g.pone).toBe(0);
    const before = g.players[0].score;
    const claim = bd.raw + 4; // like 8 claim 12
    g = claimAndConfirm(g, claim);
    // +raw +×2bonus −(4×2) = +total −8
    expect(g.players[0].score).toBe(before + bd.total - 8);
    expect(g.competitiveShow?.log[0]?.kind).toBe('overclaim');
    expect(g.competitiveShow?.log[0]?.trueTotal).toBe(bd.raw);
    expect(g.competitiveShow?.log[0]?.overclaimPenalty).toBe(8);
  });

  it('overclaim on spade starter: steal stays raw (8 claim 12 → penalty 4)', () => {
    const starter = makeCard('A', 'spades');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'hearts'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'hearts'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    expect(bd.multiplier).toBe(1);
    expect(bd.raw).toBeGreaterThan(0);

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;
    const claim = bd.raw + 4;
    g = claimAndConfirm(g, claim);
    // +raw only, −4 steal (no ×2 on show or steal)
    expect(g.players[0].score).toBe(before + bd.raw - 4);
    expect(g.competitiveShow?.log[0]?.kind).toBe('overclaim');
    expect(g.competitiveShow?.log[0]?.overclaimPenalty).toBe(4);
  });

  it('underclaim: opponent can muggins missed RAW points (no ×2 on miss)', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    const miss = 3;
    const claimed = bd.raw - miss;
    expect(claimed).toBeGreaterThan(0);
    expect(bd.multiplier).toBe(2);

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const humanBefore = g.players[0].score;
    const aiBefore = g.players[1].score;
    g = claimAndConfirm(g, claimed);
    expect(g.competitiveShow?.pendingMuggins?.missed).toBe(miss);
    expect(g.competitiveShow?.pendingMuggins?.trueTotal).toBe(bd.raw);
    // Underclaim pegs claimed only — no ×2 bonus
    expect(g.players[0].score).toBe(humanBefore + claimed);

    g = resolveMugginsChoice(g, 'muggins');
    expect(g.players[1].score).toBe(aiBefore + miss);
    expect(g.competitiveShow?.pendingMuggins).toBeNull();
    expect(g.competitiveShow?.log[0]?.mugginsTaken).toBe(miss);
  });

  it('underclaim accept leaves missed points on the table', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    const claimed = bd.raw - 2;

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const aiBefore = g.players[1].score;
    g = claimAndConfirm(g, claimed);
    g = resolveMugginsChoice(g, 'accept');
    expect(g.players[1].score).toBe(aiBefore);
    expect(g.competitiveShow?.log[0]?.mugginsTaken).toBe(0);
  });

  it('spade starter: raw claim pegs raw only (no ×2 bonus)', () => {
    const starter = makeCard('A', 'spades');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'hearts'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'hearts'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, {
      scoringMode: 'competitive',
    });
    expect(bd.multiplier).toBe(1);
    expect(bd.total).toBe(bd.raw);

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;
    g = claimAndConfirm(g, bd.raw);
    expect(g.competitiveShow?.log[0]?.kind).toBe('exact');
    expect(g.players[0].score).toBe(before + bd.raw);
  });


  it('pendingReview: Confirm keeps claim; Adjust replaces then resolves', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    expect(bd.raw).toBeGreaterThan(0);

    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;

    g = submitShowClaim(g, bd.raw + 4);
    expect(g.competitiveShow?.pendingReview?.claimed).toBe(bd.raw + 4);
    expect(g.players[0].score).toBe(before); // not pegged yet

    // Adjust down to exact → ref sides with adjuster → exact resolution
    g = adjustShowClaim(g, bd.raw);
    expect(g.competitiveShow?.pendingReview).toBeNull();
    expect(g.competitiveShow?.log[0]?.kind).toBe('exact');
    expect(g.players[0].score).toBe(before + bd.total);
    expect(g.competitiveShow?.lastRef?.sidedWith).toBe('adjuster');
    expect(g.competitiveShow?.lastRef?.trueRaw).toBe(bd.raw);
    // Original announce survives Adjust/Ref (kept replaces claimed, not original)
    expect(g.competitiveShow?.log[0]?.claimed).toBe(bd.raw); // kept
    expect(g.competitiveShow?.log[0]?.claimedOriginal).toBe(bd.raw + 4);
    expect(g.competitiveShow?.log[0]?.adjustedClaimed).toBe(bd.raw);
    expect(g.competitiveShow?.lastRef?.originalClaimed).toBe(bd.raw + 4);
  });

  it('Approve keeps claimedOriginal equal to announced hand', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    g = submitShowClaim(g, bd.raw);
    g = confirmShowClaim(g);
    expect(g.competitiveShow?.log[0]?.claimed).toBe(bd.raw);
    expect(g.competitiveShow?.log[0]?.claimedOriginal).toBe(bd.raw);
    expect(g.competitiveShow?.log[0]?.adjustedClaimed).toBeUndefined();
  });

  it('dealer Adjust preserves original hand on log (not overwritten by kept)', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const poneBd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    const dealerBd = scoreHand(dealerH, starter, false, {
      scoringMode: 'competitive',
    });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    g = submitShowClaim(g, poneBd.raw);
    g = confirmShowClaim(g);
    expect(g.competitiveShow?.step).toBe('dealer');
    const orig = dealerBd.raw + 5;
    g = submitShowClaim(g, orig);
    g = adjustShowClaim(g, dealerBd.raw);
    const dealerLog = g.competitiveShow?.log.find((e) => e.step === 'dealer');
    expect(dealerLog?.claimedOriginal).toBe(orig);
    expect(dealerLog?.adjustedClaimed).toBe(dealerBd.raw);
    expect(dealerLog?.claimed).toBe(dealerBd.raw);
    expect(g.competitiveShow?.lastRef?.originalClaimed).toBe(orig);
  });

  it('Adjust when claimant already exact: ref keeps claimant; adjuster wrong-corrector penalized', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const beforeClaimant = g.players[0].score;
    const beforeAdjuster = g.players[1].score;
    g = submitShowClaim(g, bd.raw); // exact announced
    g = adjustShowClaim(g, bd.raw + 4); // opponent adjusts up (wrong)
    expect(g.competitiveShow?.log[0]?.kind).toBe('exact');
    expect(g.players[0].score).toBe(beforeClaimant + bd.total);
    // Wrong corrector: |4| × showMult 2 (non-spade) = 8 from adjuster (dealer seat 1)
    expect(g.competitiveShow?.pendingRef?.wrongCorrectorPenalty).toBe(8);
    expect(g.players[1].score).toBe(beforeAdjuster - 8);
    expect(g.competitiveShow?.lastRef?.sidedWith).toBe('claimant');
    expect(g.competitiveShow?.pendingRef?.verdict).toMatch(/already exact/i);
    expect(g.message).toMatch(/Ref: true was/);
    expect(g.message).toMatch(/Claimant was right/);
    // Muggins / next claim gated until Ref dismissed
    g = acknowledgeCompetitiveRef(g);
    expect(g.competitiveShow?.pendingRef).toBeNull();
  });

  it('Adjust overclaim when claimant under: ref keeps adjuster if adjuster exact', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;
    g = submitShowClaim(g, Math.max(0, bd.raw - 3)); // underclaim
    g = adjustShowClaim(g, bd.raw); // adjuster exact
    expect(g.competitiveShow?.log[0]?.kind).toBe('exact');
    expect(g.players[0].score).toBe(before + bd.total);
    expect(g.competitiveShow?.lastRef?.sidedWith).toBe('adjuster');
  });

  it('Adjust neither exact: keep closer; wrong over Adjust still steal×2', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    expect(bd.raw).toBeGreaterThan(4);
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const before = g.players[0].score;
    // Claimant way under; adjuster closer but still over → keep adjuster overclaim
    g = submitShowClaim(g, 0);
    const beforeAdj = g.players[1].score;
    g = adjustShowClaim(g, bd.raw + 4);
    expect(g.competitiveShow?.lastRef?.sidedWith).toBe('adjuster');
    expect(g.competitiveShow?.lastRef?.neitherExact).toBe(true);
    expect(g.competitiveShow?.log[0]?.kind).toBe('overclaim');
    // non-spade starter: steal = 4 raw ×2 = 8 on claimant
    expect(g.players[0].score).toBe(before + bd.total - 8);
    // Adjuster still wrong (|4|×2=8) — wrong-corrector penalty
    expect(g.competitiveShow?.pendingRef?.wrongCorrectorPenalty).toBe(8);
    expect(g.players[1].score).toBe(beforeAdj - 8);
  });

  it('Adjuster exact: no wrong-corrector penalty; Ref modal then Continue', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const beforeAdj = g.players[1].score;
    g = submitShowClaim(g, Math.max(0, bd.raw - 3));
    g = adjustShowClaim(g, bd.raw);
    expect(g.competitiveShow?.pendingRef?.adjusterWrong).toBe(false);
    expect(g.competitiveShow?.pendingRef?.wrongCorrectorPenalty).toBe(0);
    expect(g.competitiveShow?.pendingRef?.verdict).toMatch(/Adjuster right/i);
    expect(g.players[1].score).toBe(beforeAdj);
    expect(g.competitiveShow?.pendingRef).toBeTruthy();
    g = acknowledgeCompetitiveRef(g);
    expect(g.competitiveShow?.pendingRef).toBeNull();
    // No muggins — segment advanced to next claim; Ref summary must not linger
    expect(g.competitiveShow?.lastRef).toBeNull();
    expect(g.competitiveShow?.step).toBe('dealer');
    expect(competitiveClaimant(g)).toBe(1); // dealer claims next
  });

  it('Ref visible after Adjust; cleared once next claim phase starts', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    // Overclaim → Adjust to true → Ref modal, then next claim (no muggins)
    g = submitShowClaim(g, bd.raw + 4);
    g = adjustShowClaim(g, bd.raw);
    expect(g.competitiveShow?.pendingRef).toBeTruthy();
    expect(g.competitiveShow?.pendingRef?.verdict).toMatch(/Adjuster right/i);
    expect(g.competitiveShow?.lastRef?.trueRaw).toBe(bd.raw);
    // Claim keypad gated while Ref is up
    expect(competitiveClaimant(g)).toBeNull();

    g = acknowledgeCompetitiveRef(g);
    expect(g.competitiveShow?.pendingRef).toBeNull();
    expect(g.competitiveShow?.lastRef).toBeNull();
    expect(g.competitiveShow?.pendingMuggins).toBeFalsy();
    // Next claimer can type — Ref UI state must be gone
    expect(g.competitiveShow?.step).toBe('dealer');
    expect(competitiveClaimant(g)).not.toBeNull();
  });

  it('Ref lastRef kept through Muggins then cleared on next claim', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    // Underclaim kept after Adjust wrong on under → still under? 
    // Claimant under, adjuster also under but closer → underclaim + muggins
    // Simpler: Approve underclaim path doesn't set lastRef.
    // Adjust: claimant announces under, adjuster adjusts to still under (wrong)
    // so kept may be adjuster's underclaim → pendingMuggins
    const under = Math.max(0, bd.raw - 4);
    const adjUnder = Math.max(0, bd.raw - 2); // closer under, still under
    g = submitShowClaim(g, under);
    g = adjustShowClaim(g, adjUnder);
    expect(g.competitiveShow?.pendingRef).toBeTruthy();
    expect(g.competitiveShow?.pendingMuggins).toBeTruthy();
    g = acknowledgeCompetitiveRef(g);
    expect(g.competitiveShow?.pendingRef).toBeNull();
    // Still on same hand segment — lastRef kept for Muggins context
    expect(g.competitiveShow?.lastRef).toBeTruthy();
    expect(g.competitiveShow?.pendingMuggins).toBeTruthy();
    expect(competitiveClaimant(g)).toBeNull();

    g = resolveMugginsChoice(g, 'accept');
    expect(g.competitiveShow?.pendingMuggins).toBeFalsy();
    expect(g.competitiveShow?.lastRef).toBeNull();
    expect(g.competitiveShow?.pendingRef).toBeNull();
    expect(g.competitiveShow?.step).toBe('dealer');
    expect(competitiveClaimant(g)).not.toBeNull();
  });

  it('Approve path: no pendingRef / no wrong-corrector penalty', () => {
    const starter = makeCard('A', 'clubs');
    const poneH = handRaw8();
    const dealerH = [
      makeCard('7', 'hearts'),
      makeCard('7', 'diamonds'),
      makeCard('8', 'clubs'),
      makeCard('9', 'spades'),
      makeCard('10', 'hearts'),
    ];
    const crib = [
      makeCard('6', 'hearts'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'clubs'),
      makeCard('3', 'spades'),
      makeCard('2', 'diamonds'),
    ];
    const bd = scoreHand(poneH, starter, false, { scoringMode: 'competitive' });
    let g = endOfPeggingForShow({
      dealer: 1,
      ponePlayed: poneH,
      dealerPlayed: dealerH,
      crib,
      starter,
      scores: [100, 100],
      scoringMode: 'competitive',
    });
    g = finishPeggingToShow(g);
    const beforeAdj = g.players[1].score;
    g = submitShowClaim(g, bd.raw);
    g = confirmShowClaim(g);
    expect(g.competitiveShow?.pendingRef).toBeFalsy();
    expect(g.competitiveShow?.lastRef).toBeFalsy();
    expect(g.players[1].score).toBe(beforeAdj);
  });

  it('refereeAdjustKeep pure cases', () => {
    expect(refereeAdjustKeep(10, 8, 8)).toEqual({
      kept: 8,
      sidedWith: 'adjuster',
      neitherExact: false,
      adjusterWrong: false,
    });
    expect(refereeAdjustKeep(8, 12, 8)).toEqual({
      kept: 8,
      sidedWith: 'claimant',
      neitherExact: false,
      adjusterWrong: true,
    });
    expect(refereeAdjustKeep(5, 12, 8)).toEqual({
      kept: 5,
      sidedWith: 'claimant',
      neitherExact: true,
      adjusterWrong: true,
    }); // |5-8|=3 < |12-8|=4
    expect(refereeAdjustKeep(4, 12, 8)).toEqual({
      kept: 4,
      sidedWith: 'claimant',
      neitherExact: true,
      adjusterWrong: true,
    }); // tie distance 4 → claimant
    expect(refereeAdjustKeep(3, 10, 8)).toEqual({
      kept: 10,
      sidedWith: 'adjuster',
      neitherExact: true,
      adjusterWrong: true,
    }); // |10-8|=2 < |3-8|=5
  });

  it('wrongCorrectorPenaltyRaw is |adj−true| when wrong else 0', () => {
    expect(wrongCorrectorPenaltyRaw(12, 8)).toBe(4);
    expect(wrongCorrectorPenaltyRaw(5, 8)).toBe(3);
    expect(wrongCorrectorPenaltyRaw(8, 8)).toBe(0);
  });

  it('createAiGame defaults scoringMode auto', () => {
    expect(createAiGame('normal').scoringMode).toBe('auto');
    expect(createAiGame('hard', 'competitive').scoringMode).toBe('competitive');
  });

  it('normalizeScoringMode defaults unknown to auto', () => {
    expect(normalizeScoringMode('competitive')).toBe('competitive');
    expect(normalizeScoringMode('auto')).toBe('auto');
    expect(normalizeScoringMode(undefined)).toBe('auto');
    expect(normalizeScoringMode('nope')).toBe('auto');
  });

  it('createGame online accepts scoringMode competitive', () => {
    const g = createGame('online', { scoringMode: 'competitive' });
    expect(g.mode).toBe('online');
    expect(g.scoringMode).toBe('competitive');
  });

  it('canOfferCompetitiveOnline is open on preview', () => {
    expect(canOfferCompetitiveOnline()).toBe(true);
  });
});
