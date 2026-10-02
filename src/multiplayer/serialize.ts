/**
 * Serialize / deserialize GameState for Firebase RTDB (cards by id).
 */
import { Card, Suit, Rank, makeCard, createDeck } from '../engine/cards';
import { formatPegKindLabel, normalizeSaidGo, type PegPlay, type PegScoreEvent, type PegState } from '../engine/pegging';
import type {
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  ShowResult,
  PegFlash,
} from '../engine/supercrib';
import type { ScoreBreakdown } from '../engine/scoreHand';

const DECK_BY_ID: Map<string, Card> = new Map(createDeck().map((c) => [c.id, c]));

export function cardFromId(id: string): Card {
  const known = DECK_BY_ID.get(id);
  if (known) return { ...known };
  // Fallback parse e.g. "10H", "AS"
  const rank = id.startsWith('10') ? '10' : id.slice(0, -1);
  const suitLetter = id.slice(-1);
  const suitMap: Record<string, Suit> = {
    H: 'hearts',
    D: 'diamonds',
    C: 'clubs',
    S: 'spades',
  };
  const suit = suitMap[suitLetter];
  if (!suit || !rank) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return makeCard(rank as Rank, suit);
}

export function cardToId(card: Card): string {
  return card.id;
}

/**
 * Firebase may return arrays as objects `{0:…,1:…}` or strip empty arrays.
 * Coerce to a dense string list ordered by numeric keys.
 */
export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (v == null ? '' : String(v))).filter((s) => s !== '');
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, unknown>)[k])
      .map((v) => (v == null ? '' : String(v)))
      .filter((s) => s !== '');
  }
  return [];
}

/** Coerce Firebase array-or-object into a dense list ordered by numeric keys. */
export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, unknown>)[k]);
  }
  return [];
}

function serCards(cards: Card[]): string[] {
  return cards.map(cardToId);
}

function deCards(ids: unknown): Card[] {
  return asStringList(ids).map(cardFromId);
}

function serPlayer(p: PlayerState) {
  return {
    hand: serCards(p.hand),
    played: serCards(p.played),
    score: p.score,
    discardSel: serCards(p.discardSel),
  };
}

function dePlayer(p: unknown): PlayerState {
  const raw = (p && typeof p === 'object' ? p : {}) as {
    hand?: unknown;
    played?: unknown;
    score?: unknown;
    discardSel?: unknown;
  };
  return {
    hand: deCards(raw.hand),
    played: deCards(raw.played),
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
    discardSel: deCards(raw.discardSel),
  };
}

function serPeg(peg: PegState | null) {
  if (!peg) return null;
  // saidGo must always be a dense number array (Firebase-safe; never a Set).
  const saidGoRaw =
    peg.saidGo instanceof Set
      ? [...peg.saidGo]
      : asList(peg.saidGo as unknown);
  return {
    sequence: peg.sequence.map((pl: PegPlay) => ({
      card: cardToId(pl.card),
      player: pl.player,
    })),
    count: peg.count,
    toPlay: peg.toPlay,
    saidGo: saidGoRaw.map(Number),
    sequenceDone: peg.sequenceDone,
  };
}

function dePeg(peg: unknown): PegState | null {
  if (!peg || typeof peg !== 'object') return null;
  const p = peg as {
    sequence?: unknown;
    count?: unknown;
    toPlay?: unknown;
    saidGo?: unknown;
    sequenceDone?: unknown;
  };
  // sequence via asList (array or Firebase object-form); each entry {card, player}
  const sequence: PegPlay[] = [];
  for (const pl of asList(p.sequence)) {
    const item = (pl && typeof pl === 'object' ? pl : {}) as {
      card?: unknown;
      player?: unknown;
    };
    const cardId = item.card == null ? '' : String(item.card);
    if (!cardId) continue; // missing fields safe — skip empty entries
    try {
      sequence.push({
        card: cardFromId(cardId),
        player: (Number(item.player) === 1 ? 1 : 0) as PlayerId,
      });
    } catch {
      // skip unparseable card entries rather than failing the whole envelope
    }
  }
  // saidGo: Set / array / object-form → normalized Set
  const saidGo = normalizeSaidGo(p.saidGo);
  return {
    sequence,
    count: typeof p.count === 'number' && Number.isFinite(p.count) ? p.count : 0,
    toPlay: (Number(p.toPlay) === 1 ? 1 : 0) as PlayerId,
    saidGo,
    sequenceDone: Boolean(p.sequenceDone),
  };
}

