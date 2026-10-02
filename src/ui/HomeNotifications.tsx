import { useEffect, useMemo, useState } from 'react';
import {
  FriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  subscribeIncomingRequests,
} from '../profile/friendRequests';
import {
  loadReadNewsIds,
  markAllNewsRead,
  markNewsItemRead,
  sortedNewsItems,
  unreadNewsCount,
  type NewsItem,
} from '../profile/notifications';
import {
  claimAvatarGift,
  subscribeAvatarGifts,
  type AvatarGiftEntry,
} from '../profile/avatarGiftInbox';
import { getExclusiveGiftAvatar } from '../profile/avatars';
import { loadProfile, type Profile } from '../profile/storage';

interface Props {
  uid: string | null;
  signedIn: boolean;
  /** Keep App profile in sync after a successful gift claim (Settings Signature list). */
  onProfileUpdate?: (p: Profile) => void;
}

type PendingGift = { id: string; entry: AvatarGiftEntry };

function BellIcon() {
  return (
    <svg
      className="home-notif-bell-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3a5.5 5.5 0 0 0-5.5 5.5v2.1c0 .7-.2 1.4-.6 2L4.6 14.4c-.7 1-.1 2.4 1.1 2.4h12.6c1.2 0 1.8-1.4 1.1-2.4l-1.3-1.8c-.4-.6-.6-1.3-.6-2V8.5A5.5 5.5 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 18.5a2.5 2.5 0 0 0 5 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HomeNotifications({ uid, signedIn, onProfileUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [gifts, setGifts] = useState<PendingGift[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadNewsIds());
  const [hiddenNews, setHiddenNews] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const news = useMemo(
    () => sortedNewsItems().filter((n) => !hiddenNews.has(n.id)),
    [hiddenNews],
  );
  const friendUnread = signedIn && uid ? incoming.length : 0;
  const giftUnread = signedIn && uid ? gifts.length : 0;
  const newsUnread = unreadNewsCount(readIds);
  const badge = friendUnread + giftUnread + newsUnread;

  useEffect(() => {
    if (!signedIn || !uid) {
      setIncoming([]);
      return;
    }
    return subscribeIncomingRequests(uid, setIncoming);
  }, [signedIn, uid]);

  useEffect(() => {
    if (!signedIn || !uid) {
      setGifts([]);
      return;
    }
    return subscribeAvatarGifts(uid, setGifts);
  }, [signedIn, uid]);

  const openPanel = () => {
    setOpen(true);
    setActionNote(null);
    setActionError(null);
    // Opening the inbox marks news read so the badge clears.
    setReadIds(markAllNewsRead());
  };

  const closePanel = () => setOpen(false);

  const onDismissNews = (item: NewsItem) => {
    setReadIds(markNewsItemRead(item.id));
    setHiddenNews((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  };

  const onAccept = async (req: FriendRequest) => {
    if (!uid) return;
    setBusyId(req.fromUid);
    setActionError(null);
    try {
      const profile = loadProfile();
      await acceptFriendRequest(uid, profile?.displayName ?? 'Player', req);
      setActionNote(`You and ${req.fromName} are now friends.`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not accept request.');
    } finally {
      setBusyId(null);
    }
  };

  const onDecline = async (req: FriendRequest) => {
    if (!uid) return;
    setBusyId(req.fromUid);
    setActionError(null);
    try {
      await declineFriendRequest(uid, req.fromUid);
      setActionNote('Request declined.');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not decline request.');
    } finally {
      setBusyId(null);
    }
  };

  const onClaimGift = async (gift: PendingGift) => {
    if (!uid) return;
    setBusyId(`gift:${gift.id}`);
    setActionError(null);
    try {
      const result = await claimAvatarGift(uid, gift.id);
      // Local grant may succeed even when cloud sync fails — refresh App state when present.
      if (result.ok) {
        onProfileUpdate?.(result.profile);
      } else if (result.profile) {
        onProfileUpdate?.(result.profile);
      }
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      const label = result.avatarLabel || 'avatar';
      setActionNote(
        result.alreadyOwned
          ? `You already own ${label}. Gift cleared.`
          : `Claimed ${label}! Equip it in Settings.`,
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not claim gift.');
    } finally {
      setBusyId(null);
    }
  };

  const badgeLabel =
    badge > 99 ? '99+' : badge > 0 ? String(badge) : undefined;

  return (
    <>
      <div className="home-header-notif-slot">
        <button
          type="button"
          className="home-notif-btn"
          onClick={openPanel}
          aria-label={
            badge > 0
              ? `Notifications, ${badge} unread`
              : 'Notifications'
          }
        >
          <BellIcon />
          {badgeLabel && (
            <span className="home-notif-badge" aria-hidden="true">
              {badgeLabel}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          className="home-notif-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <div className="home-notif-sheet overlay-card">
            <div className="home-notif-sheet-header">
              <div>
                <h2>Notifications</h2>
                <p className="home-notif-hint">You&apos;ll see your notifications</p>
              </div>
              <button
                type="button"
                className="tl-sheet-close home-notif-close"
                onClick={closePanel}
                aria-label="Close notifications"
              >
                ×
              </button>
            </div>

            <section className="home-notif-section" aria-label="Gifts">
              <h3 className="home-notif-section-title">Gifts</h3>
              {!signedIn || !uid ? (
                <p className="home-notif-empty">Sign in to see gifts</p>
              ) : gifts.length === 0 ? (
                <p className="home-notif-empty">No gifts right now</p>
              ) : (
                <ul className="home-notif-list">
                  {gifts.map((gift) => {
                    const sender =
                      gift.entry.fromName?.trim() || 'Someone';
                    const label = gift.entry.avatarLabel;
                    const catalog = getExclusiveGiftAvatar(gift.entry.avatarId);
                    const thumb =
                      gift.entry.imageSrc ||
                      catalog?.imageSrc ||
                      undefined;
                    return (
                      <li
                        key={gift.id}
                        className="home-notif-item home-notif-gift"
                      >
                        <div className="home-notif-gift-row">
                          {thumb ? (
                            <img
                              className="home-notif-gift-thumb"
                              src={thumb}
                              alt=""
                              width={40}
                              height={40}
                            />
                          ) : (
                            <span
                              className="home-notif-gift-thumb home-notif-gift-glyph"
                              aria-hidden="true"
                            >
                              {catalog?.glyph ?? '🎁'}
                            </span>
                          )}
                          <div className="home-notif-gift-body">
                            <span className="home-notif-news-title">
                              Gift: {label}
                            </span>
                            <span className="home-notif-news-copy">
                              {sender} sent you {label}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn primary home-notif-claim"
                          disabled={busyId === `gift:${gift.id}`}
                          onClick={() => void onClaimGift(gift)}
                        >
                          Claim
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

              {actionNote && (
                <p className="home-notif-note" role="status">
                  {actionNote}
                </p>
              )}
              {actionError && (
                <p className="auth-error home-notif-note" role="alert">
                  {actionError}
                </p>
              )}

            <section className="home-notif-section" aria-label="Friend requests">
              <h3 className="home-notif-section-title">Friend requests</h3>
              {!signedIn || !uid ? (
                <p className="home-notif-empty">Sign in to see friend requests</p>
              ) : incoming.length === 0 ? (
                <p className="home-notif-empty">No friend requests right now</p>
              ) : (
                <ul className="home-notif-list">
                  {incoming.map((req) => (
                    <li key={req.fromUid} className="home-notif-item friend-request-row">
                      <div className="friend-info">
                        <span className="friend-name">{req.fromName}</span>
                        <span className="friend-status">
                          {req.fromCode
                            ? `Code ${req.fromCode}`
                            : 'Wants to be friends'}
                        </span>
                      </div>
                      <div className="friend-request-actions">
                        <button
                          type="button"
                          className="btn primary friend-accept"
                          disabled={busyId === req.fromUid}
                          onClick={() => void onAccept(req)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn friend-decline"
                          disabled={busyId === req.fromUid}
                          onClick={() => void onDecline(req)}
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="home-notif-section" aria-label="News and updates">
              <h3 className="home-notif-section-title">News &amp; updates</h3>
              {news.length === 0 ? (
                <p className="home-notif-empty">No updates right now</p>
              ) : (
                <ul className="home-notif-list">
                  {news.map((item) => (
                    <li key={item.id} className="home-notif-item home-notif-news">
                      <div className="home-notif-news-body">
                        <span className="home-notif-news-title">{item.title}</span>
                        <span className="home-notif-news-copy">{item.body}</span>
                      </div>
                      <button
                        type="button"
                        className="btn home-notif-dismiss"
                        onClick={() => onDismissNews(item)}
                        aria-label={`Dismiss ${item.title}`}
                      >
                        Dismiss
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
