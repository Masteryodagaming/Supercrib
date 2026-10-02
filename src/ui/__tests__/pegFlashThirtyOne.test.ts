import { describe, it, expect } from 'vitest';
import { shouldShowPegScoreCallout } from '../pegFlashGuard';
import type { PegFlash } from '../../engine/supercrib';

function flash(events: PegFlash['events'], points?: number): PegFlash {
  return {
    id: 1,
    player: 0,
    points: points ?? events.reduce((s, e) => s + e.points, 0),
    events,
  };
}

describe('shouldShowPegScoreCallout (no double +2 on 31)', () => {
  it('suppresses callout for pure thirtyone (banner owns the announcement)', () => {
    expect(
      shouldShowPegScoreCallout(flash([{ kind: 'thirtyone', points: 2 }])),
    ).toBe(false);
  });

  it('suppresses callout for compound pair+thirtyone (banner shows combined total)', () => {
    expect(
      shouldShowPegScoreCallout(
        flash(
          [
            { kind: 'pair', points: 2 },
            { kind: 'thirtyone', points: 2 },
          ],
          4,
        ),
      ),
    ).toBe(false);
  });

  it('still shows callout for non-31 scoring (pair / 15 / run / go)', () => {
    expect(shouldShowPegScoreCallout(flash([{ kind: 'pair', points: 2 }]))).toBe(true);
    expect(shouldShowPegScoreCallout(flash([{ kind: 'fifteen', points: 2 }]))).toBe(true);
    expect(shouldShowPegScoreCallout(flash([{ kind: 'go', points: 1 }]))).toBe(true);
  });
});
