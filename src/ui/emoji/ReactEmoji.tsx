import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  type ReactEmojiId,
  type DefaultReactEmojiId,
  animMetaForReactEmojiId,
  artForReactEmojiId,
  glyphForReactEmojiId,
  isDefaultReactEmojiId,
  isTextRailEmoji,
  labelForReactEmojiId,
} from './reactEmojis';
import { playFrameClip, preloadReactEmojiFrames } from './emoteAnim';

export interface ReactEmojiProps {
  id: ReactEmojiId;
  /** Called after press animation kicks off — same payload as today’s rail (glyph string). */
  onSend?: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
  /** Optional override glyph (defaults from catalog). */
  glyph?: string;
  label?: string;
  /**
   * `send` (default): play clip then call onSend.
   * `preview`: play the same clip without calling onSend (Settings collection).
   */
  mode?: 'send' | 'preview';
  /** Play the clip once when mounted (Settings big preview modal). Tap still replays. */
  autoPlayOnMount?: boolean;
}

type BurstKind = string;

/**
 * Pressable reaction — per-id character action when art/bursts exist;
 * store stubs fall back to glyph text safely.
 */
export function ReactEmoji({
  id,
  onSend,
  disabled = false,
  className = '',
  glyph,
  label,
  mode = 'send',
  autoPlayOnMount = false,
}: ReactEmojiProps) {
  const emoji = glyph ?? glyphForReactEmojiId(id);
  const art = artForReactEmojiId(id);
  const animMeta = animMetaForReactEmojiId(id);
  const textMode = isTextRailEmoji(id);
  const aria = label ?? labelForReactEmojiId(id);
  const [pressing, setPressing] = useState(false);
  const [burst, setBurst] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const busyRef = useRef(false);
  const cancelClipRef = useRef<(() => void) | null>(null);

  const clearFrameTimer = useCallback(() => {
    if (cancelClipRef.current) {
      cancelClipRef.current();
      cancelClipRef.current = null;
    }
  }, []);

  useEffect(() => () => clearFrameTimer(), [clearFrameTimer]);

  // Warm first-tap frames (esp. mad_finger) when the rail button mounts.
  useEffect(() => {
    preloadReactEmojiFrames(id);
  }, [id]);

  const haptic = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        const pattern =
          id === 'laugh'
            ? [8, 20, 8, 20, 8, 20, 12]
            : id === 'cry'
              ? [18, 40, 18]
              : id === 'skunk'
                ? [10, 30, 40]
                : id === 'angry'
                  ? [25, 15, 25, 15, 30]
                  : id === 'mad_finger'
                    ? [20, 25, 35]
                    : id === 'trash_toss'
                      ? [15, 25, 40]
                      : id === 'ace_spade'
                        ? [15, 25, 40]
                        : id === 'grandma_peggy'
                          ? [15, 25, 40]
                          : id === 'mad_father'
                            ? [15, 25, 40]
                            : [12, 28, 16];
        navigator.vibrate(pattern);
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  const playClip = useCallback(() => {
    const meta = animMetaForReactEmojiId(id);
    const durationMs =
      meta?.durationMs ??
      (id === 'laugh' || id === 'cry' || id === 'skunk' ? 1100 : id === 'mad_finger' ? 1100 : id === 'trash_toss' ? 1710 : id === 'ace_spade' || id === 'grandma_peggy' || id === 'mad_father' ? 2100 : 900);
    const burstMs = Math.max(
      durationMs,
      id === 'skunk' || id === 'cry' ? 1200 : 1000,
    );

    setPressing(true);
    setBurst(true);
    haptic();

    clearFrameTimer();
    setFrameIdx(0);
    if (meta && meta.frames.length > 0) {
      cancelClipRef.current = playFrameClip(meta, (i) => setFrameIdx(i));
    }

    window.setTimeout(() => {
      setPressing(false);
      setFrameIdx(0);
      clearFrameTimer();
    }, durationMs);
    window.setTimeout(() => {
      setBurst(false);
      busyRef.current = false;
    }, burstMs);
  }, [clearFrameTimer, haptic, id]);

  const onPress = useCallback(() => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    const rot = (Math.random() * 18 - 9).toFixed(1);
    setTilt(Number(rot));
    playClip();
    if (mode === 'send') {
      onSend?.(emoji);
    }
  }, [disabled, emoji, mode, onSend, playClip]);

  useEffect(() => {
    if (!autoPlayOnMount || disabled) return;
    const t = window.setTimeout(() => {
      if (busyRef.current) return;
      busyRef.current = true;
      setTilt(0);
      playClip();
    }, 40);
    return () => window.clearTimeout(t);
  }, [autoPlayOnMount, disabled, id, playClip]);

  const displaySrc =
    pressing && animMeta && animMeta.frames[frameIdx]
      ? animMeta.frames[frameIdx]
      : art;

  return (
    <button
      type="button"
      className={`reaction-btn react-emoji react-emoji--${id} ${textMode ? 'is-text' : ''} ${!art && !textMode ? 'is-glyph' : ''} ${pressing ? 'is-pressing' : ''} ${className}`.trim()}
      aria-label={aria}
      title={aria}
      disabled={disabled}
      data-emoji-id={id}
      data-mode={mode}
      style={
        pressing
          ? ({ ['--react-tilt' as string]: `${tilt}deg` } as CSSProperties)
          : undefined
      }
      onClick={onPress}
    >
      <span className="react-emoji-face" aria-hidden>
        {textMode ? (
          <span className="react-emoji-text">
            <span>good</span>
            <span>luck</span>
          </span>
        ) : displaySrc ? (
          <img
            src={displaySrc}
            alt=""
            className="react-emoji-art"
            width={32}
            height={32}
            draggable={false}
          />
        ) : (
          <span className="react-emoji-glyph-fallback">{emoji}</span>
        )}
      </span>
      {burst && <ReactionBurst kind={id} />}
    </button>
  );
}

