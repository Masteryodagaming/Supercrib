import { describe, expect, it } from 'vitest';
import type { RoomRecord } from '../../multiplayer/types';
import {
  isMatchRoomStuck,
  MATCH_ROOM_STUCK_GRACE_MS,
} from '../tournamentApi';

function baseRoom(over: Partial<RoomRecord> = {}): RoomRecord {
  const now = Date.now();
  return {
    code: 'ABCDE',
    createdAt: now,
    status: 'cutting',
    hostName: 'Dad',
    guestName: 'Joe',
    seats: {
      '0': { name: 'Dad', connected: true, lastSeen: now },
      '1': { name: 'Joe', connected: true, lastSeen: now },
    },
    cut: {
      rev: 1,
      deck: [],
      cuts: [null, null],
      stage: 'cut0',
      round: 0,
    },
    game: null,
    ...over,
  };
}

describe('isMatchRoomStuck', () => {
  it('returns true for missing room', () => {
    expect(isMatchRoomStuck(null)).toBe(true);
    expect(isMatchRoomStuck(undefined)).toBe(true);
  });

  it('returns true for ended room', () => {
    expect(isMatchRoomStuck(baseRoom({ status: 'ended' }))).toBe(true);
  });

  it('never stuck when a seat is live — even cutting at cut0 with empty cuts', () => {
    // NORMAL right after second player joins
    expect(isMatchRoomStuck(baseRoom())).toBe(false);
    expect(
      isMatchRoomStuck(
        baseRoom({
          seats: {
            '0': { name: 'Dad', connected: true, lastSeen: Date.now() },
            '1': null,
          },
          guestName: null,
          status: 'waiting',
          cut: null,
        }),
      ),
    ).toBe(false);
  });

  it('returns false when game state exists', () => {
    expect(
      isMatchRoomStuck(
        baseRoom({
          status: 'playing',
          game: { rev: 1, state: { phase: 'pegging' } },
        }),
      ),
    ).toBe(false);
  });

  it('both claimed disconnected recent (array seats) is NOT stuck — brief heartbeat drop', () => {
    const now = Date.now();
    const recent = now - 60_000; // 1 minute ago
    expect(
      isMatchRoomStuck(
        {
          code: 'ECJNT',
          createdAt: now - 120_000,
          status: 'cutting',
          hostName: 'Rayzor',
          guestName: 'Elsi9',
          // RTDB often stores seats as an array
          seats: [
            { name: 'Rayzor', connected: false, lastSeen: recent },
            { name: 'Elsi9', connected: false, lastSeen: recent },
          ] as unknown as RoomRecord['seats'],
          cut: {
            rev: 1,
            deck: [],
            cuts: [null, null],
            stage: 'cut0',
            round: 0,
          },
          game: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it('both claimed stale >10m cutting is stuck', () => {
    const now = Date.now();
    const stale = now - MATCH_ROOM_STUCK_GRACE_MS - 60_000;
    expect(
      isMatchRoomStuck(
        baseRoom({
          createdAt: stale,
          seats: {
            '0': { name: 'Dad', connected: false, lastSeen: stale },
            '1': { name: 'Joe', connected: false, lastSeen: stale },
          },
        }),
        now,
      ),
    ).toBe(true);
  });

  it('stuck when cutting at cut0 empty and no live seats (stale)', () => {
    const stale = Date.now() - 60 * 60 * 1000;
    expect(
      isMatchRoomStuck(
        baseRoom({
          createdAt: stale,
          seats: {
            '0': { name: 'Dad', connected: false, lastSeen: stale },
            '1': { name: 'Joe', connected: false, lastSeen: stale },
          },
        }),
      ),
    ).toBe(true);
  });

  it('waiting with disconnected host only is NOT stuck (reusable)', () => {
    const stale = Date.now() - 60 * 60 * 1000;
    expect(
      isMatchRoomStuck(
        baseRoom({
          status: 'waiting',
          guestName: null,
          cut: null,
          createdAt: stale,
          seats: {
            '0': { name: 'Dad', connected: false, lastSeen: stale },
            '1': null,
          },
        }),
      ),
    ).toBe(false);
  });

  it('waiting host placeholder lastSeen:1 alone does not count as recent when both claimed stale', () => {
    // Sanity: host-only waiting with lastSeen:1 stays reclaimable
    const now = Date.now();
    expect(
      isMatchRoomStuck(
        baseRoom({
          status: 'waiting',
          guestName: null,
          cut: null,
          createdAt: now,
          seats: {
            '0': { name: 'Rayzor', connected: false, lastSeen: 1 },
            '1': null,
          },
        }),
        now,
      ),
    ).toBe(false);
  });
});
