/**
 * Supercrib Phase 1 game engine — pure state machine.
 * Hot-seat 2-player; target 241; locked rules only.
 */

import {
  Card,
  createDeck,
  shuffle,
  rankOrder,
} from './cards';
import { scoreHand, ScoreBreakdown } from './scoreHand';
import {
  type ScoringMode,
  type ShowClaimStep,
  type ClaimOutcomeKind,
  type RefKeepSide,
  resolveClaim,
  isCompetitiveMode,
  refereeAdjustKeep,
  wrongCorrectorPenaltyRaw,
  buildRefVerdict,
} from './competitiveScoring';

export type { ScoringMode, ShowClaimStep, ClaimOutcomeKind } from './competitiveScoring';
export { resolveClaim, isCompetitiveMode, normalizeScoringMode, canOfferCompetitiveOnline } from './competitiveScoring';
import {
  PegState,
  createPegState,
  legalPegCards,
  canPlayAny,
  applyPegPlay,
  applyGo,
  resetSequence,
  totalPegPoints,
  formatPegKindLabel,
  normalizeSaidGo,
  isLastCardExact31,
  type PegScoreEvent,
} from './pegging';

export { formatPegKindLabel } from './pegging';

export const TARGET = 241;
export const TRAP_SCORE = 240;

export type Phase =
  | 'deal'
  | 'discard'
  | 'cut'
  | 'heels'
  | 'pegging'
  | 'show'
  | 'zeroHandOffer'
  | 'redeal'
  | 'roundEnd'
  | 'gameOver';

export type PlayerId = 0 | 1;

export interface PlayerState {
  hand: Card[];
  /** Cards already played in pegging (face up history). */
  played: Card[];
  score: number;
  /** Pending discards selected (UI); confirmed into crib. */
  discardSel: Card[];
}

export interface ShowResult {
  pone: ScoreBreakdown; // non-dealer
  dealer: ScoreBreakdown;
  crib: ScoreBreakdown;
  zeroHandRedeal: boolean;
  zeroCribPenalty: number; // 30 if applied else 0
  /** Scores after show applied (or pre-redeal). */
  scoresAfter: [number, number];
}

export interface CompetitiveClaimLogEntry {
  step: ShowClaimStep;
  /** Resolved / kept announced total (after Approve or Ref). */
  claimed: number;
  trueTotal: number;
  kind: ClaimOutcomeKind;
  overclaimPenalty?: number;
  /** Missed points taken by opponent; 0 if Accept. */
  mugginsTaken?: number;
  mugginsBy?: PlayerId;
  /** First announced hand total (before Adjust/Ref); equals claimed if Approve. */
  claimedOriginal?: number;
  /** Opponent's adjusted total when Adjust was used. */
  adjustedClaimed?: number;
  /** Applied wrong-corrector peg (adjuster penalized when Adjust ≠ true). */
  wrongCorrectorPenalty?: number;
}

export interface CompetitivePendingMuggins {
  step: ShowClaimStep;
  scorer: PlayerId;
  claimed: number;
  trueTotal: number;
  missed: number;
  /** First announced hand total (before Adjust/Ref). */
  claimedOriginal?: number;
  /** Opponent's adjusted total when Adjust was used. */
  adjustedClaimed?: number;
}

/** Opponent must Approve or Adjust the claimant's announced hand total. */
export interface CompetitivePendingReview {
  step: ShowClaimStep;
  scorer: PlayerId;
  claimed: number;
}

/** Ref outcome after Adjust — blocking modal then banner. */
export interface CompetitiveRefNote {
  trueRaw: number;
  /** Claimant seat for this hand (adjuster = 1 − scorer). */
  scorer: PlayerId;
  sidedWith: RefKeepSide;
  kept: number;
  originalClaimed: number;
  adjustedClaimed: number;
  neitherExact: boolean;
  /** Adjuster's number ≠ true raw. */
  adjusterWrong: boolean;
  /** Peg points subtracted from adjuster (0 if adjuster exact). */
  wrongCorrectorPenalty: number;
  /** Verdict line for Ref modal. */
  verdict: string;
}

/** In-progress competitive show (manual count + muggins). */
export interface CompetitiveShowState {
  /** Current claim step, or 'done' when all applied. */
  step: ShowClaimStep | 'done';
  /** After a hand count: opponent Approve (keep) or Adjust (replace). */
  pendingReview: CompetitivePendingReview | null;
  pendingMuggins: CompetitivePendingMuggins | null;
  log: CompetitiveClaimLogEntry[];
  /**
   * Blocking Ref modal after Adjust (before Muggins / next claim).
   * Cleared by acknowledgeCompetitiveRef, or when the show segment advances
   * (next claim step / muggins resolve / new deal).
   */
  pendingRef?: CompetitiveRefNote | null;
  /**
   * Set after Adjust; kept through Muggins on the same hand, cleared when
   * play advances past that segment (ack with no muggins, next claim step,
   * muggins resolve, announce / Approve).
   */
  lastRef?: CompetitiveRefNote | null;
}

export interface PegFlash {
  /** Monotonic id so UI can remount callout animations. */
  id: number;
  player: PlayerId;
  points: number;
  events: PegScoreEvent[];
  /** True when 240 trap blocked the points. */
  blocked?: boolean;
  /** Optional label override (e.g. heels). */
  kindLabel?: string;
}

/** Difficulty for vs-AI games (ignored for hotseat/online). */
export type AiDifficulty = 'easy' | 'normal' | 'hard';

export interface GameState {
  phase: Phase;
  dealer: PlayerId;
  /** Non-dealer (pone). */
  pone: PlayerId;
  players: [PlayerState, PlayerState];
  crib: Card[];
  starter: Card | null;
  deck: Card[];
  peg: PegState | null;
  /** Play pile display (current sequence cards). */
  message: string;
  showResult: ShowResult | null;
  winner: PlayerId | null;
  /** Banner: trapped at 240. */
  trapped: [boolean, boolean];
  /** Win via last-card-31 from 240. */
  trapEscapeWin: boolean;
  dealNumber: number;
  /** His heels pending (2 to dealer, not doubled). */
  heelsPoints: number;
  /** Latest pegging/heels score flash for UI callout (does not affect rules). */
  lastPegFlash: PegFlash | null;
  mode: 'hotseat' | 'ai' | 'online';
  /** Vs-AI only: Easy / Normal / Hard. Online/hotseat omit. */
  aiDifficulty?: AiDifficulty;
  /**
   * Show counting style. Default auto (engine counts).
   * Competitive: manual claim + muggins; same SuperCrib show totals (Spade ×2 / raw).
   */
  scoringMode?: ScoringMode;
  /** Competitive show claim / muggins progress (null in auto mode). */
  competitiveShow?: CompetitiveShowState | null;
  /** Online: each seat must ack show/redeal before nextRound. */
  showReady: [boolean, boolean];
}

function emptyPlayer(): PlayerState {
  return { hand: [], played: [], score: 0, discardSel: [] };
}

export function createGame(
  mode: 'hotseat' | 'ai' | 'online' = 'hotseat',
  options?: { aiDifficulty?: AiDifficulty; scoringMode?: ScoringMode },
): GameState {
  const state: GameState = {
    phase: 'deal',
    dealer: 0,
    pone: 1,
    players: [emptyPlayer(), emptyPlayer()],
    crib: [],
    starter: null,
    deck: [],
    peg: null,
    message: 'New game — deal to start.',
    showResult: null,
    winner: null,
    trapped: [false, false],
    trapEscapeWin: false,
    dealNumber: 0,
    heelsPoints: 0,
    lastPegFlash: null,
    mode,
    scoringMode: options?.scoringMode ?? 'auto',
    competitiveShow: null,
    showReady: [false, false],
  };
  if (mode === 'ai') {
    state.aiDifficulty = options?.aiDifficulty ?? 'normal';
  }
  return state;
}

