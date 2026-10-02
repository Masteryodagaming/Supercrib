import {
  CRIB_MASTER_ID,
  getBuiltinAvatar,
  getExclusiveGiftAvatar,
  getTournamentPrizeAvatar,
  MASTER_YODA_ID,
} from '../profile/avatars';
import { getShopAvatarItem } from '../profile/coins';
import type { Profile } from '../profile/storage';

interface Props {
  profile: Pick<Profile, 'displayName' | 'avatarId' | 'avatarDataUrl'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AvatarView({ profile, size = 'md', className = '' }: Props) {
  const avatarId = profile?.avatarId ?? '';
  const builtin = getBuiltinAvatar(avatarId);
  // Shop catalog id (avatar_*) OR ownership unlockId (e.g. supercrib_father).
  const shop = getShopAvatarItem(avatarId);
  const dim = size === 'lg' ? 72 : size === 'sm' ? 36 : 52;
  const displayName = profile?.displayName || 'Player';

  // Leftover custom upload takes precedence while present.
  // Selecting builtins (incl. Crib Master) clears avatarDataUrl in Settings/Login.
  if (profile?.avatarDataUrl) {
    return (
      <img
        className={`avatar avatar-img ${className}`}
        src={profile.avatarDataUrl}
        alt={displayName}
        width={dim}
        height={dim}
        style={{ width: dim, height: dim }}
      />
    );
  }

  if (shop) {
    if (shop.imageSrc) {
      return (
        <img
          className={`avatar avatar-img ${className}`}
          src={shop.imageSrc}
          alt={shop.label}
          width={dim}
          height={dim}
          style={{
            width: dim,
            height: dim,
            background: 'linear-gradient(145deg,#4a3a10,#241a08)',
          }}
        />
      );
    }
    return (
      <div
        className={`avatar avatar-builtin ${className}`}
        style={{
          width: dim,
          height: dim,
          background: 'linear-gradient(145deg,#4a3a10,#241a08)',
        }}
        title={shop.label}
        aria-label={shop.label}
      >
        <span className="avatar-glyph">{shop.glyph}</span>
      </div>
    );
  }

  // Builtin art (defaults + Crib Master); master_yoda resolves via getBuiltinAvatar alias.
  const resolvedId = avatarId === MASTER_YODA_ID ? CRIB_MASTER_ID : avatarId;
  if (builtin.imageSrc && builtin.id === resolvedId) {
    return (
      <img
        className={`avatar avatar-img ${className}`}
        src={builtin.imageSrc}
        alt={builtin.label}
        width={dim}
        height={dim}
        style={{ width: dim, height: dim, background: builtin.bg }}
      />
    );
  }

  const prize = getTournamentPrizeAvatar(avatarId);
  if (prize?.imageSrc) {
    return (
      <img
        className={`avatar avatar-img ${className}`}
        src={prize.imageSrc}
        alt={prize.label}
        width={dim}
        height={dim}
        style={{ width: dim, height: dim, background: 'linear-gradient(145deg,#4a3a10,#241a08)' }}
      />
    );
  }

  const exclusive = getExclusiveGiftAvatar(avatarId);
  if (exclusive?.imageSrc) {
    return (
      <img
        className={`avatar avatar-img ${className}`}
        src={exclusive.imageSrc}
        alt={exclusive.label}
        width={dim}
        height={dim}
        style={{
          width: dim,
          height: dim,
          background: exclusive.bg ?? 'linear-gradient(145deg,#4a3a10,#241a08)',
        }}
      />
    );
  }

  return (
    <div
      className={`avatar avatar-builtin ${className}`}
      style={{ width: dim, height: dim, background: builtin.bg }}
      title={builtin.label}
      aria-label={builtin.label}
    >
      <span className="avatar-glyph">{builtin.glyph}</span>
    </div>
  );
}
