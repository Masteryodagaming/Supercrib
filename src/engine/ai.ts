/**
 * Simple legal Supercrib AI — discard + pegging heuristics.
 * Pure engine module: may import other engine modules, never UI.
 */

import { Card, cardValue, rankOrder } from './cards';
import {
  PegState,
  legalPegCards,
  canPlayAny,
  scorePegPlay,
  totalPegPoints,
} from './pegging';
import {
  GameState,
  PlayerId,
  AiDifficulty,
  requiredDiscards,
  toggleDiscardSelect,
  confirmDiscard,
  cutStarter,
  playPegCard,
  sayGo,
  getLegalPegCards,
  advanceCompetitiveAi,
  competitiveShowActive,
  competitiveClaimant,
  competitiveMugginsRespondent,
} from './supercrib';

export type { AiDifficulty };

export interface AiChoice {
  kind: 'discard' | 'peg' | 'go' | 'cut' | 'competitiveShow' | 'noop';
  cards?: Card[];
  card?: Card;
}

const AI_PLAYER: PlayerId = 1;

/** Human is always seat 0 in vs-AI mode. */
export function aiPlayerId(): PlayerId {
  return AI_PLAYER;
}

export function isAiSeat(state: GameState, player: PlayerId): boolean {
  return state.mode === 'ai' && player === AI_PLAYER;
}

export function resolveAiDifficulty(state: GameState): AiDifficulty {
  return state.aiDifficulty ?? 'normal';
}

/** True when the AI should take an automatic action now. */
export function aiShouldAct(state: GameState): boolean {
  if (state.mode !== 'ai' || state.winner !== null) return false;
  const ai = AI_PLAYER;

  if (state.phase === 'discard') {
    // Act when AI still needs to discard and (pone-first) it is AI's turn to discard
    if (state.players[ai].hand.length <= 5) return false;
    const pone = state.pone;
    const dealer = state.dealer;
    if (state.players[pone].hand.length > 5) return pone === ai;
    if (state.players[dealer].hand.length > 5) return dealer === ai;
    return false;
  }

  if (state.phase === 'cut') {
    // Non-dealer cuts — AI cuts when it is pone
    return state.pone === ai;
  }

  if (state.phase === 'pegging' && state.peg) {
    // UI owns delayed 31 reset / GO banners — do not act while sequence is paused at 31
    if (state.peg.sequenceDone) return false;
    return state.peg.toPlay === ai;
  }

  if (competitiveShowActive(state)) {
    // Human always drives Confirm/Adjust (incl. Dummy2 review hotseat in vs-AI).
    if (state.competitiveShow?.pendingReview) {
      return false;
    }
    if (state.competitiveShow?.pendingMuggins) {
      return competitiveMugginsRespondent(state) === ai;
    }
    return competitiveClaimant(state) === ai;
  }

  return false;
}

/** Choose a legal move for `player` (typically the AI seat). */
export function chooseAiMove(state: GameState, player: PlayerId): AiChoice {
  const difficulty = resolveAiDifficulty(state);

  if (state.phase === 'discard') {
    const need = requiredDiscards(state, player);
    const hand = state.players[player].hand;
    if (hand.length <= 5 || need <= 0) return { kind: 'noop' };
    const cards = chooseDiscards(hand, need, player === state.dealer, difficulty);
    return { kind: 'discard', cards };
  }

  if (state.phase === 'cut') {
    return { kind: 'cut' };
  }

  if (state.phase === 'pegging' && state.peg) {
    const legal = getLegalPegCards(state, player);
    if (legal.length === 0) {
      if (!canPlayAny(state.players[player].hand, state.peg.count)) {
        return { kind: 'go' };
      }
      return { kind: 'noop' };
    }
    const card = choosePegCard(legal, state.peg, difficulty);
    return { kind: 'peg', card };
  }

  if (competitiveShowActive(state)) {
    // Reviews are human-driven in vs-AI (Approve/Adjust UI for Dummy2).
    if (state.competitiveShow?.pendingReview) {
      return { kind: 'noop' };
    }
    if (state.competitiveShow?.pendingMuggins) {
      if (competitiveMugginsRespondent(state) === player) {
        return { kind: 'competitiveShow' };
      }
      return { kind: 'noop' };
    }
    if (competitiveClaimant(state) === player) {
      return { kind: 'competitiveShow' };
    }
  }

  return { kind: 'noop' };
}

