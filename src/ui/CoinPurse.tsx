import { useState } from 'react';
import { formatSc, normalizeCoins, SUPER_COIN_PUBLIC_PATH } from '../profile/coins';

interface Props {
  coins?: number | null;
  className?: string;
  /** When set, show a small + / Add control next to the balance. */
  onAdd?: () => void;
  /** Tap the purse itself (e.g. open Store). */
  onClick?: () => void;
}

/** Small owner-only purse: [coin img] SC {n} — never shows $. */
export function CoinPurse({ coins, className, onAdd, onClick }: Props) {
  const n = normalizeCoins(coins ?? 0);
  const [imgFailed, setImgFailed] = useState(false);
  const clickable = typeof onClick === 'function';
  return (
    <span
      className={className ? `coin-purse ${className}` : 'coin-purse'}
      title="Super Coins"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onClick();
              }
            }
          : undefined
      }
      style={clickable ? { cursor: 'pointer' } : undefined}
    >
      {!imgFailed && (
        <img
          src={SUPER_COIN_PUBLIC_PATH}
          alt=""
          className="coin-purse-icon"
          width={18}
          height={18}
          onError={() => setImgFailed(true)}
        />
      )}
      <span className="coin-purse-label">{formatSc(n)}</span>
      {onAdd && (
        <button
          type="button"
          className="coin-purse-add"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          aria-label="Add Super Coins"
        >
          +
        </button>
      )}
    </span>
  );
}
