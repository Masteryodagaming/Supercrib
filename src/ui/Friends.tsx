import { useEffect, useState } from 'react';
import {
  Friend,
  cloudFriendsOnly,
  loadFriends,
  loadProfile,
  removeFriend,
} from '../profile/storage';
import {
  resolveFriendQuery,
  saveFriendsForAccountDetailed,
} from '../profile/cloudSync';
import {
  FriendRequest,
  OutgoingRequest,
  acceptFriendRequest,
  cancelOutgoingRequest,
  clearOutgoingIfNeeded,
  declineFriendRequest,
  sendFriendRequest,
  subscribeAndProcessAccepts,
  subscribeIncomingRequests,
  subscribeOutgoingRequests,
  watchOutgoingRequestStatus,
} from '../profile/friendRequests';

interface Props {
  onBack: () => void;
  /** When set, friends list syncs to RTDB users/{uid}/friends. */
  uid?: string | null;
  signedIn?: boolean;
  /** Own player code when signed in (show + copy). */
  playerCode?: string | null;
  authConfigured?: boolean;
  authBusy?: boolean;
  authError?: string | null;
  /** Trigger Google sign-in (wired from App). */
  onSignIn?: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function Friends({
  onBack,
  uid = null,
  signedIn = false,
  playerCode = null,
  authConfigured = true,
  authBusy = false,
  authError = null,
  onSignIn,
}: Props) {
  const [friends, setFriends] = useState<Friend[]>(() =>
    signedIn ? cloudFriendsOnly(loadFriends()) : [],
  );
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
  const [query, setQuery] = useState('');
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!signedIn || !uid) {
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setSyncNote(null);
      setSyncError(null);
      setAddError(null);
      setQuery('');
      return;
    }
    // Drop legacy local-only name entries; rewrite storage + sync cleaned list.
    const loaded = loadFriends();
    const cleaned = cloudFriendsOnly(loaded);
    setFriends(cleaned);
    setSyncNote(null);
    setSyncError(null);
    setAddError(null);
    setIncoming([]);
    setOutgoing([]);
    if (cleaned.length !== loaded.length) {
      void saveFriendsForAccountDetailed(cleaned, uid).then(
        ({ synced, syncError: err }) => {
          if (err) {
            setSyncError(err);
            setSyncNote(null);
            return;
          }
          setSyncError(null);
          setSyncNote(
            synced
              ? 'Removed local-only friends · synced'
              : 'Removed local-only friends · saved on this device',
          );
        },
      );
    }
  }, [uid, signedIn]);

  // Incoming + outgoing + accept receipts when signed in
  useEffect(() => {
    if (!signedIn || !uid) return;

    const unsubIn = subscribeIncomingRequests(uid, setIncoming);
    const unsubOut = subscribeOutgoingRequests(uid, setOutgoing);
    const unsubAccept = subscribeAndProcessAccepts(uid, (next) => {
      setFriends(cloudFriendsOnly(next));
      setSyncNote('Friend added (they accepted)');
      setSyncError(null);
    });

    return () => {
      unsubIn();
      unsubOut();
      unsubAccept();
    };
  }, [signedIn, uid]);

  // When remote deletes a pending request (decline), clear our outgoing row
  useEffect(() => {
    if (!signedIn || !uid || outgoing.length === 0) return;
    const unsubs = outgoing.map((o) =>
      watchOutgoingRequestStatus(uid, o.toUid, () => {
        // Already friends → accept path cleared outgoing; otherwise decline
        const stillFriend = loadFriends().some(
          (f) => f.uid === o.toUid || f.id === o.toUid,
        );
        if (!stillFriend) {
          void clearOutgoingIfNeeded(uid, o.toUid);
        }
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [signedIn, uid, outgoing]);

  const pushList = (next: Friend[]) => {
    if (!uid) {
      setSyncNote(null);
      setSyncError(null);
      return;
    }
    void saveFriendsForAccountDetailed(next, uid).then(({ synced, syncError: err }) => {
      if (err) {
        setSyncError(err);
        setSyncNote(null);
        return;
      }
      setSyncError(null);
      setSyncNote(synced ? 'Synced across your devices' : 'Saved on this device');
    });
  };

  const onAddSignedIn = async () => {
    setAddError(null);
    setSyncNote(null);
    const raw = query.trim();
    if (!raw) {
      setAddError('Enter a player code or email.');
      return;
    }
    if (!uid) {
      setAddError('Sign in to add friends by code or email.');
      return;
    }
    setAdding(true);
    try {
      const found = await resolveFriendQuery(raw);
      if (!found) {
        setAddError('No player found for that code or email.');
        return;
      }
      const profile = loadProfile();
      const result = await sendFriendRequest({
        fromUid: uid,
        fromName: profile?.displayName ?? 'Player',
        fromCode: playerCode ?? profile?.playerCode,
        toUid: found.uid,
        toName: found.displayName,
      });
      if (!result.ok) {
        setAddError(result.message);
        return;
      }
      setQuery('');
      setSyncNote(`Request sent to ${result.toName}.`);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not look up player.');
    } finally {
      setAdding(false);
    }
  };

  const onRemove = (id: string) => {
    const next = cloudFriendsOnly(removeFriend(id));
    setFriends(next);
    pushList(next);
  };

  const onAccept = async (req: FriendRequest) => {
    if (!uid) return;
    setBusyId(`in:${req.fromUid}`);
    setAddError(null);
    try {
      const profile = loadProfile();
      const next = cloudFriendsOnly(
        await acceptFriendRequest(
          uid,
          profile?.displayName ?? 'Player',
          req,
        ),
      );
      setFriends(next);
      setSyncNote(`You and ${req.fromName} are now friends.`);
      setSyncError(null);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not accept request.');
    } finally {
      setBusyId(null);
    }
  };

  const onDecline = async (req: FriendRequest) => {
    if (!uid) return;
    setBusyId(`in:${req.fromUid}`);
    setAddError(null);
    try {
      await declineFriendRequest(uid, req.fromUid);
      setSyncNote('Request declined.');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not decline request.');
    } finally {
      setBusyId(null);
    }
  };

  const onCancelOutgoing = async (o: OutgoingRequest) => {
    if (!uid) return;
    setBusyId(`out:${o.toUid}`);
    setAddError(null);
    try {
      await cancelOutgoingRequest(uid, o.toUid);
      setSyncNote('Request cancelled.');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not cancel request.');
    } finally {
      setBusyId(null);
    }
  };

  const onCopyCode = () => {
    if (!playerCode) return;
    void copyText(playerCode).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  if (!signedIn) {
    return (
      <div className="panel-screen friends-screen friends-screen-locked">
        <h1 className="title title-coin">FRIENDS</h1>
        <p className="subtitle">Sign in to add friends</p>

        <div className="friends-locked-panel" aria-disabled="true">
          <div className="friends-locked-overlay" aria-hidden="true" />
          {/* No friend rows, no LOCAL badges, no add-by-name for guests */}
          <div className="friends-empty friends-locked-dim">
            <p>Sign in to add friends</p>
            <p className="friends-empty-hint">
              Friends are cloud-only (player code or email). There is no local name list.
            </p>
          </div>
        </div>

        <div className="friends-locked-cta">
          <p className="friends-cloud-banner friends-signin-prompt" role="status">
            Sign in with Google to send and receive friend requests, see Incoming / Outgoing,
            and keep mutual friends across devices.
          </p>
          <button
            type="button"
            className="btn primary auth-btn"
            disabled={authBusy || !authConfigured || !onSignIn}
            onClick={() => onSignIn?.()}
          >
            {authBusy ? 'Signing in…' : 'Sign in with Google'}
          </button>
          {!authConfigured && (
            <p className="auth-hint" role="status">
              Firebase Auth not configured — guest play still works elsewhere.
            </p>
          )}
          {authError && (
            <p className="auth-error" role="alert">
              {authError}
            </p>
          )}
        </div>

        <button type="button" className="menu-action" onClick={onBack}>
          <span className="coin-metal-text">Back</span>
        </button>
      </div>
    );
  }

  return (
    <div className="panel-screen friends-screen">
      <h1 className="title">FRIENDS</h1>
      <p className="subtitle">
        Send a request by player code or email · mutual when accepted
      </p>

      {playerCode && (
        <div className="player-code-card" role="status">
          <span className="player-code-label">Your code</span>
          <span className="player-code-value">{playerCode}</span>
          <button type="button" className="btn player-code-copy" onClick={onCopyCode}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      <p className="friends-cloud-banner" role="status">
        Adding someone sends a request. They must Accept before you both appear on each
        other&apos;s lists.
      </p>

      <div className="friend-add-row">
        <input
          className="field-input"
          type="text"
          maxLength={64}
          placeholder="Player code or email"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onAddSignedIn();
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
        />
        <button
          type="button"
          className="btn primary friend-add-btn"
          onClick={() => void onAddSignedIn()}
          disabled={adding}
        >
          {adding ? '…' : 'Add'}
        </button>
      </div>

      {addError && (
        <p className="auth-error friends-sync-note" role="alert">
          {addError}
        </p>
      )}
      {syncNote && <p className="friends-sync-note">{syncNote}</p>}
      {syncError && (
        <p className="auth-error friends-sync-note" role="alert">
          {syncError}
        </p>
      )}

      {incoming.length > 0 && (
        <section className="friends-section" aria-label="Incoming requests">
          <h2 className="friends-section-title">Incoming requests</h2>
          <ul className="friends-list">
            {incoming.map((req) => (
              <li key={req.fromUid} className="friend-row friend-request-row">
                <div className="friend-info">
                  <span className="friend-name">{req.fromName}</span>
                  <span className="friend-status">
                    {req.fromCode ? `Code ${req.fromCode}` : 'Wants to be friends'}
                  </span>
                </div>
                <div className="friend-request-actions">
                  <button
                    type="button"
                    className="btn primary friend-accept"
                    disabled={busyId === `in:${req.fromUid}`}
                    onClick={() => void onAccept(req)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn friend-decline"
                    disabled={busyId === `in:${req.fromUid}`}
                    onClick={() => void onDecline(req)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="friends-section" aria-label="Outgoing pending">
          <h2 className="friends-section-title">Outgoing pending</h2>
          <ul className="friends-list">
            {outgoing.map((o) => (
              <li key={o.toUid} className="friend-row">
                <div className="friend-info">
                  <span className="friend-name">{o.toName}</span>
                  <span className="friend-status">Pending</span>
                </div>
                <button
                  type="button"
                  className="btn friend-remove"
                  disabled={busyId === `out:${o.toUid}`}
                  onClick={() => void onCancelOutgoing(o)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="friends-section" aria-label="Friends list">
        {(incoming.length > 0 || outgoing.length > 0 || friends.length > 0) && (
          <h2 className="friends-section-title">Friends</h2>
        )}
        {friends.length === 0 ? (
          <div className="friends-empty">
            <p>No friends yet.</p>
            <p className="friends-empty-hint">
              Ask a friend for their player code (Settings → Account) or email
            </p>
          </div>
        ) : (
          <ul className="friends-list">
            {cloudFriendsOnly(friends).map((f) => (
              <li key={f.uid ?? f.id} className="friend-row">
                <div className="friend-info">
                  <span className="friend-name">{f.name}</span>
                  <span className="friend-status status-offline">Synced</span>
                </div>
                <button type="button" className="btn friend-remove" onClick={() => onRemove(f.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="menu-action" onClick={onBack}>
        <span className="coin-metal-text">Back</span>
      </button>
    </div>
  );
}
