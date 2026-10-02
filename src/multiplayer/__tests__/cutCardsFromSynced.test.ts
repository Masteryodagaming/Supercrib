import { describe, it, expect } from 'vitest';
import { asList, cutCardsFromSynced } from '../roomSession';
import type { SyncedCutState } from '../types';

describe('asList', () => {
  it('returns arrays as-is', () => {
    expect(asList(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('maps plain objects with numeric keys', () => {
    expect(asList({ 1: 'b', 0: 'a' })).toEqual(['a', 'b']);
  });

  it('returns empty for null/undefined/non-list', () => {
    expect(asList(null)).toEqual([]);
    expect(asList(undefined)).toEqual([]);
    expect(asList('x')).toEqual([]);
  });
});

describe('cutCardsFromSynced', () => {
  it('returns null when cut missing', () => {
    expect(cutCardsFromSynced(undefined)).toBeNull();
    expect(cutCardsFromSynced(null)).toBeNull();
  });

  it('returns null when deck missing or empty', () => {
    expect(cutCardsFromSynced({} as never)).toBeNull();
    expect(
      cutCardsFromSynced({
        rev: 0,
        deck: [],
        cuts: ['', ''],
        stage: 'cut0',
        round: 1,
      }),
    ).toBeNull();
  });

  it('accepts emptyCut-shaped object with cuts: [\'\', \'\']', () => {
    const cut: SyncedCutState = {
      rev: 0,
      deck: ['AS', 'KH', 'QD'],
      cuts: ['', ''],
      stage: 'cut0',
      round: 1,
    };
    const view = cutCardsFromSynced(cut);
    expect(view).not.toBeNull();
    expect(view!.deck).toHaveLength(3);
    expect(view!.cuts).toEqual([null, null]);
  });

  it('treats null/undefined cut slots as no card', () => {
    const view = cutCardsFromSynced({
      rev: 1,
      deck: ['AS', 'KH'],
      cuts: [null, undefined] as never,
      stage: 'cut0',
      round: 1,
    });
    expect(view).not.toBeNull();
    expect(view!.cuts).toEqual([null, null]);
  });

  it('accepts Firebase object-form deck and cuts', () => {
    const cut = {
      rev: 0,
      deck: { 0: 'AS', 1: 'KH', 2: 'QD' },
      cuts: { 0: '', 1: '' },
      stage: 'cut0' as const,
      round: 1,
    };
    const view = cutCardsFromSynced(cut as never);
    expect(view).not.toBeNull();
    expect(view!.deck).toHaveLength(3);
    expect(view!.deck[0].rank).toBe('A');
    expect(view!.cuts).toEqual([null, null]);
  });

  it('parses filled cut slots from object-form cuts', () => {
    const cut = {
      rev: 2,
      deck: { 0: '2C' },
      cuts: { 0: 'AS', 1: 'KH' },
      stage: 'reveal' as const,
      round: 1,
    };
    const view = cutCardsFromSynced(cut as never);
    expect(view).not.toBeNull();
    expect(view!.cuts[0]?.rank).toBe('A');
    expect(view!.cuts[1]?.rank).toBe('K');
  });
});
