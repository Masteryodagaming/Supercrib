import { describe, expect, it } from 'vitest';
import { createGame, startDeal } from '../../engine/supercrib';
import { makeCard } from '../../engine/cards';
import {
  asStringList,
  deserializeGameState,
  serializeGameState,
  stripUndefined,
} from '../serialize';

function rngFrom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Recursively delete null-valued keys (Firebase RTDB strips nulls). */
function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      const next = stripNulls(v);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return value;
}

/** Simulate Firebase array → object `{0:…,1:…}` for nested arrays. */
function arraysToObjects(value: unknown): unknown {
  if (Array.isArray(value)) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, i) => {
      obj[String(i)] = arraysToObjects(v);
    });
    return obj;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = arraysToObjects(v);
    }
    return out;
  }
  return value;
}

describe('asStringList', () => {
  it('returns arrays of strings', () => {
    expect(asStringList(['AH', '2C'])).toEqual(['AH', '2C']);
  });

  it('coerces numeric-key object hands', () => {
    expect(asStringList({ 0: 'AH', 1: '2C', 2: 'KD' })).toEqual([
      'AH',
      '2C',
      'KD',
    ]);
  });

  it('returns [] for null/undefined/non-list', () => {
    expect(asStringList(null)).toEqual([]);
    expect(asStringList(undefined)).toEqual([]);
    expect(asStringList('AH')).toEqual([]);
    expect(asStringList(42)).toEqual([]);
  });
});

