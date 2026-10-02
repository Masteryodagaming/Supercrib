import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: pegging COUNT play-area was capped at max-width 220px, so only
 * ~3 desktop pile cards (~56–62px) were visible. Show the full current
 * peg.sequence and let the row expand/wrap as cards are played.
 *
 * COUNT_BOX_FIT: box itself is max-content (not a fixed wide empty panel);
 * max-width 100% still lets the pile grow/wrap across the mid-row.
 */
describe('play pile show-all CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('does not clip pegging play-area to ~3 cards (no 220px cap)', () => {
    expect(css).not.toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*max-width:\s*min\(100%,\s*220px\)/s,
    );
    expect(css).not.toMatch(/max-width:\s*min\(100%,\s*220px\)/);
  });

  it('pegging play-area fits content and caps at mid-row (no fixed empty panel)', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*width:\s*max-content/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*overflow:\s*visible/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*flex:\s*0\s+1\s+auto/s,
    );
    // Must not stretch to a wide empty gray panel over the hand
    // (?<!max-) so max-width:100% (still required) is not a false positive
    expect(css).not.toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*(?<!max-)width:\s*100%/s,
    );
  });

  it('play-pile-row expands and wraps during pegging', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.play-pile-row\s*\{[^}]*flex-wrap:\s*wrap/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.play-pile-row\s*\{[^}]*width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.play-pile-row\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it('keeps hand hit-target stacking (HAND_HIT_TARGET)', () => {
    expect(css).toMatch(/\.hand-area\s*\{[^}]*z-index:\s*14/s);
    expect(css).toMatch(/\.table-mid-zone\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('leaves pass-3 desktop board clamps intact', () => {
    expect(css).toMatch(/--board-w:\s*clamp\(340px,\s*36vw,\s*480px\)/);
    expect(css).toMatch(/--board-w:\s*clamp\(380px,\s*34vw,\s*540px\)/);
  });
});
