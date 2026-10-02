import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Josh: Show / count overlay must not show a vertical scrollbar.
 * Content fits via compact fans + overflow:hidden.
 */
describe('Show overlay no scrollbar CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('show-overlay uses overflow hidden (no visible scrollbar)', () => {
    expect(css).toMatch(
      /\.overlay-card\.show-overlay,\s*\n\.show-overlay\s*\{[^}]*overflow:\s*hidden/s,
    );
  });

  it('desktop show-overlay also overflow hidden', () => {
    const block = css.match(
      /@media\s*\(min-width:\s*900px\)\s*and\s*\(hover:\s*hover\)\s*\{[\s\S]*?\.overlay-card\.show-overlay\s*\{([^}]*)\}/,
    );
    expect(block?.[1] ?? '').toMatch(/overflow:\s*hidden/);
  });
});
