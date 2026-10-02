import { describe, expect, it } from 'vitest';
import {
  applyPlayoffGameResult,
  bothQuartersComplete,
  bothSemisComplete,
  buildFinalFromStandings,
  buildFinalSeries,
  buildQuartersFromStandings,
  buildSemisFromQuarters,
  buildSemisFromStandings,
  buildSemisFromTop6Quarters,
  buildTop6OpeningFromStandings,
  isTop6PlayInBracket,
  nextPendingGameIndex,
  playoffPodium,
  playoffSeriesWinsForGame,
} from '../playoffs';
import type { PlayoffBracket, PlayoffSeries } from '../types';
import type { StandingRow } from '../scoring';

function row(id: string, place: number): StandingRow {
  return {
    userId: id,
    displayName: id,
    gamePoints: 10 - place,
    wins: 1,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    joinedAt: place,
    place,
  };
}

function freshSf14() {
  return buildSemisFromStandings([row('a', 1), row('b', 2), row('c', 3), row('d', 4)]).series[
    'sf-1v4'
  ];
}

describe('playoffs', () => {
  it('builds 1v4 and 2v3 semis', () => {
    const b = buildSemisFromStandings([row('a', 1), row('b', 2), row('c', 3), row('d', 4)]);
    expect(b.series['sf-1v4'].playerAId).toBe('a');
    expect(b.series['sf-1v4'].playerBId).toBe('d');
    expect(b.series['sf-2v3'].playerAId).toBe('b');
    expect(b.series['sf-2v3'].playerBId).toBe('c');
  });

  it('buildFinalFromStandings seeds RR #1 vs #2 as Final only', () => {
    const b = buildFinalFromStandings([row('a', 1), row('b', 2), row('c', 3), row('d', 4)]);
    expect(b.status).toBe('final');
    expect(Object.keys(b.series)).toEqual(['final']);
    expect(b.series['final'].playerAId).toBe('a');
    expect(b.series['final'].playerBId).toBe('b');
    expect(b.series['final'].seedA).toBe(1);
    expect(b.series['final'].seedB).toBe(2);
    expect(b.series['final'].status).toBe('live');
    expect(b.series['sf-1v4']).toBeUndefined();
  });

  it('buildFinalFromStandings requires at least 2 standings', () => {
    expect(() => buildFinalFromStandings([row('a', 1)])).toThrow(/at least 2/i);
  });

  it('Bo3 series completes at 2 wins and opens final', () => {
    let sf = freshSf14();
    expect(nextPendingGameIndex(sf)).toBe(1);
    sf = applyPlayoffGameResult(sf, 1, 241, 100);
    sf = applyPlayoffGameResult(sf, 2, 241, 180);
    expect(sf.status).toBe('complete');
    expect(sf.winnerId).toBe('a');
    expect(sf.winsA).toBe(2);

    const bracket = {
      status: 'semis' as const,
      series: {
        'sf-1v4': sf,
        'sf-2v3': {
          ...sf,
          id: 'sf-2v3',
          playerAId: 'b',
          playerBId: 'c',
          winnerId: 'b',
          status: 'complete' as const,
          winsA: 2,
          winsB: 0,
        },
      },
    };
    expect(bothSemisComplete(bracket)).toBe(true);
    const fin = buildFinalSeries(bracket);
    expect(fin.playerAId).toBe('a');
    expect(fin.playerBId).toBe('b');
  });

  it('normal win awards +1 whether skunk flag is on or off', () => {
    // Supercrib non-skunk: loser >= 181 (e.g. 241–200)
    expect(playoffSeriesWinsForGame(241, 200, { variant: 'supercrib' })).toBe(1);
    expect(
      playoffSeriesWinsForGame(241, 200, {
        variant: 'supercrib',
        playoffSkunkCountsAsTwo: true,
      }),
    ).toBe(1);

    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 200, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(1);
    expect(sf.winsB).toBe(0);
    expect(sf.status).toBe('live');
    expect(nextPendingGameIndex(sf)).toBe(2);
  });

  it('flag off: skunk score still awards only +1 and series continues', () => {
    // Supercrib skunk: loser < 181 (241–180)
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 180, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: false,
    });
    expect(sf.winsA).toBe(1);
    expect(sf.status).toBe('live');
    expect(sf.winnerId).toBeNull();
    expect(nextPendingGameIndex(sf)).toBe(2);
  });

  it('flag on: skunk awards +2 and completes series 2-0 after one game', () => {
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 180, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(2);
    expect(sf.winsB).toBe(0);
    expect(sf.status).toBe('complete');
    expect(sf.winnerId).toBe('a');
    expect(nextPendingGameIndex(sf)).toBeNull();
    // Remaining games stay pending/unused
    expect(sf.games.filter((g) => g.result === 'pending')).toHaveLength(2);
  });

  it('flag on: double skunk also ends series', () => {
    // Supercrib double skunk: loser < 122 (241–100)
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 100, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(2);
    expect(sf.status).toBe('complete');
    expect(sf.winnerId).toBe('a');
  });

  it('flag on: classic_121 skunk lines apply', () => {
    // Classic skunk: loser < 91
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 121, 90, {
      variant: 'classic_121',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(2);
    expect(sf.status).toBe('complete');
  });

  it('flag on: trailing player skunks to 2-1 and wins series', () => {
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 200, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(1);
    // B skunks A → +2 for B → 1-2, B wins
    sf = applyPlayoffGameResult(sf, 2, 180, 241, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(1);
    expect(sf.winsB).toBe(2);
    expect(sf.status).toBe('complete');
    expect(sf.winnerId).toBe('d');
  });

  it('flag on: leader skunk at 1-0 stores 3 wins but completes', () => {
    let sf = freshSf14();
    sf = applyPlayoffGameResult(sf, 1, 241, 200, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    sf = applyPlayoffGameResult(sf, 2, 241, 180, {
      variant: 'supercrib',
      playoffSkunkCountsAsTwo: true,
    });
    expect(sf.winsA).toBe(3);
    expect(sf.status).toBe('complete');
    expect(sf.winnerId).toBe('a');
  });
});


function completeSeries(
  base: PlayoffSeries,
  winnerSide: 'a' | 'b',
): PlayoffSeries {
  return {
    ...base,
    status: 'complete',
    winsA: winnerSide === 'a' ? 2 : 0,
    winsB: winnerSide === 'b' ? 2 : 0,
    winnerId: winnerSide === 'a' ? base.playerAId : base.playerBId,
  };
}

function completedBracket(opts?: {
  /** Who wins sf-1v4 — default seed1 (a). */
  sf14Winner?: 'a' | 'b';
  /** Who wins sf-2v3 — default seed2 (b). */
  sf23Winner?: 'a' | 'b';
  /** Who wins final — 'a' = sf14 winner, 'b' = sf23 winner. */
  finalWinner?: 'a' | 'b';
  /** Drop seeds on semis for fallback tests. */
  clearSeeds?: boolean;
}): PlayoffBracket {
  const built = buildSemisFromStandings([
    row('a', 1),
    row('b', 2),
    row('c', 3),
    row('d', 4),
  ]);
  let sf14 = completeSeries(built.series['sf-1v4'], opts?.sf14Winner ?? 'a');
  let sf23 = completeSeries(built.series['sf-2v3'], opts?.sf23Winner ?? 'a');
  if (opts?.clearSeeds) {
    sf14 = { ...sf14, seedA: 0, seedB: 0 };
    sf23 = { ...sf23, seedA: 0, seedB: 0 };
  }
  const finalBase = buildFinalSeries({
    status: 'semis',
    series: { 'sf-1v4': sf14, 'sf-2v3': sf23 },
  });
  const final = completeSeries(finalBase, opts?.finalWinner ?? 'a');
  return {
    status: 'complete',
    series: { 'sf-1v4': sf14, 'sf-2v3': sf23, final },
  };
}

describe('playoffPodium', () => {
  it('returns null when bracket is not complete', () => {
    const b = buildSemisFromStandings([
      row('a', 1),
      row('b', 2),
      row('c', 3),
      row('d', 4),
    ]);
    expect(playoffPodium(b)).toBeNull();
  });

  it('places champion, runner-up, and 3rd by better semi-loser seed', () => {
    // a (1) beats d (4); b (2) beats c (3); a beats b in final
    // semi losers: d seed4, c seed3 → 3rd = c, 4th = d
    const b = completedBracket();
    expect(playoffPodium(b)).toEqual({
      firstId: 'a',
      secondId: 'b',
      thirdId: 'c',
      fourthId: 'd',
    });
  });

  it('3rd is lower seed when upset: seed1 loses semi', () => {
    // d (4) upsets a (1); b (2) beats c (3); d beats b in final
    // semi losers: a seed1, c seed3 → 3rd = a, 4th = c
    const b = completedBracket({
      sf14Winner: 'b',
      sf23Winner: 'a',
      finalWinner: 'a',
    });
    expect(b.series['final'].winnerId).toBe('d');
    expect(playoffPodium(b)).toEqual({
      firstId: 'd',
      secondId: 'b',
      thirdId: 'a',
      fourthId: 'c',
    });
  });

  it('falls back to RR order when seeds missing', () => {
    // same outcomes as first test but seeds cleared
    const b = completedBracket({ clearSeeds: true });
    expect(playoffPodium(b)).toEqual({
      firstId: 'a',
      secondId: 'b',
      thirdId: 'd', // stable fallback without rrOrder
      fourthId: 'c',
    });
    expect(playoffPodium(b, ['a', 'b', 'c', 'd'])).toEqual({
      firstId: 'a',
      secondId: 'b',
      thirdId: 'c',
      fourthId: 'd',
    });
  });

  it('Top 2 final-only podium uses RR order for 3rd/4th', () => {
    const built = buildFinalFromStandings([
      row('a', 1),
      row('b', 2),
      row('c', 3),
      row('d', 4),
    ]);
    const final = {
      ...built.series['final'],
      status: 'complete' as const,
      winsA: 2,
      winsB: 0,
      winnerId: 'a',
    };
    const bracket = {
      status: 'complete' as const,
      series: { final },
    };
    expect(playoffPodium(bracket, ['a', 'b', 'c', 'd'])).toEqual({
      firstId: 'a',
      secondId: 'b',
      thirdId: 'c',
      fourthId: 'd',
    });
  });
});


describe('Top 8 quarters', () => {
  const eight = () =>
    [1, 2, 3, 4, 5, 6, 7, 8].map((place) => row(`p${place}`, place));

  it('builds QF 1v8, 4v5, 2v7, 3v6', () => {
    const b = buildQuartersFromStandings(eight());
    expect(b.status).toBe('quarters');
    expect(b.series['qf-1v8'].playerAId).toBe('p1');
    expect(b.series['qf-1v8'].playerBId).toBe('p8');
    expect(b.series['qf-4v5'].playerAId).toBe('p4');
    expect(b.series['qf-4v5'].playerBId).toBe('p5');
    expect(b.series['qf-2v7'].playerAId).toBe('p2');
    expect(b.series['qf-2v7'].playerBId).toBe('p7');
    expect(b.series['qf-3v6'].playerAId).toBe('p3');
    expect(b.series['qf-3v6'].playerBId).toBe('p6');
  });

  it('requires at least 8 standings', () => {
    expect(() =>
      buildQuartersFromStandings([
        row('a', 1),
        row('b', 2),
        row('c', 3),
        row('d', 4),
        row('e', 5),
        row('f', 6),
        row('g', 7),
      ]),
    ).toThrow(/at least 8/i);
  });

  it('advances quarters → semis → final', () => {
    const built = buildQuartersFromStandings(eight());
    // Higher seeds win each QF
    const qfComplete = (id: string, winnerSide: 'a' | 'b') => {
      const s = built.series[id];
      return {
        ...s,
        status: 'complete' as const,
        winsA: winnerSide === 'a' ? 2 : 0,
        winsB: winnerSide === 'b' ? 2 : 0,
        winnerId: winnerSide === 'a' ? s.playerAId : s.playerBId,
      };
    };
    const afterQf: PlayoffBracket = {
      status: 'quarters',
      series: {
        'qf-1v8': qfComplete('qf-1v8', 'a'),
        'qf-4v5': qfComplete('qf-4v5', 'a'),
        'qf-2v7': qfComplete('qf-2v7', 'a'),
        'qf-3v6': qfComplete('qf-3v6', 'a'),
      },
    };
    expect(bothQuartersComplete(afterQf)).toBe(true);
    const semis = buildSemisFromQuarters(afterQf);
    expect(semis['sf-a'].playerAId).toBe('p1');
    expect(semis['sf-a'].playerBId).toBe('p4');
    expect(semis['sf-b'].playerAId).toBe('p2');
    expect(semis['sf-b'].playerBId).toBe('p3');

    const afterSf: PlayoffBracket = {
      status: 'semis',
      series: {
        ...afterQf.series,
        'sf-a': {
          ...semis['sf-a'],
          status: 'complete',
          winsA: 2,
          winsB: 0,
          winnerId: 'p1',
        },
        'sf-b': {
          ...semis['sf-b'],
          status: 'complete',
          winsA: 2,
          winsB: 0,
          winnerId: 'p2',
        },
      },
    };
    expect(bothSemisComplete(afterSf)).toBe(true);
    const fin = buildFinalSeries(afterSf);
    expect(fin.playerAId).toBe('p1');
    expect(fin.playerBId).toBe('p2');

    const complete: PlayoffBracket = {
      status: 'complete',
      series: {
        ...afterSf.series,
        final: {
          ...fin,
          status: 'complete',
          winsA: 2,
          winsB: 0,
          winnerId: 'p1',
        },
      },
    };
    // Semi losers p4 (seed4) and p3 (seed3) → 3rd = p3, 4th = p4
    expect(playoffPodium(complete)).toEqual({
      firstId: 'p1',
      secondId: 'p2',
      thirdId: 'p3',
      fourthId: 'p4',
    });
  });
});


describe('Top 6 play-in', () => {
  const six = () =>
    [1, 2, 3, 4, 5, 6].map((place) => row(`p${place}`, place));

  it('builds only QF 3v6 and 4v5 (seeds 1–2 bye)', () => {
    const b = buildTop6OpeningFromStandings(six());
    expect(b.status).toBe('quarters');
    expect(Object.keys(b.series).sort()).toEqual(['qf-3v6', 'qf-4v5']);
    expect(b.series['qf-3v6'].playerAId).toBe('p3');
    expect(b.series['qf-3v6'].playerBId).toBe('p6');
    expect(b.series['qf-4v5'].playerAId).toBe('p4');
    expect(b.series['qf-4v5'].playerBId).toBe('p5');
    expect(b.series['qf-1v8']).toBeUndefined();
    expect(b.series['qf-2v7']).toBeUndefined();
    expect(isTop6PlayInBracket(b)).toBe(true);
  });

  it('requires at least 6 standings', () => {
    expect(() =>
      buildTop6OpeningFromStandings([
        row('a', 1),
        row('b', 2),
        row('c', 3),
        row('d', 4),
        row('e', 5),
      ]),
    ).toThrow(/at least 6/i);
  });

  it('after play-in winners, semis are 1 vs W(4v5) and 2 vs W(3v6)', () => {
    const standings = six();
    const built = buildTop6OpeningFromStandings(standings);
    const qfComplete = (id: string, winnerSide: 'a' | 'b') => {
      const s = built.series[id];
      return {
        ...s,
        status: 'complete' as const,
        winsA: winnerSide === 'a' ? 2 : 0,
        winsB: winnerSide === 'b' ? 2 : 0,
        winnerId: winnerSide === 'a' ? s.playerAId : s.playerBId,
      };
    };
    // Higher seeds win play-in: 4 beats 5, 3 beats 6
    const afterQf: PlayoffBracket = {
      status: 'quarters',
      series: {
        'qf-4v5': qfComplete('qf-4v5', 'a'),
        'qf-3v6': qfComplete('qf-3v6', 'a'),
      },
    };
    expect(bothQuartersComplete(afterQf)).toBe(true);
    expect(isTop6PlayInBracket(afterQf)).toBe(true);
    const semis = buildSemisFromTop6Quarters(afterQf, standings);
    expect(semis['sf-a'].playerAId).toBe('p1');
    expect(semis['sf-a'].playerBId).toBe('p4');
    expect(semis['sf-a'].seedA).toBe(1);
    expect(semis['sf-a'].seedB).toBe(4);
    expect(semis['sf-b'].playerAId).toBe('p2');
    expect(semis['sf-b'].playerBId).toBe('p3');
    expect(semis['sf-b'].seedA).toBe(2);
    expect(semis['sf-b'].seedB).toBe(3);
  });

  it('upset winners still feed classic 6-team semis', () => {
    const standings = six();
    const built = buildTop6OpeningFromStandings(standings);
    const qfComplete = (id: string, winnerSide: 'a' | 'b') => {
      const s = built.series[id];
      return {
        ...s,
        status: 'complete' as const,
        winsA: winnerSide === 'a' ? 2 : 0,
        winsB: winnerSide === 'b' ? 2 : 0,
        winnerId: winnerSide === 'a' ? s.playerAId : s.playerBId,
      };
    };
    // 5 upsets 4; 6 upsets 3 → semis 1v5 and 2v6
    const afterQf: PlayoffBracket = {
      status: 'quarters',
      series: {
        'qf-4v5': qfComplete('qf-4v5', 'b'),
        'qf-3v6': qfComplete('qf-3v6', 'b'),
      },
    };
    const semis = buildSemisFromTop6Quarters(afterQf, standings);
    expect(semis['sf-a'].playerAId).toBe('p1');
    expect(semis['sf-a'].playerBId).toBe('p5');
    expect(semis['sf-b'].playerAId).toBe('p2');
    expect(semis['sf-b'].playerBId).toBe('p6');
  });
});
