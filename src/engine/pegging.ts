/**
 * Pegging (play-to-31) — pure. Pegging points are NEVER multiplied.
 */

import { Card, cardValue, rankOrder } from './cards';

export const PEG_LIMIT = 31;

export interface PegPlay {
  card: Card;
  player: 0 | 1;
}

export interface PegScoreEvent {
  kind: 'fifteen' | 'pair' | 'trips' | 'quads' | 'run' | 'thirtyone' | 'go' | 'last';  points: number;
  runLength?: number;
}

export interface PegState {
  /** Cards played in the current sequence (since last reset to 0). */
  sequence: PegPlay[];
  count: number;
  /** Whose turn to play (or say go). */
  toPlay: 0 | 1;
  /** Players who have said go this sequence (cannot play). */
  saidGo: Set<0 | 1>;
  /** True when sequence is done (31 or both cannot play). */
  sequenceDone: boolean;
}

export function createPegState(firstPlayer: 0 | 1): PegState {
  return {
    sequence: [],
    count: 0,
    toPlay: firstPlayer,
    saidGo: new Set(),
    sequenceDone: false,
  };
}

export function legalPegCards(hand: Card[], count: number): Card[] {
  return hand.filter((c) => count + cardValue(c) <= PEG_LIMIT);
}

/** Coerce saidGo from Set, array, or Firebase object-form into a Set<0|1>. */
export function normalizeSaidGo(raw: unknown): Set<0 | 1> {
  if (raw instanceof Set) {
    const out = new Set<0 | 1>();
    for (const v of raw) {
      const n = Number(v);
      if (n === 0 || n === 1) out.add(n as 0 | 1);
    }
    return out;
  }
  if (Array.isArray(raw)) {
    return new Set(
      raw.map((v) => Number(v)).filter((n) => n === 0 || n === 1) as (0 | 1)[],
    );
  }
  if (raw && typeof raw === 'object') {
    return new Set(
      Object.keys(raw as object)
        .filter((k) => /^\d+$/.test(k))
        .map((k) => Number((raw as Record<string, unknown>)[k]))
        .filter((n) => n === 0 || n === 1) as (0 | 1)[],
    );
  }
  return new Set();
}

export function canPlayAny(hand: Card[], count: number): boolean {
  return legalPegCards(hand, count).length > 0;
}

/**
 * Score the play of `card` onto the current sequence (before appending).
 * Does not include go/last — those are separate.
 */
export function scorePegPlay(sequence: PegPlay[], card: Card, newCount: number): PegScoreEvent[] {
  const events: PegScoreEvent[] = [];
  const plays = [...sequence, { card, player: 0 as 0 | 1 }];

  if (newCount === 15) {
    events.push({ kind: 'fifteen', points: 2 });
  }

  // Pairs / trips / quads from end
  let same = 1;
  for (let i = plays.length - 2; i >= 0; i--) {
    if (plays[i].card.rank === card.rank) same++;
    else break;
  }
  if (same === 2) events.push({ kind: 'pair', points: 2 });
  else if (same === 3) events.push({ kind: 'trips', points: 6 });
  else if (same === 4) events.push({ kind: 'quads', points: 12 });

  // Runs: longest run of length >= 3 using a suffix of the sequence
  const runPts = scorePegRun(plays.map((p) => p.card));
  if (runPts >= 3) {
    events.push({ kind: 'run', points: runPts, runLength: runPts });
  }

  if (newCount === 31) {
    events.push({ kind: 'thirtyone', points: 2 });
  }

  return events;
}

/**
 * Check whether the last `len` cards form a run (consecutive ranks, any order).
 * Returns run length points (= length) or 0.
 */
function scorePegRun(cards: Card[]): number {
  // Try longest suffix first
  for (let len = cards.length; len >= 3; len--) {
    const slice = cards.slice(cards.length - len);
    if (isRun(slice)) return len;
  }
  return 0;
}

