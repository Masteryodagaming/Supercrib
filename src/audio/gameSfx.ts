/**
 * In-game SFX — prefer CC0 WAV samples under public/sfx/, with quiet synth
 * fallbacks if a sample fails to load. Gated by Settings `settings.sound`
 * (default on). Autoplay failures are quiet.
 *
 * Plain card play uses card WAVs only. Peg scoring (points > 0) plays a wood
 * tick plus a prize flourish scaled by points (named steps 2 / 4 / 6 / 12).
 *
 * Sources: OpenGameArt CC0 (BMacZero playing-card sounds; Wuzzy wooden dice).
 * See public/sfx/CREDITS.txt.
 */

export type GameSfxKind = 'shuffle' | 'deal' | 'card' | 'peg' | 'go' | 'win';

/** Named prize bands Josh specified (2 / 4 / 6 / 12). */
export type PegPrizeTier = 'none' | 'low' | 'mid' | 'big' | 'jackpot';

const MASTER_GAIN = 0.22;
/** Deal fly-ins slightly quieter than pegging card slaps. */
const DEAL_GAIN = 0.55;
const CARD_GAIN = 0.75;
const SHUFFLE_GAIN = 0.7;
const PEG_GAIN = 0.8;
/** Crib discard tap — quieter than pegging slap. */
const SELECT_GAIN = 0.42;
const SELECT_SOFT_GAIN = 0.28;
/** Ignore duplicate select cues within this window (multi-fire / retry). */
const SELECT_DEBOUNCE_MS = 50;

const WAV = {
  shuffle: ['/sfx/card_shuffle.wav', '/sfx/card_shuffle_bridge.wav'] as const,
  cardPlay: ['/sfx/card_play1.wav', '/sfx/card_play2.wav'] as const,
  cut: ['/sfx/card_cut.wav'] as const,
  peg: ['/sfx/peg_wood.wav', '/sfx/peg1.wav', '/sfx/peg2.wav', '/sfx/peg3.wav'] as const,
};

let enabled = true;
let ctx: AudioContext | null = null;
let unlockBound = false;
/** Shared white-noise buffer (1s) — sliced per synth cue. */
let noiseBuf: AudioBuffer | null = null;

const bufferCache = new Map<string, AudioBuffer | null>();
const loadPromises = new Map<string, Promise<AudioBuffer | null>>();
let prefetchStarted = false;
let shuffleAlt = 0;
let cardPlayAlt = 0;
let lastSelectAt = 0;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

function getNoise(c: AudioContext): AudioBuffer | null {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  try {
    const len = Math.max(1, Math.floor(c.sampleRate * 1.0));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  } catch {
    return null;
  }
}

function detachUnlockListeners(handler: () => void): void {
  if (typeof window === 'undefined') return;
  window.removeEventListener('pointerdown', handler);
  window.removeEventListener('pointerup', handler);
  window.removeEventListener('click', handler);
  window.removeEventListener('keydown', handler);
  window.removeEventListener('touchstart', handler);
  window.removeEventListener('touchend', handler);
}

/**
 * Gesture unlock — keep listening until AudioContext is actually running.
 * (Chrome: first event may fire while resume() is still pending / fails.)
 */
function bindUnlockListeners(): void {
  if (typeof window === 'undefined') return;
  // Already audible — nothing to bind. If ctx later suspends, prepare() rebinds.
  if (ctx && ctx.state === 'running') return;
  if (unlockBound) return;
  unlockBound = true;
  const onGesture = () => {
    unlockGameAudio();
    const c = getCtx();
    if (c && c.state === 'running') {
      detachUnlockListeners(onGesture);
      unlockBound = false; // allow re-bind if ctx later suspends
    }
  };
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('pointerup', onGesture, { passive: true });
  window.addEventListener('click', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  window.addEventListener('touchstart', onGesture, { passive: true });
  window.addEventListener('touchend', onGesture, { passive: true });
}

/** Resume context after a user gesture (browsers block autoplay). */
export function unlockGameAudio(): void {
  bindUnlockListeners();
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    void c.resume().catch(() => {
      /* autoplay policy — ignore */
    });
  }
  ensurePrefetch();
}