/** Thin wrapper: vs-AI game at the given difficulty (default Normal). */
export function createAiGame(
  difficulty: AiDifficulty = 'normal',
  scoringMode: ScoringMode = 'auto',
): GameState {
  return createGame('ai', { aiDifficulty: difficulty, scoringMode });
}

let pegFlashSeq = 0;
/**
 * Cross-client unique flash ids. A plain incrementing counter collides online
 * (each browser starts at 0), so flashSeenId skips a remote pair in later rounds.
 */
function nextPegFlashId(): number {
  pegFlashSeq = (pegFlashSeq + 1) % 1000;
  return Date.now() * 1000 + pegFlashSeq;
}

function other(p: PlayerId): PlayerId {
  return (1 - p) as PlayerId;
}

/** Keep score in [0, TARGET] conceptually; floor at 0 for penalties. */
export function clampScore(n: number): number {
  return Math.max(0, n);
}

/**
 * Can this player score points toward a win from current score?
 * At exactly 240: cannot win via show or normal pegging — only last-card exact 31.
 */
export function isTrapped(score: number): boolean {
  return score === TRAP_SCORE;
}

/**
 * Apply pegging/show points with 240 trap and 241 target.
 * Returns { score, won, trapBlocked }.
 * For trap escape: pass `trapEscape: true` when last card exact 31.
 */
export function applyPoints(
  current: number,
  points: number,
  opts: { trapEscape?: boolean; allowWin?: boolean } = {},
): { score: number; won: boolean; trapBlocked: boolean } {
  if (points <= 0) {
    return { score: current, won: false, trapBlocked: false };
  }

  const trapped = isTrapped(current);

  if (trapped) {
    if (opts.trapEscape) {
      const next = current + points;
      if (next >= TARGET) {
        return { score: TARGET, won: true, trapBlocked: false };
      }
      // Escape play that doesn't reach 241 still adds? Spec: ONLY win from 240
      // is last-card-31. So non-winning peg points from 240 are blocked too
      // except that exact escape path which wins. If last-card-31 gives 2 pts
      // → 242, win at 241.
      return { score: TARGET, won: true, trapBlocked: false };
    }
    // Blocked: cannot score via show or normal pegging
    return { score: current, won: false, trapBlocked: true };
  }

  const next = current + points;
  if (next === TRAP_SCORE) {
    return { score: TRAP_SCORE, won: false, trapBlocked: false };
  }
  if (next >= TARGET) {
    // Landing on/over 241 wins, unless we'd need to stop... Spec: first to 241.
    // If current + points >= 241 and not trapped, win.
    // But if current is 239 and points is 2 → 241 win.
    // If current is 238 and points is 2 → 240 trap, no win.
    return { score: TARGET, won: true, trapBlocked: false };
  }
  return { score: next, won: false, trapBlocked: false };
}

/** Subtract points (zero-crib), floor 0. */
export function applyPenalty(current: number, penalty: number): number {
  return clampScore(current - penalty);
}

function scoreOpts(state: GameState): { scoringMode?: ScoringMode } {
  return { scoringMode: state.scoringMode ?? 'auto' };
}

/** Seat that must announce the current competitive claim step. */
export function competitiveClaimant(state: GameState): PlayerId | null {
  const cs = state.competitiveShow;
  if (
    !cs ||
    cs.step === 'done' ||
    cs.pendingMuggins ||
    cs.pendingReview ||
    cs.pendingRef
  ) {
    return null;
  }
  if (cs.step === 'pone') return state.pone;
  return state.dealer; // dealer hand + crib
}

/** Seat that may Confirm / Adjust the pending claim. */
export function competitiveReviewRespondent(state: GameState): PlayerId | null {
  const pending = state.competitiveShow?.pendingReview;
  if (!pending) return null;
  return (1 - pending.scorer) as PlayerId;
}

/** Seat that may Accept / Muggins an underclaim. */
export function competitiveMugginsRespondent(state: GameState): PlayerId | null {
  const pending = state.competitiveShow?.pendingMuggins;
  if (!pending) return null;
  return (1 - pending.scorer) as PlayerId;
}

export function competitiveShowActive(state: GameState): boolean {
  return (
    isCompetitiveMode(state.scoringMode) &&
    state.phase === 'show' &&
    !!state.competitiveShow &&
    state.competitiveShow.step !== 'done'
  );
}

export function startDeal(state: GameState, rng: () => number = Math.random): GameState {
  const deck = shuffle(createDeck(), rng);
  const dealer = state.dealer;
  const pone = other(dealer);

  // Deal: dealer 8, opponent (pone) 7 — alternate, pone first (non-dealer first card)
  const poneHand: Card[] = [];
  const dealerHand: Card[] = [];
  let i = 0;
  // 7 rounds to pone+dealer, then 1 extra to dealer
  for (let r = 0; r < 7; r++) {
    poneHand.push(deck[i++]);
    dealerHand.push(deck[i++]);
  }
  dealerHand.push(deck[i++]); // 8th to dealer

  const remaining = deck.slice(i);

  const players: [PlayerState, PlayerState] = [
    { ...emptyPlayer(), score: state.players[0].score, hand: dealer === 0 ? dealerHand : poneHand },
    { ...emptyPlayer(), score: state.players[1].score, hand: dealer === 1 ? dealerHand : poneHand },
  ];
  // Fix hands properly:
  players[dealer] = {
    ...emptyPlayer(),
    score: state.players[dealer].score,
    hand: dealerHand,
  };
  players[pone] = {
    ...emptyPlayer(),
    score: state.players[pone].score,
    hand: poneHand,
  };

  return {
    ...state,
    phase: 'discard',
    pone,
    players,
    crib: [],
    starter: null,
    deck: remaining,
    peg: null,
    message: `Deal #${state.dealNumber + 1}: discard to crib (2 cards, or 3 if dealer).`,
    showResult: null,
    competitiveShow: null,
    heelsPoints: 0,
    lastPegFlash: null,
    dealNumber: state.dealNumber + 1,
    trapEscapeWin: false,
    winner: state.winner,
    showReady: [false, false],
  };
}

export function requiredDiscards(state: GameState, player: PlayerId): number {
  return player === state.dealer ? 3 : 2;
}

export function toggleDiscardSelect(state: GameState, player: PlayerId, card: Card): GameState {
  if (state.phase !== 'discard') return state;
  const p = state.players[player];
  const need = requiredDiscards(state, player);
  const has = p.discardSel.some((c) => c.id === card.id);
  let discardSel: Card[];
  if (has) {
    discardSel = p.discardSel.filter((c) => c.id !== card.id);
  } else {
    if (p.discardSel.length >= need) return state;
    if (!p.hand.some((c) => c.id === card.id)) return state;
    discardSel = [...p.discardSel, card];
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...p, discardSel };
  return { ...state, players };
}

export function confirmDiscard(state: GameState, player: PlayerId): GameState {
  if (state.phase !== 'discard') return state;
  const need = requiredDiscards(state, player);
  const p = state.players[player];
  if (p.discardSel.length !== need) return state;

  const selIds = new Set(p.discardSel.map((c) => c.id));
  const hand = p.hand.filter((c) => !selIds.has(c.id));
  if (hand.length !== 5) return state;

  const crib = [...state.crib, ...p.discardSel];
  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...p, hand, discardSel: [] };

  let next: GameState = {
    ...state,
    players,
    crib,
    message: `Discard confirmed (${need} cards).`,
  };

  // Both done when crib has 5
  if (crib.length === 5) {
    next = { ...next, phase: 'cut', message: 'Cut the deck — tap a face-down card for the starter.' };
  }
  return next;
}

/**
 * Non-dealer cuts: choose a card from the remaining stock as starter (dealer turns it).
 * Pass `cutIndex` for a player-chosen cut; omit to pick randomly (AI / tests).
 */
