import { useEffect, useState } from 'react';
import {
  animMetaForReactEmojiId,
  artForReactEmojiId,
  glyphForReactEmojiId,
  isTextRailEmoji,
  type ReactEmojiId,
} from './reactEmojis';
import { playFrameClip, preloadReactEmojiFrames } from './emoteAnim';

export interface EmoteFrameClipProps {
  reactId: ReactEmojiId;
  /** Fallback glyph when no art / anim. */
  emoji?: string;
  className?: string;
  width?: number;
  height?: number;
}

/**
 * Non-button display clip for board pops / previews.
 * On mount: preload + play anim frames once (uneven holds when meta has them),
 * then hold the last frame (or static art) until unmounted.
 */
export function EmoteFrameClip({
  reactId,
  emoji,
  className = '',
  width = 112,
  height = 112,
}: EmoteFrameClipProps) {
  const art = artForReactEmojiId(reactId);
  const textMode = isTextRailEmoji(reactId);
  const [src, setSrc] = useState<string | null>(() => {
    const meta = animMetaForReactEmojiId(reactId);
    return meta?.frames[0] ?? art;
  });

  useEffect(() => {
    preloadReactEmojiFrames(reactId);
  }, [reactId]);

  useEffect(() => {
    const meta = animMetaForReactEmojiId(reactId);
    const staticArt = artForReactEmojiId(reactId);
    if (!meta || meta.frames.length === 0) {
      setSrc(staticArt);
      return;
    }
    setSrc(meta.frames[0]);
    const cancel = playFrameClip(
      meta,
      (i) => {
        const url = meta.frames[i];
        if (url) setSrc(url);
      },
      () => {
        // Hold last frame until unmount (POP_MS); fall back to static art.
        const last = meta.frames[meta.frames.length - 1] ?? null;
        setSrc(last ?? staticArt);
      },
    );
    return cancel;
  }, [reactId]);

  if (textMode) {
    return <span className={`reaction-pop-text ${className}`.trim()}>good luck</span>;
  }

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`reaction-pop-art ${className}`.trim()}
        width={width}
        height={height}
        draggable={false}
      />
    );
  }

  return (
    <span className={`reaction-pop-fallback ${className}`.trim()}>
      {emoji ?? glyphForReactEmojiId(reactId)}
    </span>
  );
}
