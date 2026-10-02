import { isAiUserId } from './practiceAi';
import type { TournamentPlayer } from './types';

/**
 * Resolve which avatar id to show for a tournament player.
 * Prefer seated `player.avatarId`; else a Live-page cache from users/{uid}/profile.
 * AI placeholders never use the cache — caller should render a default glyph.
 */
export function resolveAvatarId(
  player: Pick<TournamentPlayer, 'userId' | 'avatarId' | 'isAi'> | null | undefined,
  cache: Record<string, string | null | undefined>,
): string | null {
  if (!player) return null;
  if (player.isAi === true || isAiUserId(player.userId)) return null;
  const seated = (player.avatarId ?? '').trim();
  if (seated) return seated;
  const cached = cache[player.userId];
  if (typeof cached === 'string' && cached.trim()) return cached.trim();
  return null;
}
