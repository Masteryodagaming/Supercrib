/** Room code helpers — no Firebase. Ambiguous chars (0/O, 1/I/L) omitted. */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 5, rng: () => number = Math.random): string {
  const n = Math.max(4, Math.min(6, Math.floor(length)));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return out;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  const c = normalizeRoomCode(code);
  if (c.length < 4 || c.length > 6) return false;
  return [...c].every((ch) => ALPHABET.includes(ch));
}

export { ALPHABET };
