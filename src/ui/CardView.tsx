import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { Card, isRed } from '../engine/cards';

const SUIT_SYM: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const DRAG_THRESHOLD_PX = 18;

interface Props {
  card?: Card;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  tappable?: boolean;
  /** When true, pointer-drag can reorder; short tap still fires onClick. */
  draggable?: boolean;
  dimmed?: boolean;
  legal?: boolean;
  className?: string;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  /** Pointer-based reorder helpers (preferred over HTML5 DnD on touch). */
  onPointerReorderStart?: (e: ReactPointerEvent) => void;
  onPointerReorderMove?: (e: ReactPointerEvent) => void;
  onPointerReorderEnd?: (e: ReactPointerEvent) => void;
  style?: CSSProperties;
  title?: string;
  /** data attribute for drop targeting */
  handIndex?: number;
}

export function CardView({
  card,
  faceDown,
  selected,
  disabled,
  tappable,
  draggable,
  dimmed,
  legal,
  className,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPointerReorderStart,
  onPointerReorderMove,
  onPointerReorderEnd,
  style,
  title,
  handIndex,
}: Props) {
  const suppressClick = useRef(false);
  const pointerDrag = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const cls = [
    'card',
    faceDown || !card ? 'back' : '',
    card && isRed(card.suit) ? 'red' : '',
    selected ? 'selected' : '',
    disabled ? 'disabled' : '',
    tappable ? 'tappable' : '',
    draggable ? 'draggable' : '',
    dimmed ? 'dimmed' : '',
    legal ? 'legal-play' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const dataProps =
    handIndex !== undefined ? { 'data-hand-index': String(handIndex) } : {};

  const handleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onClick?.();
  };

  if (faceDown || !card) {
    if (tappable || onClick) {
      return (
        <button
          type="button"
          className={cls}
          style={style}
          onClick={handleClick}
          disabled={disabled}
          aria-label={title ?? 'face down'}
          title={title}
          {...dataProps}
        />
      );
    }
    return <div className={cls} style={style} aria-label="face down" title={title} {...dataProps} />;
  }

  return (
    <button
      type="button"
      className={cls}
      style={style}
      onClick={handleClick}
      disabled={disabled || (!tappable && !draggable)}
      // Keep HTML5 DnD as desktop fallback; pointer handlers cover touch.
      draggable={!!draggable && !onPointerReorderStart}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.id);
        suppressClick.current = true;
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver?.();
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDrop?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onPointerDown={(e) => {
        if (disabled) return;
        if (e.button !== 0) return;
        // Track all taps so short presses work on iOS even without drag-reorder.
        pointerDrag.current = { x: e.clientX, y: e.clientY, active: false };
        if (draggable) onPointerReorderStart?.(e);
      }}
      onPointerMove={(e) => {
        const d = pointerDrag.current;
        if (!d) return;
        if (!draggable) return;
        if (!d.active) {
          const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
          if (dist < DRAG_THRESHOLD_PX) return;
          d.active = true;
          suppressClick.current = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
        onPointerReorderMove?.(e);
      }}
      onPointerUp={(e) => {
        const d = pointerDrag.current;
        pointerDrag.current = null;
        if (d?.active) {
          suppressClick.current = true;
          onPointerReorderEnd?.(e);
        } else {
          // Short tap — clear tentative drag, then fire select/play immediately.
          // iOS Safari often eats the follow-up click after pointer handlers / scroll.
          onDragEnd?.();
          if (tappable && !disabled && onClick) {
            suppressClick.current = true; // block duplicate native click
            onClick();
          }
        }
      }}
      onPointerCancel={() => {
        pointerDrag.current = null;
        onDragEnd?.();
      }}
      aria-label={`${card.rank} of ${card.suit}`}
      {...dataProps}
    >
      <span className="card-index">
        <span className="card-rank">{card.rank}</span>
        <span className="suit">{SUIT_SYM[card.suit]}</span>
      </span>
    </button>
  );
}
