/**
 * Persist active online room so refresh / restore can resume the same seat.
 * Guest-friendly (no Auth required) — localStorage only.
 */

import type { SeatRole } from './types';
import { normalizeRoomCode, isValidRoomCode } from './roomCode';

export const ACTIVE_ROOM_SESSION_KEY = 'supercrib.activeRoomSession.v1';

export interface ActiveRoomSession {
  roomCode: string;
  seat: SeatRole;
  displayName: string;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Pure parse — safe for unit tests without localStorage. */
export function parseActiveRoomSession(raw: unknown): ActiveRoomSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.roomCode !== 'string') return null;
  const roomCode = normalizeRoomCode(o.roomCode);
  if (!isValidRoomCode(roomCode)) return null;
  if (o.seat !== 0 && o.seat !== 1) return null;
  if (typeof o.displayName !== 'string') return null;
  const displayName = o.displayName.trim();
  if (!displayName) return null;
  return { roomCode, seat: o.seat, displayName };
}

export function loadActiveRoomSession(): ActiveRoomSession | null {
  const store = getStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(ACTIVE_ROOM_SESSION_KEY);
    if (!raw) return null;
    return parseActiveRoomSession(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveActiveRoomSession(session: ActiveRoomSession): void {
  const store = getStorage();
  if (!store) return;
  const normalized = parseActiveRoomSession(session);
  if (!normalized) return;
  try {
    store.setItem(ACTIVE_ROOM_SESSION_KEY, JSON.stringify(normalized));
  } catch {
    // quota / private mode — ignore
  }
}

export function clearActiveRoomSession(): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.removeItem(ACTIVE_ROOM_SESSION_KEY);
  } catch {
    // ignore
  }
}
