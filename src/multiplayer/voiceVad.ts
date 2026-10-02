/**
 * Voice-activity detection helpers for side live chat.
 * Pure RMS / hysteresis logic is unit-tested; the monitor uses AnalyserNode.
 */

/** Default RMS threshold on 8-bit time-domain data (0..1 scale after normalize). */
export const VAD_DEFAULT_THRESHOLD = 0.045;

/** Keep transmitting this long after speech drops (ms). */
export const VAD_HANGOVER_MS = 450;

/** Analyser FFT size for time-domain sampling. */
export const VAD_FFT_SIZE = 512;

/** How often to sample (ms). */
export const VAD_POLL_MS = 50;

/** RMS of Uint8Array time-domain samples (128-centered). */
export function rmsFromTimeDomain(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export interface VadSpeakingState {
  speaking: boolean;
  lastSpokeAt: number;
}

/**
 * Hysteresis: go live when rms >= threshold; stay live for hangoverMs after drop.
 */
export function speakingFromRms(
  rms: number,
  threshold: number,
  wasSpeaking: boolean,
  hangoverMs: number,
  now: number,
  lastSpokeAt: number,
): VadSpeakingState {
  if (rms >= threshold) {
    return { speaking: true, lastSpokeAt: now };
  }
  if (wasSpeaking && now - lastSpokeAt < hangoverMs) {
    return { speaking: true, lastSpokeAt };
  }
  return { speaking: false, lastSpokeAt };
}

export type VadSpeakingCallback = (speaking: boolean) => void;

/**
 * Safari requires AudioContext.resume() to happen inside a user gesture. Keep one
 * VAD context alive across lobby → table so the later monitor start does not
 * create a fresh suspended context after the Connect gesture has finished.
 */
let sharedVadContext: AudioContext | null = null;

function getVoiceAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!sharedVadContext || sharedVadContext.state === 'closed') {
    sharedVadContext = new AC();
  }
  return sharedVadContext;
}

/** Call synchronously from Connect (and later gestures/visibility) for Safari. */
export function unlockVoiceAudioContext(): void {
  const ctx = getVoiceAudioContext();
  if (!ctx || ctx.state !== 'suspended') return;
  void ctx.resume().catch((err) => {
    console.warn('voice VAD AudioContext resume()', err);
  });
}

/**
 * Polls an AnalyserNode on a local mic stream and reports speaking changes.
 * Does not touch WebRTC tracks — caller enables/disables the send track.
 */
export class VoiceActivityMonitor {
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf: Uint8Array | null = null;
  private speaking = false;
  private lastSpokeAt = 0;
  private disposed = false;
  private readonly onSpeaking: VadSpeakingCallback;
  private readonly threshold: number;
  private readonly hangoverMs: number;

  constructor(
    onSpeaking: VadSpeakingCallback,
    opts: { threshold?: number; hangoverMs?: number } = {},
  ) {
    this.onSpeaking = onSpeaking;
    this.threshold = opts.threshold ?? VAD_DEFAULT_THRESHOLD;
    this.hangoverMs = opts.hangoverMs ?? VAD_HANGOVER_MS;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Attach mic stream and start polling. Idempotent if already running. */
  start(stream: MediaStream): void {
    if (this.disposed) return;
    this.stopInternal(false);
    try {
      const ctx = getVoiceAudioContext();
      if (!ctx) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = VAD_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.4;
      this.analyser = analyser;
      this.buf = new Uint8Array(analyser.fftSize);
      const source = ctx.createMediaStreamSource(stream);
      this.source = source;
      source.connect(analyser);
      // Do not connect to destination — local monitor only (no echo loop).
      void ctx.resume().catch(() => {
        /* autoplay / gesture already used for getUserMedia */
      });
      this.timer = setInterval(() => this.tick(), VAD_POLL_MS);
    } catch (e) {
      console.warn('VAD start failed', e);
      this.stopInternal(false);
    }
  }

  private tick(): void {
    if (this.disposed || !this.analyser || !this.buf) return;
    this.analyser.getByteTimeDomainData(this.buf);
    const rms = rmsFromTimeDomain(this.buf);
    const now = Date.now();
    const next = speakingFromRms(
      rms,
      this.threshold,
      this.speaking,
      this.hangoverMs,
      now,
      this.lastSpokeAt,
    );
    this.lastSpokeAt = next.lastSpokeAt;
    if (next.speaking !== this.speaking) {
      this.speaking = next.speaking;
      this.onSpeaking(this.speaking);
    }
  }

  private stopInternal(emitQuiet: boolean): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.analyser = null;
    this.buf = null;
    // Shared context intentionally survives lobby → table. Closing it here
    // would discard the Safari gesture unlock before the next monitor mounts.
    if (emitQuiet && this.speaking) {
      this.speaking = false;
      this.onSpeaking(false);
    } else {
      this.speaking = false;
    }
  }

  stop(): void {
    this.stopInternal(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopInternal(true);
  }
}
