import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: after Join live chat moved into .meta-leading, .meta z-index:32 +
 * taller header + mid-zone overflow-x:hidden (→ overflow-y:auto) buried /
 * clipped CutFan (waiting + both seats) and pegging COUNT under hand/header.
 */
describe('cut + COUNT visibility after side-chat header (CSS)', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('meta stays below mid-zone cut/count stacking', () => {
    // Property line (not a comment) — meta must be 12, not 32
    expect(css).toMatch(/^\.meta\s*\{[^}]*^\s*z-index:\s*12;/ms);
    expect(css).not.toMatch(/^\.meta\s*\{[^}]*^\s*z-index:\s*32;/ms);
  });

  it('cut + pegging mid-zone sit above hand (14) and use overflow visible', () => {
    expect(css).toMatch(
      /\.table\.phase-cut\s+\.table-mid-zone\s*\{[^}]*z-index:\s*18/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.table-mid-zone\s*\{[^}]*z-index:\s*18/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.table-mid-zone\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it('waiting/watch cut fans keep full opacity when disabled', () => {
    expect(css).toMatch(
      /\.cut-panel\.cut-watching\s+\.cut-fan\s+\.cut-card:disabled[^}]*opacity:\s*1/s,
    );
    expect(css).toMatch(
      /\.cut-fan\.cut-watching\s+\.cut-card:disabled[^}]*opacity:\s*1/s,
    );
  });

  it('cut-panel does not flex-shrink away', () => {
    expect(css).toMatch(/\.cut-panel\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it('Join live chat stays in meta-leading with its own high z', () => {
    expect(css).toMatch(/\.meta-leading\s*\{[^}]*z-index:\s*32/s);
    expect(css).toMatch(/\.table-side-live-chat\s*\{[^}]*z-index:\s*32/s);
  });
});
