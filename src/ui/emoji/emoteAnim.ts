/**
 * Shared frame-clip helpers for rail ReactEmoji + board EmoteFrameClip.
 */

import type { ReactEmojiAnimMeta } from './reactEmojis';
import { animMetaForReactEmojiId, artForReactEmojiId } from './reactEmojis';

/** Per-frame hold times; uses meta.frameDurationsMs when present, else equal split. */
export function frameDurationsForAnim(meta: ReactEmojiAnimMeta): number[] {
  const n = meta.frames.length;
  if (n === 0) return [];
  if (meta.frameDurationsMs && meta.frameDurationsMs.length === n) {
    return meta.frameDurationsMs.map((ms) => Math.max(0, Math.floor(ms)));
  }
  const step = Math.max(40, Math.floor(meta.durationMs / n));
  return Array.from({ length: n }, () => step);
}

/**
 * Drive a one-shot frame sequence with uneven holds.
 * Calls onFrame(i) for each frame index; onDone when the last hold finishes.
 * Returns a cancel function.
 */
export function playFrameClip(
  meta: ReactEmojiAnimMeta,
  onFrame: (index: number) => void,
  onDone?: () => void,
): () => void {
  const durations = frameDurationsForAnim(meta);
  const n = meta.frames.length;
  const timers: number[] = [];
  let cancelled = false;

  const clear = () => {
    cancelled = true;
    for (const t of timers) window.clearTimeout(t);
    timers.length = 0;
  };

  if (n === 0) {
    onDone?.();
    return clear;
  }

  onFrame(0);
  let elapsed = 0;
  for (let i = 1; i < n; i++) {
    elapsed += durations[i - 1] ?? 0;
    const idx = i;
    timers.push(
      window.setTimeout(() => {
        if (cancelled) return;
        onFrame(idx);
      }, elapsed),
    );
  }
  const total =
    durations.reduce((a, b) => a + b, 0) || meta.durationMs;
  timers.push(
    window.setTimeout(() => {
      if (cancelled) return;
      onDone?.();
    }, total),
  );

  return clear;
}

/** Warm image cache for anim frames (+ static art). Safe to call often. */
export function preloadReactEmojiFrames(id: string): void {
  if (typeof Image === 'undefined') return;
  const meta = animMetaForReactEmojiId(id);
  if (meta) {
    for (const url of meta.frames) {
      const img = new Image();
      img.src = url;
    }
  }
  const art = artForReactEmojiId(id);
  if (art) {
    const img = new Image();
    img.src = art;
  }
}