export function cutStarter(
  state: GameState,
  rngOrIndex: (() => number) | number = Math.random,
): GameState {
  if (state.phase !== 'cut' && state.phase !== 'heels') return state;
  if (state.crib.length !== 5) return state;

  const rng = typeof rngOrIndex === 'function' ? rngOrIndex : Math.random;
  let deck = state.deck;
  if (deck.length === 0) {
    // Shouldn't happen with 52-15=37 left; safety reshuffle unused
    deck = shuffle(createDeck(), rng);
  }
  const cutIndex =
    typeof rngOrIndex === 'number'
      ? Math.max(0, Math.min(deck.length - 1, Math.floor(rngOrIndex)))
      : Math.floor(rng() * deck.length);
  const starter = deck[cutIndex];
  const remaining = [...deck.slice(0, cutIndex), ...deck.slice(cutIndex + 1)];

  let heelsPoints = 0;
  let message = `Starter: ${starter.rank} of ${starter.suit}.`;
  if (starter.suit === 'spades') {
    message += ' SPADE — show is RAW (no ×2).';
  } else {
    message += ' Show will be ×2.';
  }

  let players = state.players;
  let winner: PlayerId | null = state.winner;
  let trapped = [...state.trapped] as [boolean, boolean];

  if (starter.rank === 'J') {
    heelsPoints = 2;
    message += ' His heels! Dealer +2.';
    const d = state.dealer;
    const res = applyPoints(players[d].score, 2, {});
    const nextPlayers = [...players] as [PlayerState, PlayerState];
    nextPlayers[d] = { ...players[d], score: res.score };
    players = nextPlayers;
    trapped[d] = isTrapped(res.score);
    if (res.won) winner = d;
  }

  // Pegging: pone plays first
  const peg = createPegState(state.pone);

  const lastPegFlash: PegFlash | null =
    heelsPoints > 0
      ? {
          id: nextPegFlashId(),
          player: state.dealer,
          points: heelsPoints,
          events: [],
          kindLabel: 'heels',
        }
      : null;

  const afterCut: GameState = {
    ...state,
    phase: winner !== null ? 'gameOver' : 'pegging',
    starter,
    deck: remaining,
    peg,
    players,
    heelsPoints,
    message,
    winner,
    trapped,
    lastPegFlash,
  };
  // Catch dead hands before pegging — offer zero-hand redeal overlay.
  return applyZeroHandOfferIfNeeded(afterCut);
}

export function getLegalPegCards(state: GameState, player: PlayerId): Card[] {
  if (!state.peg || state.phase !== 'pegging') return [];
  return legalPegCards(state.players[player].hand, state.peg.count);
}

/** Banner pause duration for GO / 31 overlays (ms). */
export const PEG_BANNER_MS = 2400;

/** Pegging hit exactly 31 — UI should pause before resetting the pile. */
export function needsThirtyOnePause(state: GameState): boolean {
  return (
    state.phase === 'pegging' &&
    !!state.peg &&
    state.peg.sequenceDone &&
    state.peg.count === 31
  );
}

/** toPlay cannot legally play — UI should pause and show GO before applying. */
export function needsGoPause(state: GameState): boolean {
  if (state.phase !== 'pegging' || !state.peg || state.winner !== null) return false;
  if (state.peg.sequenceDone) return false;
  return !canPlayAny(state.players[state.peg.toPlay].hand, state.peg.count);
}

/**
 * Both hands empty after pegging scoring (go/last or final play) — UI pauses so
 * the peg flash is visible before ShowOverlay. Not used while a 31 banner is up.
 */
export function needsEndOfPeggingPause(state: GameState): boolean {
  return (
    state.phase === 'pegging' &&
    !!state.peg &&
    state.winner === null &&
    state.peg.sequenceDone &&
    state.players[0].hand.length === 0 &&
    state.players[1].hand.length === 0 &&
    !needsThirtyOnePause(state)
  );
}

/** After end-of-pegging flash pause: advance to show (or redeal). */
export function finishPeggingToShow(state: GameState): GameState {
  if (!needsEndOfPeggingPause(state)) return state;
  return beginShow(state);
}

/**
 * Play a card in pegging. Enforces 240 trap (normal pegging blocked from scoring
 * if trapped, unless last-card exact 31 escape).
 */
export function playPegCard(state: GameState, player: PlayerId, card: Card): GameState {
  if (state.phase !== 'pegging' || !state.peg || state.winner !== null) return state;
  if (state.peg.toPlay !== player) return state;
  // Normalize saidGo (Set/array/Firebase object) so .has never throws / silently fails
  const pegNorm = { ...state.peg, saidGo: normalizeSaidGo(state.peg.saidGo) };
  if (pegNorm.saidGo.has(player)) return state;

  const hand = state.players[player].hand;
  if (!hand.some((c) => c.id === card.id)) return state;
  if (!legalPegCards(hand, pegNorm.count).some((c) => c.id === card.id)) return state;

  let { state: pegAfter, events } = applyPegPlay(pegNorm, card, player);
  const points = totalPegPoints(events);
  const newHand = hand.filter((c) => c.id !== card.id);
  const played = [...state.players[player].played, card];

  const newCount = pegAfter.count;
  // Exact 31 ends the pegging count — that play is the "last card … for exactly 31"
  // escape from StinkHole (Rules). Emptying the hand is NOT required.
  const trapEscape =
    isTrapped(state.players[player].score) && isLastCardExact31(newCount);

  const res = applyPoints(state.players[player].score, points, {
    trapEscape,
  });

  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...players[player], hand: newHand, played, score: res.score };

  const trapped: [boolean, boolean] = [
    isTrapped(players[0].score),
    isTrapped(players[1].score),
  ];

  let message = `P${player} plays ${card.rank}${card.suit[0].toUpperCase()} (count ${newCount}).`;
  if (events.length) {
    message +=
      ' ' +
      events.map((e) => `${e.kind}+${e.points}`).join(', ') +
      `.`;
  }
  if (res.trapBlocked) {
    message += ' [StinkHole — peg points blocked]';
  }
  if (res.won && trapEscape) {
    message += ' Escaped 240 via last-card-31!';
  }

  let flashEvents = events;
  let flashPoints = points;
  let flashBlocked = res.trapBlocked;
  let flashWon = res.won;

  // Last play of pegging (both hands empty) without hitting 31: award +1 go/last.
  // Stay in pegging with sequenceDone so the UI can show the flash before show.
  const bothEmpty =
    players[0].hand.length === 0 && players[1].hand.length === 0;
  if (bothEmpty && !pegAfter.sequenceDone && !res.won) {
    const goEvent: PegScoreEvent = { kind: 'go', points: 1 };
    flashEvents = [...events, goEvent];
    flashPoints = totalPegPoints(flashEvents);
    const goRes = applyPoints(players[player].score, 1, { trapEscape: false });
    players[player] = { ...players[player], score: goRes.score };
    flashWon = goRes.won;
    flashBlocked = res.trapBlocked || goRes.trapBlocked;
    pegAfter = { ...pegAfter, sequenceDone: true };
    if (!goRes.trapBlocked) {
      message += ` Go/last +1.`;
    } else {
      message += ' [StinkHole — go point blocked]';
    }
    trapped[0] = isTrapped(players[0].score);
    trapped[1] = isTrapped(players[1].score);
  }

  const kindLabel =
    flashEvents.length > 0
      ? formatPegKindLabel(flashEvents) ||
        flashEvents.map((e) => e.kind).join(' · ') ||
        'peg'
      : '';
  const lastPegFlash: PegFlash | null =
    flashEvents.length > 0
      ? {
          id: nextPegFlashId(),
          player,
          points: flashPoints,
          events: flashEvents,
          blocked: flashBlocked,
          kindLabel,
        }
      : null;

  let next: GameState = {
    ...state,
    players,
    peg: pegAfter,
    message,
    trapped,
    winner: flashWon ? player : null,
    trapEscapeWin: flashWon && trapEscape,
    phase: flashWon ? 'gameOver' : state.phase,
    lastPegFlash,
  };

  if (flashWon) return next;

  // On 31: leave sequenceDone + count 31 visible for UI pause (finishPegThirtyOne later).
  // Do NOT resetSequence or chain forced Goes here — UI owns the delay.

  // Both hands empty (with or without go award): stay in pegging so flash is visible.
  // Host advances via finishPeggingToShow after PEG_BANNER_MS.
  // (Previously beginShow ran in the same tick and ShowOverlay hid the callout.)

  return next;
}

