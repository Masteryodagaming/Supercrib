/**
 * Home header notifications — static news + localStorage read state.
 * Friend-request unread comes from live inbox count (not stored here).
 */

export const NOTIF_READ_STORAGE_KEY = 'supercrib.notif.read.v1';

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  /** Sort key — newer first when descending. */
  createdAt: number;
}

/** Seed list; grow later without migration (unread = ids not in read set). */
export const NEWS_ITEMS: NewsItem[] = [
  {
    id: 'club-night',
    title: 'Tournaments are open',
    body: 'Jump into Tournaments when an event is live.',
    createdAt: Date.UTC(2026, 8, 1),
  },
  {
    id: 'email-signin',
    title: 'Email sign-in is on',
    body: 'Create an account with email in Settings — same promo as Google.',
    createdAt: Date.UTC(2026, 7, 20),
  },
  {
    id: 'new-store',
    title: 'New Store coming',
    body: 'Spend Super Coins on cosmetics as categories unlock.',
    createdAt: Date.UTC(2026, 7, 10),
  },
];

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadReadNewsIds(): Set<string> {
  const ls = storage();
  if (!ls) return new Set();
  try {
    const raw = ls.getItem(NOTIF_READ_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function saveReadNewsIds(ids: Set<string>): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(NOTIF_READ_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

export function markNewsIdsRead(ids: string[]): Set<string> {
  const next = loadReadNewsIds();
  for (const id of ids) next.add(id);
  saveReadNewsIds(next);
  return next;
}

export function markAllNewsRead(): Set<string> {
  return markNewsIdsRead(NEWS_ITEMS.map((n) => n.id));
}

export function markNewsItemRead(id: string): Set<string> {
  return markNewsIdsRead([id]);
}

export function unreadNewsIds(read: Set<string> = loadReadNewsIds()): string[] {
  return NEWS_ITEMS.filter((n) => !read.has(n.id)).map((n) => n.id);
}

export function unreadNewsCount(read: Set<string> = loadReadNewsIds()): number {
  return unreadNewsIds(read).length;
}

export function sortedNewsItems(): NewsItem[] {
  return [...NEWS_ITEMS].sort((a, b) => b.createdAt - a.createdAt);
}
