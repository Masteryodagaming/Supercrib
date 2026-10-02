import { describe, it, expect } from 'vitest';
import {
  spectatorHideHoleCards,
  isSpectatorRevealPhase,
} from '../spectateHands';
import type { Phase } from '../../engine/supercrib';

describe('spectatorHideHoleCards', () => {
  const hidden: Phase[] = [
    'deal',
    'discard',
    'cut',
    'heels',
    'pegging',
    'roundEnd',
  ];
  const revealed: Phase[] = ['show', 'zeroHandOffer', 'redeal', 'gameOver'];

  it('hides hole cards during discard / cut / pegging', () => {
    for (const phase of hidden) {
      expect(spectatorHideHoleCards(phase), phase).toBe(true);
      expect(isSpectatorRevealPhase(phase), phase).toBe(false);
    }
  });

  it('reveals hands in show / count / gameOver phases', () => {
    for (const phase of revealed) {
      expect(spectatorHideHoleCards(phase), phase).toBe(false);
      expect(isSpectatorRevealPhase(phase), phase).toBe(true);
    }
  });
});
