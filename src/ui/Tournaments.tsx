import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../profile/auth';
import { canHostTournaments, isOwner } from '../tournament/isOwner';
import {
  createDraft,
  fetchTournamentByCode,
  listHostTournaments,
  listMyTournaments,
  openLobby,
  rememberMyTournamentId,
  requestJoin,
  subscribePrizeAvatarSupply,
} from '../tournament/tournamentApi';
import type { GameClockChoice, Tournament } from '../tournament/types';
import {
  clampPlayoffAdvance,
  DEFAULT_ROUND_LOCK_IN_MIN,
  MAX_SEATS,
  MIN_SEATS,
  type PlayoffAdvanceCount,
} from '../tournament/types';
import { scheduleMeta } from '../tournament/scheduleMeta';
import {
  TOURNAMENT_CREATE_COST,
  chargeTournamentCreateOnProfile,
  chargeTournamentJoinOnProfile,
  formatSc,
} from '../profile/coins';
import {
  FIRST_EVER_WINNER_AVATAR_ID,
  TOURNAMENT_PRIZE_AVATARS,
  formatPrizeAvatarOption,
  getTournamentPrizeAvatar,
} from '../profile/avatars';
import { saveProfileForAccount } from '../profile/cloudSync';
import type { Profile } from '../profile/storage';
import { AvatarPreviewModal } from './AvatarPreviewModal';

interface Props {
  authUser: AuthUser | null;
  playerCode?: string | null;
  profile?: Profile | null;
  onProfileUpdate?: (profile: Profile) => void;
  onBack: () => void;
  onOpenLobby: (tournamentId: string) => void;
  onOpenLive: (tournamentId: string) => void;
}