/** Apply one AI decision via pure engine transitions. */
export function applyAiTurn(state: GameState, player: PlayerId = AI_PLAYER): GameState {
  const choice = chooseAiMove(state, player);
  switch (choice.kind) {
    case 'discard': {
      if (!choice.cards || choice.cards.length === 0) return state;
      let next = state;
      for (const c of choice.cards) {
        next = toggleDiscardSelect(next, player, c);
      }
      return confirmDiscard(next, player);
    }
    case 'peg':
      if (!choice.card) return state;
      return playPegCard(state, player, choice.card);
    case 'go':
      return sayGo(state, player);
    case 'cut':
      return cutStarter(state);
    case 'competitiveShow':
      return advanceCompetitiveAi(state);
    default:
      return state;
  }
}

// ── Discard heuristic ──────────────────────────────────────────────

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k <= 0 || k > n) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

/** Rough keep strength without starter (fifteens / pairs / runs / 5s). */
export function estimateKeepValue(cards: Card[]): number {
  let score = 0;
  const n = cards.length;
  const limit = 1 << n;
  for (let mask = 1; mask < limit; mask++) {
    let sum = 0;
    let bits = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += cardValue(cards[i]);
        bits++;
      }
    }
    if (sum === 15) score += 2;
    // Soft near-15 with starter room
    if (bits >= 2 && sum >= 5 && sum <= 14) score += 0.15;
  }

  const byRank = new Map<string, number>();
  for (const c of cards) {
    byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1);
  }
  for (const count of byRank.values()) {
    if (count >= 2) score += (count * (count - 1) / 2) * 2;
  }

  // Run potential by unique consecutive ranks
  const orders = [...new Set(cards.map((c) => rankOrder(c.rank)))].sort((a, b) => a - b);
  let i = 0;
  while (i < orders.length) {
    let j = i;
    while (j + 1 < orders.length && orders[j + 1] === orders[j] + 1) j++;
    const len = j - i + 1;
    if (len >= 3) score += len;
    else if (len === 2) score += 0.5;
    i = j + 1;
  }

  // Prefer keeping 5s (pegging + fifteens)
  for (const c of cards) {
    if (c.rank === '5') score += 1.5;
    if (c.rank === 'J') score += 0.3; // nobs chance
  }

  return score;
}

/**
 * Penalty for cards tossed to opponent's crib (when AI is non-dealer).
 * Easy 15s / pairs / 5s are especially bad gifts.
 */
export function opponentCribPenalty(discards: Card[]): number {
  let pen = 0;
  const n = discards.length;
  for (let a = 0; a < n; a++) {
    if (discards[a].rank === '5') pen += 4;
    for (let b = a + 1; b < n; b++) {
      const va = cardValue(discards[a]);
      const vb = cardValue(discards[b]);
      if (va + vb === 15) pen += 5;
      if (discards[a].rank === discards[b].rank) pen += 4;
      // Sequential ranks help opponent runs
      if (Math.abs(rankOrder(discards[a].rank) - rankOrder(discards[b].rank)) === 1) {
        pen += 1.5;
      }
    }
  }
  // Three-card 15 when dealer discards 3 — still used only as opponent penalty
  if (n >= 3) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let c = b + 1; c < n; c++) {
          if (
            cardValue(discards[a]) +
              cardValue(discards[b]) +
              cardValue(discards[c]) ===
            15
          ) {
            pen += 3;
          }
        }
      }
    }
  }
  return pen;
}

/** Mild bonus when loading own crib (AI is dealer). */
function ownCribBonus(discards: Card[]): number {
  return opponentCribPenalty(discards) * 0.35;
}

/** Hard: stronger crib awareness multipliers. */
function cribWeight(difficulty: AiDifficulty): { opp: number; own: number } {
  if (difficulty === 'hard') return { opp: 1.55, own: 1.45 };
  return { opp: 1, own: 1 };
}

interface ScoredDiscard {
  disc: Card[];
  score: number;
}

