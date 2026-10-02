/**
 * Owner-only Practice-with-AI helpers (Club Night testing).
 * Pure helpers — no Firebase. Used by tournamentApi + TournamentLive.
 */
import type { TournamentPairing, TournamentPlayer } from './types';

/**
 * Fixed roster for Practice with AI.
 * First 3 names kept for Practice 4 compat; full list (19) fills Practice 20.
 */
export const PRACTICE_AI_ROSTER: ReadonlyArray<{
  userId: string;
  displayName: string;
  isAi: true;
}> = [
  { userId: 'ai-bot-1', displayName: 'AI Alex', isAi: true },
  { userId: 'ai-bot-2', displayName: 'AI Sam', isAi: true },
  { userId: 'ai-bot-3', displayName: 'AI Riley', isAi: true },
  { userId: 'ai-bot-4', displayName: 'AI Jordan', isAi: true },
  { userId: 'ai-bot-5', displayName: 'AI Casey', isAi: true },
  { userId: 'ai-bot-6', displayName: 'AI Morgan', isAi: true },
  { userId: 'ai-bot-7', displayName: 'AI Taylor', isAi: true },
  { userId: 'ai-bot-8', displayName: 'AI Quinn', isAi: true },
  { userId: 'ai-bot-9', displayName: 'AI Avery', isAi: true },
  { userId: 'ai-bot-10', displayName: 'AI Blake', isAi: true },
  { userId: 'ai-bot-11', displayName: 'AI Cameron', isAi: true },
  { userId: 'ai-bot-12', displayName: 'AI Drew', isAi: true },
  { userId: 'ai-bot-13', displayName: 'AI Emerson', isAi: true },
  { userId: 'ai-bot-14', displayName: 'AI Finley', isAi: true },
  { userId: 'ai-bot-15', displayName: 'AI Harper', isAi: true },
  { userId: 'ai-bot-16', displayName: 'AI Jamie', isAi: true },
  { userId: 'ai-bot-17', displayName: 'AI Kendall', isAi: true },
  { userId: 'ai-bot-18', displayName: 'AI Logan', isAi: true },
  { userId: 'ai-bot-19', displayName: 'AI Parker', isAi: true },
];

export function isAiUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return userId.startsWith('ai-bot-') || /^ai-\d+$/.test(userId);
}

export function isAiTournamentPlayer(
  p: TournamentPlayer | null | undefined,
): boolean {
  if (!p) return false;
  return p.isAi === true || isAiUserId(p.userId);
}

/** True when either seat on the board is an AI placeholder. */
export function pairingInvolvesAi(
  players: Record<string, TournamentPlayer>,
  pairing: TournamentPairing,
): boolean {
  const a = pairing.playerAId ? players[pairing.playerAId] : undefined;
  const b = pairing.playerBId ? players[pairing.playerBId] : undefined;
  return isAiTournamentPlayer(a) || isAiTournamentPlayer(b);
}

/** True when both seats are AI (no human Join needed). */
export function pairingIsAiOnly(
  players: Record<string, TournamentPlayer>,
  pairing: TournamentPairing,
): boolean {
  if (!pairing.playerAId || !pairing.playerBId) return false;
  return (
    isAiTournamentPlayer(players[pairing.playerAId]) &&
    isAiTournamentPlayer(players[pairing.playerBId])
  );
}

/**
 * Quick test scores for Resolve AI board (SuperCrib 241 race).
 * Default: deterministic 241–200 (2 GP win for A, non-skunk; skunk line is 181).
 * With random: flip winner; loser 190–230 (non-skunk).
 */
export function pickPracticeAiScores(
  opts?: { random?: boolean; rng?: () => number },
): { scoreA: number; scoreB: number } {
  if (!opts?.random) {
    return { scoreA: 241, scoreB: 200 };
  }
  const rng = opts.rng ?? Math.random;
  const aWins = rng() < 0.5;
  const winner = 241;
  const loser = 190 + Math.floor(rng() * 41); // 190–230
  return aWins
    ? { scoreA: winner, scoreB: loser }
    : { scoreA: loser, scoreB: winner };
}

export function makeAiTournamentPlayer(
  slot: { userId: string; displayName: string },
  seat: number,
  joinedAt: number,
): TournamentPlayer {
  return {
    userId: slot.userId,
    displayName: slot.displayName,
    seat,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt,
    approved: true,
    isAi: true,
  };
}

export function makeOwnerTournamentPlayer(
  user: { uid: string; displayName?: string | null; avatarId?: string | null },
  seat: number,
  joinedAt: number,
  playerCode?: string | null,
): TournamentPlayer {
  const avatarId = (user.avatarId ?? '').trim();
  return {
    userId: user.uid,
    displayName: (user.displayName || 'Owner').trim() || 'Owner',
    ...(playerCode ? { playerCode: playerCode.trim().toUpperCase() } : {}),
    ...(avatarId ? { avatarId } : {}),
    seat,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt,
    approved: true,
  };
}