export function Tournaments({
  authUser,
  playerCode,
  profile = null,
  onProfileUpdate,
  onBack,
  onOpenLobby,
  onOpenLive,
}: Props) {
  const owner = isOwner(authUser);
  /** Create / host only — NOT used to hide the Club Night tab (public hosting stays false). */
  const canHost = canHostTournaments(authUser);
  const [hostList, setHostList] = useState<Tournament[]>([]);
  const [myList, setMyList] = useState<Tournament[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPopup, setErrorPopup] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('Friday Tournament');
  const [maxSeats, setMaxSeats] = useState(8);
  const [clock, setClock] = useState<GameClockChoice>(22);
  const [roundLockInMin, setRoundLockInMin] = useState(DEFAULT_ROUND_LOCK_IN_MIN);
  const [tournamentDurationMin, setTournamentDurationMin] = useState(0);
  const [playoffAdvanceCount, setPlayoffAdvanceCount] = useState<PlayoffAdvanceCount>(4);
  const [playoffSkunkCountsAsTwo, setPlayoffSkunkCountsAsTwo] = useState(false);
  const [entryFeeSc, setEntryFeeSc] = useState(0);
  const [prizeFirstAvatarId, setPrizeFirstAvatarId] = useState(FIRST_EVER_WINNER_AVATAR_ID);
  const [prizeSupply, setPrizeSupply] = useState<Record<string, number>>({});
  const [prizePreviewOpen, setPrizePreviewOpen] = useState(false);
  const [rrGamesPerPlayer, setRrGamesPerPlayer] = useState(7); // default seats 8 → full RR
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const refresh = useCallback(() => {
    if (!authUser?.uid) {
      setHostList([]);
      setMyList([]);
      return;
    }
    if (canHost) {
      void listHostTournaments(authUser.uid)
        .then(setHostList)
        .catch(() => setHostList([]));
    } else {
      setHostList([]);
    }
    void listMyTournaments(authUser.uid)
      .then(setMyList)
      .catch(() => setMyList([]));
  }, [authUser?.uid, canHost]);

  
  useEffect(() => {
    if (!authUser) {
      setPrizeSupply({});
      return;
    }
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribePrizeAvatarSupply(setPrizeSupply);
    } catch {
      setPrizeSupply({});
    }
    return () => unsub?.();
  }, [authUser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clamp advance so it never exceeds seats (Top 6 needs ≥6, Top 4 needs ≥4).
  const seatsClamped = Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.floor(maxSeats) || MIN_SEATS));
  const advanceOptions = useMemo(() => {
    const opts: Array<{ value: PlayoffAdvanceCount; label: string; help: string }> = [
      {
        value: 8,
        label: 'Top 8',
        help: 'Bo3 quarters 1v8 / 4v5 / 2v7 / 3v6, then semis, then Final',
      },
      {
        value: 6,
        label: 'Top 6',
        help: 'Bo3 play-in 3v6 / 4v5; seeds 1–2 bye to semis, then Final',
      },
      {
        value: 4,
        label: 'Top 4',
        help: 'Bo3 semis 1v4 / 2v3, then Final',
      },
      {
        value: 2,
        label: 'Top 2',
        help: 'Skip semis — Final only between RR #1 and #2',
      },
    ];
    return opts.filter((o) => o.value <= seatsClamped);
  }, [seatsClamped]);

  useEffect(() => {
    if (playoffAdvanceCount > seatsClamped) {
      setPlayoffAdvanceCount(clampPlayoffAdvance(playoffAdvanceCount, seatsClamped));
    }
  }, [seatsClamped, playoffAdvanceCount]);

  // Clamp RR games into [2, seats−1]; if previously at old max, follow new max.
  const prevSeatsRef = useRef(seatsClamped);
  useEffect(() => {
    const maxG = Math.max(2, seatsClamped - 1);
    const oldMax = Math.max(2, prevSeatsRef.current - 1);
    prevSeatsRef.current = seatsClamped;
    setRrGamesPerPlayer((prev) => {
      if (prev >= oldMax) return maxG;
      return Math.min(maxG, Math.max(2, prev));
    });
  }, [seatsClamped]);

  const closeCreate = () => setShowCreate(false);

  const failCreate = (msg: string) => {
    setError(msg);
    setErrorPopup(msg);
  };

  const onCreate = async () => {
    if (!authUser || !canHost) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      failCreate('Enter a tournament name at the top of this sheet.');
      return;
    }
    setBusy(true);
    setError(null);
    setErrorPopup(null);
    try {
      const advance = clampPlayoffAdvance(playoffAdvanceCount, seatsClamped);
      const prizeId = prizeFirstAvatarId.trim();
      if (prizeId) {
        const catalog = getTournamentPrizeAvatar(prizeId);
        const max = catalog?.maxSupply;
        if (max != null && max > 0) {
          const granted = prizeSupply[prizeId] ?? 0;
          if (granted >= max) {
            failCreate(
              `${catalog?.label ?? 'Prize'} is sold out (${max}/${max}). Pick another 1st-place prize.`,
            );
            return;
          }
        }
      }

      // Owner hosts free (SC create fee was blocking setup at 0 balance).
      const shouldChargeSc = canHost && !owner && !!profile;
      if (shouldChargeSc && profile) {
        chargeTournamentCreateOnProfile(profile, TOURNAMENT_CREATE_COST);
      }

      const meta = await createDraft(authUser, {
        name: trimmedName,
        maxSeats: seatsClamped,
        gameClockMin: clock,
        visibility: 'private',
        playoffAdvanceCount: advance,
        playoffSkunkCountsAsTwo,
        roundLockInMin,
        tournamentDurationMin,
        entryFeeSc: Math.max(0, Math.floor(entryFeeSc) || 0),
        prizeFirstAvatarId: prizeFirstAvatarId.trim() || undefined,
        rrGamesPerPlayer,
      });
      if (shouldChargeSc && profile) {
        const charged = chargeTournamentCreateOnProfile(profile, TOURNAMENT_CREATE_COST);
        const saved = await saveProfileForAccount(charged, authUser.uid);
        onProfileUpdate?.(saved);
      }
      await openLobby(authUser, meta.id);
      rememberMyTournamentId(meta.id);
      closeCreate();
      refresh();
      onOpenLobby(meta.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      failCreate(msg);
    } finally {
      setBusy(false);
    }
  };

  const openJoinedTournament = (doc: NonNullable<Awaited<ReturnType<typeof fetchTournamentByCode>>>) => {
    setError(null);
    setJoinCodeInput('');
    if (doc.meta.id) rememberMyTournamentId(doc.meta.id);
    refresh();
    if (!doc.meta.id) return;
    if (doc.meta.status === 'live' || doc.meta.status === 'complete') {
      onOpenLive(doc.meta.id);
    } else {
      onOpenLobby(doc.meta.id);
    }
  };

  const onRequestJoin = async () => {
    if (!authUser) {
      setError('Sign in to request a join.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = joinCodeInput.trim();
      const preview = await fetchTournamentByCode(code);
      if (!preview) throw new Error('Invalid join code');

      // Already seated → open lobby/live; do not re-request or charge fee.
      const seated = preview.players[authUser.uid];
      if (seated?.approved && !seated.dropped) {
        openJoinedTournament(preview);
        return;
      }

      const fee = Math.max(0, Math.floor(preview.meta.entryFeeSc ?? 0) || 0);
      if (fee > 0) {
        if (!profile) {
          throw new Error('Profile required to pay the tournament entry fee.');
        }
        // Validate first (throws if insufficient).
        chargeTournamentJoinOnProfile(profile, fee);
      }
      await requestJoin(authUser, code, playerCode ?? undefined, profile?.avatarId);
      if (fee > 0 && profile) {
        const charged = chargeTournamentJoinOnProfile(profile, fee);
        const saved = await saveProfileForAccount(charged, authUser.uid);
        onProfileUpdate?.(saved);
      }
      // Pending or newly requested — still open lobby so they see status.
      openJoinedTournament(preview);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Join failed';
      if (msg === 'Already in this tournament' || msg === 'Tournament is not accepting joins') {
        try {
          const again = await fetchTournamentByCode(joinCodeInput.trim());
          if (again?.meta.id && authUser) {
            const seated = again.players[authUser.uid];
            if (seated?.approved && !seated.dropped) {
              openJoinedTournament(again);
              return;
            }
            if (msg === 'Tournament is not accepting joins') {
              setError('This tournament already started.');
              return;
            }
          }
        } catch {
          // fall through
        }
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const rrMax = Math.max(2, seatsClamped - 1);
  const rrClamped = Math.min(rrMax, Math.max(2, Math.floor(rrGamesPerPlayer) || rrMax));
  const preview = scheduleMeta(seatsClamped, rrClamped);
  const prizePreview = getTournamentPrizeAvatar(prizeFirstAvatarId);

  return (
    <div className="home tournament-screen">
      <h1 className="title title-coin">TOURNAMENTS</h1>
      <p className="find-match-hint">
        Tournaments · private for now. Join with a host code if you were invited.
      </p>
      {owner && (
        <p className="record-note">Owner mode · {authUser?.email ?? 'signed in'}</p>
      )}
      {!owner && authUser && (
        <p className="record-note">Private tournament — ask the host for a join code. Hosting is owner-only.</p>
      )}

      {authUser && (
        <div className="panel tl-join-panel">
          <p className="section-label">Have a join code?</p>
          <div className="tl-join-code-row">
            <input
              className="field-input tl-join-code-input"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Join code"
            />
            <button
              type="button"
              className="primary tl-join-request-btn menu-action"
              disabled={busy || !joinCodeInput.trim()}
              onClick={() => void onRequestJoin()}
            >
              <span className="coin-metal-text">Request to join</span>
            </button>
          </div>
        </div>
      )}
      {!authUser && (
        <p className="auth-hint">Sign in to enter a join code from the host.</p>
      )}

      {authUser && (
        <div className="panel" style={{ marginTop: 12, textAlign: 'left' }}>
          <p className="section-label">Your tournaments</p>
          {myList.length === 0 && (
            <p className="record-note">
              No seated tournaments yet — enter a join code above when invited.
            </p>
          )}
          <ul className="tournament-list">
            {myList.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>{' '}
                <span className="record-note">
                  · {t.status} · {t.joinCode} · SuperCrib
                </span>
                <div className="row-actions">
                  {(t.status === 'draft' || t.status === 'lobby') && (
                    <button type="button" className="menu-action" onClick={() => onOpenLobby(t.id)}>
                      <span className="coin-metal-text">Open lobby</span>
                    </button>
                  )}
                  {(t.status === 'live' || t.status === 'complete' || t.status === 'cancelled') && (
                    <button type="button" className="primary menu-action" onClick={() => onOpenLive(t.id)}>
                      <span className="coin-metal-text">
                        {t.status === 'live' ? 'Live board' : 'Results'}
                      </span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canHost && (
        <button
          type="button"
          className="primary menu-action"
          style={{ marginTop: 12 }}
          onClick={() => setShowCreate(true)}
        >
          <span className="coin-metal-text">Create tournament</span>
        </button>
      )}

      {canHost && showCreate && (
        <div
          className="tl-sheet-overlay"
          role="presentation"
          onClick={closeCreate}
        >
          <div
            className="tl-sheet overlay-card create-tourney-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-tourney-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tl-sheet-header">
              <h2 id="create-tourney-title">Create tournament</h2>
              <button
                type="button"
                className="tl-sheet-close"
                aria-label="Close"
                onClick={closeCreate}
              >
                ×
              </button>
            </div>

            <label className="section-label">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </label>

            <p className="section-label" style={{ marginBottom: 0 }}>
              Variant
            </p>
            <p className="record-note create-tourney-locked">SuperCrib (241)</p>

            <label className="section-label">
              Seats ({MIN_SEATS}–{MAX_SEATS})
              <input
                type="number"
                min={MIN_SEATS}
                max={MAX_SEATS}
                value={maxSeats}
                onChange={(e) => setMaxSeats(Number(e.target.value))}
              />
            </label>
            <label className="section-label">
              Round robin games (each)
              <input
                type="number"
                min={2}
                max={rrMax}
                value={rrClamped}
                onChange={(e) => setRrGamesPerPlayer(Number(e.target.value))}
              />
            </label>
            <p className="field-hint create-tourney-hint">
              Default = full RR ({rrMax} games). Min 2, max seats−1. Odd seat counts may
              vary ±1 from byes when truncated.
            </p>
            <p className="field-hint create-tourney-hint">
              Preview: {preview.rounds} rounds · {preview.gamesPerPlayer} games each ·{' '}
              {preview.simultaneousBoards} boards · {preview.estimate}
            </p>

            <label className="section-label">
              Game clock (minutes)
              <select
                value={clock}
                onChange={(e) => setClock(Number(e.target.value) as GameClockChoice)}
              >
                <option value={18}>18</option>
                <option value={22}>22 (default)</option>
                <option value={25}>25</option>
                <option value={30}>30</option>
                <option value={0}>Off</option>
              </select>
            </label>
            <p className="field-hint create-tourney-hint">Per-game clock for SuperCrib tables.</p>

            <label className="section-label">
              Round timer (minutes)
              <input
                type="number"
                min={5}
                max={24 * 60}
                value={roundLockInMin}
                onChange={(e) => setRoundLockInMin(Number(e.target.value))}
              />
            </label>
            <p className="field-hint create-tourney-hint">
              Lock-in window after the host starts the round timer (default{' '}
              {DEFAULT_ROUND_LOCK_IN_MIN}m).
            </p>

            <label className="section-label">
              Tournament timer (minutes)
              <input
                type="number"
                min={0}
                max={7 * 24 * 60}
                value={tournamentDurationMin}
                onChange={(e) => setTournamentDurationMin(Number(e.target.value))}
              />
            </label>
            <p className="field-hint create-tourney-hint">
              Overall event limit from Round 1 timer Start. 0 = off (no auto-finish).
            </p>

            <label className="section-label">
              Advance to playoffs
              <select
                value={playoffAdvanceCount}
                onChange={(e) => {
                  const v = Number(e.target.value) as PlayoffAdvanceCount;
                  setPlayoffAdvanceCount(
                    v === 2 || v === 6 || v === 8 ? v : 4,
                  );
                }}
              >
                {advanceOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint create-tourney-hint">
              {playoffAdvanceCount === 2
                ? 'Skip semis — Final only between RR #1 and #2.'
                : playoffAdvanceCount === 8
                  ? 'Bo3 quarters 1v8 / 4v5 / 2v7 / 3v6, then semis, then Final.'
                  : playoffAdvanceCount === 6
                    ? 'Bo3 play-in 3v6 / 4v5; seeds 1–2 bye to semis, then Final.'
                    : 'Bo3 semis 1v4 / 2v3, then Final.'}
            </p>

            <label className="create-tourney-check">
              <input
                type="checkbox"
                checked={playoffSkunkCountsAsTwo}
                onChange={(e) => setPlayoffSkunkCountsAsTwo(e.target.checked)}
              />
              <span>Skunk counts as 2 series wins in playoffs</span>
            </label>
            <p className="field-hint create-tourney-hint">
              Skunk or double-skunk ends a Bo3 series in one game.
            </p>

            <label className="section-label">
              Entry fee (SC)
              <input
                type="number"
                min={0}
                max={100000}
                value={entryFeeSc}
                onChange={(e) => setEntryFeeSc(Number(e.target.value))}
              />
            </label>
            <p className="field-hint create-tourney-hint">
              Default 0 — free to join. Charged from the joiner on request when &gt; 0.
            </p>

            <label className="section-label">
              1st place prize avatar
              <select
                value={prizeFirstAvatarId}
                onChange={(e) => setPrizeFirstAvatarId(e.target.value)}
              >
                <option value="">No prize</option>
                {TOURNAMENT_PRIZE_AVATARS.map((a) => {
                  const granted = prizeSupply[a.id] ?? 0;
                  const max = a.maxSupply;
                  const soldOut = max != null && granted >= max;
                  return (
                    <option key={a.id} value={a.id} disabled={soldOut}>
                      {formatPrizeAvatarOption(a, granted)}
                    </option>
                  );
                })}
              </select>
            </label>
            {prizePreview && (
              <button
                type="button"
                className="create-tourney-prize-preview-btn"
                onClick={() => {
                  if (prizePreview.imageSrc) setPrizePreviewOpen(true);
                }}
                title="Tap to preview"
                aria-label={`Preview ${prizePreview.label}`}
              >
                {prizePreview.imageSrc ? (
                  <img src={prizePreview.imageSrc} alt="" width={48} height={48} />
                ) : (
                  <span style={{ fontSize: 28 }} aria-hidden>
                    {prizePreview.glyph ?? '🏆'}
                  </span>
                )}
                <span className="record-note">
                  {prizePreview.label}
                  {prizePreview.imageSrc ? ' · tap to preview' : ''}
                </span>
              </button>
            )}
            <p className="field-hint create-tourney-hint">
              1st place unlocks this avatar for the winner. Limited editions
              (1/1, 5/5, …) stop once supply is gone.
            </p>

            {owner ? (
              <p className="field-hint create-tourney-hint">
                Owner create is free. Entry default free (set Entry fee above to charge joiners).
              </p>
            ) : (
              <p className="field-hint create-tourney-hint">
                Create costs {formatSc(TOURNAMENT_CREATE_COST)}. Entry default free
                (set Entry fee above to charge joiners).
              </p>
            )}

            {error && (
              <p className="auth-error create-tourney-error" role="alert">
                {error}
              </p>
            )}

            <div className="tl-sheet-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void onCreate()}
              >
                {busy ? 'Creating…' : 'Save draft & open lobby'}
              </button>
              <button type="button" disabled={busy} onClick={closeCreate}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {canHost && (
        <div className="panel" style={{ marginTop: 12, textAlign: 'left' }}>
          <p className="section-label">Your tournaments</p>
          {hostList.length === 0 && <p className="record-note">No events yet.</p>}
          <ul className="tournament-list">
            {hostList.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>{' '}
                <span className="record-note">
                  · {t.status} · {t.joinCode} · SuperCrib ·{' '}
                  {(t.entryFeeSc ?? 0) > 0
                    ? `Entry ${t.entryFeeSc} SC`
                    : 'Free'}
                  {t.prizeFirstAvatarId ? ' · 1st: Avatar' : ''}
                </span>
                <div className="row-actions">
                  {(t.status === 'draft' || t.status === 'lobby') && (
                    <button type="button" className="menu-action" onClick={() => onOpenLobby(t.id)}>
                      <span className="coin-metal-text">Open lobby</span>
                    </button>
                  )}
                  {(t.status === 'live' || t.status === 'complete' || t.status === 'cancelled') && (
                    <button type="button" className="primary menu-action" onClick={() => onOpenLive(t.id)}>
                      <span className="coin-metal-text">
                        {t.status === 'live' ? 'Live board' : 'Results'}
                      </span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}



      {errorPopup && (
        <div
          className="overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="create-error-title"
          aria-describedby="create-error-body"
          onClick={() => setErrorPopup(null)}
        >
          <div
            className="overlay-card find-match-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-error-title">Can&apos;t create tournament</h2>
            <p id="create-error-body" className="find-match-hint" style={{ textAlign: 'left' }}>
              {errorPopup}
            </p>
            <button
              type="button"
              className="btn primary find-match-option"
              onClick={() => setErrorPopup(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={onBack}>
        Back
      </button>

      {prizePreviewOpen && prizePreview?.imageSrc && (
        <AvatarPreviewModal
          src={prizePreview.imageSrc}
          label={prizePreview.label}
          onClose={() => setPrizePreviewOpen(false)}
        />
      )}
    </div>
  );
}
