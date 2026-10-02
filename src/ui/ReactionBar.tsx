import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerId } from '../engine/supercrib';
import type { SyncedReaction } from '../multiplayer/types';
import { ReactEmoji, ReactionBurst } from './emoji/ReactEmoji';
import { EmoteFrameClip } from './emoji/EmoteFrameClip';
import { preloadReactEmojiFrames } from './emoji/emoteAnim';
import {
  DEFAULT_RAIL_EMOJI_IDS,
  animMetaForReactEmojiId,
  glyphForReactEmojiId,
  idForReactionGlyph,
  normalizeEquippedRailEmojiIds,
  type ReactEmojiId,
} from './emoji/reactEmojis';

/** Glyph list kept for any callers that still import the rail set. */
export const REACTION_EMOJIS = DEFAULT_RAIL_EMOJI_IDS.map((id) => glyphForReactEmojiId(id));
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const RATE_LIMIT_MS = 800;
/** Long enough for character action on the big board pop, then float away. */
const POP_MS = 2100;

interface PopItem {
  id: number;
  emoji: string;
  fromOpp: boolean;
  reactId: ReactEmojiId | null;
}

interface Props {
  viewer: PlayerId;
  /** Latest room.reaction from Firebase (online); null/undefined for AI. */
  remoteReaction?: SyncedReaction | null;
  /**
   * Vs-AI: synthetic opponent reaction (same shape as remote).
   * Spawns fromOpp pops without Firebase.
   */
  externalOppReaction?: SyncedReaction | null;
  /** Online: push to RTDB. AI: omit — local pop only. */
  onSend?: (emoji: string) => void;
  /**
   * Equipped 8-slot loadout from profile (4 left + 4 right). Missing/invalid → defaults.
   */
  equippedRailEmojiIds?: readonly string[] | null;
}

export function ReactionBar({
  viewer,
  remoteReaction = null,
  externalOppReaction = null,
  onSend,
  equippedRailEmojiIds = null,
}: Props) {
  const [pops, setPops] = useState<PopItem[]>([]);
  const lastTapRef = useRef(0);
  const lastRemoteAtRef = useRef<number>(0);
  const lastExternalAtRef = useRef<number>(0);
  const idRef = useRef(0);

  const railIds = useMemo(
    () => normalizeEquippedRailEmojiIds(equippedRailEmojiIds),
    [equippedRailEmojiIds],
  );

  // Preload anim frames for equipped rail (incl. specials) so first tap isn't blank.
  useEffect(() => {
    for (const id of railIds) {
      if (animMetaForReactEmojiId(id)) preloadReactEmojiFrames(id);
    }
  }, [railIds]);

  const spawnPop = useCallback((emoji: string, fromOpp: boolean) => {
    const id = ++idRef.current;
    const reactId = idForReactionGlyph(emoji);
    setPops((prev) => [...prev, { id, emoji, fromOpp, reactId }]);
    window.setTimeout(() => {
      setPops((prev) => prev.filter((p) => p.id !== id));
    }, POP_MS);
  }, []);

  // Mirror opponent (and any remote) reactions from RTDB
  useEffect(() => {
    if (!remoteReaction || typeof remoteReaction.at !== 'number') return;
    if (remoteReaction.at <= lastRemoteAtRef.current) return;
    lastRemoteAtRef.current = remoteReaction.at;
    // Skip echo of our own send — we already popped locally on tap
    if (remoteReaction.seat === viewer) return;
    if (!remoteReaction.emoji) return;
    spawnPop(remoteReaction.emoji, true);
  }, [remoteReaction, viewer, spawnPop]);

  // Vs-AI synthetic opponent reactions
  useEffect(() => {
    if (!externalOppReaction || typeof externalOppReaction.at !== 'number') return;
    if (externalOppReaction.at <= lastExternalAtRef.current) return;
    lastExternalAtRef.current = externalOppReaction.at;
    if (externalOppReaction.seat === viewer) return;
    if (!externalOppReaction.emoji) return;
    spawnPop(externalOppReaction.emoji, true);
  }, [externalOppReaction, viewer, spawnPop]);

  const onTap = (emoji: string) => {
    const now = Date.now();
    if (now - lastTapRef.current < RATE_LIMIT_MS) return;
    lastTapRef.current = now;
    spawnPop(emoji, false);
    onSend?.(emoji);
  };

  const leftIds = railIds.slice(0, 4);
  const rightIds = railIds.slice(4, 8);

  return (
    <>
      <div className="reaction-dock reaction-dock-left" role="group" aria-label="Emoji reactions left">
        {leftIds.map((id, slot) => (
          <ReactEmoji key={`L${slot}-${id}`} id={id} onSend={onTap} />
        ))}
      </div>
      <div className="reaction-dock reaction-dock-right" role="group" aria-label="Emoji reactions right">
        {rightIds.map((id, slot) => (
          <ReactEmoji key={`R${slot}-${id}`} id={id} onSend={onTap} />
        ))}
      </div>
      <div className="reaction-pops" aria-live="polite" aria-atomic="false">
        {pops.map((p) => (
          <span
            key={p.id}
            className={`reaction-pop${p.fromOpp ? ' from-opp' : ' from-you'}${p.reactId ? ` reaction-pop--${p.reactId}` : ''} is-acting`}
            aria-hidden
          >
            <span
              className={`reaction-pop-stage${p.reactId ? ` react-emoji--${p.reactId}` : ''} is-pressing`}
            >
              <span className="react-emoji-face reaction-pop-face">
                {p.reactId ? (
                  <EmoteFrameClip
                    reactId={p.reactId}
                    emoji={p.emoji}
                    width={p.reactId === 'ace_spade' ? 152 : 112}
                    height={p.reactId === 'ace_spade' ? 152 : 112}
                  />
                ) : (
                  <span className="reaction-pop-fallback">{p.emoji}</span>
                )}
              </span>
              {p.reactId ? <ReactionBurst kind={p.reactId} /> : null}
            </span>
          </span>
        ))}
      </div>
    </>
  );
}
