import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: after PLAY_PILE_SHOW_ALL, pegging COUNT box used width/flex 100%
 * and left a translucent empty gray panel over the right hand cards (stole hits
 * visually). Box must start small and expand with the pile only.
 */
describe('COUNT box fit-to-content CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('pegging COUNT play-area is max-content, not a fixed wide panel', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*width:\s*max-content/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*flex:\s*0\s+1\s+auto/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*max-width:\s*100%/s,
    );
  });

  it('pegging COUNT play-area does not steal pointer events', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*pointer-events:\s*none/s,
    );
  });

  it('pile still wraps / stays visible (PLAY_PILE_SHOW_ALL kept)', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.play-pile-row\s*\{[^}]*flex-wrap:\s*wrap/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.play-pile-row\s*\{[^}]*overflow:\s*visible/s,
    );
    expect(css).not.toMatch(/max-width:\s*min\(100%,\s*220px\)/);
  });

  it('keeps HAND_HIT_TARGET hand stacking', () => {
    expect(css).toMatch(/\.hand-area\s*\{[^}]*z-index:\s*14/s);
    expect(css).toMatch(/\.table-mid-zone\s*\{[^}]*pointer-events:\s*none/s);
  });
});
