/**
 * Owner gate for Club Night tournaments.
 * Prefer VITE_OWNER_USER_ID; also match email / displayName (username).
 */

export interface OwnerLike {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
}

const DEFAULT_OWNER_EMAIL = 'j0shwa@hotmail.com';

function envString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function ownerUserId(): string {
  return envString(import.meta.env.VITE_OWNER_USER_ID);
}

export function ownerEmail(): string {
  const fromEnv = envString(import.meta.env.VITE_OWNER_EMAIL);
  return fromEnv || DEFAULT_OWNER_EMAIL;
}

export function ownerUsername(): string {
  return envString(import.meta.env.VITE_OWNER_USERNAME);
}

/** When false (default), only the owner can create / start tournaments. */
export function tournamentsPublicHosting(): boolean {
  const raw = envString(import.meta.env.VITE_TOURNAMENTS_PUBLIC_HOSTING).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function isOwner(user: OwnerLike | null | undefined): boolean {
  if (!user) return false;
  const uid = (user.uid ?? '').trim();
  const email = (user.email ?? '').trim().toLowerCase();
  const name = (user.displayName ?? '').trim().toLowerCase();

  const oid = ownerUserId();
  if (oid && uid && uid === oid) return true;

  const oEmail = ownerEmail().toLowerCase();
  if (oEmail && email && email === oEmail) return true;

  const oUser = ownerUsername().toLowerCase();
  if (oUser && name && name === oUser) return true;

  return false;
}

/**
 * True when this signed-in user may create / host tournaments.
 * Owner always can; others only when VITE_TOURNAMENTS_PUBLIC_HOSTING=true.
 */
export function canHostTournaments(user: OwnerLike | null | undefined): boolean {
  if (!user?.uid) return false;
  if (isOwner(user)) return true;
  return tournamentsPublicHosting();
}

export const OWNER_FORBIDDEN_MESSAGE =
  '403 Forbidden — only the tournament owner can perform this action.';

export function requireOwner(user: OwnerLike | null | undefined): void {
  if (!isOwner(user)) {
    throw new Error(OWNER_FORBIDDEN_MESSAGE);
  }
}

/** Owner always; non-owner hosters only when public hosting is on. */
export function requireHost(user: OwnerLike | null | undefined): void {
  if (canHostTournaments(user)) return;
  if (!user?.uid) {
    throw new Error('403 Forbidden — sign in required to host tournaments.');
  }
  throw new Error(OWNER_FORBIDDEN_MESSAGE);
}
