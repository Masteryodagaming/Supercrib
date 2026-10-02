import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression: Join live chat sat bottom-left over hand cards — visible but
 * untappable on iPhone (hand stole hits). Also missing on wide desktop play.
 * Control must live in header/.meta-leading near Quit, clear of hand, with
 * a comfortable phone tap target and pointer-events above felt overlays.
 */
describe('side live chat hit-target / header placement CSS', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('anchors control in meta-leading (not absolute bottom over hand)', () => {
    expect(css).toMatch(/\.meta-leading\s*\{[^}]*z-index:\s*32/s);
    expect(css).toMatch(/\.meta-leading\s*\{[^}]*pointer-events:\s*auto/s);
    expect(css).toMatch(
      /\.table-side-live-chat\s*\{[^}]*position:\s*relative/s,
    );
    // Must not reintroduce bottom-over-hand placement
    expect(css).not.toMatch(
      /\.table-side-live-chat\s*\{[^}]*bottom:\s*[0-9.]+rem/s,
    );
  });

  it('keeps high z-index + pointer-events on the control and join button', () => {
    expect(css).toMatch(/\.table-side-live-chat\s*\{[^}]*z-index:\s*32/s);
    expect(css).toMatch(
      /\.table-side-live-chat\s*\{[^}]*pointer-events:\s*auto/s,
    );
    expect(css).toMatch(
      /\.side-live-chat-btn\s*\{[^}]*pointer-events:\s*auto/s,
    );
    expect(css).toMatch(
      /\.side-live-chat-btn\s*\{[^}]*min-height:\s*36px/s,
    );
  });

  it('meta chrome stays visible; chat control keeps high z, meta stays below CutFan/COUNT', () => {
    expect(css).toMatch(/\.meta\s*\{[^}]*overflow:\s*visible/s);
    // Meta itself must stay below mid-zone cut/count (18) — was 32 and buried them
    expect(css).toMatch(/\.meta\s*\{[^}]*z-index:\s*12/s);
    expect(css).toMatch(/\.meta-leading\s*\{[^}]*z-index:\s*32/s);
  });
});
