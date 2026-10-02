import { describe, expect, it } from 'vitest';
import {
  rmsFromTimeDomain,
  speakingFromRms,
  VAD_DEFAULT_THRESHOLD,
  VAD_HANGOVER_MS,
} from '../voiceVad';

describe('voiceVad pure helpers', () => {
  it('rmsFromTimeDomain is 0 for silence (all 128)', () => {
    const silence = Uint8Array.from({ length: 64 }, () => 128);
    expect(rmsFromTimeDomain(silence)).toBe(0);
  });

  it('rmsFromTimeDomain rises with amplitude', () => {
    const quiet = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 130 : 126));
    const loud = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 200 : 56));
    expect(rmsFromTimeDomain(loud)).toBeGreaterThan(rmsFromTimeDomain(quiet));
    expect(rmsFromTimeDomain(loud)).toBeGreaterThan(VAD_DEFAULT_THRESHOLD);
  });

  it('speakingFromRms opens above threshold', () => {
    const r = speakingFromRms(0.1, 0.045, false, VAD_HANGOVER_MS, 1000, 0);
    expect(r.speaking).toBe(true);
    expect(r.lastSpokeAt).toBe(1000);
  });

  it('speakingFromRms stays quiet below threshold', () => {
    const r = speakingFromRms(0.01, 0.045, false, VAD_HANGOVER_MS, 1000, 0);
    expect(r.speaking).toBe(false);
  });

  it('speakingFromRms hangover keeps open briefly after drop', () => {
    const open = speakingFromRms(0.1, 0.045, false, 450, 1000, 0);
    expect(open.speaking).toBe(true);
    const hold = speakingFromRms(0.01, 0.045, true, 450, 1200, open.lastSpokeAt);
    expect(hold.speaking).toBe(true);
    const closed = speakingFromRms(0.01, 0.045, true, 450, 1600, open.lastSpokeAt);
    expect(closed.speaking).toBe(false);
  });

  it('empty buffer rms is 0', () => {
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0);
  });
});
