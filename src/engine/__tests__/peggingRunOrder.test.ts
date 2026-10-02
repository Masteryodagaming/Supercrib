import { describe, it, expect } from 'vitest';
import { makeCard } from '../cards';
import { createPegState, applyPegPlay, scorePegPlay, formatPegKindLabel } from '../pegging';

describe('pegging runs any order', () => {
  it('scores run of 4 when cards are not played in order (5-7-6-4)', () => {
    let s = createPegState(0);
    const plays = [
      makeCard('5', 'hearts'),
      makeCard('7', 'clubs'),
      makeCard('6', 'diamonds'),
      makeCard('4', 'spades'),
    ];
    const eventsByPlay: ReturnType<typeof applyPegPlay>['events'][] = [];
    for (let i = 0; i < plays.length; i++) {
      const r = applyPegPlay(s, plays[i], (i % 2) as 0 | 1);
      s = r.state;
      eventsByPlay.push(r.events);
    }
    // After 5,7,6 → run of 3; after 4 → run of 4
    expect(eventsByPlay[2].some((e) => e.kind === 'run' && e.points === 3)).toBe(true);
    expect(eventsByPlay[3].some((e) => e.kind === 'run' && e.points === 4)).toBe(true);
    expect(formatPegKindLabel(eventsByPlay[3])).toContain('run of 4');
  });

  it('scores run of 4 for 2-5-3-4', () => {
    const seq = [
      { card: makeCard('2', 'hearts'), player: 0 as const },
      { card: makeCard('5', 'clubs'), player: 1 as const },
      { card: makeCard('3', 'diamonds'), player: 0 as const },
    ];
    const events = scorePegPlay(seq, makeCard('4', 'spades'), 14);
    expect(events.some((e) => e.kind === 'run' && e.points === 4)).toBe(true);
    expect(formatPegKindLabel(events)).toBe('run of 4');
  });

  it('formatPegKindLabel joins fifteen + run + go', () => {
    expect(
      formatPegKindLabel([
        { kind: 'fifteen', points: 2 },
        { kind: 'run', points: 3, runLength: 3 },
        { kind: 'go', points: 1 },
      ]),
    ).toBe('15 · run of 3 · go');
  });

  it('formatPegKindLabel for pair and go alone', () => {
    expect(formatPegKindLabel([{ kind: 'pair', points: 2 }])).toBe('pair');
    expect(formatPegKindLabel([{ kind: 'go', points: 1 }])).toBe('go');
  });
});