function serBreakdown(b: ScoreBreakdown) {
  return { ...b };
}

function deBreakdown(b: ScoreBreakdown): ScoreBreakdown {
  return { ...b };
}

function serShow(s: ShowResult | null) {
  if (!s) return null;
  return {
    pone: serBreakdown(s.pone),
    dealer: serBreakdown(s.dealer),
    crib: serBreakdown(s.crib),
    zeroHandRedeal: s.zeroHandRedeal,
    zeroCribPenalty: s.zeroCribPenalty,
    scoresAfter: [...s.scoresAfter] as [number, number],
  };
}

function deShow(s: unknown): ShowResult | null {
  if (!s || typeof s !== 'object') return null;
  const raw = s as {
    pone: ScoreBreakdown;
    dealer: ScoreBreakdown;
    crib: ScoreBreakdown;
    zeroHandRedeal?: boolean;
    zeroCribPenalty?: number;
    scoresAfter?: [number, number] | Record<string, number>;
  };
  let scoresAfter: [number, number] = [0, 0];
  if (Array.isArray(raw.scoresAfter)) {
    scoresAfter = [Number(raw.scoresAfter[0]) || 0, Number(raw.scoresAfter[1]) || 0];
  } else if (raw.scoresAfter && typeof raw.scoresAfter === 'object') {
    const o = raw.scoresAfter as Record<string, number>;
    scoresAfter = [Number(o['0']) || 0, Number(o['1']) || 0];
  }
  return {
    pone: deBreakdown(raw.pone),
    dealer: deBreakdown(raw.dealer),
    crib: deBreakdown(raw.crib),
    zeroHandRedeal: Boolean(raw.zeroHandRedeal),
    zeroCribPenalty: typeof raw.zeroCribPenalty === 'number' ? raw.zeroCribPenalty : 0,
    scoresAfter,
  };
}

function serFlash(f: PegFlash | null) {
  if (!f) return null;
  const events = f.events.map((e: PegScoreEvent) => ({ ...e }));
  // Always send a non-empty kindLabel for scoring flashes (pair/trips/run/15/31/go).
  // Reconstruct from events when omitted so Firebase never drops the label.
  const kindLabel =
    typeof f.kindLabel === 'string' && f.kindLabel.length > 0
      ? f.kindLabel
      : formatPegKindLabel(events);
  const out: {
    id: number;
    player: PlayerId;
    points: number;
    events: PegScoreEvent[];
    blocked?: boolean;
    kindLabel?: string;
  } = {
    id: f.id,
    player: f.player,
    points: f.points,
    events,
  };
  if (typeof f.blocked === 'boolean') {
    out.blocked = f.blocked;
  }
  // Omit empty kindLabel — undefined is rejected by Firebase RTDB.
  if (kindLabel.length > 0) {
    out.kindLabel = kindLabel;
  }
  return out;
}

function deFlash(f: unknown): PegFlash | null {
  if (!f || typeof f !== 'object') return null;
  const raw = f as PegFlash;
  const eventsRaw = Array.isArray(raw.events)
    ? raw.events
    : raw.events && typeof raw.events === 'object'
      ? Object.keys(raw.events as object)
          .filter((k) => /^\d+$/.test(k))
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (raw.events as unknown as Record<string, PegScoreEvent>)[k])
      : [];
  const events = eventsRaw.map((e) => ({ ...e }));
  const kindLabel =
    typeof raw.kindLabel === 'string' && raw.kindLabel.length > 0
      ? raw.kindLabel
      : formatPegKindLabel(events);
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    player: (Number(raw.player) === 1 ? 1 : 0) as PlayerId,
    points: typeof raw.points === 'number' ? raw.points : 0,
    events,
    blocked: raw.blocked,
    ...(kindLabel.length > 0 ? { kindLabel } : {}),
  };
}

