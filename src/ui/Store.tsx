import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../profile/auth';
import {
  SUPER_COIN_PUBLIC_PATH,
  STORE_AVATAR_ITEMS,
  STORE_EMOJI_ITEMS,
  STORE_BOARD_ITEMS,
  STORE_FELT_ITEMS,
  buyShopItemOnProfile,
  formatSc,
  shopUnlockId,
  type SuperCoinShopItem,
} from '../profile/coins';
import { GOOGLE_SIGNIN_PROMO_SC } from '../profile/promos';
import { pushCloudProfile } from '../profile/cloudSync';
import { drainCoinInbox } from '../profile/coinInbox';
import type { Profile } from '../profile/storage';
import { CoinPurse } from './CoinPurse';

interface Props {
  profile: Profile;
  authUser: AuthUser | null;
  uid?: string | null;
  authConfigured?: boolean;
  authBusy?: boolean;
  onSignIn?: () => void;
  onSave: (profile: Profile) => void;
  onBack: () => void;
}

type StoreCategory = {
  id: string;
  label: string;
  blurb: string;
  thumb: string;
  roundThumb?: boolean;
};

/** Locked SuperCoin teasers — Buy Coin only (circle Emoji teaser removed). */
const STORE_CATEGORIES: StoreCategory[] = [
  {
    id: 'buy_coin',
    label: 'Buy Coin',
    blurb: 'Top up Super Coins',
    thumb: SUPER_COIN_PUBLIC_PATH,
    roundThumb: true,
  },
];

/** Full play-plank art for Store BOARD preview (unlockId → URL). */
const BOARD_PREVIEW_SRC: Record<string, string> = {
  zero_forge: '/boards/zero-forge.jpg?v=3',
  cj_dumpster: '/boards/cj-dumpster.jpg?v=17',
  arena: '/boards/arena.jpg?v=2',
  gold: '/boards/gold.jpg?v=1',
};

function boardPreviewSrc(item: SuperCoinShopItem): string {
  const unlock = shopUnlockId(item);
  return BOARD_PREVIEW_SRC[unlock] ?? item.imageSrc ?? '';
}

function ownsShopUnlock(profile: Profile, item: SuperCoinShopItem): boolean {
  const unlock = shopUnlockId(item);
  if (item.kind === 'board') return (profile.ownedBoardIds ?? []).includes(unlock);
  if (item.kind === 'felt') return (profile.ownedFeltIds ?? []).includes(unlock);
  if (item.kind === 'emoji') return (profile.ownedEmojiIds ?? []).includes(unlock);
  return (profile.ownedAvatarIds ?? []).includes(unlock);
}

/** Locked shelf Buy — disabled, Coming soon (no purchase). */
function LockedBuyButton() {
  return (
    <button
      type="button"
      className="btn primary store-buy-btn store-buy-btn-locked"
      disabled
      aria-disabled="true"
      title="Coming soon"
    >
      Buy
    </button>
  );
}

/**
 * Super Coin Store — Avatar + Board + Felt + Emoji open; SuperCoin top-up locked.
 */
