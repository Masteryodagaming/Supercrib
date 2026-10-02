import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: yellow COUNT kissed/overlapped the top of the player hand during
 * pegging. COUNT must sit clearly above the hand with a small gap, while the
 * count box keeps hug-content / grow (max-content) behavior.
 */
describe('COUNT above-hand gap CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('pegging mid-zone has extra bottom pad so COUNT clears the hand', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.table-mid-zone\s*\{[^}]*padding-bottom:\s*1\.55rem/s,
    );
  });

  it('pegging hand-area has extra top pad and no upward translate', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.hand-area\s*\{[^}]*transform:\s*none/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.hand-area\s*\{[^}]*padding-top:\s*0\.95rem/s,
    );
  });

  it('desktop @900 pegging keeps a clear COUNT↔hand gap', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.table-mid-zone\s*\{[^}]*padding-bottom:\s*1\.75rem/s,
    );
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.hand-area\s*\{[^}]*padding-top:\s*1\.15rem/s,
    );
  });

  it('tablet hover:none pegging does not crush the gap back to 0.35rem', () => {
    expect(css).toMatch(
      /Keep COUNT clearly above hand \(was 0\.35rem[^)]*\)[\s\S]*?padding-bottom:\s*1\.45rem/,
    );
  });

  it('keeps COUNT box hug-content / grow (max-content)', () => {
    expect(css).toMatch(
      /\.table\.phase-pegging\s+\.mid-play-row\s+\.play-area\.peg-active\s*\{[^}]*width:\s*max-content/s,
    );
  });
});