/** Coerce players from array or numeric-key object into a 2-tuple. */
function dePlayers(value: unknown): [PlayerState, PlayerState] {
  let list: unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === 'object') {
    list = Object.keys(value as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, unknown>)[k]);
  }
  return [dePlayer(list[0]), dePlayer(list[1])];
}

function deTrapped(value: unknown): [boolean, boolean] {
  if (Array.isArray(value)) {
    return [Boolean(value[0]), Boolean(value[1])];
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return [Boolean(o['0']), Boolean(o['1'])];
  }
  return [false, false];
}

/**
 * Deep-scrub `undefined` from objects/arrays. Firebase RTDB rejects undefined
 * anywhere in written data; null is fine (stripped server-side).
 */
export function stripUndefined<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out as T;
}

export type SerializedGameState = ReturnType<typeof serializeGameState>;

export function serializeGameState(state: GameState) {
  const raw = {
    phase: state.phase,
    dealer: state.dealer,
    pone: state.pone,
    players: [serPlayer(state.players[0]), serPlayer(state.players[1])] as [
      ReturnType<typeof serPlayer>,
      ReturnType<typeof serPlayer>,
    ],
    crib: serCards(state.crib),
    starter: state.starter ? cardToId(state.starter) : null,
    deck: serCards(state.deck),
    peg: serPeg(state.peg),
    message: state.message,
    showResult: serShow(state.showResult),
    winner: state.winner,
    trapped: [...state.trapped] as [boolean, boolean],
    trapEscapeWin: state.trapEscapeWin,
    dealNumber: state.dealNumber,
    heelsPoints: state.heelsPoints,
    lastPegFlash: serFlash(state.lastPegFlash),
    mode: state.mode,
    aiDifficulty: state.aiDifficulty,
    scoringMode: state.scoringMode ?? 'auto',
    competitiveShow: state.competitiveShow ?? null,
    showReady: [...(state.showReady ?? [false, false])] as [boolean, boolean],
  };
  // Guarantee no undefined anywhere (pair flash without kindLabel, etc.).
  return stripUndefined(raw);
}