export function Store({
  profile,
  authUser,
  uid = null,
  authConfigured = false,
  authBusy = false,
  onSignIn,
  onSave,
  onBack,
}: Props) {
  const [buyBusyId, setBuyBusyId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [boardPreview, setBoardPreview] = useState<{
    label: string;
    src: string;
  } | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void drainCoinInbox(uid, profile).then((next) => {
      if (cancelled) return;
      if (next.coins !== profile.coins || next.coinLedger !== profile.coinLedger) {
        onSave(next);
        void pushCloudProfile(uid, next);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!boardPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBoardPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardPreview]);

  const avatarItems = useMemo(() => STORE_AVATAR_ITEMS, []);
  const boardItems = useMemo(() => STORE_BOARD_ITEMS, []);
  const feltItems = useMemo(() => STORE_FELT_ITEMS, []);
  const emojiItems = useMemo(() => STORE_EMOJI_ITEMS, []);

  const handleBuyShopItem = (item: SuperCoinShopItem) => {
    if (buyBusyId) return;
    setBuyError(null);
    if (ownsShopUnlock(profile, item)) {
      setBuyError('Already owned — equip it in Settings → Felt & Board.');
      return;
    }
    const coins = profile.coins ?? 0;
    if (coins < item.price) {
      setBuyError(`Need ${formatSc(item.price)} (you have ${formatSc(coins)}).`);
      return;
    }
    setBuyBusyId(item.id);
    try {
      const next = buyShopItemOnProfile(profile, item.id);
      const saved: Profile = { ...next, updatedAt: Date.now() };
      onSave(saved);
      if (uid) void pushCloudProfile(uid, saved);
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : 'Purchase failed.');
    } finally {
      setBuyBusyId(null);
    }
  };

  const openBoardPreview = (item: SuperCoinShopItem) => {
    const src = boardPreviewSrc(item);
    if (!src) return;
    setBoardPreview({ label: item.label, src });
  };

  return (
    <div className="panel-screen store-screen" id="super-coin-store">
      <h1 className="title title-coin">STORE</h1>
      <p className="subtitle">Spend Super Coins · never $</p>

      <div className="super-coins-balance-row store-balance">
        <CoinPurse coins={profile.coins} className="coin-purse-store" />
      </div>

      {!authUser && (
        <div className="store-google-promo" role="note">
          <p className="store-google-promo-line">
            Sign up or log in (Google or email) · get {GOOGLE_SIGNIN_PROMO_SC} SC (one-time)
          </p>
          {onSignIn && (
            <button
              type="button"
              className="btn primary store-google-promo-cta"
              disabled={authBusy || !authConfigured}
              onClick={onSignIn}
            >
              {authBusy ? 'Signing in…' : 'Sign in with Google'}
            </button>
          )}
        </div>
      )}

      <h2 className="store-section-title title-coin">
        <span className="coin-metal-text">AVATARS</span>
      </h2>
      <div className="store-teaser-shelf store-shelf-open" aria-label="Avatars for sale">
        <ul className="store-teaser-grid">
          {avatarItems.map((item) => {
            const owned = ownsShopUnlock(profile, item);
            const busy = buyBusyId === item.id;
            return (
              <li key={item.id}>
                <div className={`store-teaser-card${owned ? ' store-card-owned' : ''}`}>
                  <span className="store-teaser-art-wrap" aria-hidden>
                    {item.imageSrc ? (
                      <img
                        src={item.imageSrc}
                        alt=""
                        className="store-teaser-art"
                        width={96}
                        height={96}
                        draggable={false}
                      />
                    ) : (
                      <span className="store-teaser-glyph">{item.glyph}</span>
                    )}
                  </span>
                  <span className="store-teaser-name coin-metal-text">{item.label}</span>
                  <span className="store-teaser-price">
                    {owned ? 'Owned' : formatSc(item.price)}
                  </span>
                  <button
                    type="button"
                    className="btn primary store-buy-btn"
                    disabled={owned || !!buyBusyId}
                    onClick={() => handleBuyShopItem(item)}
                  >
                    {owned ? 'Owned' : busy ? 'Buying…' : 'Buy'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {buyError && (
          <p className="store-buy-error" role="alert">
            {buyError}
          </p>
        )}
      </div>

      <h2 className="store-section-title title-coin">
        <span className="coin-metal-text">BOARD</span>
      </h2>
      <div className="store-teaser-shelf store-shelf-open" aria-label="Board skins for sale">
        <ul className="store-teaser-grid">
          {boardItems.map((item) => {
            const owned = ownsShopUnlock(profile, item);
            const busy = buyBusyId === item.id;
            const previewSrc = boardPreviewSrc(item);
            return (
              <li key={item.id}>
                <div
                  className={`store-teaser-card store-teaser-card-previewable${owned ? ' store-card-owned' : ''}`}
                >
                  <button
                    type="button"
                    className="store-teaser-art-wrap store-teaser-art-wrap-board store-board-preview-hit"
                    aria-label={`Preview ${item.label} board`}
                    onClick={() => openBoardPreview(item)}
                    disabled={!previewSrc}
                  >
                    {item.imageSrc ? (
                      <img
                        src={item.imageSrc}
                        alt=""
                        className="store-teaser-art store-teaser-art-board"
                        width={96}
                        height={96}
                        draggable={false}
                      />
                    ) : (
                      <span className="store-teaser-glyph">{item.glyph}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="store-teaser-name coin-metal-text store-board-preview-hit"
                    onClick={() => openBoardPreview(item)}
                    disabled={!previewSrc}
                  >
                    {item.label}
                  </button>
                  <span className="store-teaser-price">
                    {owned ? 'Owned' : formatSc(item.price)}
                  </span>
                  <button
                    type="button"
                    className="btn primary store-buy-btn"
                    disabled={owned || !!buyBusyId}
                    onClick={() => handleBuyShopItem(item)}
                  >
                    {owned ? 'Owned' : busy ? 'Buying…' : 'Buy'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <h2 className="store-section-title title-coin">
        <span className="coin-metal-text">FELT</span>
      </h2>
      <div className="store-teaser-shelf store-shelf-open" aria-label="Felt themes for sale">
        <ul className="store-teaser-grid">
          {feltItems.map((item) => {
            const owned = ownsShopUnlock(profile, item);
            const busy = buyBusyId === item.id;
            return (
              <li key={item.id}>
                <div className={`store-teaser-card${owned ? ' store-card-owned' : ''}`}>
                  <span className="store-teaser-art-wrap store-teaser-art-wrap-board" aria-hidden>
                    {item.imageSrc ? (
                      <img
                        src={item.imageSrc}
                        alt=""
                        className="store-teaser-art store-teaser-art-board"
                        width={96}
                        height={96}
                        draggable={false}
                      />
                    ) : (
                      <span className="store-teaser-glyph">{item.glyph}</span>
                    )}
                  </span>
                  <span className="store-teaser-name coin-metal-text">{item.label}</span>
                  <span className="store-teaser-price">
                    {owned ? 'Owned' : formatSc(item.price)}
                  </span>
                  <button
                    type="button"
                    className="btn primary store-buy-btn"
                    disabled={owned || !!buyBusyId}
                    onClick={() => handleBuyShopItem(item)}
                  >
                    {owned ? 'Owned' : busy ? 'Buying…' : 'Buy'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <h2 className="store-section-title title-coin">
        <span className="coin-metal-text">EMOJI</span>
      </h2>
      <div className="store-teaser-shelf store-shelf-open" aria-label="Emoji reactions for sale">
        <ul className="store-teaser-grid">
          {emojiItems.map((item) => {
            const owned = ownsShopUnlock(profile, item);
            const busy = buyBusyId === item.id;
            return (
              <li key={item.id}>
                <div className={`store-teaser-card${owned ? ' store-card-owned' : ''}`}>
                  <span className="store-teaser-art-wrap" aria-hidden>
                    {item.imageSrc ? (
                      <img
                        src={item.imageSrc}
                        alt=""
                        className="store-teaser-art"
                        width={96}
                        height={96}
                        draggable={false}
                      />
                    ) : (
                      <span className="store-teaser-glyph">{item.glyph}</span>
                    )}
                  </span>
                  <span className="store-teaser-name coin-metal-text">{item.label}</span>
                  <span className="store-teaser-price">
                    {owned ? 'Owned' : formatSc(item.price)}
                  </span>
                  <button
                    type="button"
                    className="btn primary store-buy-btn"
                    disabled={owned || !!buyBusyId}
                    onClick={() => handleBuyShopItem(item)}
                  >
                    {owned ? 'Owned' : busy ? 'Buying…' : 'Buy'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <h2 className="store-section-title title-coin store-section-title-sm">
        <span className="coin-metal-text">SUPERCOIN</span>
      </h2>
      <div className="store-teaser-shelf store-teaser-locked" aria-label="Locked store categories">
        <ul className="store-teaser-grid store-teaser-grid-cats">
          {STORE_CATEGORIES.map((cat) => (
            <li key={cat.id}>
              <div className="store-teaser-card store-teaser-card-locked" aria-disabled="true">
                <span className="store-card-lock-chip" title="Coming soon" aria-hidden>
                  🔒
                </span>
                <span
                  className={`store-teaser-art-wrap${cat.roundThumb ? ' store-teaser-art-wrap-coin' : ''}`}
                  aria-hidden
                >
                  <img
                    src={cat.thumb}
                    alt=""
                    className={`store-teaser-art${cat.roundThumb ? ' store-teaser-art-coin' : ''}`}
                    width={96}
                    height={96}
                    draggable={false}
                  />
                </span>
                <span className="store-teaser-name coin-metal-text">{cat.label}</span>
                <span className="store-teaser-price">{cat.blurb}</span>
                <LockedBuyButton />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="record-note store-foot-note">
        Unlock cosmetics with Super Coins as shelves open.
      </p>

      <button type="button" className="btn store-back menu-action" onClick={onBack}>
        <span className="coin-metal-text">Back</span>
      </button>

      {boardPreview && (
        <div
          className="store-board-preview-backdrop"
          role="presentation"
          onClick={() => setBoardPreview(null)}
        >
          <div
            className="store-board-preview-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${boardPreview.label} board preview`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="store-board-preview-title coin-metal-text">{boardPreview.label}</h2>
            <img
              src={boardPreview.src}
              alt={`${boardPreview.label} pegboard`}
              className="store-board-preview-img"
              draggable={false}
            />
            <button
              type="button"
              className="btn menu-action store-board-preview-close"
              onClick={() => setBoardPreview(null)}
            >
              <span className="coin-metal-text">Close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
