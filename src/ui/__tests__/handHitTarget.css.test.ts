import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: pass-2 desktop crib/starter grew larger than the hand and
 * mid-zone (z8) sat above hand-area (z6), stealing taps. Keep crib/starter
 * compact on desktop and hand above mid chrome for hit targets.
 */
describe('desktop hand hit-target CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('hand-area stacks above mid-zone and accepts pointer events', () => {
    expect(css).toMatch(/\.hand-area\s*\{[^}]*z-index:\s*14/s);
    expect(css).toMatch(/\.hand-area\s*\{[^}]*pointer-events:\s*auto/s);
  });

  it('mid-zone passes pointer events through empty space', () => {
    expect(css).toMatch(/\.table-mid-zone\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('cut fan re-enables pointer events under mid-zone none', () => {
    expect(css).toMatch(/\.cut-fan\s*\{[^}]*pointer-events:\s*auto/s);
  });

  it('fixed crib pile does not steal hand taps', () => {
    expect(css).toMatch(
      /\.fixed-crib-corner\s+\.dealer-crib-pile\s*\{[^}]*pointer-events:\s*none/s,
    );
  });

  it('desktop @900 keeps crib/starter compact vs large hand', () => {
    // Starter shrunk back toward phone compact sizes
    expect(css).toMatch(
      /\.fixed-starter-corner\s+\.card,\s*\n\s*\.table\.phase-pegging\s+\.starter-zone\s+\.card,\s*\n\s*\.mid-play-row\s+\.starter-zone\s+\.card\s*\{[^}]*width:\s*52px/s,
    );
    expect(css).toMatch(/\.crib-pile-stack,\s*\n\s*\.crib-empty-slot\s*\{[^}]*width:\s*44px/s);
    // Hand stays large (pass-2)
    expect(css).toMatch(
      /\.hand-area\s+\.hand-row\s*>\s*span\s+\.card,\s*\n\s*\.hand-area\s+\.hand-row\s*>\s*\.card\s*\{[^}]*width:\s*74px/s,
    );
  });
});