describe('serializeGameState', () => {
  it('round-trips a simple dealt online game', () => {
    const g = startDeal(createGame('online'), rngFrom(42));
    const raw = serializeGameState(g);
    const back = deserializeGameState(raw);

    expect(back.mode).toBe('online');
    expect(back.phase).toBe(g.phase);
    expect(back.dealer).toBe(g.dealer);
    expect(back.pone).toBe(g.pone);
    expect(back.dealNumber).toBe(g.dealNumber);
    expect(back.players[0].hand.map((c) => c.id)).toEqual(
      g.players[0].hand.map((c) => c.id),
    );
    expect(back.players[1].hand.map((c) => c.id)).toEqual(
      g.players[1].hand.map((c) => c.id),
    );
    expect(back.deck.map((c) => c.id)).toEqual(g.deck.map((c) => c.id));
    expect(back.crib.map((c) => c.id)).toEqual(g.crib.map((c) => c.id));
    expect(back.message).toBe(g.message);
  });

  it('round-trips peg saidGo Set', () => {
    const g = startDeal(createGame('online'), rngFrom(7));
    const raw = serializeGameState(g);
    expect(raw.peg).toBeNull();
    const back = deserializeGameState(raw);
    expect(back.peg).toBeNull();
  });

  it('round-trips after JSON null-strip (Firebase simulation)', () => {
    const g = startDeal(createGame('online'), rngFrom(99));
    expect(g.phase).toBe('discard');
    // Online startDeal: dealer 8 cards, pone 7, empty crib, null starter/peg/show/winner/flash
    const ser = serializeGameState(g);
    const stripped = stripNulls(JSON.parse(JSON.stringify(ser)));
    // Null fields should be gone
    expect((stripped as Record<string, unknown>).starter).toBeUndefined();
    expect((stripped as Record<string, unknown>).peg).toBeUndefined();
    expect((stripped as Record<string, unknown>).showResult).toBeUndefined();
    expect((stripped as Record<string, unknown>).winner).toBeUndefined();
    expect((stripped as Record<string, unknown>).lastPegFlash).toBeUndefined();

    const back = deserializeGameState(stripped);
    expect(back.phase).toBe(g.phase);
    expect(back.starter).toBeNull();
    expect(back.peg).toBeNull();
    expect(back.showResult).toBeNull();
    expect(back.winner).toBeNull();
    expect(back.lastPegFlash).toBeNull();
    expect(back.trapped).toEqual([false, false]);
    expect(back.players[0].hand).toHaveLength(g.players[0].hand.length);
    expect(back.players[1].hand).toHaveLength(g.players[1].hand.length);
    expect(back.players[0].hand.map((c) => c.id)).toEqual(
      g.players[0].hand.map((c) => c.id),
    );
    expect(back.players[1].hand.map((c) => c.id)).toEqual(
      g.players[1].hand.map((c) => c.id),
    );
    expect(back.deck.map((c) => c.id)).toEqual(g.deck.map((c) => c.id));
  });

  it('deserializes object-form hands/players (Firebase array shape)', () => {
    const g = startDeal(createGame('online'), rngFrom(3));
    const ser = serializeGameState(g);
    const asObjects = arraysToObjects(stripNulls(JSON.parse(JSON.stringify(ser))));
    const back = deserializeGameState(asObjects);
    expect(back.players[0].hand.map((c) => c.id)).toEqual(
      g.players[0].hand.map((c) => c.id),
    );
    expect(back.players[1].hand.map((c) => c.id)).toEqual(
      g.players[1].hand.map((c) => c.id),
    );
    expect(back.deck.map((c) => c.id)).toEqual(g.deck.map((c) => c.id));
    expect(back.starter).toBeNull();
    expect(back.peg).toBeNull();
  });

  it('dePlayer defaults missing hand/played/discardSel/score', () => {
    const minimal = {
      phase: 'discard',
      dealer: 0,
      pone: 1,
      players: [{}, { hand: { 0: 'AH' } }],
      crib: [],
      deck: ['2C', '3D'],
      message: 'ok',
      trapped: [false, false],
      trapEscapeWin: false,
      dealNumber: 1,
      heelsPoints: 0,
      mode: 'online',
    };
    const back = deserializeGameState(minimal);
    expect(back.players[0].hand).toEqual([]);
    expect(back.players[0].played).toEqual([]);
    expect(back.players[0].discardSel).toEqual([]);
    expect(back.players[0].score).toBe(0);
    expect(back.players[1].hand.map((c) => c.id)).toEqual(['AH']);
  });

  it('round-trips peg with 2-card sequence through null-strip + object-form', () => {
    const g = startDeal(createGame('online'), rngFrom(21));
    const ser = serializeGameState(g) as Record<string, unknown>;
    // Inject a peg pile like the N8EN5 desync case (two 7s)
    ser.peg = {
      sequence: [
        { card: '7C', player: 0 },
        { card: '7D', player: 1 },
      ],
      count: 14,
      toPlay: 0,
      saidGo: [1],
      sequenceDone: false,
    };
    ser.phase = 'pegging';
    ser.starter = 'AH';

    const stripped = stripNulls(JSON.parse(JSON.stringify(ser)));
    const asObjects = arraysToObjects(stripped);
    const back = deserializeGameState(asObjects);

    expect(back.peg).not.toBeNull();
    expect(back.peg!.sequence).toHaveLength(2);
    expect(back.peg!.sequence[0].card.id).toBe('7C');
    expect(back.peg!.sequence[0].player).toBe(0);
    expect(back.peg!.sequence[1].card.id).toBe('7D');
    expect(back.peg!.sequence[1].player).toBe(1);
    expect(back.peg!.count).toBe(14);
    expect(back.peg!.toPlay).toBe(0);
    expect(back.peg!.saidGo.has(1)).toBe(true);
    expect(back.peg!.saidGo.has(0)).toBe(false);
    expect(back.peg!.sequenceDone).toBe(false);
    expect(back.starter?.id).toBe('AH');
  });

  it('dePeg tolerates missing saidGo/sequence and empty saidGo stripped by Firebase', () => {
    const minimal = {
      phase: 'pegging',
      dealer: 0,
      pone: 1,
      players: [{ hand: [] }, { hand: [] }],
      crib: [],
      deck: [],
      peg: {
        sequence: { 0: { card: '7C', player: 0 } },
        count: 7,
        toPlay: 1,
        // saidGo omitted (Firebase empty-array strip)
      },
      message: 'ok',
      trapped: [false, false],
      trapEscapeWin: false,
      dealNumber: 1,
      heelsPoints: 0,
      mode: 'online',
    };
    const back = deserializeGameState(minimal);
    expect(back.peg!.sequence).toHaveLength(1);
    expect(back.peg!.sequence[0].card.id).toBe('7C');
    expect(back.peg!.count).toBe(7);
    expect(back.peg!.toPlay).toBe(1);
    expect(back.peg!.saidGo.size).toBe(0);
    expect(back.peg!.sequenceDone).toBe(false);
  });
});