function scoreDiscardCombos(
  hand: Card[],
  need: number,
  isDealer: boolean,
  difficulty: AiDifficulty,
): ScoredDiscard[] {
  const keepCount = hand.length - need;
  const discardCombos = combinations(hand, need);
  const weights = cribWeight(difficulty);
  const scored: ScoredDiscard[] = [];

  for (const disc of discardCombos) {
    const discIds = new Set(disc.map((c) => c.id));
    const keep = hand.filter((c) => !discIds.has(c.id));
    if (keep.length !== keepCount) continue;

    let score = estimateKeepValue(keep);
    if (isDealer) {
      score += ownCribBonus(disc) * weights.own;
    } else {
      score -= opponentCribPenalty(disc) * weights.opp;
    }

    // Tiny tie-break: prefer discarding higher dead wood
    score -= disc.reduce((s, c) => s + cardValue(c), 0) * 0.01;
    scored.push({ disc, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Pick among scored candidates by difficulty.
 * Easy: often random or from bottom ~50%; Normal/Hard: top (Hard has no noise).
 */
function pickByDifficulty<T>(
  scored: { item: T; score: number }[],
  difficulty: AiDifficulty,
  rng: () => number = Math.random,
): T {
  if (scored.length === 0) {
    throw new Error('pickByDifficulty requires at least one candidate');
  }
  if (scored.length === 1 || difficulty === 'hard') {
    return scored[0].item;
  }
  if (difficulty === 'normal') {
    // Tiny noise: rarely take 2nd-best when close
    if (
      scored.length >= 2 &&
      scored[0].score - scored[1].score < 0.35 &&
      rng() < 0.08
    ) {
      return scored[1].item;
    }
    return scored[0].item;
  }

  // Easy: high chance of suboptimal
  const roll = rng();
  if (roll < 0.45) {
    // Pure random among all legal
    return scored[Math.floor(rng() * scored.length)].item;
  }
  if (roll < 0.8) {
    // Bottom ~50% by score (worst half)
    const half = Math.max(1, Math.ceil(scored.length * 0.5));
    const bottom = scored.slice(-half);
    return bottom[Math.floor(rng() * bottom.length)].item;
  }
  // Occasional "almost good" — top half but not always #1
  const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.5)));
  return topHalf[Math.floor(rng() * topHalf.length)].item;
}

export function chooseDiscards(
  hand: Card[],
  need: number,
  isDealer: boolean,
  difficulty: AiDifficulty = 'normal',
  rng: () => number = Math.random,
): Card[] {
  const scored = scoreDiscardCombos(hand, need, isDealer, difficulty);
  if (scored.length === 0) return hand.slice(0, need);
  return pickByDifficulty(
    scored.map((s) => ({ item: s.disc, score: s.score })),
    difficulty,
    rng,
  );
}

// ── Pegging heuristic ──────────────────────────────────────────────

/**
 * Soft lookahead: after our play, how easy is a 15 / pair / 31 for a generic opponent?
 * Used only as a tie-break / slight penalty on Hard.
 */
function leaveDangerPenalty(peg: PegState, card: Card): number {
  const newCount = peg.count + cardValue(card);
  if (newCount >= 31) return 0;
  let danger = 0;
  // Leaving count that makes 15 easy (count in 5..14 with room)
  const needFor15 = 15 - newCount;
  if (needFor15 >= 1 && needFor15 <= 10) danger += 0.8;
  // Pair bait: opponent matching our rank
  danger += 0.5;
  // Near 31 with small cards left for them
  const needFor31 = 31 - newCount;
  if (needFor31 >= 1 && needFor31 <= 5) danger += 0.6;
  return danger;
}

interface ScoredPeg {
  card: Card;
  key: number;
}

function scorePegCandidates(
  legal: Card[],
  peg: PegState,
  difficulty: AiDifficulty,
): ScoredPeg[] {
  const scored: ScoredPeg[] = [];
  const pointMul = difficulty === 'hard' ? 1.35 : 1;

  for (const card of legal) {
    const newCount = peg.count + cardValue(card);
    if (newCount > 31) continue;

    const events = scorePegPlay(peg.sequence, card, newCount);
    const pts = totalPegPoints(events);
    // Prefer points, then exact 31, then lower card value (save big cards)
    let key = pts * 100 * pointMul + (newCount === 31 ? 10 : 0) - cardValue(card);

    if (difficulty === 'hard') {
      // Aggressively prefer any scoring play; penalize leaving easy replies when tied on points
      if (pts > 0) key += pts * 25;
      if (pts === 0) key -= leaveDangerPenalty(peg, card) * 8;
    }

    scored.push({ card, key });
  }

  scored.sort((a, b) => b.key - a.key);
  return scored;
}

/**
 * Prefer scoring plays (15 / 31 / pair / run / …) when legal;
 * else lowest safe card. Never chooses a card that busts 31
 * (caller must pass only legal cards).
 */
export function choosePegCard(
  legal: Card[],
  peg: PegState,
  difficulty: AiDifficulty = 'normal',
  rng: () => number = Math.random,
): Card {
  if (legal.length === 0) {
    throw new Error('choosePegCard requires at least one legal card');
  }

  const scored = scorePegCandidates(legal, peg, difficulty);
  if (scored.length === 0) return legal[0];

  return pickByDifficulty(
    scored.map((s) => ({ item: s.card, score: s.key })),
    difficulty,
    rng,
  );
}

/** Exported for tests: all legal peg cards never exceed 31. */
export function assertLegalPegChoices(hand: Card[], count: number): Card[] {
  return legalPegCards(hand, count);
}
