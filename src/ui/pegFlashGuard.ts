import type { PegFlash } from '../engine/supercrib';

/**
 * Sticky peg-score callout is suppressed when 31 is announced by the
 * full-screen banner — avoids double +2 (callout + banner).
 * Compound 15/pair/run+31 totals belong on the banner only.
 */
export function shouldShowPegScoreCallout(flash: PegFlash): boolean {
  return !flash.events.some((e) => e.kind === 'thirtyone');
}