/**
 * After the 31 banner pause: reset the pegging sequence (opponent leads).
 * Does not chain forced Goes — UI may pause again if the leader cannot play.
 */
export function finishPegThirtyOne(state: GameState): GameState {
  if (!needsThirtyOnePause(state) || !state.peg) return state;
  const nextPlayer = state.peg.toPlay; // opponent from applyPegPlay
  let next: GameState = {
    ...state,
    peg: resetSequence(state.peg, nextPlayer),
    message: state.message.includes('New sequence')
      ? state.message
      : state.message + ' New sequence.',
  };
  if (next.players[0].hand.length === 0 && next.players[1].hand.length === 0) {
    return beginShow(next);
  }
  return next;
}

/**
 * While pegging and toPlay cannot legally play, auto-say Go until someone can
 * play or the phase ends. Caps iterations to avoid infinite loops.
 */
export function resolveForcedPegGoes(state: GameState): GameState {
  let cur = state;
  for (let i = 0; i < 4; i++) {
    if (cur.phase !== 'pegging' || !cur.peg || cur.winner !== null) break;
    const tp = cur.peg.toPlay;
    if (canPlayAny(cur.players[tp].hand, cur.peg.count)) break;
    const next = applySayGo(cur, tp);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** Public Go — one Go step only (UI schedules chained Goes after delay). */
export function sayGo(state: GameState, player: PlayerId): GameState {
  return applySayGo(state, player);
}

/** Single Go step (no multi-go chain). */
export function applySayGo(state: GameState, player: PlayerId): GameState {
  if (state.phase !== 'pegging' || !state.peg || state.winner !== null) return state;
  if (state.peg.sequenceDone) return state;
  if (state.peg.toPlay !== player) return state;

  const pegNorm = { ...state.peg, saidGo: normalizeSaidGo(state.peg.saidGo) };

  // May only say go if cannot play
  if (canPlayAny(state.players[player].hand, pegNorm.count)) return state;

  const opp = other(player);
  const opponentCanPlay =
    state.players[opp].hand.length > 0 &&
    canPlayAny(state.players[opp].hand, pegNorm.count) &&
    !pegNorm.saidGo.has(opp);

  const { state: pegAfter, events, lastCardPlayer } = applyGo(
    pegNorm,
    player,
    opponentCanPlay,
  );

  let players = state.players;
  let winner: PlayerId | null = state.winner;
  let trapped = [...state.trapped] as [boolean, boolean];
  let message = `P${player} says go.`;
  let trapEscapeWin = false;

  if (events.length && lastCardPlayer !== null) {
    const pts = totalPegPoints(events);
    // Go/last card = 1 — NOT a trap escape (escape needs exact 31)
    const res = applyPoints(players[lastCardPlayer].score, pts, { trapEscape: false });
    const nextPlayers = [...players] as [PlayerState, PlayerState];
    nextPlayers[lastCardPlayer] = {
      ...players[lastCardPlayer],
      score: res.score,
    };
    players = nextPlayers;
    trapped[lastCardPlayer] = isTrapped(res.score);
    if (res.won) winner = lastCardPlayer;
    if (res.trapBlocked) message += ' [StinkHole — go point blocked]';
    else message += ` Last card +${pts} to P${lastCardPlayer}.`;
  }

  const goKindLabel =
    events.length && lastCardPlayer !== null
      ? formatPegKindLabel(events) || 'go'
      : undefined;
  const lastPegFlash: PegFlash | null =
    events.length && lastCardPlayer !== null
      ? {
          id: nextPegFlashId(),
          player: lastCardPlayer,
          points: totalPegPoints(events),
          events,
          blocked: message.includes('StinkHole'),
          kindLabel: goKindLabel || 'go',
        }
      : null;

  let next: GameState = {
    ...state,
    players,
    peg: pegAfter,
    message,
    trapped,
    winner,
    trapEscapeWin,
    phase: winner !== null ? 'gameOver' : state.phase,
    lastPegFlash,
  };

  if (winner !== null) return next;

  const bothEmpty =
    players[0].hand.length === 0 && players[1].hand.length === 0;

  if (pegAfter.sequenceDone) {
    // After Go resolves: if both hands empty, stay in pegging (sequenceDone)
    // so the go flash is visible before finishPeggingToShow.
    if (bothEmpty) {
      return next;
    }
    // Otherwise reset: the player who said Go leads next (pegAfter.toPlay).
    let leader = pegAfter.toPlay; // Go-caller (see applyGo)
    if (players[leader].hand.length === 0) leader = other(leader);
    next = {
      ...next,
      peg: resetSequence(pegAfter, leader),
      message: next.message + ' New sequence.',
    };
  }

  // Both empty without sequenceDone is unexpected here; keep pegging for pause.
  if (bothEmpty) {
    return next;
  }

  return next;
}


/**
 * If either 5-card hand scores 0 with the starter, pause for a choice:
 * Redeal (void) or Continue with 0.
 * Hands may be in `hand` (after cut) or `played` (after pegging).
 */
export function applyZeroHandOfferIfNeeded(state: GameState): GameState {
  if (!state.starter) return state;
  if (state.winner !== null) return state;
  if (state.phase === 'zeroHandOffer' || state.phase === 'redeal') return state;

  const starter = state.starter;
  const dealer = state.dealer;
  const pone = state.pone;

  const handOf = (pid: PlayerId): Card[] => {
    const p = state.players[pid];
    if (p.hand.length === 5) return p.hand;
    if (p.played.length === 5) return p.played;
    const combined = [...p.played, ...p.hand];
    return combined.length === 5 ? combined : p.played;
  };

  const poneHand = handOf(pone);
  const dealerHand = handOf(dealer);
  if (poneHand.length !== 5 || dealerHand.length !== 5) return state;
  if (state.crib.length !== 5) return state;

  const opts = scoreOpts(state);
  const poneScore = scoreHand(poneHand, starter, false, opts);
  const dealerScore = scoreHand(dealerHand, starter, false, opts);
  if (poneScore.total !== 0 && dealerScore.total !== 0) return state;

  const cribScore = scoreHand(state.crib, starter, true, opts);
  const showResult: ShowResult = {
    pone: poneScore,
    dealer: dealerScore,
    crib: cribScore,
    zeroHandRedeal: true,
    zeroCribPenalty: 0,
    scoresAfter: [state.players[0].score, state.players[1].score],
  };
  return {
    ...state,
    phase: 'zeroHandOffer',
    showResult,
    // Keep peg if we already created one after cut; cleared on redeal choice.
    showReady: [false, false],
    message:
      'A hand scores 0 with this starter — Redeal, or Continue with 0.',
  };
}

/** @deprecated alias */
export function applyZeroHandRedealIfNeeded(state: GameState): GameState {
  return applyZeroHandOfferIfNeeded(state);
}

/**
 * Resolve zero-hand offer.
 * - redeal: void deal, same dealer redeals (via existing redeal ack flow)
 * - continue: keep the 0 and play on (pegging if pre-peg, or apply show if post-peg)
 */
export function resolveZeroHandOffer(
  state: GameState,
  choice: 'redeal' | 'continue',
): GameState {
  if (state.phase !== 'zeroHandOffer' || !state.showResult) return state;

  if (choice === 'redeal') {
    // One tap: void and redeal immediately (same dealer).
    return redealSameDealer({
      ...state,
      phase: 'redeal',
      peg: null,
      showReady: [false, false],
      lastPegFlash: null,
      message:
        'ZERO-HAND REDEAL: deal voided. Same dealer redeals. No show points from this deal.',
    });
  }

  // Continue with 0
  const stillHolding =
    state.players[0].hand.length === 5 || state.players[1].hand.length === 5;

  if (stillHolding) {
    // Pre-pegging (right after cut)
    return {
      ...state,
      phase: 'pegging',
      showResult: null,
      peg: state.peg ?? createPegState(state.pone),
      showReady: [false, false],
      message: 'Continuing with a 0-hand. Pegging…',
    };
  }

  // Post-pegging: apply show scores (including the 0) instead of voiding
  if (isCompetitiveMode(state.scoringMode)) {
    // Keep true totals in showResult; enter claim flow without pegging yet.
    const r = state.showResult;
    return {
      ...state,
      phase: 'show',
      showResult: r
        ? {
            ...r,
            zeroHandRedeal: false,
            scoresAfter: [state.players[0].score, state.players[1].score],
          }
        : r,
      competitiveShow: {
        step: 'pone',
        pendingReview: null,
        pendingMuggins: null,
        log: [],
      },
      peg: null,
      showReady: [false, false],
      message: 'Competitive show — announce your count.',
    };
  }
  return applyShowScoresFromResult(state);
}

/** Apply show points from an existing showResult (used when continuing with a 0-hand). */
function applyShowScoresFromResult(state: GameState): GameState {
  const r = state.showResult;
  if (!r || !state.starter) return state;
  const dealer = state.dealer;
  const pone = state.pone;
  let players = [...state.players] as [PlayerState, PlayerState];
  let winner: PlayerId | null = null;
  let trapped: [boolean, boolean] = [
    isTrapped(players[0].score),
    isTrapped(players[1].score),
  ];

  const applyShow = (pid: PlayerId, pts: number): void => {
    if (winner !== null) return;
    const res = applyPoints(players[pid].score, pts, { trapEscape: false });
    players[pid] = { ...players[pid], score: res.score };
    trapped[pid] = isTrapped(res.score);
    if (res.won) winner = pid;
  };

  applyShow(pone, r.pone.total);
  applyShow(dealer, r.dealer.total);

  let zeroCribPenalty = 0;
  if (winner === null) {
    if (r.crib.total === 0) {
      zeroCribPenalty = 30;
      players[dealer] = {
        ...players[dealer],
        score: applyPenalty(players[dealer].score, 30),
      };
      trapped[dealer] = isTrapped(players[dealer].score);
    } else {
      applyShow(dealer, r.crib.total);
    }
  }

  const showResult: ShowResult = {
    ...r,
    zeroHandRedeal: false,
    zeroCribPenalty,
    scoresAfter: [players[0].score, players[1].score],
  };

  return {
    ...state,
    players,
    showResult,
    trapped,
    winner,
    peg: null,
    showReady: [false, false],
    phase: winner !== null ? 'gameOver' : 'show',
    message:
      winner !== null
        ? `P${winner} wins!`
        : zeroCribPenalty
          ? `Show done. Zero crib: dealer −30.`
          : `Show done (continued with a 0-hand).`,
  };
}


function beginShow(state: GameState): GameState {
  if (!state.starter) return state;
  const starter = state.starter;
  const dealer = state.dealer;
  const pone = state.pone;
  const opts = scoreOpts(state);

  // Hands are empty after pegging — use `played` as the 5-card hands
  const poneHand = state.players[pone].played;
  const dealerHand = state.players[dealer].played;
  const crib = state.crib;

  // Safety: should be 5 each
  const poneScore = scoreHand(ensure5(poneHand, state), starter, false, opts);
  const dealerScore = scoreHand(ensure5(dealerHand, state), starter, false, opts);
  const cribScore = scoreHand(ensure5(crib, state), starter, true, opts);

  const offered = applyZeroHandOfferIfNeeded(state);
  if (offered.phase === 'zeroHandOffer') {
    return offered;
  }

  // Competitive: compute true totals but do not peg until claims resolve.
  if (isCompetitiveMode(state.scoringMode)) {
    const showResult: ShowResult = {
      pone: poneScore,
      dealer: dealerScore,
      crib: cribScore,
      zeroHandRedeal: false,
      zeroCribPenalty: 0,
      scoresAfter: [state.players[0].score, state.players[1].score],
    };
    return {
      ...state,
      showResult,
      competitiveShow: {
        step: 'pone',
        pendingReview: null,
        pendingMuggins: null,
        log: [],
      },
      peg: null,
      showReady: [false, false],
      phase: 'show',
      message: 'Competitive show — announce your count.',
    };
  }

  // Apply show in order: pone, dealer, crib — with trap rules
  let players = [...state.players] as [PlayerState, PlayerState];
  let winner: PlayerId | null = null;
  let trapped: [boolean, boolean] = [
    isTrapped(players[0].score),
    isTrapped(players[1].score),
  ];

  const applyShow = (pid: PlayerId, pts: number): void => {
    if (winner !== null) return;
    const res = applyPoints(players[pid].score, pts, { trapEscape: false });
    players[pid] = { ...players[pid], score: res.score };
    trapped[pid] = isTrapped(res.score);
    if (res.won) winner = pid;
  };

  applyShow(pone, poneScore.total);
  applyShow(dealer, dealerScore.total);

  let zeroCribPenalty = 0;
  if (winner !== null) {
    /* skip crib */
  } else if (cribScore.total === 0) {
    zeroCribPenalty = 30;
    players[dealer] = {
      ...players[dealer],
      score: applyPenalty(players[dealer].score, 30),
    };
    trapped[dealer] = isTrapped(players[dealer].score);
  } else {
    applyShow(dealer, cribScore.total);
  }

  const showResult: ShowResult = {
    pone: poneScore,
    dealer: dealerScore,
    crib: cribScore,
    zeroHandRedeal: false,
    zeroCribPenalty,
    scoresAfter: [players[0].score, players[1].score],
  };

  return {
    ...state,
    players,
    showResult,
    competitiveShow: null,
    trapped,
    winner,
    peg: null,
    showReady: [false, false],
    phase: winner !== null ? 'gameOver' : 'show',
    message:
      winner !== null
        ? `P${winner} wins!`
        : zeroCribPenalty
          ? `Show done. Zero crib: dealer −30.`
          : `Show done. Hand ${poneScore.total}, dealer ${dealerScore.total}, crib ${cribScore.total}.`,
  };
}

/** Competitive claim truth = RAW (pre–Spade×2), never the doubled total. */
function trueRawForStep(r: ShowResult, step: ShowClaimStep): number {
  if (step === 'pone') return r.pone.raw;
  if (step === 'dealer') return r.dealer.raw;
  return r.crib.raw;
}

function breakdownForStep(
  r: ShowResult,
  step: ShowClaimStep,
): ScoreBreakdown {
  if (step === 'pone') return r.pone;
  if (step === 'dealer') return r.dealer;
  return r.crib;
}

function nextClaimStep(step: ShowClaimStep): ShowClaimStep | 'done' {
  if (step === 'pone') return 'dealer';
  if (step === 'dealer') return 'crib';
  return 'done';
}

function scorerForStep(state: GameState, step: ShowClaimStep): PlayerId {
  return step === 'pone' ? state.pone : state.dealer;
}

/**
 * Apply one show bucket (hand/crib) with trap rules; optional overclaim penalty
 * and optional muggins points to the opponent.
 * Overclaim steal = (claimed − trueRaw) × showMultiplier (×2 non-spade, ×1 spade).
 */
function applyCompetitiveBucket(
  state: GameState,
  step: ShowClaimStep,
  resolution: ReturnType<typeof resolveClaim>,
  mugginsTaken: number,
): {
  players: [PlayerState, PlayerState];
  winner: PlayerId | null;
  trapped: [boolean, boolean];
  zeroCribPenalty: number;
  /** Applied overclaim penalty (raw steal × showMultiplier). */
  appliedOverclaimPenalty: number;
} {
  let players = [...state.players] as [PlayerState, PlayerState];
  let winner: PlayerId | null = state.winner;
  let trapped: [boolean, boolean] = [
    isTrapped(players[0].score),
    isTrapped(players[1].score),
  ];
  const scorer = scorerForStep(state, step);
  const opponent = (1 - scorer) as PlayerId;
  let zeroCribPenalty = state.showResult?.zeroCribPenalty ?? 0;
  const showMult = state.showResult
    ? Math.max(1, breakdownForStep(state.showResult, step).multiplier)
    : 1;
  const appliedOverclaimPenalty =
    resolution.overclaimPenalty > 0
      ? resolution.overclaimPenalty * showMult
      : 0;

  const applyShow = (pid: PlayerId, pts: number): void => {
    if (winner !== null || pts <= 0) return;
    const res = applyPoints(players[pid].score, pts, { trapEscape: false });
    players[pid] = { ...players[pid], score: res.score };
    trapped[pid] = isTrapped(res.score);
    if (res.won) winner = pid;
  };

  // Crib true-zero: dealer −30 (classic), instead of pegging claimed points.
  if (step === 'crib' && resolution.trueTotal === 0) {
    zeroCribPenalty = 30;
    players[scorer] = {
      ...players[scorer],
      score: applyPenalty(players[scorer].score, 30),
    };
    // Overclaim on a zero crib still costs the (× multiplier) steal amount.
    if (appliedOverclaimPenalty > 0) {
      players[scorer] = {
        ...players[scorer],
        score: applyPenalty(players[scorer].score, appliedOverclaimPenalty),
      };
    }
    trapped[scorer] = isTrapped(players[scorer].score);
    return { players, winner, trapped, zeroCribPenalty, appliedOverclaimPenalty };
  }

  applyShow(scorer, resolution.applyToScorer);
  // SuperCrib ×2: separate peg after claim matches / snaps to raw (not on underclaim).
  if (
    resolution.kind !== 'underclaim' &&
    state.showResult &&
    winner === null
  ) {
    const bd = breakdownForStep(state.showResult, step);
    const doubleBonus = resolution.trueTotal * Math.max(0, bd.multiplier - 1);
    if (doubleBonus > 0) applyShow(scorer, doubleBonus);
  }
  if (appliedOverclaimPenalty > 0 && winner === null) {
    players[scorer] = {
      ...players[scorer],
      score: applyPenalty(players[scorer].score, appliedOverclaimPenalty),
    };
    trapped[scorer] = isTrapped(players[scorer].score);
  }
  if (mugginsTaken > 0 && winner === null) {
    applyShow(opponent, mugginsTaken);
  }

  return { players, winner, trapped, zeroCribPenalty, appliedOverclaimPenalty };
}

/** Optional announce meta preserved through Adjust → Ref → log. */
type ClaimAnnounceMeta = {
  claimedOriginal?: number;
  adjustedClaimed?: number;
};

function claimMetaFields(meta?: ClaimAnnounceMeta): Partial<CompetitiveClaimLogEntry> {
  if (!meta) return {};
  const out: Partial<CompetitiveClaimLogEntry> = {};
  if (meta.claimedOriginal !== undefined) {
    out.claimedOriginal = meta.claimedOriginal;
  }
  if (meta.adjustedClaimed !== undefined) {
    out.adjustedClaimed = meta.adjustedClaimed;
  }
  return out;
}

function finalizeCompetitiveStep(
  state: GameState,
  step: ShowClaimStep,
  resolution: ReturnType<typeof resolveClaim>,
  mugginsTaken: number,
  mugginsBy: PlayerId | undefined,
  meta?: ClaimAnnounceMeta,
): GameState {
  const applied = applyCompetitiveBucket(state, step, resolution, mugginsTaken);
  const logEntry: CompetitiveClaimLogEntry = {
    step,
    claimed: resolution.claimed,
    trueTotal: resolution.trueTotal,
    kind: resolution.kind,
    ...(applied.appliedOverclaimPenalty > 0
      ? { overclaimPenalty: applied.appliedOverclaimPenalty }
      : {}),
    ...(resolution.kind === 'underclaim'
      ? { mugginsTaken, ...(mugginsBy !== undefined ? { mugginsBy } : {}) }
      : {}),
    ...claimMetaFields(meta),
  };
  const prev = state.competitiveShow!;
  const nextStep = nextClaimStep(step);
  const showResult: ShowResult = {
    ...state.showResult!,
    zeroCribPenalty: applied.zeroCribPenalty,
    scoresAfter: [applied.players[0].score, applied.players[1].score],
  };
  const log = [...prev.log, logEntry];
  const done = nextStep === 'done' || applied.winner !== null;
  return {
    ...state,
    players: applied.players,
    trapped: applied.trapped,
    winner: applied.winner,
    showResult,
    competitiveShow: {
      step: done ? 'done' : nextStep,
      pendingReview: null,
      pendingMuggins: null,
      pendingRef: null,
      lastRef: null,
      log,
    },
    phase: applied.winner !== null ? 'gameOver' : 'show',
    message:
      applied.winner !== null
        ? `P${applied.winner} wins!`
        : done
          ? applied.zeroCribPenalty
            ? `Show done. Zero crib: dealer −30.`
            : 'Competitive show complete.'
          : `Claim ${nextStep}…`,
  };
}

/**
 * Apply a finalized announced total (after Confirm keeps claim, or Adjust
 * replaces it). Overclaims are auto-caught. Underclaims pause for Accept / Muggins.
 */
function applyAnnouncedClaim(
  state: GameState,
  claimed: number,
  meta?: ClaimAnnounceMeta,
): GameState {
  if (!competitiveShowActive(state) || !state.showResult) return state;
  const cs = state.competitiveShow!;
  if (cs.pendingMuggins || cs.step === 'done') return state;
  const step = cs.step;
  const trueRaw = trueRawForStep(state.showResult, step);
  const resolution = resolveClaim(trueRaw, claimed);
  // Default original = announced/kept when caller did not pass meta (Approve).
  const announceMeta: ClaimAnnounceMeta = {
    claimedOriginal:
      meta?.claimedOriginal !== undefined ? meta.claimedOriginal : claimed,
    ...(meta?.adjustedClaimed !== undefined
      ? { adjustedClaimed: meta.adjustedClaimed }
      : {}),
  };
  // Clear review before applying (claim is now settled as announced).
  const base: GameState = {
    ...state,
    competitiveShow: { ...cs, pendingReview: null },
  };

  if (resolution.kind === 'underclaim' && resolution.mugginsAvailable > 0) {
    // Peg the underclaim immediately; wait for opponent on the miss.
    const applied = applyCompetitiveBucket(base, step, resolution, 0);
    const showResultBase: ShowResult = {
      ...base.showResult!,
      zeroCribPenalty: applied.zeroCribPenalty,
      scoresAfter: [applied.players[0].score, applied.players[1].score],
    };
    if (applied.winner !== null) {
      // Game already over from the underclaim peg — no muggins pause.
      const logEntry: CompetitiveClaimLogEntry = {
        step,
        claimed: resolution.claimed,
        trueTotal: resolution.trueTotal,
        kind: 'underclaim',
        mugginsTaken: 0,
        ...claimMetaFields(announceMeta),
      };
      return {
        ...base,
        players: applied.players,
        trapped: applied.trapped,
        winner: applied.winner,
        showResult: showResultBase,
        competitiveShow: {
          step: 'done',
          pendingReview: null,
          pendingMuggins: null,
          pendingRef: null,
          lastRef: null,
          log: [...cs.log, logEntry],
        },
        phase: 'gameOver',
        message: `P${applied.winner} wins!`,
      };
    }
    return {
      ...base,
      players: applied.players,
      trapped: applied.trapped,
      winner: applied.winner,
      showResult: showResultBase,
      competitiveShow: {
        ...cs,
        pendingReview: null,
        pendingRef: null,
        // lastRef cleared by adjustShowClaim overlay / next claim advance
        pendingMuggins: {
          step,
          scorer: scorerForStep(base, step),
          claimed: resolution.claimed,
          trueTotal: resolution.trueTotal,
          missed: resolution.mugginsAvailable,
          ...claimMetaFields(announceMeta),
        },
      },
      phase: 'show',
      message: `Underclaim — opponent may Muggins ${resolution.mugginsAvailable}.`,
    };
  }

  return finalizeCompetitiveStep(base, step, resolution, 0, undefined, announceMeta);
}

/**
 * Claimant announces a show count. Opponent then Approve or Adjust before
 * points are applied (overclaim / underclaim / muggins as today after that).
 */
export function submitShowClaim(state: GameState, claimed: number): GameState {
  if (!competitiveShowActive(state) || !state.showResult) return state;
  const cs = state.competitiveShow!;
  if (cs.pendingMuggins || cs.pendingReview || cs.step === 'done') return state;
  const step = cs.step;
  const c = Math.max(0, Math.floor(claimed));
  return {
    ...state,
    competitiveShow: {
      ...cs,
      lastRef: null,
      pendingRef: null,
      pendingReview: {
        step,
        scorer: scorerForStep(state, step),
        claimed: c,
      },
    },
    message: `Hand counted ${c} — opponent Approve or Adjust.`,
  };
}

/** Opponent Approves the hand total as announced; then resolve vs true raw. */
export function confirmShowClaim(state: GameState): GameState {
  const pending = state.competitiveShow?.pendingReview;
  if (!pending || state.phase !== 'show') return state;
  const cs = state.competitiveShow!;
  const cleared: GameState = {
    ...state,
    competitiveShow: { ...cs, lastRef: null, pendingRef: null },
  };
  return applyAnnouncedClaim(cleared, pending.claimed, {
    claimedOriginal: pending.claimed,
  });
}

/**
 * Opponent Adjusts with a different total. Ref compares original claim,
 * adjusted claim, and true raw; keeps the correct (or closer) announced
 * number, applies wrong-corrector penalty to adjuster when Adjust ≠ true,
 * then existing resolve (overclaim steal×2 / underclaim muggins). Sets
 * pendingRef so UI shows a blocking Ref modal before Muggins / next claim.
 */
export function adjustShowClaim(state: GameState, adjusted: number): GameState {
  const pending = state.competitiveShow?.pendingReview;
  if (!pending || state.phase !== 'show' || !state.showResult) return state;
  const trueRaw = trueRawForStep(state.showResult, pending.step);
  const adj = Math.max(0, Math.floor(adjusted));
  const decision = refereeAdjustKeep(pending.claimed, adj, trueRaw);
  const showMult = Math.max(
    1,
    breakdownForStep(state.showResult, pending.step).multiplier,
  );
  const rawWrong = wrongCorrectorPenaltyRaw(adj, trueRaw);
  const appliedWrong = rawWrong > 0 ? rawWrong * showMult : 0;
  const verdict = buildRefVerdict(
    decision,
    pending.claimed,
    adj,
    trueRaw,
    appliedWrong,
  );

  let next = applyAnnouncedClaim(state, decision.kept, {
    claimedOriginal: pending.claimed,
    adjustedClaimed: adj,
  });
  const csAfter = next.competitiveShow;
  if (!csAfter) return next;

  // Wrong-corrector peg: subtract from adjuster (opponent of claimant).
  const adjuster = (1 - pending.scorer) as PlayerId;
  let players = next.players;
  let trapped = next.trapped;
  if (appliedWrong > 0) {
    const nextPlayers = [...players] as [PlayerState, PlayerState];
    nextPlayers[adjuster] = {
      ...nextPlayers[adjuster],
      score: applyPenalty(nextPlayers[adjuster].score, appliedWrong),
    };
    players = nextPlayers;
    trapped = [isTrapped(players[0].score), isTrapped(players[1].score)];
    if (next.showResult) {
      next = {
        ...next,
        players,
        trapped,
        showResult: {
          ...next.showResult,
          scoresAfter: [players[0].score, players[1].score],
        },
      };
    } else {
      next = { ...next, players, trapped };
    }
  }

  const refNote: CompetitiveRefNote = {
    trueRaw,
    scorer: pending.scorer,
    sidedWith: decision.sidedWith,
    kept: decision.kept,
    originalClaimed: pending.claimed,
    adjustedClaimed: adj,
    neitherExact: decision.neitherExact,
    adjusterWrong: decision.adjusterWrong,
    wrongCorrectorPenalty: appliedWrong,
    verdict,
  };

  // Stamp wrong-corrector on the newest log entry for this step (if any).
  let log = csAfter.log;
  if (appliedWrong > 0 && log.length > 0) {
    const last = log[log.length - 1]!;
    if (last.step === pending.step) {
      log = [
        ...log.slice(0, -1),
        { ...last, wrongCorrectorPenalty: appliedWrong },
      ];
    }
  }

  const who = decision.sidedWith === 'adjuster' ? 'Adjuster' : 'Claimant';
  const penBit =
    appliedWrong > 0 ? ` Adjuster penalized −${appliedWrong}.` : '';
  const refLine = decision.neitherExact
    ? `Ref: true was ${trueRaw} — neither exact; kept ${who}'s ${decision.kept} (closer).${penBit}`
    : `Ref: true was ${trueRaw} — ${who} was right.${penBit}`;

  return {
    ...next,
    message: `${refLine} ${next.message}`,
    competitiveShow: {
      ...csAfter,
      log,
      pendingRef: refNote,
      lastRef: refNote,
    },
  };
}

/** Dismiss blocking Ref modal; then Muggins / next claim UI proceeds. */
export function acknowledgeCompetitiveRef(state: GameState): GameState {
  const cs = state.competitiveShow;
  if (!cs?.pendingRef) return state;
  // Keep lastRef only while still on this hand segment (Muggins next).
  // Once play advances to the next claim / done, drop Ref UI state so it
  // cannot linger under the next hand's claim keypad.
  const stillOnSegment = !!cs.pendingMuggins;
  return {
    ...state,
    competitiveShow: {
      ...cs,
      pendingRef: null,
      lastRef: stillOnSegment ? cs.lastRef ?? null : null,
    },
  };
}

/** Opponent Accepts (leave miss) or takes Muggins on an underclaim. */
export function resolveMugginsChoice(
  state: GameState,
  choice: 'accept' | 'muggins',
): GameState {
  if (state.phase !== 'show' || !state.competitiveShow?.pendingMuggins) {
    return state;
  }
  // Ref modal must be dismissed first.
  if (state.competitiveShow.pendingRef) return state;
  if (!state.showResult) return state;
  const pending = state.competitiveShow.pendingMuggins;
  // Claimed points already applied when underclaim was submitted.
  const mugginsTaken = choice === 'muggins' ? pending.missed : 0;
  const mugginsBy =
    choice === 'muggins' ? ((1 - pending.scorer) as PlayerId) : undefined;

  // Only apply muggins points (claimed already on the board).
  let players = [...state.players] as [PlayerState, PlayerState];
  let winner: PlayerId | null = state.winner;
  let trapped: [boolean, boolean] = [...state.trapped];
  if (mugginsTaken > 0 && winner === null) {
    const opp = (1 - pending.scorer) as PlayerId;
    const res = applyPoints(players[opp].score, mugginsTaken, {
      trapEscape: false,
    });
    players[opp] = { ...players[opp], score: res.score };
    trapped[opp] = isTrapped(res.score);
    if (res.won) winner = opp;
  }

  const wrongPen = state.competitiveShow.lastRef?.wrongCorrectorPenalty;
  const logEntry: CompetitiveClaimLogEntry = {
    step: pending.step,
    claimed: pending.claimed,
    trueTotal: pending.trueTotal,
    kind: 'underclaim',
    mugginsTaken,
    ...(mugginsBy !== undefined ? { mugginsBy } : {}),
    ...(pending.claimedOriginal !== undefined
      ? { claimedOriginal: pending.claimedOriginal }
      : { claimedOriginal: pending.claimed }),
    ...(pending.adjustedClaimed !== undefined
      ? { adjustedClaimed: pending.adjustedClaimed }
      : {}),
    ...(typeof wrongPen === 'number' && wrongPen > 0
      ? { wrongCorrectorPenalty: wrongPen }
      : {}),
  };
  const nextStep = nextClaimStep(pending.step);
  const done = nextStep === 'done' || winner !== null;
  const zeroCribPenalty = state.showResult.zeroCribPenalty;
  return {
    ...state,
    players,
    trapped,
    winner,
    showResult: {
      ...state.showResult,
      scoresAfter: [players[0].score, players[1].score],
    },
    competitiveShow: {
      step: done ? 'done' : nextStep,
      pendingReview: null,
      pendingMuggins: null,
      pendingRef: null,
      lastRef: null,
      log: [...state.competitiveShow.log, logEntry],
    },
    phase: winner !== null ? 'gameOver' : 'show',
    message:
      winner !== null
        ? `P${winner} wins!`
        : done
          ? zeroCribPenalty
            ? `Show done. Zero crib: dealer −30.`
            : 'Competitive show complete.'
          : choice === 'muggins'
            ? `Muggins +${mugginsTaken}. Claim ${nextStep}…`
            : `Accepted underclaim. Claim ${nextStep}…`,
  };
}

/**
 * AI advances competitive show: honest claim + take muggins on underclaims.
 * Pending Approve/Adjust reviews are human-driven (vs-AI Dummy2 hotseat UI).
 */
export function advanceCompetitiveAi(state: GameState): GameState {
  if (!isCompetitiveMode(state.scoringMode) || state.phase !== 'show') {
    return state;
  }
  const cs = state.competitiveShow;
  if (!cs || cs.step === 'done') return state;

  // Do not auto-Confirm reviews — UI shows Approve/Adjust for the reviewing seat
  // (human drives Dummy2 review in vs-AI so the step is always visible).
  if (cs.pendingReview) {
    return state;
  }

  // Human must dismiss Ref modal before Muggins / next claim.
  if (cs.pendingRef) {
    return state;
  }

  if (cs.pendingMuggins) {
    const respondent = competitiveMugginsRespondent(state);
    if (respondent !== 1) return state; // human decides
    // AI usually takes muggins
    return resolveMugginsChoice(state, 'muggins');
  }

  const claimant = competitiveClaimant(state);
  if (claimant !== 1 || !state.showResult) return state;
  const trueRaw = trueRawForStep(state.showResult, cs.step);
  // Honest AI claims the true RAW score (×2 is not typed).
  return submitShowClaim(state, trueRaw);
}

function ensure5(cards: Card[], _state: GameState): Card[] {
  if (cards.length === 5) return cards;
  // Fallback shouldn't happen in normal play
  throw new Error(`Expected 5 cards for show, got ${cards.length}`);
}

/** After show overlay acknowledged — rotate dealer and deal again. */
export function nextRound(state: GameState): GameState {
  if (state.phase !== 'show' && state.phase !== 'roundEnd') return state;
  if (state.winner !== null) return state;
  const newDealer = other(state.dealer);
  return startDeal({
    ...state,
    dealer: newDealer,
    pone: state.dealer,
    phase: 'deal',
    showResult: null,
    competitiveShow: null,
    crib: [],
    starter: null,
    showReady: [false, false],
  });
}

/** After zero-hand redeal — same dealer, scores unchanged (already). */
export function redealSameDealer(state: GameState): GameState {
  if (state.phase !== 'redeal') return state;
  return startDeal({
    ...state,
    showResult: null,
    competitiveShow: null,
    crib: [],
    starter: null,
    phase: 'deal',
    showReady: [false, false],
  });
}

/**
 * Acknowledge show / zero-hand redeal overlay.
 * Online: each seat must ack; only when both ready does nextRound/redeal run.
 * Hot-seat / AI: a single ack advances immediately.
 * Game-over leave is handled by the UI (no both-player requirement).
 */
export function ackShowContinue(state: GameState, player: PlayerId): GameState {
  if (state.winner !== null) return state;
  if (state.phase !== 'show' && state.phase !== 'redeal') return state;
  // Competitive: wait until all claims are resolved.
  if (
    state.phase === 'show' &&
    isCompetitiveMode(state.scoringMode) &&
    state.competitiveShow &&
    state.competitiveShow.step !== 'done'
  ) {
    return state;
  }

  if (state.mode !== 'online') {
    return state.phase === 'redeal' ? redealSameDealer(state) : nextRound(state);
  }

  const ready: [boolean, boolean] = [
    Boolean(state.showReady?.[0]),
    Boolean(state.showReady?.[1]),
  ];
  if (ready[player]) {
    return state;
  }
  ready[player] = true;

  if (ready[0] && ready[1]) {
    const cleared = { ...state, showReady: [false, false] as [boolean, boolean] };
    return state.phase === 'redeal' ? redealSameDealer(cleared) : nextRound(cleared);
  }

  return { ...state, showReady: ready };
}

/** Acknowledge game over / new game. */
export function newGame(mode: 'hotseat' | 'ai' | 'online' = 'hotseat'): GameState {
  return startDeal(createGame(mode));
}

/**
 * Cosmetic hand reorder — display order only.
 * Preserves discardSel by card id; does not change game legality.
 */
export function reorderHand(
  state: GameState,
  player: PlayerId,
  fromIndex: number,
  toIndex: number,
): GameState {
  const p = state.players[player];
  const hand = [...p.hand];
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= hand.length ||
    toIndex >= hand.length ||
    fromIndex === toIndex
  ) {
    return state;
  }
  const [card] = hand.splice(fromIndex, 1);
  hand.splice(toIndex, 0, card);
  // Keep discardSel pointing at the same cards (by id)
  const byId = new Map(hand.map((c) => [c.id, c]));
  const discardSel = p.discardSel
    .map((c) => byId.get(c.id))
    .filter((c): c is Card => !!c);
  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...p, hand, discardSel };
  return { ...state, players };
}

