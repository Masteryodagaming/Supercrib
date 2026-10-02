import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetGameSfxForTests,
  isSoundEnabled,
  pegGrandeur,
  pegPrizeTier,
  playCard,
  playCardSelect,
  playCut,
  playDeal,
  playGameSfx,
  playGo,
  playPeg,
  playShuffle,
  playWin,
  setSoundEnabled,
} from '../gameSfx';

class FakeOscillator {
  type = 'sine';
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class FakeBiquadFilter {
  type = 'bandpass';
  frequency = { value: 0 };
  Q = { value: 0 };
  connect = vi.fn();
}

class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  createOscillator() {
    return new FakeOscillator() as unknown as OscillatorNode;
  }
  createGain() {
    return new FakeGain() as unknown as GainNode;
  }
  createBiquadFilter() {
    return new FakeBiquadFilter() as unknown as BiquadFilterNode;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      sampleRate,
      length,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
  }
  createBufferSource() {
    return new FakeBufferSource() as unknown as AudioBufferSourceNode;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

/** Minimal window stub for node vitest (no jsdom). */
function ensureWindowStub(): void {
  const g = globalThis as unknown as {
    window?: {
      AudioContext?: unknown;
      webkitAudioContext?: unknown;
      addEventListener?: (...a: unknown[]) => void;
      removeEventListener?: (...a: unknown[]) => void;
    };
  };
  if (!g.window) {
    g.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }
}

describe('gameSfx', () => {
  beforeEach(() => {
    __resetGameSfxForTests();
    ensureWindowStub();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', {
      ...((globalThis as { window?: object }).window ?? {}),
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetGameSfxForTests();
  });

  it('defaults to sound enabled', () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it('setSoundEnabled(false) mutes subsequent plays without throwing', () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(() => {
      playShuffle();
      playDeal();
      playCard();
      playCardSelect();
      playCardSelect(true);
      playPeg();
      playGo();
      playWin();
      playGameSfx('deal');
      playGameSfx('shuffle');
      playGameSfx('card');
    }).not.toThrow();
  });

  it('setSoundEnabled(true) restores playback path', () => {
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(() => playPeg()).not.toThrow();
  });

  it('play kinds are quiet no-ops when AudioContext is missing', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      webkitAudioContext: undefined,
    });
    __resetGameSfxForTests();
    setSoundEnabled(true);
    expect(() => {
      playShuffle();
      playDeal();
      playCard();
      playPeg();
      playGo();
      playWin();
    }).not.toThrow();
  });

  it('does not throw when oscillator graph throws (autoplay / closed)', () => {
    class BrokenCtx extends FakeAudioContext {
      createOscillator(): OscillatorNode {
        throw new Error('NotAllowedError');
      }
    }
    vi.stubGlobal('AudioContext', BrokenCtx);
    vi.stubGlobal('window', {
      AudioContext: BrokenCtx,
      webkitAudioContext: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    __resetGameSfxForTests();
    setSoundEnabled(true);
    expect(() => playWin()).not.toThrow();
  });

  it('card / shuffle / peg synth paths do not throw with FakeAudioContext', () => {
    setSoundEnabled(true);
    expect(() => {
      playShuffle();
      playDeal();
      playCard();
      playPeg();
    }).not.toThrow();
  });

  it('playCard path never schedules prize oscillators when WAV cache empty (cardboard fallback only)', async () => {
    const oscStarts: number[] = [];
    class CountOsc extends FakeAudioContext {
      createOscillator() {
        const o = new FakeOscillator();
        const orig = o.start;
        o.start = vi.fn((...a: unknown[]) => {
          oscStarts.push(1);
          return (orig as (...args: unknown[]) => unknown)(...a);
        });
        return o as unknown as OscillatorNode;
      }
    }
    vi.stubGlobal('AudioContext', CountOsc);
    vi.stubGlobal('window', {
      AudioContext: CountOsc,
      webkitAudioContext: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );
    __resetGameSfxForTests();
    setSoundEnabled(true);
    // WAV miss → synthCard fallback (noise + one low triangle). No prize arpeggio.
    playCard();
    await new Promise((r) => setTimeout(r, 30));
    // synthCard uses 1 tone; prize arpeggio would fire many oscillators.
    expect(oscStarts.length).toBeLessThanOrEqual(2);
    expect(oscStarts.length).toBeGreaterThanOrEqual(1);
  });

  it('playCut does not throw when muted or with FakeAudioContext', () => {
    setSoundEnabled(false);
    expect(() => playCut()).not.toThrow();
    setSoundEnabled(true);
    expect(() => playCut()).not.toThrow();
  });

  it('playCardSelect does not throw when muted or with FakeAudioContext', () => {
    setSoundEnabled(false);
    expect(() => playCardSelect()).not.toThrow();
    expect(() => playCardSelect(true)).not.toThrow();
    setSoundEnabled(true);
    expect(() => playCardSelect()).not.toThrow();
    expect(() => playCardSelect(true)).not.toThrow();
  });

  it('playCardSelect debounce suppresses rapid multi-fire without throwing', async () => {
    setSoundEnabled(true);
    expect(() => {
      playCardSelect();
      playCardSelect();
      playCardSelect(true);
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 60));
    expect(() => playCardSelect()).not.toThrow();
  });

});

describe('peg prize tiers', () => {
  beforeEach(() => {
    __resetGameSfxForTests();
    ensureWindowStub();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', {
      ...((globalThis as { window?: object }).window ?? {}),
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetGameSfxForTests();
  });

  it('maps named steps 2/4/6/12 to low/mid/big/jackpot', () => {
    expect(pegPrizeTier(0)).toBe('none');
    expect(pegPrizeTier(2)).toBe('low');
    expect(pegPrizeTier(4)).toBe('mid');
    expect(pegPrizeTier(6)).toBe('big');
    expect(pegPrizeTier(12)).toBe('jackpot');
    expect(pegGrandeur(2)).toBe(1);
    expect(pegGrandeur(4)).toBe(2);
    expect(pegGrandeur(6)).toBe(3);
    expect(pegGrandeur(12)).toBe(4);
  });

  it('nearby scores sit between named bands', () => {
    expect(pegGrandeur(1)).toBeLessThan(pegGrandeur(2));
    expect(pegGrandeur(3)).toBeGreaterThan(pegGrandeur(2));
    expect(pegGrandeur(3)).toBeLessThan(pegGrandeur(4));
    expect(pegGrandeur(5)).toBeGreaterThan(pegGrandeur(4));
    expect(pegGrandeur(5)).toBeLessThan(pegGrandeur(6));
    expect(pegGrandeur(8)).toBeGreaterThan(pegGrandeur(6));
    expect(pegGrandeur(8)).toBeLessThan(pegGrandeur(12));
    expect(pegPrizeTier(1)).toBe('low');
    expect(pegPrizeTier(3)).toBe('mid');
    expect(pegPrizeTier(5)).toBe('big');
    expect(pegPrizeTier(9)).toBe('jackpot'); // mid ramp (7–11)
    expect(pegPrizeTier(15)).toBe('jackpot');
  });

  it('playPeg(points) does not throw for scoring tiers', () => {
    setSoundEnabled(true);
    expect(() => {
      playPeg(0);
      playPeg(2);
      playPeg(4);
      playPeg(6);
      playPeg(12);
    }).not.toThrow();
  });
});
