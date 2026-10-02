import { useEffect, useState } from 'react';
import type { AuthUser } from '../profile/auth';
import { fetchCloudFriends } from '../profile/cloudSync';
import {
  cloudFriendsOnly,
  loadFriends,
  type Friend,
} from '../profile/storage';
import { isOwner } from '../tournament/isOwner';
import { formatScheduleSummary } from '../tournament/scheduleMeta';
import {
  addPlayer,
  addPlayerByUid,
  approveJoin,
  denyJoin,
  kick,
  startTournament,
  startRound,
  subscribeTournament,
} from '../tournament/tournamentApi';
import { isAiTournamentPlayer } from '../tournament/tournamentApi';
import type { TournamentDoc } from '../tournament/types';
import { MIN_SEATS } from '../tournament/types';
import { getTournamentPrizeAvatar } from '../profile/avatars';
import { AvatarPreviewModal } from './AvatarPreviewModal';

interface Props {
  tournamentId: string;
  authUser: AuthUser | null;
  onBack: () => void;
  onLive: (tournamentId: string) => void;
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

export function TournamentLobby({ tournamentId, authUser, onBack, onLive }: Props) {
  const [doc, setDoc] = useState<TournamentDoc | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [prizePreviewOpen, setPrizePreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<Friend[]>(() => cloudFriendsOnly(loadFriends()));
  const [inviteBusyUid, setInviteBusyUid] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTournament(tournamentId, setDoc);
  }, [tournamentId]);

  const meta = doc?.meta;
  const hostOk =
    !!authUser &&
    (isOwner(authUser) || authUser.uid === meta?.hostUserId);