function isRun(cards: Card[]): boolean {
  const orders = cards.map((c) => rankOrder(c.rank)).sort((a, b) => a - b);
  // No duplicate ranks in a pegging run
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] === orders[i - 1]) return false;
  }
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] !== orders[i - 1] + 1) return false;
  }
  return true;
}

export function totalPegPoints(events: PegScoreEvent[]): number {
  return events.reduce((s, e) => s + e.points, 0);
}

/** Human-readable peg flash label, e.g. "run of 4", "15 · run of 3", "pair", "go". */
export function formatPegKindLabel(events: PegScoreEvent[]): string {
  const parts: string[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'fifteen':
        parts.push('15');
        break;
      case 'pair':
        parts.push('pair');
        break;
      case 'trips':
        parts.push('trips');
        break;
      case 'quads':
        parts.push('quads');
        break;
      case 'run':
        parts.push(`run of ${e.runLength ?? e.points}`);
        break;
      case 'thirtyone':
        parts.push('31');
        break;
      case 'go':
      case 'last':
        parts.push('go');
        break;
      default:
        break;
    }
  }
  return parts.join(' · ');
}

/**
 * Apply a card play. Returns new state + events.
 * Caller must ensure card is legal.
 */
export function applyPegPlay(
  state: PegState,
  card: Card,
  player: 0 | 1,
): { state: PegState; events: PegScoreEvent[] } {
  const newCount = state.count + cardValue(card);
  const events = scorePegPlay(state.sequence, card, newCount);
  const sequence: PegPlay[] = [...state.sequence, { card, player }];
  const hit31 = newCount === 31;

  const next: PegState = {
    sequence,
    count: newCount,
    toPlay: (1 - player) as 0 | 1,
    saidGo: new Set(), // reset goes after a successful play
    sequenceDone: hit31,
  };

  if (hit31) {
    // Sequence ends; next sequence starts at 0 with opponent (handled by game)
  }

  return { state: next, events };
}

/**
 * Player says go. If opponent also cannot/won't play, award last-card point
 * (1 if count !== 31 — 31 already scored 2).
 */
export function applyGo(
  state: PegState,
  player: 0 | 1,
  opponentCanPlay: boolean,
): { state: PegState; events: PegScoreEvent[]; lastCardPlayer: 0 | 1 | null } {
  const saidGo = normalizeSaidGo(state.saidGo);
  saidGo.add(player);

  if (!opponentCanPlay || saidGo.has((1 - player) as 0 | 1)) {
    // Sequence over — last card / go point to the player who played the last card.
    // Next series is led by the player who said Go (could not play), NOT the scorer.
    const last = state.sequence[state.sequence.length - 1];
    const events: PegScoreEvent[] = [];
    let lastCardPlayer: 0 | 1 | null = null;
    if (last && state.count !== 31) {
      events.push({ kind: 'go', points: 1 });
      lastCardPlayer = last.player;
    }
    return {
      state: { ...state, saidGo, sequenceDone: true, toPlay: player },
      events,
      lastCardPlayer,
    };
  }

  return {
    state: {
      ...state,
      saidGo,
      toPlay: (1 - player) as 0 | 1,
    },
    events: [],
    lastCardPlayer: null,
  };
}

/** Start a new pegging sequence after 31 or dual go. */
export function resetSequence(_state: PegState, nextPlayer: 0 | 1): PegState {
  return {
    sequence: [],
    count: 0,
    toPlay: nextPlayer,
    saidGo: new Set(),
    sequenceDone: false,
  };
}

/**
 * True if this play is "last card for exactly 31" — the only escape from 240 trap.
 * Hitting exactly 31 ends the pegging count; that card is the last card of the
 * sequence. Emptying the hand is not required (Rules: last card for exactly 31).
 */
export function isLastCardExact31(newCount: number): boolean {
  return newCount === 31;
}