/** Wire Settings `settings.sound` (default true). */
export function setSoundEnabled(on: boolean): void {
  enabled = on !== false;
  if (enabled) {
    bindUnlockListeners();
    ensurePrefetch();
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/**
 * Run `fn` only once AudioContext is running (resume-then-play).
 * Fixes desktop Chrome silence when play* raced unlock before resume settled.
 */
function withRunningCtx(fn: (c: AudioContext) => void): void {
  if (!enabled) return;
  bindUnlockListeners();
  const c = getCtx();
  if (!c) return;
  ensurePrefetch();
  const run = () => {
    if (!enabled) return;
    try {
      fn(c);
    } catch {
      /* ignore autoplay / closed */
    }
  };
  if (c.state === 'running') {
    run();
    return;
  }
  void c
    .resume()
    .then(() => {
      if (c.state === 'running') run();
    })
    .catch(() => {
      /* still blocked — wait for next gesture */
    });
}

function masterOut(c: AudioContext, gain = MASTER_GAIN): GainNode {
  const master = c.createGain();
  master.gain.value = gain;
  master.connect(c.destination);
  return master;
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(url)) return bufferCache.get(url) ?? null;
  const existing = loadPromises.get(url);
  if (existing) return existing;

  const p = (async () => {
    const c = getCtx();
    if (!c || typeof fetch === 'undefined') {
      bufferCache.set(url, null);
      return null;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) {
        bufferCache.set(url, null);
        return null;
      }
      const arr = await res.arrayBuffer();
      const buf = await c.decodeAudioData(arr.slice(0));
      bufferCache.set(url, buf);
      return buf;
    } catch {
      bufferCache.set(url, null);
      return null;
    } finally {
      loadPromises.delete(url);
    }
  })();

  loadPromises.set(url, p);
  return p;
}

function ensurePrefetch(): void {
  if (prefetchStarted || typeof window === 'undefined') return;
  if (!enabled) return;
  prefetchStarted = true;
  const urls = [...WAV.shuffle, ...WAV.cardPlay, ...WAV.cut, ...WAV.peg];
  for (const u of urls) void loadBuffer(u);
}

function playBuffer(c: AudioContext, buf: AudioBuffer, gain: number): void {
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = Math.max(0.0001, gain);
  src.connect(g);
  g.connect(c.destination);
  try {
    src.start(0);
  } catch {
    /* ignore */
  }
}

/** Soft exponential envelope (avoids 0 for exp ramps). */
function env(
  g: AudioParam,
  start: number,
  peak: number,
  attack: number,
  dur: number,
): void {
  const p = Math.max(0.0001, peak);
  g.cancelScheduledValues(start);
  g.setValueAtTime(0.0001, start);
  g.exponentialRampToValueAtTime(p, start + Math.max(0.001, attack));
  g.exponentialRampToValueAtTime(0.0001, start + Math.max(attack + 0.01, dur));
}

