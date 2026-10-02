import { describe, expect, it } from 'vitest';
import {
  isAiTournamentPlayer,
  isAiUserId,
  makeAiTournamentPlayer,
  pairingInvolvesAi,
  pairingIsAiOnly,
  pickPracticeAiScores,
  PRACTICE_AI_ROSTER,
} from '../practiceAi';
import type { TournamentPairing, TournamentPlayer } from '../types';

function stubPlayer(
  partial: Partial<TournamentPlayer> & Pick<TournamentPlayer, 'userId' | 'displayName'>,
): TournamentPlayer {
  return {
    seat: 0,
    gamePoints: 0,
    wins: 0,
    losses: 0,
    skunksGiven: 0,
    skunksReceived: 0,
    spread: 0,
    place: null,
    dropped: false,
    joinedAt: 0,
    approved: true,
    ...partial,
  };
}

describe('practice AI helpers', () => {
  it('roster has 19 named AI bots (first 3 stable for Practice 4)', () => {
    expect(PRACTICE_AI_ROSTER).toHaveLength(19);
    expect(PRACTICE_AI_ROSTER.map((r) => r.userId)).toEqual(
      Array.from({ length: 19 }, (_, i) => `ai-bot-${i + 1}`),
    );
    expect(PRACTICE_AI_ROSTER.slice(0, 3).map((r) => r.displayName)).toEqual([
      'AI Alex',
      'AI Sam',
      'AI Riley',
    ]);
    const names = PRACTICE_AI_ROSTER.map((r) => r.displayName);
    expect(new Set(names).size).toBe(19);
    expect(PRACTICE_AI_ROSTER.every((r) => r.isAi && r.displayName.startsWith('AI '))).toBe(
      true,
    );
  });

  it('detects AI user ids and players', () => {
    expect(isAiUserId('ai-bot-1')).toBe(true);
    expect(isAiUserId('ai-2')).toBe(true);
    expect(isAiUserId('real-uid')).toBe(false);
    expect(isAiUserId(null)).toBe(false);

    expect(
      isAiTournamentPlayer(stubPlayer({ userId: 'u1', displayName: 'A', isAi: true })),
    ).toBe(true);
    expect(
      isAiTournamentPlayer(stubPlayer({ userId: 'ai-bot-2', displayName: 'AI Sam' })),
    ).toBe(true);
    expect(
      isAiTournamentPlayer(stubPlayer({ userId: 'human', displayName: 'Josh' })),
    ).toBe(false);
  });

  it('makeAiTournamentPlayer sets isAi and seat', () => {
    const p = makeAiTournamentPlayer(PRACTICE_AI_ROSTER[0], 2, 123);
    expect(p.isAi).toBe(true);
    expect(p.userId).toBe('ai-bot-1');
    expect(p.seat).toBe(2);
    expect(p.approved).toBe(true);
    expect(p.joinedAt).toBe(123);
  });

  it('pairingInvolvesAi / pairingIsAiOnly', () => {
    const players: Record<string, TournamentPlayer> = {
      human: stubPlayer({ userId: 'human', displayName: 'Josh' }),
      'ai-bot-1': stubPlayer({
        userId: 'ai-bot-1',
        displayName: 'AI Alex',
        isAi: true,
      }),
      'ai-bot-2': stubPlayer({
        userId: 'ai-bot-2',
        displayName: 'AI Sam',
        isAi: true,
      }),
    };
    const humanVsAi: TournamentPairing = {
      board: 1,
      playerAId: 'human',
      playerBId: 'ai-bot-1',
      result: 'pending',
      scoreA: null,
      scoreB: null,
      gamePointsA: 0,
      gamePointsB: 0,
      spreadA: 0,
      spreadB: 0,
    };
    const aiOnly: TournamentPairing = {
      ...humanVsAi,
      board: 2,
      playerAId: 'ai-bot-1',
      playerBId: 'ai-bot-2',
    };
    const humans: TournamentPairing = {
      ...humanVsAi,
      board: 3,
      playerAId: 'human',
      playerBId: 'human',
    };

    expect(pairingInvolvesAi(players, humanVsAi)).toBe(true);
    expect(pairingIsAiOnly(players, humanVsAi)).toBe(false);
    expect(pairingInvolvesAi(players, aiOnly)).toBe(true);
    expect(pairingIsAiOnly(players, aiOnly)).toBe(true);
    expect(pairingInvolvesAi(players, humans)).toBe(false);
  });

  it('pickPracticeAiScores fixed and random (SuperCrib 241)', () => {
    expect(pickPracticeAiScores()).toEqual({ scoreA: 241, scoreB: 200 });
    const a = pickPracticeAiScores({ random: true, rng: () => 0.1 });
    expect(a.scoreA).toBe(241);
    expect(a.scoreB).toBeGreaterThanOrEqual(190);
    expect(a.scoreB).toBeLessThanOrEqual(230);
    const b = pickPracticeAiScores({ random: true, rng: () => 0.9 });
    expect(b.scoreB).toBe(241);
    expect(b.scoreA).toBeGreaterThanOrEqual(190);
    expect(b.scoreA).toBeLessThanOrEqual(230);
  });
});
