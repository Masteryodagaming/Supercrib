/**
 * Short shareable player codes (no ambiguous 0/O/1/I).
 * Codes live on users/{uid}/profile.playerCode and are indexed at playerCodes/{code}.
 */

export const PLAYER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PLAYER_CODE_LENGTH = 6;

export function generatePlayerCode(
  length = PLAYER_CODE_LENGTH,
  rng: () => number = Math.random,
): string {
  const n = Math.max(6, Math.min(8, Math.floor(length)));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += PLAYER_CODE_ALPHABET[Math.floor(rng() * PLAYER_CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizePlayerCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlayerCode(code: string): boolean {
  const c = normalizePlayerCode(code);
  if (c.length < 6 || c.length > 8) return false;
  return [...c].every((ch) => PLAYER_CODE_ALPHABET.includes(ch));
}

/** Looks like an email (contains @) rather than a player code. */
export function looksLikeEmail(raw: string): boolean {
  const t = raw.trim();
  return t.includes('@') && t.includes('.');
}

/** RTDB-safe key: lower/trim and replace `.` with `,`. */
export function emailIndexKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
