import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: felt menu-lock `.app[class*="felt-"]:not(.app-playing) > *`
 * set position:relative on Splash, overriding position:fixed. On wide PC with
 * ZF felt equipped, the lockup was trapped in the narrow .app shell and ZF
 * side rails / portrait tiles showed outside. Splash must stay viewport-fixed;
 * stage must contain + no-repeat (never 100% 100% / repeat).
 */
describe('PC start / splash ZF tile lock', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('felt menu-lock child stacking excludes .splash-screen', () => {
    expect(css).toMatch(
      /\.app\[class\*="felt-"\]:not\(\.app-playing\)\s*>\s\*:not\(\.splash-screen\)\s*\{[^}]*position:\s*relative/s,
    );
    // Must not reintroduce the unscoped > * relative rule
    expect(css).not.toMatch(
      /\.app\[class\*="felt-"\]:not\(\.app-playing\)\s*>\s\*\s*\{[^}]*position:\s*relative/s,
    );
  });

  it('splash stays viewport-fixed when felt is equipped on .app', () => {
    expect(css).toMatch(
      /\.app\[class\*="felt-"\]:not\(\.app-playing\)\s*>\s*\.splash-screen[\s\S]*?position:\s*fixed/s,
    );
    expect(css).toMatch(/\.splash-screen\s*\{[^}]*position:\s*fixed/s);
  });

  it('splash-stage uses contain + no-repeat (no stretch / tile)', () => {
    expect(css).toMatch(
      /\.splash-stage\s*\{[^}]*background-repeat:\s*no-repeat[^}]*background-size:\s*contain/s,
    );
    expect(css).not.toMatch(/\.splash-stage\s*\{[^}]*background-size:\s*100%\s+100%/s);
  });
});
