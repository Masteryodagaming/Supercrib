import { describe, expect, it } from 'vitest';
import type { RoomRecord } from '../../multiplayer/types';
import { finishedMatchRoomScores } from '../tournamentApi';
import {
  shouldAttemptTournamentSubmit,
  shouldRecordOnlineCareer,
} from '../../ui/tournamentSubmitGuards';

function baseRoom(over: Partial<RoomRecord> = {}): RoomRecord {
  const now = Date.now();
  return {
    code: 'NK5Y8',
    createdAt: now,
    status: 'playing',
    hostName: 'Joe J',
    guestName: 'Elsi9',
    seats: {
      '0': { name: 'Joe J', connected: false, lastSeen: now },
      '1': { name: 'Elsi9', connected: false, lastSeen: now },
    },
    cut: null,
    game: null,
    ...over,
  };
}

describe('finishedMatchRoomScores', () => {
  it('returns null when room or game missing', () => {
    expect(finishedMatchRoomScores(null)).toBeNull();
    expect(finishedMatchRoomScores(undefined)).toBeNull();
    expect(finishedMatchRoomScores(baseRoom())).toBeNull();
  });

  it('returns null when phase is not gameOver', () => {
    expect(
      finishedMatchRoomScores(
        baseRoom({
          game: {
            rev: 1,
            state: {
              phase: 'pegging',
              players: [{ score: 100 }, { score: 120 }],
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it('returns scores when gameOver (array players) — needs submit', () => {
    expect(
      finishedMatchRoomScores(
        baseRoom({
          status: 'ended',
          game: {
            rev: 42,
            state: {
              phase: 'gameOver',
              winner: 1,
              players: [{ score: 205 }, { score: 241 }],
            },
          },
        }),
      ),
    ).toEqual({ scoreA: 205, scoreB: 241 });
  });

  it('returns scores when gameOver (object players keys)', () => {
    expect(
      finishedMatchRoomScores(
        baseRoom({
          game: {
            rev: 2,
            state: {
              phase: 'gameOver',
              players: {
                '0': { score: 10 },
                '1': { score: 20 },
              },
            },
          },
        }),
      ),
    ).toEqual({ scoreA: 10, scoreB: 20 });
  });

  it('returns null when scores missing', () => {
    expect(
      finishedMatchRoomScores(
        baseRoom({
          game: {
            rev: 1,
            state: { phase: 'gameOver', players: [{}, { score: 1 }] },
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('tournament submit vs career guards (regression)', () => {
  it('skips career on refresh-at-gameOver but still allows tournament submit', () => {
    expect(
      shouldRecordOnlineCareer({
        sawLiveOnlineMatch: false,
        roomAlreadyRecorded: false,
      }),
    ).toBe(false);
    expect(
      shouldAttemptTournamentSubmit({
        hasTournamentContext: true,
        hasAuth: true,
        alreadySubmitted: false,
        inFlight: false,
        hasScores: true,
      }),
    ).toBe(true);
  });

  it('skips career when room already recorded but still allows tournament submit', () => {
    expect(
      shouldRecordOnlineCareer({
        sawLiveOnlineMatch: true,
        roomAlreadyRecorded: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptTournamentSubmit({
        hasTournamentContext: true,
        hasAuth: true,
        alreadySubmitted: false,
        inFlight: false,
        hasScores: true,
      }),
    ).toBe(true);
  });

  it('does not re-submit when already submitted or in flight', () => {
    expect(
      shouldAttemptTournamentSubmit({
        hasTournamentContext: true,
        hasAuth: true,
        alreadySubmitted: true,
        inFlight: false,
        hasScores: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptTournamentSubmit({
        hasTournamentContext: true,
        hasAuth: true,
        alreadySubmitted: false,
        inFlight: true,
        hasScores: true,
      }),
    ).toBe(false);
  });
});