/** Walk a value; fail if any undefined appears (Firebase RTDB rejects these). */
function assertNoUndefined(value: unknown, path = '$'): void {
  if (value === undefined) {
    throw new Error(`undefined at ${path}`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(v, `${path}.${k}`);
  }
}

describe('stripUndefined / pair flash Firebase safety', () => {
  it('stripUndefined omits undefined object keys and keeps null', () => {
    const input = { a: 1, b: undefined, c: null, d: { e: undefined, f: 2 } };
    const out = stripUndefined(input);
    expect(out).toEqual({ a: 1, c: null, d: { f: 2 } });
    expect('b' in (out as object)).toBe(false);
  });

  it('serializes post-pair flash and always fills kindLabel (no undefined)', () => {
    const g = startDeal(createGame('online'), rngFrom(55));
    // Simulate playPegCard pair flash: events present, kindLabel omitted on object
    const withPair: typeof g = {
      ...g,
      phase: 'pegging',
      starter: makeCard('A', 'hearts'),
      peg: {
        sequence: [
          { card: makeCard('7', 'clubs'), player: 0 },
          { card: makeCard('7', 'diamonds'), player: 1 },
        ],
        count: 14,
        toPlay: 0,
        saidGo: new Set(),
        sequenceDone: false,
      },
      lastPegFlash: {
        id: 42,
        player: 1,
        points: 2,
        events: [{ kind: 'pair', points: 2 }],
        blocked: false,
        // kindLabel omitted — serializer must reconstruct so both clients show PAIR
      },
      winner: null,
      showResult: null,
    };

    const ser = serializeGameState(withPair);
    assertNoUndefined(ser);
    // JSON round-trip must not resurrect undefined
    const jsonShape = JSON.parse(JSON.stringify(ser));
    assertNoUndefined(jsonShape);
    expect(JSON.stringify(ser)).not.toContain('undefined');
    expect(ser.lastPegFlash).not.toBeNull();
    expect((ser.lastPegFlash as { kindLabel: string }).kindLabel).toBe('pair');
    expect((ser.lastPegFlash as { points: number }).points).toBe(2);
    expect((ser.peg as { saidGo: number[] }).saidGo).toEqual([]);

    // Simulate Firebase write shape: null-strip + object-form arrays
    const stripped = stripNulls(jsonShape);
    const asObjects = arraysToObjects(stripped);
    assertNoUndefined(asObjects);

    const back = deserializeGameState(asObjects);
    expect(back.peg!.sequence).toHaveLength(2);
    expect(back.peg!.sequence[0].card.id).toBe('7C');
    expect(back.peg!.sequence[1].card.id).toBe('7D');
    expect(back.peg!.count).toBe(14);
    expect(back.lastPegFlash).not.toBeNull();
    expect(back.lastPegFlash!.points).toBe(2);
    expect(back.lastPegFlash!.events).toEqual([{ kind: 'pair', points: 2 }]);
    expect(back.lastPegFlash!.kindLabel).toBe('pair');
  });

  it('includes kindLabel when non-empty (heels/go)', () => {
    const g = startDeal(createGame('online'), rngFrom(8));
    const withLabel: typeof g = {
      ...g,
      lastPegFlash: {
        id: 1,
        player: 0,
        points: 2,
        events: [],
        kindLabel: 'heels',
      },
    };
    const ser = serializeGameState(withLabel);
    assertNoUndefined(ser);
    expect((ser.lastPegFlash as { kindLabel: string }).kindLabel).toBe('heels');
    expect(
      Object.prototype.hasOwnProperty.call(ser.lastPegFlash as object, 'blocked'),
    ).toBe(false);
  });

  it('serPeg saidGo is always a number array even if Set-like', () => {
    const g = startDeal(createGame('online'), rngFrom(12));
    const withGo: typeof g = {
      ...g,
      phase: 'pegging',
      starter: makeCard('2', 'clubs'),
      peg: {
        sequence: [{ card: makeCard('5', 'hearts'), player: 0 }],
        count: 5,
        toPlay: 1,
        saidGo: new Set([0]),
        sequenceDone: false,
      },
    };
    const ser = serializeGameState(withGo);
    assertNoUndefined(ser);
    expect(Array.isArray((ser.peg as { saidGo: number[] }).saidGo)).toBe(true);
    expect((ser.peg as { saidGo: number[] }).saidGo).toEqual([0]);
  });

  it('round-trips competitive scoringMode + competitiveShow (claim / muggins)', () => {
    const g = startDeal(createGame('online', { scoringMode: 'competitive' }), rngFrom(3));
    const withShow: typeof g = {
      ...g,
      phase: 'show',
      scoringMode: 'competitive',
      competitiveShow: {
        step: 'dealer',
        pendingReview: null,
        pendingMuggins: {
          step: 'pone',
          scorer: 1,
          claimed: 6,
          trueTotal: 8,
          missed: 2,
          claimedOriginal: 4,
          adjustedClaimed: 6,
        },
        pendingRef: {
          trueRaw: 8,
          scorer: 1,
          sidedWith: 'adjuster',
          kept: 6,
          originalClaimed: 4,
          adjustedClaimed: 6,
          neitherExact: true,
          adjusterWrong: true,
          wrongCorrectorPenalty: 4,
          verdict: 'Neither exact — kept adjuster (closer); adjuster wrong, penalized −4',
        },
        lastRef: {
          trueRaw: 8,
          scorer: 1,
          sidedWith: 'adjuster',
          kept: 6,
          originalClaimed: 4,
          adjustedClaimed: 6,
          neitherExact: true,
          adjusterWrong: true,
          wrongCorrectorPenalty: 4,
          verdict: 'Neither exact — kept adjuster (closer); adjuster wrong, penalized −4',
        },
        log: [
          {
            step: 'pone',
            claimed: 6,
            trueTotal: 8,
            kind: 'underclaim',
            mugginsTaken: 0,
            claimedOriginal: 4,
            adjustedClaimed: 6,
          },
        ],
      },
    };
    const ser = serializeGameState(withShow);
    assertNoUndefined(ser);
    expect(ser.scoringMode).toBe('competitive');
    const stripped = stripNulls(JSON.parse(JSON.stringify(ser)));
    const asObjects = arraysToObjects(stripped);
    const back = deserializeGameState(asObjects);
    expect(back.scoringMode).toBe('competitive');
    expect(back.competitiveShow?.step).toBe('dealer');
    expect(back.competitiveShow?.pendingMuggins).toEqual({
      step: 'pone',
      scorer: 1,
      claimed: 6,
      trueTotal: 8,
      missed: 2,
      claimedOriginal: 4,
      adjustedClaimed: 6,
    });
    expect(back.competitiveShow?.pendingRef).toEqual({
      trueRaw: 8,
      scorer: 1,
      sidedWith: 'adjuster',
      kept: 6,
      originalClaimed: 4,
      adjustedClaimed: 6,
      neitherExact: true,
      adjusterWrong: true,
      wrongCorrectorPenalty: 4,
      verdict: 'Neither exact — kept adjuster (closer); adjuster wrong, penalized −4',
    });
    expect(back.competitiveShow?.lastRef).toEqual({
      trueRaw: 8,
      scorer: 1,
      sidedWith: 'adjuster',
      kept: 6,
      originalClaimed: 4,
      adjustedClaimed: 6,
      neitherExact: true,
      adjusterWrong: true,
      wrongCorrectorPenalty: 4,
      verdict: 'Neither exact — kept adjuster (closer); adjuster wrong, penalized −4',
    });
    expect(back.competitiveShow?.pendingReview).toBeNull();
    expect(back.competitiveShow?.log).toHaveLength(1);
    expect(back.competitiveShow?.log[0]?.kind).toBe('underclaim');
    expect(back.competitiveShow?.log[0]?.claimedOriginal).toBe(4);
    expect(back.competitiveShow?.log[0]?.adjustedClaimed).toBe(6);
    expect(back.competitiveShow?.log[0]?.claimed).toBe(6);
  });
  it('pendingReview round-trip (scorer 0 and 1 survive Firebase strip/object arrays)', () => {
    for (const scorer of [0, 1] as const) {
      const g = startDeal(createGame('online', { scoringMode: 'competitive' }), rngFrom(3));
      const withReview: typeof g = {
        ...g,
        phase: 'show',
        scoringMode: 'competitive',
        competitiveShow: {
          step: 'pone',
          pendingReview: { step: 'pone', scorer, claimed: 8 },
          pendingMuggins: null,
          log: [],
        },
      };
      const ser = serializeGameState(withReview);
      assertNoUndefined(ser);
      const stripped = stripNulls(JSON.parse(JSON.stringify(ser)));
      const asObjects = arraysToObjects(stripped);
      const back = deserializeGameState(asObjects);
      expect(back.competitiveShow?.pendingReview).toEqual({
        step: 'pone',
        scorer,
        claimed: 8,
      });
      expect(back.scoringMode).toBe('competitive');
    }
  });

});
