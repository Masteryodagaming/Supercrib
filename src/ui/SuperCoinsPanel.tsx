import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../profile/auth';
import {
  TOURNAMENT_CREATE_COST,
  applyDeltaToProfile,
  formatSc,
  normalizeCoins,
  setBalanceOnProfile,
} from '../profile/coins';
import {
  lookupByPlayerCode,
  saveProfileForAccountDetailed,
} from '../profile/cloudSync';
import { sendCoinsToPlayerCode } from '../profile/coinInbox';
import { isValidPlayerCode, normalizePlayerCode } from '../profile/playerCode';
import type { Profile } from '../profile/storage';
import { isOwner } from '../tournament/isOwner';
import { CoinPurse } from './CoinPurse';

interface Props {
  profile: Profile;
  authUser: AuthUser | null;
  uid?: string | null;
  onSave: (profile: Profile) => void;
}

/**
 * Owner-only Doctor coins admin tooling (set/add/remove/send + ledger).
 * Shop lives in Store.tsx — not here.
 */
export function SuperCoinsPanel({ profile, authUser, uid = null, onSave }: Props) {
  const owner = isOwner(authUser);
  const [setValue, setSetValue] = useState(String(normalizeCoins(profile.coins ?? 0)));
  const [grantValue, setGrantValue] = useState('100');
  const [sendCode, setSendCode] = useState('');
  const [sendAmount, setSendAmount] = useState('50');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setSetValue(String(normalizeCoins(profile.coins ?? 0)));
  }, [profile.coins]);

  const ledger = useMemo(() => {
    const rows = Array.isArray(profile.coinLedger) ? profile.coinLedger : [];
    return [...rows].reverse().slice(0, 20);
  }, [profile.coinLedger]);

  if (!owner) return null;

  const persist = async (next: Profile, successMsg: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { value, syncError } = await saveProfileForAccountDetailed(
        next,
        uid,
        authUser?.email ?? null,
      );
      onSave(value);
      if (syncError) {
        setError(syncError);
      } else {
        setOk(successMsg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Coin update failed');
    } finally {
      setBusy(false);
    }
  };

  const onSetBalance = () => {
    const n = Number(setValue);
    if (!Number.isFinite(n) || n < 0) {
      setError('Balance must be a number ≥ 0.');
      return;
    }
    try {
      const next = setBalanceOnProfile(profile, n, note.trim() || 'Doctor set balance');
      void persist(next, `Balance set to ${formatSc(n)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Set failed');
    }
  };

  const onGrant = (sign: 1 | -1) => {
    const n = Number(grantValue);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive amount to add or remove.');
      return;
    }
    const delta = sign * Math.floor(n);
    try {
      const next = applyDeltaToProfile(
        profile,
        delta,
        'admin_grant',
        note.trim() || (delta >= 0 ? 'Doctor grant' : 'Doctor remove'),
      );
      void persist(next, delta >= 0 ? `Added ${formatSc(delta)}` : `Removed ${formatSc(-delta)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grant failed');
    }
  };

  const onSendToCode = () => {
    const codeRaw = sendCode.trim();
    const normalized = normalizePlayerCode(codeRaw);
    if (!isValidPlayerCode(normalized)) {
      setError('Enter a valid player code.');
      return;
    }
    const n = Number(sendAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive Super Coin amount.');
      return;
    }
    const amount = Math.floor(n);
    const fromUid = authUser?.uid;
    if (!fromUid) {
      setError('Sign in required to send Super Coins.');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    void (async () => {
      try {
        const lookup = await lookupByPlayerCode(normalized);
        if (!lookup) {
          setError('No player found for that code.');
          return;
        }
        const sendNote =
          note.trim() ||
          `Doctor adjustment/purchase → ${lookup.displayName} (${normalized})`;
        const { result, localProfile } = await sendCoinsToPlayerCode({
          fromUid,
          fromName: profile.displayName || authUser?.displayName || 'Doctor',
          fromProfile: profile,
          toUid: lookup.uid,
          toName: lookup.displayName,
          amount,
          note: sendNote,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (result.mode === 'local' && localProfile) {
          const { value, syncError } = await saveProfileForAccountDetailed(
            localProfile,
            uid,
            authUser?.email ?? null,
          );
          onSave(value);
          if (syncError) {
            setError(syncError);
            return;
          }
        }
        setOk(
          `Sent ${formatSc(result.amount)} to ${result.toName}${
            result.mode === 'inbox' ? ' (pending inbox)' : ''
          }`,
        );
        setSendCode('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section id="doctor-coins" className="super-coins-panel doctor-coins-panel" aria-label="Doctor coins">
      <p className="section-label">Doctor coins</p>
      <div className="super-coins-balance-row">
        <CoinPurse coins={profile.coins} />
      </div>
      <p className="record-note">
        Owner admin · never $. Tournament create costs {formatSc(TOURNAMENT_CREATE_COST)}; joining is free.
      </p>

      <label className="field-label" htmlFor="sc-note">
        Note (optional)
      </label>
      <input
        id="sc-note"
        className="field-input"
        type="text"
        maxLength={120}
        value={note}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why this change?"
      />

      <label className="field-label" htmlFor="sc-set">
        Set balance (≥0)
      </label>
      <div className="super-coins-row">
        <input
          id="sc-set"
          className="field-input"
          type="number"
          min={0}
          step={1}
          value={setValue}
          disabled={busy}
          onChange={(e) => setSetValue(e.target.value)}
        />
        <button type="button" className="btn sc-compact" disabled={busy} onClick={onSetBalance}>
          Set
        </button>
      </div>

      <label className="field-label" htmlFor="sc-grant">
        Add / remove
      </label>
      <div className="super-coins-row">
        <input
          id="sc-grant"
          className="field-input"
          type="number"
          min={1}
          step={1}
          value={grantValue}
          disabled={busy}
          onChange={(e) => setGrantValue(e.target.value)}
        />
        <button type="button" className="btn primary sc-compact" disabled={busy} onClick={() => onGrant(1)}>
          Add
        </button>
        <button type="button" className="btn sc-compact" disabled={busy} onClick={() => onGrant(-1)}>
          Remove
        </button>
      </div>

      <label className="field-label" htmlFor="sc-send-code">
        Adjustment / purchase (player code)
      </label>
      <div className="super-coins-row">
        <input
          id="sc-send-code"
          className="field-input"
          type="text"
          maxLength={12}
          value={sendCode}
          disabled={busy}
          onChange={(e) => setSendCode(e.target.value.toUpperCase())}
          placeholder="Player code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <label className="field-label" htmlFor="sc-send-amount">
        Amount (SC)
      </label>
      <div className="super-coins-row">
        <input
          id="sc-send-amount"
          className="field-input"
          type="number"
          min={1}
          step={1}
          value={sendAmount}
          disabled={busy}
          onChange={(e) => setSendAmount(e.target.value)}
        />
        <button
          type="button"
          className="btn primary sc-compact"
          disabled={busy}
          onClick={onSendToCode}
        >
          Send
        </button>
      </div>
      <p className="record-note">Mints Super Coins for the recipient (does not deduct from you).</p>

      <p className="section-label">Recent ledger</p>
      {ledger.length === 0 ? (
        <p className="record-note">No coin activity yet.</p>
      ) : (
        <ul className="super-coins-ledger">
          {ledger.map((row, i) => (
            <li key={`${row.at}-${i}`}>
              <span className={row.delta >= 0 ? 'sc-pos' : 'sc-neg'}>
                {row.delta >= 0 ? '+' : ''}
                {row.delta}
              </span>
              <span className="record-note">
                {row.reason}
                {row.note ? ` · ${row.note}` : ''}
                {' · '}
                {new Date(row.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="form-ok" role="status">
          {ok}
        </p>
      )}
    </section>
  );
}