const KNOWN_BURSTS: readonly DefaultReactEmojiId[] = [
  'laugh',
  'cry',
  'angry',
  'skunk',
  'facepalm',
  'handshake',
  'clover',
];

export function ReactionBurst({ kind }: { kind: BurstKind }) {
  if (kind === 'mad_finger' || kind === 'trash_toss' || kind === 'ace_spade' || kind === 'grandma_peggy' || kind === 'mad_father') {
    // Peak art already has motion lines — skip CSS streaks; light sparks only.
    return (
      <span className={`react-emoji-burst react-emoji-burst--${kind}`} aria-hidden>
        <i className="fx spark hot h1" />
        <i className="fx spark s1" />
      </span>
    );
  }
  const burstId = isDefaultReactEmojiId(kind) && KNOWN_BURSTS.includes(kind) ? kind : null;
  if (!burstId) {
    return (
      <span className="react-emoji-burst react-emoji-burst--generic" aria-hidden>
        <i className="fx spark s1" />
        <i className="fx spark s2" />
        <i className="fx spark s3" />
      </span>
    );
  }
  return (
    <span className={`react-emoji-burst react-emoji-burst--${burstId}`} aria-hidden>
      {burstId === 'laugh' && (
        <>
          <i className="fx ha ha1">ha</i>
          <i className="fx ha ha2">ha</i>
          <i className="fx ha ha3">ha</i>
          <i className="fx tear fly t1" />
          <i className="fx tear fly t2" />
          <i className="fx tear fly t3" />
          <i className="fx spark s1" />
          <i className="fx spark s2" />
          <i className="fx spark s3" />
          <i className="fx spark s4" />
          <i className="fx ring pop-ring" />
        </>
      )}
      {burstId === 'cry' && (
        <>
          <i className="fx tear stream st-a" />
          <i className="fx tear stream st-b" />
          <i className="fx tear stream st-c" />
          <i className="fx tear drop d1" />
          <i className="fx tear drop d2" />
          <i className="fx tear drop d3" />
          <i className="fx spark blue b1" />
          <i className="fx spark blue b2" />
        </>
      )}
      {burstId === 'angry' && (
        <>
          <i className="fx steam st1" />
          <i className="fx steam st2" />
          <i className="fx steam st3" />
          <i className="fx vein" />
          <i className="fx spark hot h1" />
          <i className="fx spark hot h2" />
        </>
      )}
      {burstId === 'skunk' && (
        <>
          <i className="fx spray-plume pl1" />
          <i className="fx spray-plume pl2" />
          <i className="fx spray-plume pl3" />
          <i className="fx spray-dot sd1" />
          <i className="fx spray-dot sd2" />
          <i className="fx spray-dot sd3" />
          <i className="fx spray-dot sd4" />
          <i className="fx spray-dot sd5" />
          <i className="fx tail" />
        </>
      )}
      {burstId === 'facepalm' && (
        <>
          <i className="fx slap" />
          <i className="fx slap slap2" />
          <i className="fx sweat sw1" />
          <i className="fx sweat sw2" />
        </>
      )}
      {burstId === 'handshake' && (
        <>
          <i className="fx gold-ring" />
          <i className="fx spark gold g1" />
          <i className="fx spark gold g2" />
          <i className="fx spark gold g3" />
          <i className="fx spark gold g4" />
        </>
      )}
      {burstId === 'clover' && (
        <>
          <i className="fx spark gold g1" />
          <i className="fx spark gold g2" />
          <i className="fx spark gold g3" />
          <i className="fx spark gold g4" />
          <i className="fx luck-star" />
        </>
      )}
    </span>
  );
}
