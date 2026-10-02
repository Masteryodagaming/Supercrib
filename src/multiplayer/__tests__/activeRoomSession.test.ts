import { describe, expect, it, beforeEach } from 'vitest';
import {
  ACTIVE_ROOM_SESSION_KEY,
  parseActiveRoomSession,
  loadActiveRoomSession,
  saveActiveRoomSession,
  clearActiveRoomSession,
} from '../activeRoomSession';
import { isGenericPlayerName, resolveJoinSeat } from '../roomSession';
import type { RoomRecord } from '../types';

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installMemoryStorage();
});

describe('parseActiveRoomSession', () => {
  it('accepts a valid payload', () => {
    expect(
      parseActiveRoomSession({
        roomCode: 'h7k2p',
        seat: 1,
        displayName: 'Josh',
      }),
    ).toEqual({ roomCode: 'H7K2P', seat: 1, displayName: 'Josh' });
  });

  it('rejects corrupt / incomplete payloads', () => {
    expect(parseActiveRoomSession(null)).toBeNull();
    expect(parseActiveRoomSession({})).toBeNull();
    expect(
      parseActiveRoomSession({ roomCode: 'ABC', seat: 0, displayName: 'A' }),
    ).toBeNull();
    expect(
      parseActiveRoomSession({
        roomCode: 'H7K2P',
        seat: 2,
        displayName: 'A',
      }),
    ).toBeNull();
    expect(
      parseActiveRoomSession({
        roomCode: 'H7K2P',
        seat: 0,
        displayName: '   ',
      }),
    ).toBeNull();
  });

  it('round-trips through localStorage', () => {
    saveActiveRoomSession({
      roomCode: 'H7K2P',
      seat: 0,
      displayName: 'Host',
    });
    expect(localStorage.getItem(ACTIVE_ROOM_SESSION_KEY)).toBeTruthy();
    expect(loadActiveRoomSession()).toEqual({
      roomCode: 'H7K2P',
      seat: 0,
      displayName: 'Host',
    });
    clearActiveRoomSession();
    expect(loadActiveRoomSession()).toBeNull();
  });
});

describe('resolveJoinSeat', () => {
  const base = (): Pick<RoomRecord, 'hostName' | 'guestName' | 'seats'> => ({
    hostName: 'Host',
    guestName: 'Guest',
    seats: {
      '0': { name: 'Host', connected: false, lastSeen: 1 },
      '1': { name: 'Guest', connected: false, lastSeen: 1 },
    },
  });

  it('prefers saved seat when the name matches (even if still marked connected)', () => {
    const room = base();
    room.seats['0'] = { name: 'Host', connected: true, lastSeen: 1 };
    expect(resolveJoinSeat(room, 'Host', 0)).toBe(0);
    room.seats['1'] = { name: 'Guest', connected: true, lastSeen: 1 };
    expect(resolveJoinSeat(room, 'Guest', 1)).toBe(1);
  });

  it('rejoins disconnected host without preferred seat', () => {
    expect(resolveJoinSeat(base(), 'Host')).toBe(0);
  });

  it('throws when room is full for a stranger', () => {
    const room = base();
    const now = Date.now();
    room.seats['0'] = { name: 'Host', connected: true, lastSeen: now };
    room.seats['1'] = { name: 'Guest', connected: true, lastSeen: now };
    expect(() => resolveJoinSeat(room, 'Other', undefined, now)).toThrow(/full/i);
  });

  it('rejects same display name taking guest while host is live', () => {
    const room = base();
    room.hostName = 'Joe J';
    room.guestName = undefined as unknown as string;
    room.seats['0'] = { name: 'Joe J', connected: true, lastSeen: Date.now() };
    delete (room.seats as { '1'?: unknown })['1'];
    expect(() => resolveJoinSeat(room, 'Joe J')).toThrow(/host/i);
  });

  it('treats guest named like host as ghost and lets a stranger join seat 1', () => {
    const room = base();
    room.hostName = 'Joe J';
    room.guestName = 'Joe J';
    room.seats['0'] = { name: 'Joe J', connected: false, lastSeen: 1 };
    room.seats['1'] = { name: 'Joe J', connected: true, lastSeen: Date.now() };
    expect(resolveJoinSeat(room, 'Master Yoda')).toBe(1);
  });

  it('treats stale connected seats as vacant', () => {
    const room = base();
    const old = Date.now() - 120_000;
    room.seats['0'] = { name: 'Host', connected: true, lastSeen: old };
    room.seats['1'] = { name: 'Guest', connected: true, lastSeen: old };
    expect(resolveJoinSeat(room, 'Other')).toBe(1);
  });

  it('reads array-shaped seats from RTDB', () => {
    const room = {
      hostName: 'Host',
      guestName: 'Guest',
      seats: [
        { name: 'Host', connected: false, lastSeen: 1 },
        { name: 'Guest', connected: true, lastSeen: Date.now() },
      ] as unknown as RoomRecord['seats'],
    };
    expect(() => resolveJoinSeat(room, 'Other')).toThrow(/full/i);
    expect(resolveJoinSeat(room, 'Guest')).toBe(1);
  });

  it('treats generic Player guest as reclaimable ghost for a stranger on seat 1', () => {
    const room = base();
    room.hostName = 'Joe J';
    room.guestName = 'Player';
    const now = Date.now();
    room.seats['0'] = { name: 'Joe J', connected: true, lastSeen: now };
    room.seats['1'] = { name: 'Player', connected: true, lastSeen: now };
    expect(resolveJoinSeat(room, 'Master Yoda', undefined, now)).toBe(1);
    expect(resolveJoinSeat(room, 'Rayzor', 1, now)).toBe(1);
  });

  it('reclaims preferredSeat when seat name is Player even if marked live', () => {
    const room = base();
    room.hostName = 'Player';
    room.guestName = null as unknown as string;
    const now = Date.now();
    room.seats['0'] = { name: 'Player', connected: true, lastSeen: now };
    delete (room.seats as { '1'?: unknown })['1'];
    expect(resolveJoinSeat(room, 'Mike Milliea', 0, now)).toBe(0);
  });

  it('reclaims preferredSeat 1 when disconnected or stale', () => {
    const room = base();
    room.hostName = 'Mike Milliea';
    room.guestName = 'Wrong';
    const now = Date.now();
    room.seats['0'] = { name: 'Mike Milliea', connected: true, lastSeen: now };
    room.seats['1'] = { name: 'Wrong', connected: false, lastSeen: now };
    expect(resolveJoinSeat(room, 'Master Yoda', 1, now)).toBe(1);
    room.seats['1'] = { name: 'Wrong', connected: true, lastSeen: now - 120_000 };
    expect(resolveJoinSeat(room, 'Master Yoda', 1, now)).toBe(1);
  });

  it('isGenericPlayerName is case-insensitive', () => {
    expect(isGenericPlayerName('Player')).toBe(true);
    expect(isGenericPlayerName(' player ')).toBe(true);
    expect(isGenericPlayerName('PLAYER')).toBe(true);
    expect(isGenericPlayerName('Master Yoda')).toBe(false);
  });


});
