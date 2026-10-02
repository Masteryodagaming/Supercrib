import { describe, it, expect } from 'vitest';
import {
  shouldShowWaitingStarterCutFan,
  shouldStartRemoteStarterCutReveal,
  remoteCutAnimSlots,
} from '../onlineCutWatch';
import type { Card } from '../../engine/cards';

const starter: Card = { id: 'AS', rank: 'A', suit: 'spades' };

describe('shouldShowWaitingStarterCutFan', () => {
  it('shows fan for dealer/spectator while phase is cut', () => {
    expect(
      shouldShowWaitingStarterCutFan({
        phase: 'cut',
        cribGathering: false,
        cribSettled: true,
        humanCutFan: false,
        animCutFan: false,
      }),
    ).toBe(true);
  });

  it('hides when human or AI anim fan already showing', () => {
    expect(
      shouldShowWaitingStarterCutFan({
        phase: 'cut',
        cribGathering: false,
        cribSettled: true,
        humanCutFan: true,
        animCutFan: false,
      }),
    ).toBe(false);
    expect(
      shouldShowWaitingStarterCutFan({
        phase: 'cut',
        cribGathering: false,
        cribSettled: true,
        humanCutFan: false,
        animCutFan: true,
      }),
    ).toBe(false);
  });

  it('hides during crib gather or non-cut phases', () => {
    expect(
      shouldShowWaitingStarterCutFan({
        phase: 'cut',
        cribGathering: true,
        cribSettled: false,
        humanCutFan: false,
        animCutFan: false,
      }),
    ).toBe(false);
    expect(
      shouldShowWaitingStarterCutFan({
        phase: 'pegging',
        cribGathering: false,
        cribSettled: true,
        humanCutFan: false,
        animCutFan: false,
      }),
    ).toBe(false);
  });
});

describe('shouldStartRemoteStarterCutReveal', () => {
  const base = {
    mode: 'online',
    prevPhase: 'cut' as string | null,
    prevDealNumber: 2,
    nextPhase: 'pegging',
    dealNumber: 2,
    starter,
    viewerSeat: 0 as const,
    pone: 1 as const,
    alreadyStartedForDeal: null as number | null,
  };

  it('starts when dealer watches pone cut sync past cut', () => {
    expect(shouldStartRemoteStarterCutReveal(base)).toBe(true);
  });

  it('starts when seat1 watches seat0 (pone) cut', () => {
    expect(
      shouldStartRemoteStarterCutReveal({
        ...base,
        viewerSeat: 1,
        pone: 0,
      }),
    ).toBe(true);
  });

  it('skips for the cutting seat (pone)', () => {
    expect(
      shouldStartRemoteStarterCutReveal({
        ...base,
        viewerSeat: 1,
        pone: 1,
      }),
    ).toBe(false);
  });

  it('skips AI / hotseat modes', () => {
    expect(shouldStartRemoteStarterCutReveal({ ...base, mode: 'ai' })).toBe(false);
  });

  it('skips if we never locally saw cut phase this deal', () => {
    expect(shouldStartRemoteStarterCutReveal({ ...base, prevPhase: null })).toBe(false);
    expect(shouldStartRemoteStarterCutReveal({ ...base, prevPhase: 'discard' })).toBe(false);
    expect(shouldStartRemoteStarterCutReveal({ ...base, prevDealNumber: 1 })).toBe(false);
  });

  it('skips duplicate / already animated deal', () => {
    expect(shouldStartRemoteStarterCutReveal({ ...base, alreadyStartedForDeal: 2 })).toBe(false);
  });

  it('skips when still in cut or missing starter', () => {
    expect(shouldStartRemoteStarterCutReveal({ ...base, nextPhase: 'cut' })).toBe(false);
    expect(shouldStartRemoteStarterCutReveal({ ...base, starter: null })).toBe(false);
  });
});

describe('remoteCutAnimSlots', () => {
  it('uses post-cut deck + 1 and a mid visual slot', () => {
    const s = remoteCutAnimSlots(36);
    expect(s.deckCount).toBe(37);
    expect(s.visualI).toBeGreaterThanOrEqual(0);
    expect(s.cutIndex).toBeGreaterThanOrEqual(0);
  });
});
