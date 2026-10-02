/**
 * Occasional opponent emoji pops during vs-AI games (no Firebase).
 */
import { useEffect, useRef, useState } from 'react';
import type { GameState, AiDifficulty } from '../engine/supercrib';
import type { SyncedReaction } from '../multiplayer/types';
import { EMOJI_GLYPH } from './emoji/reactEmojis';

const AI_SEAT = 1 as const;

const MIN_GAP_EASY_MS = 2200;
const MIN_GAP_NORMAL_MS = 2800;
const MIN_GAP_HARD_MS = 3800;

function minGap(diff: AiDifficulty): number {
  if (diff === 'easy') return MIN_GAP_EASY_MS;
  if (diff === 'hard') return MIN_GAP_HARD_MS;
  return MIN_GAP_NORMAL_MS;
}

function chance(diff: AiDifficulty, easy: number, normal: number, hard: number): number {
  if (diff === 'easy') return easy;
  if (diff === 'hard') return hard;
  return normal;
}

function pickGlyph(
  id: keyof typeof EMOJI_GLYPH,
): string {
  return EMOJI_GLYPH[id];
}

/**
 * Watch AI game state and emit sparse opponent reactions for ReactionBar.
 */
export function useAiReactions(
  game: GameState | null,
  enabled: boolean,
): SyncedReaction | null {
  const [reaction, setReaction] = useState<SyncedReaction | null>(null);
  const lastEmitAtRef = useRef(0);
  const lastFlashIdRef = useRef<number | null>(null);
  const lastDealLuckRef = useRef<number | null>(null);
  const lastPhaseRef = useRef<string | null>(null);
  const angryOnceRef = useRef(false);
  const handshakeOnceRef = useRef(false);

  useEffect(() => {
    if (!enabled || !game || game.mode !== 'ai') {
      return;
    }

    const diff: AiDifficulty = game.aiDifficulty ?? 'normal';
    const now = Date.now();
    const gap = minGap(diff);

    const tryEmit = (emoji: string, p: number) => {
      if (now - lastEmitAtRef.current < gap) return false;
      if (Math.random() > p) return false;
      lastEmitAtRef.current = now;
      setReaction({ seat: AI_SEAT, emoji, at: now });
      return true;
    };

    // Reset per-game flags when a fresh deal #1 starts after gameOver clear — use score sum ~0
    if (game.dealNumber <= 1 && game.players[0].score === 0 && game.players[1].score === 0) {
      angryOnceRef.current = false;
      handshakeOnceRef.current = false;
    }

    const human = game.players[0].score;
    const ai = game.players[1].score;
    const late = human >= 180 || ai >= 180;
    const nearEnd = human >= 220 || ai >= 220;

    // Peg flash reactions
    const flash = game.lastPegFlash;
    if (flash && flash.id !== lastFlashIdRef.current) {
      lastFlashIdRef.current = flash.id;
      const pts = flash.points;
      if (!flash.blocked && pts >= 2) {
        if (flash.player === AI_SEAT) {
          tryEmit(pickGlyph('laugh'), chance(diff, 0.7, 0.55, 0.4));
        } else if (pts >= 4) {
          tryEmit(
            Math.random() < 0.55 ? pickGlyph('cry') : pickGlyph('facepalm'),
            chance(diff, 0.75, 0.6, 0.45),
          );
        } else if (pts >= 2) {
          tryEmit(pickGlyph('facepalm'), chance(diff, 0.35, 0.25, 0.15));
        }
      }
    }

    // After cut / start of pegging — rare good luck
    if (
      game.phase === 'pegging' &&
      lastPhaseRef.current !== 'pegging' &&
      game.dealNumber !== lastDealLuckRef.current
    ) {
      lastDealLuckRef.current = game.dealNumber;
      tryEmit(pickGlyph('clover'), chance(diff, 0.28, 0.18, 0.1));
    }

    // AI far behind late → angry (once)
    if (
      late &&
      !angryOnceRef.current &&
      ai < human - 40 &&
      game.phase !== 'gameOver'
    ) {
      if (tryEmit(pickGlyph('angry'), chance(diff, 0.55, 0.4, 0.3))) {
        angryOnceRef.current = true;
      }
    }

    // Skunk threat: human near win and AI under skunk line (~181 behind winner path)
    if (
      nearEnd &&
      human >= 230 &&
      ai < 181 &&
      game.phase !== 'gameOver'
    ) {
      tryEmit(pickGlyph('skunk'), chance(diff, 0.35, 0.25, 0.2));
    }

    // Nice play / almost over → handshake (once near end)
    if (
      nearEnd &&
      !handshakeOnceRef.current &&
      game.phase !== 'gameOver' &&
      (flash?.points ?? 0) >= 6
    ) {
      if (tryEmit(pickGlyph('handshake'), chance(diff, 0.4, 0.3, 0.22))) {
        handshakeOnceRef.current = true;
      }
    }

    // Game over — handshake sometimes
    if (game.phase === 'gameOver' && game.winner !== null && !handshakeOnceRef.current) {
      if (tryEmit(pickGlyph('handshake'), chance(diff, 0.65, 0.5, 0.4))) {
        handshakeOnceRef.current = true;
      }
    }

    lastPhaseRef.current = game.phase;
  }, [enabled, game]);

  if (!enabled) return null;
  return reaction;
}
