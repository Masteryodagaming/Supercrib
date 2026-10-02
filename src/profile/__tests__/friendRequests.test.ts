import { describe, it, expect, beforeEach } from 'vitest';
import {
  friendAcceptPath,
  friendRequestPath,
  outgoingRequestPath,
  sendFriendRequest,
} from '../friendRequests';
import { addCloudFriend, clearProfileStorage, loadFriends } from '../storage';

/** Minimal localStorage mock for node vitest. */
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
  clearProfileStorage();
});

describe('friend request paths', () => {
  it('builds inbox / accept / outgoing paths', () => {
    expect(friendRequestPath('to1', 'from1')).toBe('friendRequests/to1/from1');
    expect(friendAcceptPath('a', 'b')).toBe('friendAccepts/a/b');
    expect(outgoingRequestPath('a', 'b')).toBe('users/a/outgoingRequests/b');
  });
});

describe('sendFriendRequest guards (no firebase)', () => {
  it('rejects self', async () => {
    const r = await sendFriendRequest({
      fromUid: 'u1',
      fromName: 'Me',
      toUid: 'u1',
      toName: 'Me',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('self');
    }
  });

  it('rejects already friends', async () => {
    addCloudFriend('u2', 'Dad');
    expect(loadFriends()).toHaveLength(1);
    const r = await sendFriendRequest({
      fromUid: 'u1',
      fromName: 'Josh',
      toUid: 'u2',
      toName: 'Dad',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('already_friends');
      expect(r.message).toMatch(/already friends/i);
    }
  });
});