/** Swap two hand positions (cosmetic). */
export function swapHandCards(
  state: GameState,
  player: PlayerId,
  indexA: number,
  indexB: number,
): GameState {
  const p = state.players[player];
  const hand = [...p.hand];
  if (
    indexA < 0 ||
    indexB < 0 ||
    indexA >= hand.length ||
    indexB >= hand.length ||
    indexA === indexB
  ) {
    return state;
  }
  const tmp = hand[indexA];
  hand[indexA] = hand[indexB];
  hand[indexB] = tmp;
  const byId = new Map(hand.map((c) => [c.id, c]));
  const discardSel = p.discardSel
    .map((c) => byId.get(c.id))
    .filter((c): c is Card => !!c);
  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...p, hand, discardSel };
  return { ...state, players };
}

// --- Test helpers: inject state ---


/** Cosmetic sort: A low … K high (then suit). Preserves discardSel by id. */
export function sortHandByRank(state: GameState, player: PlayerId): GameState {
  const p = state.players[player];
  const hand = [...p.hand].sort((a, b) => {
    const d = rankOrder(a.rank) - rankOrder(b.rank);
    if (d !== 0) return d;
    return a.suit.localeCompare(b.suit);
  });
  const byId = new Map(hand.map((c) => [c.id, c]));
  const discardSel = p.discardSel
    .map((c) => byId.get(c.id))
    .filter((c): c is Card => !!c);
  const players = [...state.players] as [PlayerState, PlayerState];
  players[player] = { ...p, hand, discardSel };
  return { ...state, players };
}

/** Sort human seat(s) after a deal — AI mode: seat 0 only; hot-seat: both. */
export function sortHumanHands(state: GameState): GameState {
  if (state.mode === 'ai') return sortHandByRank(state, 0);
  return sortHandByRank(sortHandByRank(state, 0), 1);
}

export function withScores(state: GameState, s0: number, s1: number): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[0] = { ...players[0], score: s0 };
  players[1] = { ...players[1], score: s1 };
  return {
    ...state,
    players,
    trapped: [isTrapped(s0), isTrapped(s1)],
  };
}

