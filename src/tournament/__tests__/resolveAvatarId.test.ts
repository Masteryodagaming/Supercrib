import { describe, expect, it } from 'vitest';
import { resolveAvatarId } from '../resolveAvatarId';

describe('resolveAvatarId', () => {
  it('prefers seated avatarId over cache', () => {
    expect(
      resolveAvatarId(
        { userId: 'u1', avatarId: 'peg', isAi: false },
        { u1: 'spade' },
      ),
    ).toBe('peg');
  });

  it('falls back to cache when seated avatar missing', () => {
    expect(resolveAvatarId({ userId: 'u1' }, { u1: 'heart' })).toBe('heart');
  });

  it('returns null for AI (skip fetch / default glyph)', () => {
    expect(
      resolveAvatarId({ userId: 'ai-bot-1', avatarId: 'peg', isAi: true }, {}),
    ).toBeNull();
    expect(resolveAvatarId({ userId: 'ai-bot-2' }, { 'ai-bot-2': 'peg' })).toBeNull();
  });

  it('returns null when neither seated nor cached', () => {
    expect(resolveAvatarId({ userId: 'u1' }, {})).toBeNull();
    expect(resolveAvatarId({ userId: 'u1' }, { u1: null })).toBeNull();
    expect(resolveAvatarId(null, {})).toBeNull();
  });
});