  useEffect(() => {
    if (!hostOk || !authUser?.uid) return;
    let cancelled = false;
    void fetchCloudFriends(authUser.uid).then((cloud) => {
      if (cancelled) return;
      const list = cloudFriendsOnly(cloud.length ? cloud : loadFriends());
      setFriends(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hostOk, authUser?.uid]);

  const players = doc
    ? Object.values(doc.players).filter((p) => p.approved && !p.dropped)
    : [];
  const requests = doc ? Object.values(doc.joinRequests ?? {}) : [];
  const selfSeated =
    !!authUser &&
    !!doc?.players[authUser.uid]?.approved &&
    !doc.players[authUser.uid].dropped;
  const selfPending =
    !!authUser &&
    !!doc?.joinRequests?.[authUser.uid] &&
    !selfSeated;

  const onCopyJoinCode = () => {
    if (!meta?.joinCode) return;
    void copyText(meta.joinCode).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const onAdd = async () => {
    if (!authUser) return;
    setBusy(true);
    setError(null);
    try {
      await addPlayer(authUser, tournamentId, codeInput);
      setCodeInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const onAddMyself = async () => {
    if (!authUser) return;
    setBusy(true);
    setError(null);
    try {
      await addPlayerByUid(authUser, tournamentId, authUser.uid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add myself failed');
    } finally {
      setBusy(false);
    }
  };

  const onInviteFriend = async (friendUid: string) => {
    if (!authUser) return;
    setInviteBusyUid(friendUid);
    setInviteError(null);
    try {
      await addPlayerByUid(authUser, tournamentId, friendUid);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setInviteBusyUid(null);
    }
  };

  const onStart = async () => {
    if (!authUser) return;
    setBusy(true);
    setError(null);
    try {
      await startTournament(authUser, tournamentId);
      await startRound(authUser, tournamentId, 1);
      onLive(tournamentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  if (!meta) {
    return (
      <div className="home">
        <p>Loading lobby…</p>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const inviteableFriends = friends.filter(
    (f) => f.uid && !doc?.players[f.uid]?.approved,
  );

    const prizeAvatar = getTournamentPrizeAvatar(meta.prizeFirstAvatarId);

  return (
    <div className="home tournament-screen">
      <div className="tl-title-with-prize">
        <h1 className="title">{meta.name}</h1>
        {prizeAvatar && (
          <button
            type="button"
            className="tl-title-prize"
            onClick={() => {
              if (prizeAvatar.imageSrc) setPrizePreviewOpen(true);
            }}
            aria-label={`1st place prize: ${prizeAvatar.label}`}
          >
            {prizeAvatar.imageSrc ? (
              <img
                src={prizeAvatar.imageSrc}
                alt=""
                width={44}
                height={44}
                className="tl-title-prize-img"
              />
            ) : (
              <span className="tl-title-prize-glyph" aria-hidden>
                {prizeAvatar.glyph ?? '🏆'}
              </span>
            )}
            <span className="tl-title-prize-label">
              <span className="tl-title-prize-kicker">1st prize</span>
              {prizeAvatar.label}
            </span>
          </button>
        )}
      </div>
      <p className="subtitle tl-lobby-code-row">
        Lobby · code <strong>{meta.joinCode}</strong>
        <button
          type="button"
          className="btn player-code-copy tl-lobby-code-copy"
          onClick={onCopyJoinCode}
          aria-label="Copy join code"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {' · '}
        {meta.variant === 'classic_121' ? 'Classic 121 (engine: SuperCrib)' : 'SuperCrib'}
      </p>
      <p className="find-match-hint">
        {players.length} / {meta.maxSeats} seated
        {players.length >= MIN_SEATS
          ? ` · ${formatScheduleSummary(players.length, meta.rrGamesPerPlayer)}`
          : ` · need ≥${MIN_SEATS} to start`}
        {' · '}
        {(meta.entryFeeSc ?? 0) > 0
          ? `Entry ${meta.entryFeeSc} SC`
          : 'Free'}
        
      </p>

      {!hostOk && selfSeated && (meta.status === 'lobby' || meta.status === 'draft') && (
        <div className="panel tl-seated-status-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">You&apos;re seated</p>
          <p className="find-match-hint">Waiting for the host to start</p>
        </div>
      )}

      {!hostOk && selfSeated && meta.status === 'live' && (
        <div className="panel tl-seated-status-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">You&apos;re seated</p>
          <p className="find-match-hint">Tournament is live — join your board when ready.</p>
          <button
            type="button"
            className="primary"
            onClick={() => onLive(tournamentId)}
          >
            Go to live board
          </button>
        </div>
      )}

      {!hostOk && selfSeated && meta.status === 'complete' && (
        <div className="panel tl-seated-status-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">You&apos;re seated</p>
          <p className="find-match-hint">Tournament complete</p>
          <button
            type="button"
            className="primary"
            onClick={() => onLive(tournamentId)}
          >
            View results
          </button>
        </div>
      )}

      {!hostOk && selfPending && (
        <div className="panel tl-seated-status-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">Join request pending</p>
          <p className="find-match-hint">Join request pending — wait for host</p>
        </div>
      )}

      {hostOk && !selfSeated && players.length < meta.maxSeats && (
        <div className="panel tl-add-myself-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">Host seat</p>
          <p className="find-match-hint tl-add-myself-hint">
            You are hosting but not seated yet. Add yourself to play in this tournament.
          </p>
          <button
            type="button"
            className="primary tl-add-myself-btn"
            disabled={busy}
            onClick={() => void onAddMyself()}
          >
            Add myself
          </button>
        </div>
      )}

      {hostOk && (
        <div className="panel" style={{ textAlign: 'left' }}>
          <p className="section-label">Add by player code</p>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="Player code"
            maxLength={8}
          />
          <button type="button" className="primary" disabled={busy || !codeInput.trim()} onClick={() => void onAdd()}>
            Add player
          </button>
        </div>
      )}

      {hostOk && (
        <div className="panel tl-invite-friends-panel" style={{ textAlign: 'left' }}>
          <p className="section-label">Invite friends</p>
          {inviteableFriends.length === 0 ? (
            <p className="find-match-hint tl-invite-friends-empty">
              {friends.some((f) => f.uid)
                ? 'All friends are already in this lobby.'
                : 'No friends to invite yet — add friends from the Friends screen first.'}
            </p>
          ) : (
            <ul className="tournament-list tl-invite-friends-list">
              {inviteableFriends.map((f) => (
                <li key={f.uid ?? f.id} className="tl-invite-friend-row">
                  <span>{f.name}</span>
                  <button
                    type="button"
                    className="primary tl-invite-btn"
                    disabled={!!inviteBusyUid || busy}
                    onClick={() => {
                      if (!f.uid) return;
                      void onInviteFriend(f.uid);
                    }}
                  >
                    {inviteBusyUid === f.uid ? 'Inviting…' : 'Invite'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {inviteError && (
            <p className="auth-error" role="alert">
              {inviteError}
            </p>
          )}
        </div>
      )}

      <div className="panel" style={{ textAlign: 'left' }}>
        <p className="section-label">Players</p>
        <ul className="tournament-list">
          {players
            .sort((a, b) => a.seat - b.seat)
            .map((p) => (
              <li key={p.userId}>
                Seat {p.seat + 1}: {p.displayName}
                {isAiTournamentPlayer(p) ? ' (AI)' : ''}
                {p.playerCode ? ` · ${p.playerCode}` : ''}
                {authUser && p.userId === authUser.uid ? ' · you' : ''}
                {hostOk && (
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      if (!authUser) return;
                      void kick(authUser, tournamentId, p.userId).catch((e) =>
                        setError(e instanceof Error ? e.message : 'Kick failed'),
                      );
                    }}
                  >
                    Kick
                  </button>
                )}
              </li>
            ))}
        </ul>
      </div>

      {hostOk && requests.length > 0 && (
        <div className="panel" style={{ textAlign: 'left' }}>
          <p className="section-label">Join requests</p>
          <ul className="tournament-list">
            {requests.map((r) => (
              <li key={r.userId}>
                {r.displayName}
                {r.playerCode ? ` · ${r.playerCode}` : ''}
                <button
                  type="button"
                  className="primary"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    if (!authUser) return;
                    void approveJoin(authUser, tournamentId, r.userId).catch((e) =>
                      setError(e instanceof Error ? e.message : 'Approve failed'),
                    );
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!authUser) return;
                    void denyJoin(authUser, tournamentId, r.userId);
                  }}
                >
                  Deny
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hostOk && (
        <button
          type="button"
          className="primary"
          disabled={busy || players.length < MIN_SEATS}
          onClick={() => void onStart()}
        >
          {busy ? 'Starting…' : 'Start tournament'}
        </button>
      )}

      {meta.status === 'live' && (hostOk || !selfSeated) && (
        <button type="button" className="primary" onClick={() => onLive(tournamentId)}>
          Go to live board
        </button>
      )}


      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={onBack}>
        Back
      </button>

      {prizePreviewOpen && prizeAvatar?.imageSrc && (
        <AvatarPreviewModal
          src={prizeAvatar.imageSrc}
          label={prizeAvatar.label}
          onClose={() => setPrizePreviewOpen(false)}
        />
      )}
    </div>
  );
}
