/**
 * Doctor adjustment/purchase Super Coins via RTDB inbox (works with owner-only users/{uid} rules).
 *
 * Paths:
 *   coinInbox/{toUid}/{pushId} — pending grant
 *     { fromUid, fromName?, amount, note?, at, reason: 'admin_grant' }
 *
 * Recipient drains on hydrate / Settings open: applyCoinDelta, delete entry, save local.
 * Caller should pushCloudProfile after drain. See README for RTDB rules.
 */
import { get, push, ref, remove } from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from '../multiplayer/firebase';
import { applyCoinDelta, ledgerHasMatchingGrant, type CoinReason } from './coins';
import { loadProfile, saveProfile, type Profile } from './storage';

export interface CoinInboxEntry {
  fromUid: string;
  fromName?: string;
  amount: number;
  note?: string;
  at: number;
  reason: CoinReason;
}

export function coinInboxPath(toUid: string, pushId: string): string {
  return `coinInbox/${toUid}/${pushId}`;
}

export function coinInboxInboxPath(toUid: string): string {
  return `coinInbox/${toUid}`;
}

function isCoinInboxEntry(v: unknown): v is CoinInboxEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<CoinInboxEntry>;
  return (
    typeof e.fromUid === 'string' &&
    typeof e.amount === 'number' &&
    Number.isFinite(e.amount) &&
    e.amount > 0 &&
    typeof e.at === 'number' &&
    typeof e.reason === 'string'
  );
}

function entriesFromSnap(val: unknown): Array<{ id: string; entry: CoinInboxEntry }> {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val as Record<string, unknown>)
    .map(([id, raw]) => {
      if (!isCoinInboxEntry(raw)) return null;
      return { id, entry: raw };
    })
    .filter((x): x is { id: string; entry: CoinInboxEntry } => x !== null)
    .sort((a, b) => a.entry.at - b.entry.at);
}

export type SendCoinsToCodeResult =
  | { ok: true; mode: 'local' | 'inbox'; toName: string; amount: number }
  | {
      ok: false;
      reason: 'invalid_code' | 'invalid_amount' | 'not_found' | 'not_configured' | 'error';
      message: string;
    };

/**
 * Owner sends SC to a player code as adjustment/purchase (mint — does not deduct from sender).
 * Same uid → apply locally. Other uid → write coinInbox entry.
 */
export async function sendCoinsToPlayerCode(args: {
  fromUid: string;
  fromName: string;
  fromProfile: Profile;
  toUid: string;
  toName: string;
  amount: number;
  note?: string;
}): Promise<{ result: SendCoinsToCodeResult; localProfile?: Profile }> {
  const amount = Math.floor(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      result: {
        ok: false,
        reason: 'invalid_amount',
        message: 'Enter a positive Super Coin amount.',
      },
    };
  }
  if (!args.toUid) {
    return {
      result: { ok: false, reason: 'not_found', message: 'No player found for that code.' },
    };
  }

  const note =
    args.note?.trim() ||
    `Doctor adjustment/purchase → ${args.toName.trim() || 'Player'}`;

  if (args.toUid === args.fromUid) {
    try {
      const nextState = applyCoinDelta(
        args.fromProfile.coins ?? 0,
        args.fromProfile.coinLedger,
        amount,
        'admin_grant',
        note,
      );
      const localProfile: Profile = {
        ...args.fromProfile,
        coins: nextState.coins,
        coinLedger: nextState.ledger,
      };
      return {
        result: {
          ok: true,
          mode: 'local',
          toName: args.toName.trim() || args.fromProfile.displayName || 'You',
          amount,
        },
        localProfile,
      };
    } catch (e) {
      return {
        result: {
          ok: false,
          reason: 'error',
          message: e instanceof Error ? e.message : 'Grant failed',
        },
      };
    }
  }

  if (!isFirebaseConfigured()) {
    return {
      result: {
        ok: false,
        reason: 'not_configured',
        message: 'Cloud sync is not available.',
      },
    };
  }

  const payload: CoinInboxEntry = {
    fromUid: args.fromUid,
    fromName: args.fromName.trim() || 'Doctor',
    amount,
    at: Date.now(),
    reason: 'admin_grant',
    note,
  };

  try {
    const inboxRef = ref(getFirebaseDb(), coinInboxInboxPath(args.toUid));
    await push(inboxRef, payload);
    return {
      result: {
        ok: true,
        mode: 'inbox',
        toName: args.toName.trim() || 'Player',
        amount,
      },
    };
  } catch (e) {
    console.warn('sendCoinsToPlayerCode failed', e);
    return {
      result: {
        ok: false,
        reason: 'error',
        message:
          e instanceof Error
            ? e.message
            : 'Could not send coins. Check connection or RTDB coinInbox rules.',
      },
    };
  }
}

/**
 * Drain pending coinInbox/{myUid} grants into the profile, delete entries, save locally.
 * Caller should pushCloudProfile when signed in.
 */
export async function drainCoinInbox(uid: string, profile?: Profile | null): Promise<Profile> {
  const base = profile ?? loadProfile(uid);
  if (!base) {
    return createFallbackProfile();
  }
  if (!isFirebaseConfigured() || !uid) {
    return base;
  }

  try {
    const snap = await get(ref(getFirebaseDb(), coinInboxInboxPath(uid)));
    const rows = entriesFromSnap(snap.val());
    if (rows.length === 0) return base;

    let coins = base.coins ?? 0;
    let ledger = base.coinLedger;
    let applied = 0;
    for (const { id, entry } of rows) {
      const note =
        entry.note?.trim() ||
        `Doctor adjustment/purchase from ${entry.fromName?.trim() || 'owner'}`;
      // Idempotent: if we already applied this grant (delete failed earlier), skip re-credit.
      if (ledgerHasMatchingGrant(ledger, entry.at, entry.amount, 'admin_grant')) {
        try {
          await remove(ref(getFirebaseDb(), coinInboxPath(uid, id)));
        } catch (e) {
          console.warn('drainCoinInbox delete failed', id, e);
        }
        continue;
      }
      try {
        const next = applyCoinDelta(coins, ledger, entry.amount, 'admin_grant', note, entry.at);
        coins = next.coins;
        ledger = next.ledger;
        applied += 1;
      } catch (e) {
        console.warn('drainCoinInbox apply failed', id, e);
        continue;
      }
      try {
        await remove(ref(getFirebaseDb(), coinInboxPath(uid, id)));
      } catch (e) {
        console.warn('drainCoinInbox delete failed', id, e);
      }
    }

    if (applied === 0) return base;

    const updated: Profile = {
      ...base,
      coins,
      coinLedger: ledger,
      updatedAt: Date.now(),
    };
    return saveProfile(updated, uid);
  } catch (e) {
    console.warn('drainCoinInbox failed', e);
    return base;
  }
}

function createFallbackProfile(): Profile {
  return {
    displayName: 'Player',
    avatarId: 'peg',
    avatarDataUrl: null,
    record: { wins: 0, losses: 0, gamesPlayed: 0 },
    onlineRecord: { wins: 0, losses: 0, gamesPlayed: 0 },
    settings: { sound: true, theme: 'felt', board: 'default' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
