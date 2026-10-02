import { describe, expect, it } from 'vitest';
import { roomScoringMode, canChangeRoomScoringMode } from '../roomSession';
import type { RoomRecord } from '../types';

function baseRoom(scoringMode?: RoomRecord['scoringMode']): RoomRecord {
  return {
    code: 'H7K2P',
    createdAt: 1,
    status: 'waiting',
    hostName: 'Host',
    guestName: null,
    seats: {
      '0': { name: 'Host', connected: true, lastSeen: 1 },
      '1': null,
    },
    cut: null,
    game: null,
    ...(scoringMode ? { scoringMode } : {}),
  };
}

describe('roomScoringMode', () => {
  it('defaults missing / unknown to auto', () => {
    expect(roomScoringMode(null)).toBe('auto');
    expect(roomScoringMode(baseRoom())).toBe('auto');
    expect(roomScoringMode(baseRoom('auto'))).toBe('auto');
  });

  it('returns competitive when host set it on the room', () => {
    expect(roomScoringMode(baseRoom('competitive'))).toBe('competitive');
  });
});

describe('canChangeRoomScoringMode', () => {
  it('allows waiting lobby', () => {
    expect(canChangeRoomScoringMode(baseRoom())).toBe(true);
    expect(canChangeRoomScoringMode(baseRoom('competitive'))).toBe(true);
  });

  it('locks once cutting / playing / dealt', () => {
    expect(canChangeRoomScoringMode({ ...baseRoom(), status: 'cutting' })).toBe(false);
    expect(canChangeRoomScoringMode({ ...baseRoom(), status: 'playing' })).toBe(false);
    expect(canChangeRoomScoringMode({ ...baseRoom(), status: 'ended' })).toBe(false);
    expect(
      canChangeRoomScoringMode({
        ...baseRoom(),
        status: 'waiting',
        game: { rev: 1, state: { phase: 'discard' } },
      }),
    ).toBe(false);
  });
});