function noiseBurst(
  c: AudioContext,
  dest: AudioNode,
  start: number,
  opts: {
    dur: number;
    gain: number;
    type?: BiquadFilterType;
    freq?: number;
    Q?: number;
    playbackRate?: number;
  },
): void {
  const buf = getNoise(c);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.playbackRate ?? 1;
  const filter = c.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.value = opts.freq ?? 2000;
  filter.Q.value = opts.Q ?? 1.2;
  const g = c.createGain();
  env(g.gain, start, opts.gain, 0.004, opts.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  const offset = Math.random() * 0.7;
  try {
    src.start(start, offset, opts.dur + 0.03);
    src.stop(start + opts.dur + 0.04);
  } catch {
    /* ignore */
  }
}

function tone(
  c: AudioContext,
  dest: AudioNode,
  start: number,
  opts: {
    freq: number;
    dur: number;
    type?: OscillatorType;
    gain: number;
    attack?: number;
  },
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = opts.freq;
  env(g.gain, start, opts.gain, opts.attack ?? 0.006, opts.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + opts.dur + 0.03);
}

/** Rapid card-riffle / shuffle rustle (fallback). */
function synthShuffle(c: AudioContext): void {
  const out = masterOut(c, MASTER_GAIN * 0.85);
  const now = c.currentTime;
  for (let i = 0; i < 7; i++) {
    const t = now + i * 0.038 + Math.random() * 0.012;
    noiseBurst(c, out, t, {
      dur: 0.045 + Math.random() * 0.02,
      gain: 0.55 + Math.random() * 0.2,
      type: 'bandpass',
      freq: 1400 + Math.random() * 2200,
      Q: 0.7 + Math.random() * 0.6,
      playbackRate: 0.9 + Math.random() * 0.4,
    });
    noiseBurst(c, out, t + 0.008, {
      dur: 0.055,
      gain: 0.22,
      type: 'highpass',
      freq: 600 + Math.random() * 400,
      Q: 0.5,
    });
  }
}

/** Quiet cardboard slap fallback (no metallic / coin / plink). */
function synthCard(c: AudioContext, variant: 'deal' | 'play'): void {
  const out = masterOut(c, MASTER_GAIN * 0.5);
  const now = c.currentTime;
  const play = variant === 'play';

  // Soft mid rustle — cardboard contact, not a bright ping
  noiseBurst(c, out, now, {
    dur: play ? 0.05 : 0.042,
    gain: play ? 0.45 : 0.36,
    type: 'bandpass',
    freq: (play ? 1100 : 900) + Math.random() * 400,
    Q: 0.8,
    playbackRate: 0.85 + Math.random() * 0.2,
  });
  // Low thump (table) — keep quiet; never a high metallic tick
  tone(c, out, now, {
    freq: 70 + Math.random() * 25,
    dur: 0.055,
    type: 'triangle',
    gain: play ? 0.2 : 0.16,
    attack: 0.004,
  });
}

/** Wood peg tick (fallback). */
function synthPeg(c: AudioContext): void {
  const out = masterOut(c, MASTER_GAIN * 0.85);
  const now = c.currentTime;

  noiseBurst(c, out, now, {
    dur: 0.022,
    gain: 0.85,
    type: 'bandpass',
    freq: 2400 + Math.random() * 800,
    Q: 2.2,
    playbackRate: 1.4,
  });
  noiseBurst(c, out, now + 0.001, {
    dur: 0.04,
    gain: 0.45,
    type: 'bandpass',
    freq: 780 + Math.random() * 120,
    Q: 3.5,
  });
  tone(c, out, now, {
    freq: 210 + Math.random() * 30,
    dur: 0.07,
    type: 'triangle',
    gain: 0.5,
    attack: 0.002,
  });
  tone(c, out, now + 0.004, {
    freq: 420 + Math.random() * 40,
    dur: 0.045,
    type: 'sine',
    gain: 0.22,
    attack: 0.002,
  });
}

/**
 * Continuous grandeur 0..4 for prize scaling.
 * Clear steps at Josh's named points: 2→1, 4→2, 6→3, 12→4 (jackpot).
 */
export function pegGrandeur(points: number): number {
  const p = Math.max(0, Number(points) || 0);
  if (p <= 0) return 0;
  if (p <= 1) return 0.55; // quieter than 2pt low
  if (p === 2) return 1; // low
  if (p === 3) return 1.5; // between low & mid
  if (p === 4) return 2; // mid / bigger
  if (p === 5) return 2.5; // near mid–big
  if (p === 6) return 3; // big
  if (p >= 12) return 4; // jackpot
  // 7–11: ramp big → jackpot
  return 3 + (p - 6) / 6;
}

/** Discrete named band for UI/tests (nearest Josh step). */
export function pegPrizeTier(points: number): PegPrizeTier {
  const g = pegGrandeur(points);
  if (g <= 0) return 'none';
  if (g < 1.5) return 'low';
  if (g < 2.5) return 'mid';
  if (g < 3.5) return 'big';
  return 'jackpot';
}

/**
 * Prize / reward flourish layered on scoring pegs.
 * Rising arpeggio + chord stack; note count / brightness / length scale with grandeur.
 */
function synthPegPrize(c: AudioContext, points: number): void {
  const gLevel = pegGrandeur(points);
  if (gLevel <= 0) return;

  const out = masterOut(c, MASTER_GAIN * (0.55 + gLevel * 0.12));
  const now = c.currentTime;
  // Major-ish sparkle ladder (C5 E5 G5 C6 E6 G6)
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
  const noteCount =
    gLevel < 1.5 ? 1 : gLevel < 2.5 ? 2 : gLevel < 3.5 ? 4 : 6;
  const step = gLevel >= 3.5 ? 0.055 : gLevel >= 2.5 ? 0.06 : 0.07;
  const noteDur = 0.1 + gLevel * 0.035;
  const baseGain = 0.22 + gLevel * 0.08;

  for (let i = 0; i < noteCount; i++) {
    const t = now + 0.018 + i * step;
    const freq = notes[Math.min(i, notes.length - 1)];
    tone(c, out, t, {
      freq,
      dur: noteDur,
      type: 'sine',
      gain: baseGain * (1 - i * 0.06),
      attack: 0.008,
    });
    if (gLevel >= 2) {
      tone(c, out, t + 0.004, {
        freq: freq * 2,
        dur: noteDur * 0.7,
        type: 'triangle',
        gain: baseGain * 0.28,
        attack: 0.006,
      });
    }
  }

  // Sustained chord stack at mid+ tiers
  if (gLevel >= 2) {
    const chordT = now + 0.02;
    const chordGain = 0.12 + gLevel * 0.04;
    const chordDur = 0.22 + gLevel * 0.06;
    for (const f of [523.25, 659.25, 783.99]) {
      tone(c, out, chordT, {
        freq: f,
        dur: chordDur,
        type: 'sine',
        gain: chordGain,
        attack: 0.02,
      });
    }
  }

  // Jackpot: extra high sparkle + low whoosh body
  if (gLevel >= 3.5) {
    tone(c, out, now + 0.28, {
      freq: 2093,
      dur: 0.22,
      type: 'sine',
      gain: 0.28,
      attack: 0.01,
    });
    tone(c, out, now + 0.32, {
      freq: 2637,
      dur: 0.18,
      type: 'triangle',
      gain: 0.16,
      attack: 0.01,
    });
    noiseBurst(c, out, now + 0.01, {
      dur: 0.12,
      gain: 0.2,
      type: 'highpass',
      freq: 4000,
      Q: 0.6,
    });
  }
}

function synthGo(c: AudioContext): void {
  const out = masterOut(c);
  const now = c.currentTime;
  tone(c, out, now, { freq: 280, dur: 0.14, type: 'sine', gain: 0.5 });
  tone(c, out, now + 0.02, { freq: 420, dur: 0.12, type: 'sine', gain: 0.35 });
}

function synthWin(c: AudioContext): void {
  const out = masterOut(c);
  const now = c.currentTime;
  tone(c, out, now, { freq: 523.25, dur: 0.28, type: 'sine', gain: 0.55 });
  tone(c, out, now + 0.02, { freq: 659.25, dur: 0.25, type: 'sine', gain: 0.4 });
  tone(c, out, now + 0.12, { freq: 783.99, dur: 0.2, type: 'sine', gain: 0.35 });
}

/**
 * Play sample when warm; otherwise wait for decode then play (no double synth).
 * Uses withRunningCtx so desktop Chrome hears audio after gesture+resume.
 */
function playSamplePreferWav(
  urls: readonly string[],
  gain: number,
  fallback: (c: AudioContext) => void,
  preferred?: string,
): void {
  withRunningCtx((c) => {
    const primary = preferred ?? urls[0];
    if (!primary) {
      fallback(c);
      return;
    }

    const cached = bufferCache.get(primary);
    if (cached) {
      playBuffer(c, cached, MASTER_GAIN * gain);
      return;
    }

    const finish = (buf: AudioBuffer | null) => {
      withRunningCtx((c2) => {
        if (buf) {
          playBuffer(c2, buf, MASTER_GAIN * gain);
          return;
        }
        for (const u of urls) {
          if (u === primary) continue;
          const hit = bufferCache.get(u);
          if (hit) {
            playBuffer(c2, hit, MASTER_GAIN * gain);
            return;
          }
        }
        fallback(c2);
      });
    };

    if (cached === null) {
      void (async () => {
        for (const u of urls) {
          if (u === primary) continue;
          const b = await loadBuffer(u);
          if (b) {
            finish(b);
            return;
          }
        }
        finish(null);
      })();
      return;
    }

    void loadBuffer(primary).then(finish);
  });
}

export function playShuffle(): void {
  const i = shuffleAlt % WAV.shuffle.length;
  shuffleAlt += 1;
  playSamplePreferWav(WAV.shuffle, SHUFFLE_GAIN, synthShuffle, WAV.shuffle[i]);
}

export function playDeal(): void {
  const i = cardPlayAlt % WAV.cardPlay.length;
  cardPlayAlt += 1;
  playSamplePreferWav(WAV.cardPlay, DEAL_GAIN, (c) => synthCard(c, 'deal'), WAV.cardPlay[i]);
}

/** Card slap WAV only (cardboard on table). No peg wood / prize / metallic. */
export function playCard(): void {
  const i = cardPlayAlt % WAV.cardPlay.length;
  cardPlayAlt += 1;
  playSamplePreferWav(WAV.cardPlay, CARD_GAIN, (c) => synthCard(c, 'play'), WAV.cardPlay[i]);
}

/**
 * Peg wood tick + optional prize. Call only for scoring peg points — not on
 * plain card plays. When `points` > 0, layers prize flourish (2/4/6/12 tiers).
 */
export function playPeg(points = 0): void {
  const i = Math.floor(Math.random() * WAV.peg.length);
  playSamplePreferWav(WAV.peg, PEG_GAIN, synthPeg, WAV.peg[i]);
  const pts = Math.max(0, Number(points) || 0);
  if (pts > 0) {
    withRunningCtx((c) => {
      synthPegPrize(c, pts);
    });
  }
}

export function playGo(): void {
  withRunningCtx((c) => {
    synthGo(c);
  });
}

export function playWin(): void {
  withRunningCtx((c) => {
    synthWin(c);
  });
}

export function playGameSfx(kind: GameSfxKind): void {
  switch (kind) {
    case 'shuffle':
      playShuffle();
      break;
    case 'deal':
      playDeal();
      break;
    case 'card':
      playCard();
      break;
    case 'peg':
      playPeg();
      break;
    case 'go':
      playGo();
      break;
    case 'win':
      playWin();
      break;
  }
}

/**
 * Card cut cue — card_cut.wav (same family as card slap). Falls back to
 * card_play*.wav then quiet cardboard synth. One clear cue per cut event.
 */
export function playCut(): void {
  playSamplePreferWav(
    [...WAV.cut, ...WAV.cardPlay],
    0.65,
    (c) => synthCard(c, 'play'),
    WAV.cut[0],
  );
}

/**
 * Soft card tap for crib discard select/deselect (hand toggle-select).
 * Prefer card_cut.wav quieter, else card_play*.wav, else soft deal synth.
 * `soft` = deselect (quieter). Debounced so multi-fire / online retry does not spam.
 * Not peg wood, not prize/coin.
 */
export function playCardSelect(soft = false): void {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  if (now - lastSelectAt < SELECT_DEBOUNCE_MS) return;
  lastSelectAt = now;
  const gain = soft ? SELECT_SOFT_GAIN : SELECT_GAIN;
  playSamplePreferWav(
    [...WAV.cut, ...WAV.cardPlay],
    gain,
    (c) => synthCard(c, 'deal'),
    WAV.cut[0],
  );
}

/** Test helpers — reset module state between vitest cases. */
export function __resetGameSfxForTests(): void {
  enabled = true;
  ctx = null;
  unlockBound = false;
  noiseBuf = null;
  bufferCache.clear();
  loadPromises.clear();
  prefetchStarted = false;
  shuffleAlt = 0;
  cardPlayAlt = 0;
  lastSelectAt = 0;
}