function deCompetitiveShow(raw: unknown): GameState['competitiveShow'] {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const step = o.step;
  if (
    step !== 'pone' &&
    step !== 'dealer' &&
    step !== 'crib' &&
    step !== 'done'
  ) {
    return null;
  }
  let pendingReview: NonNullable<GameState['competitiveShow']>['pendingReview'] =
    null;
  const pr = o.pendingReview;
  if (pr && typeof pr === 'object') {
    const p = pr as Record<string, unknown>;
    if (
      (p.step === 'pone' || p.step === 'dealer' || p.step === 'crib') &&
      (p.scorer === 0 || p.scorer === 1 || p.scorer === '0' || p.scorer === '1')
    ) {
      pendingReview = {
        step: p.step,
        scorer: Number(p.scorer) as 0 | 1,
        claimed: Number(p.claimed) || 0,
      };
    }
  }
  let pendingMuggins: NonNullable<GameState['competitiveShow']>['pendingMuggins'] =
    null;
  const pm = o.pendingMuggins;
  if (pm && typeof pm === 'object') {
    const p = pm as Record<string, unknown>;
    if (
      (p.step === 'pone' || p.step === 'dealer' || p.step === 'crib') &&
      (p.scorer === 0 || p.scorer === 1 || p.scorer === '0' || p.scorer === '1')
    ) {
      pendingMuggins = {
        step: p.step,
        scorer: Number(p.scorer) as 0 | 1,
        claimed: Number(p.claimed) || 0,
        trueTotal: Number(p.trueTotal) || 0,
        missed: Number(p.missed) || 0,
        ...(p.claimedOriginal !== undefined
          ? { claimedOriginal: Number(p.claimedOriginal) || 0 }
          : {}),
        ...(p.adjustedClaimed !== undefined
          ? { adjustedClaimed: Number(p.adjustedClaimed) || 0 }
          : {}),
      };
    }
  }
  // Firebase may store log as object-form array {0:…,1:…} — use asList.
  const logRaw = asList(o.log);
  const log: NonNullable<GameState['competitiveShow']>['log'] = [];
  for (const entry of logRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.step !== 'pone' && e.step !== 'dealer' && e.step !== 'crib') continue;
    if (
      e.kind !== 'exact' &&
      e.kind !== 'overclaim' &&
      e.kind !== 'underclaim'
    ) {
      continue;
    }
    log.push({
      step: e.step,
      claimed: Number(e.claimed) || 0,
      trueTotal: Number(e.trueTotal) || 0,
      kind: e.kind,
      mugginsTaken: Number(e.mugginsTaken) || 0,
      ...(typeof e.overclaimPenalty === 'number'
        ? { overclaimPenalty: e.overclaimPenalty }
        : {}),
      ...(e.claimedOriginal !== undefined
        ? { claimedOriginal: Number(e.claimedOriginal) || 0 }
        : {}),
      ...(e.adjustedClaimed !== undefined
        ? { adjustedClaimed: Number(e.adjustedClaimed) || 0 }
        : {}),
      ...(typeof e.wrongCorrectorPenalty === 'number'
        ? { wrongCorrectorPenalty: e.wrongCorrectorPenalty }
        : {}),
    });
  }
  const parseRefNote = (
    raw: unknown,
  ): NonNullable<GameState['competitiveShow']>['lastRef'] => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (
      !(r.scorer === 0 || r.scorer === 1 || r.scorer === '0' || r.scorer === '1') ||
      !(r.sidedWith === 'claimant' || r.sidedWith === 'adjuster')
    ) {
      return null;
    }
    return {
      trueRaw: Number(r.trueRaw) || 0,
      scorer: Number(r.scorer) as 0 | 1,
      sidedWith: r.sidedWith,
      kept: Number(r.kept) || 0,
      originalClaimed: Number(r.originalClaimed) || 0,
      adjustedClaimed: Number(r.adjustedClaimed) || 0,
      neitherExact: !!r.neitherExact,
      adjusterWrong: !!r.adjusterWrong,
      wrongCorrectorPenalty: Number(r.wrongCorrectorPenalty) || 0,
      verdict: typeof r.verdict === 'string' ? r.verdict : '',
    };
  };
  const lastRef = parseRefNote(o.lastRef);
  const pendingRef = parseRefNote(o.pendingRef);
  return {
    step,
    pendingReview,
    pendingMuggins,
    log,
    pendingRef,
    lastRef,
  };
}

export function deserializeGameState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid serialized GameState');
  }
  const s = raw as Record<string, unknown>;
  // Prefer tolerate missing keys (Firebase strips nulls).
  const starterRaw = s.starter;
  const starter =
    typeof starterRaw === 'string' && starterRaw.length > 0
      ? cardFromId(starterRaw)
      : null;

  return {
    phase: s.phase as Phase,
    dealer: (Number(s.dealer) === 1 ? 1 : 0) as PlayerId,
    pone: (Number(s.pone) === 1 ? 1 : 0) as PlayerId,
    players: dePlayers(s.players),
    crib: deCards(s.crib),
    starter,
    deck: deCards(s.deck),
    peg: dePeg(s.peg),
    message: typeof s.message === 'string' ? s.message : '',
    showResult: deShow(s.showResult),
    winner:
      s.winner === 0 || s.winner === 1 || s.winner === '0' || s.winner === '1'
        ? (Number(s.winner) as PlayerId)
        : null,
    trapped: deTrapped(s.trapped),
    trapEscapeWin: Boolean(s.trapEscapeWin),
    dealNumber: typeof s.dealNumber === 'number' ? s.dealNumber : 0,
    heelsPoints: typeof s.heelsPoints === 'number' ? s.heelsPoints : 0,
    lastPegFlash: deFlash(s.lastPegFlash),
    mode: (s.mode === 'online' || s.mode === 'ai' || s.mode === 'hotseat'
      ? s.mode
      : 'online') as GameState['mode'],
    aiDifficulty:
      s.aiDifficulty === 'easy' ||
      s.aiDifficulty === 'normal' ||
      s.aiDifficulty === 'hard'
        ? s.aiDifficulty
        : undefined,
    scoringMode: s.scoringMode === 'competitive' ? 'competitive' : 'auto',
    competitiveShow: deCompetitiveShow(s.competitiveShow),
    showReady: deTrapped(s.showReady),
  };
}
