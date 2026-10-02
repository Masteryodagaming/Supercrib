import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: pass-2 desktop --board-w (up to 560–620) left no vertical room
 * for Competitive claim keypad + Confirm in browser mode. Pass-3 modestly
 * shrinks the plank and keeps the claim overlay viewport-visible.
 */
describe('desktop count/claim window CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('desktop @900 board is modest (not pass-2 560 cap)', () => {
    expect(css).toMatch(/--board-w:\s*clamp\(340px,\s*36vw,\s*480px\)/);
    expect(css).not.toMatch(/--board-w:\s*clamp\(380px,\s*42vw,\s*560px\)/);
  });

  it('desktop @1100 board is modest (not pass-2 620 cap)', () => {
    expect(css).toMatch(/--board-w:\s*clamp\(380px,\s*34vw,\s*540px\)/);
    expect(css).not.toMatch(/--board-w:\s*clamp\(420px,\s*40vw,\s*620px\)/);
  });

  it('short desktop height-aware clamp leaves room for claim UI', () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*900px\)\s*and\s*\(max-height:\s*920px\)/,
    );
    expect(css).toMatch(/--board-w:\s*clamp\(240px,\s*32vh,\s*360px\)/);
  });

  it('desktop hover claim overlay is viewport-fixed above board', () => {
    expect(css).toMatch(
      /\.table\s*>\s*\.overlay:has\(\.show-overlay\)\s*\{[^}]*position:\s*fixed/s,
    );
    expect(css).toMatch(
      /\.table\s*>\s*\.overlay:has\(\.show-overlay\)\s*\{[^}]*z-index:\s*40/s,
    );
  });

  it('short desktop uses compact claim keypad', () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*900px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(max-height:\s*900px\)/,
    );
    expect(css).toMatch(
      /\.claim-keypad\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*2\.15rem\)/s,
    );
  });

  it('keeps hand hit-target stacking from HAND_HIT_TARGET fix', () => {
    expect(css).toMatch(/\.hand-area\s*\{[^}]*z-index:\s*14/s);
    expect(css).toMatch(/\.table-mid-zone\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('does not revert PC splash ZF contain / menu-lock exclusion', () => {
    // pcStartSplash.css.test.ts owns full splash coverage; sanity-check only.
    expect(css).toMatch(
      /\.splash-stage\s*\{[^}]*background-size:\s*contain/s,
    );
    expect(css).toMatch(
      /\.app\[class\*="felt-"\]:not\(\.app-playing\)\s*>\s\*:not\(\.splash-screen\)/,
    );
  });

  it('keeps Approve/Adjust review-actions sticky (not clipped by overflow:hidden)', () => {
    expect(css).toMatch(
      /\.overlay-card\.show-overlay\s*\.review-actions[^}]*position:\s*sticky/s,
    );
    expect(css).toMatch(
      /\.overlay-card\.show-overlay:has\(\.review-actions\)/,
    );
  });
});
