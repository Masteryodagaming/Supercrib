import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CRIB_MASTER_ID,
  getSelectableAvatars,
  migrateMasterYodaSelection,
  splitSelectableAvatars,
} from '../profile/avatars';
import { SUPER_COIN_SHOP } from '../profile/coins';
import {
  effectiveOwnedFeltIds,
  getSelectableFelts,
  ownsFelt,
  normalizeFeltId,
  type FeltTheme,
} from '../profile/felts';
import {
  getSelectableBoards,
  ownsBoard,
  normalizeBoardId,
  effectiveOwnedBoardIds,
  type BoardSkin,
} from '../profile/boards';
import { Profile, saveProfile } from '../profile/storage';
import { authProviderLabel, type AuthUser } from '../profile/auth';
import { saveProfileForAccountDetailed, pushCloudProfile } from '../profile/cloudSync';
import { setSoundEnabled } from '../audio/gameSfx';
import { drainCoinInbox } from '../profile/coinInbox';
import { deleteTournament, listHostTournaments } from '../tournament/tournamentApi';
import type { Tournament } from '../tournament/types';
import { AvatarView } from './AvatarView';
import { AvatarPreviewModal } from './AvatarPreviewModal';
import { CoinPurse } from './CoinPurse';
import { SuperCoinsPanel } from './SuperCoinsPanel';
import { canHostTournaments, isOwner } from '../tournament/isOwner';
import { ReactEmoji } from './emoji/ReactEmoji';
import {
  RAIL_SLOT_COUNT,
  artForReactEmojiId,
  effectiveOwnedEmojiIds,
  glyphForReactEmojiId,
  isTextRailEmoji,
  labelForReactEmojiId,
  normalizeEquippedRailEmojiIds,
  ownedReactEmojiIds,
  type ReactEmojiId,
} from './emoji/reactEmojis';

type SettingsTab = 'account' | 'avatars' | 'emoji' | 'felt';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'avatars', label: 'Avatars' },
  { id: 'emoji', label: 'Emoji' },
  { id: 'felt', label: 'Felt & Board' },
];

interface Props {
  profile: Profile;
  onSave: (profile: Profile) => void;
  onBack: () => void;
  onFriends: () => void;
  /** When signed in, display name + records write to users/{uid}/profile. */
  uid?: string | null;
  signedIn?: boolean;
  authUser?: AuthUser | null;
  authConfigured?: boolean;
  authBusy?: boolean;
  authError?: string | null;
  onSignIn?: () => void;
  onSignInWithEmail?: (email: string, password: string) => void;
  onSignOut?: () => void;
  /** When true, scroll/focus #doctor-coins after mount (owner). */
  focusDoctor?: boolean;
  onFocusDoctorHandled?: () => void;
  /** Open dedicated Store screen (owner). */
  onOpenStore?: () => void;
}


export function Settings({
  profile,
  onSave,
  onBack,
  onFriends,
  uid = null,
  signedIn = false,
  authUser = null,
  authConfigured = false,
  authBusy = false,
  authError = null,
  onSignIn,
  onSignInWithEmail,
  onSignOut,
  focusDoctor = false,
  onFocusDoctorHandled,
  onOpenStore,
}: Props) {
  const [name, setName] = useState(profile.displayName);
  const [avatarId, setAvatarId] = useState(profile.avatarId);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(profile.avatarDataUrl);
  const [avatarPreview, setAvatarPreview] = useState<{ src: string; label: string } | null>(null);
  const [sound, setSound] = useState(profile.settings?.sound ?? true);
  const [theme, setTheme] = useState(() => normalizeFeltId(profile.settings?.theme));
  const [board, setBoard] = useState(() => normalizeBoardId(profile.settings?.board));
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveOkTimer = useRef<number | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLocalError, setEmailLocalError] = useState<string | null>(null);
  const [hostTournaments, setHostTournaments] = useState<Tournament[]>([]);
  const [tourneyBusy, setTournyBusy] = useState(false);
  const [tourneyError, setTournyError] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [equippedRail, setEquippedRail] = useState<ReactEmojiId[]>(() =>
    normalizeEquippedRailEmojiIds(profile.equippedRailEmojiIds),
  );
  /** Which dock slot is selected for assignment (null = none). */
  const [equipSlot, setEquipSlot] = useState<number | null>(null);
  /** Owned emoji big-preview modal (null = closed). */
  const [emojiPreviewId, setEmojiPreviewId] = useState<ReactEmojiId | null>(null);
  const [emojiEquipConfirm, setEmojiEquipConfirm] = useState<string | null>(null);
  const emojiConfirmTimer = useRef<number | null>(null);
  const canManageTournaments = canHostTournaments(authUser);
  const owner = isOwner(authUser);
  /** Only strip signature avatars when signed-in and confirmed non-owner. */
  const ownerMigrateOpts = useMemo(
    () => (authUser ? { owner } : undefined),
    [authUser, owner],
  );

  const selectableAvatars = useMemo(
    () => getSelectableAvatars(profile.ownedAvatarIds, SUPER_COIN_SHOP, { owner }),
    [profile.ownedAvatarIds, owner],
  );
  const { signature: signatureAvatars, defaults: defaultAvatars } = useMemo(
    () => splitSelectableAvatars(selectableAvatars),
    [selectableAvatars],
  );
  const equippedAvatarLabel =
    selectableAvatars.find((x) => x.id === avatarId)?.label ?? 'Avatar';

  const emojiViewer = useMemo(
    () => ({ uid: authUser?.uid ?? uid, email: authUser?.email ?? null }),
    [authUser?.uid, authUser?.email, uid],
  );
  const ownedEmojis = useMemo(
    () => ownedReactEmojiIds(profile.ownedEmojiIds, emojiViewer),
    [profile.ownedEmojiIds, emojiViewer],
  );
  // Drain Doctor SC gifts when Settings opens (signed-in).
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

  // Auto-union specials into ownedEmojiIds (mad_finger + trash_toss + ace_spade + grandma_peggy + mad_father: Dummy|Owner).
  useEffect(() => {
    const viewerUid = authUser?.uid ?? uid;
    const viewerEmail = authUser?.email ?? null;
    const nextOwned = effectiveOwnedEmojiIds(viewerUid, viewerEmail, profile.ownedEmojiIds);
    const prev = profile.ownedEmojiIds ?? [];
    const same =
      nextOwned.length === prev.length && nextOwned.every((id) => prev.includes(id));
    if (same) return;
    const next = { ...profile, ownedEmojiIds: nextOwned };
    onSave(next);
    if (uid) void pushCloudProfile(uid, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authUser?.uid, authUser?.email, profile.ownedEmojiIds]);

  const scrollToDoctor = useCallback(() => {
    const el = document.getElementById('doctor-coins');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Prefer focusing the set-balance field inside Doctor panel
      const focusEl = document.getElementById('sc-set') as HTMLElement | null;
      focusEl?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (!focusDoctor || !owner) return;
    setSettingsTab('account');
    // Wait a tick so SuperCoinsPanel is in the DOM
    const t = window.setTimeout(() => {
      scrollToDoctor();
      onFocusDoctorHandled?.();
    }, 50);
    return () => window.clearTimeout(t);
  }, [focusDoctor, owner, scrollToDoctor, onFocusDoctorHandled]);

  const refreshHostTournaments = useCallback(() => {
    if (!authUser?.uid || !canManageTournaments) {
      setHostTournaments([]);
      return;
    }
    void listHostTournaments(authUser.uid)
      .then(setHostTournaments)
      .catch((e) => setTournyError(e instanceof Error ? e.message : 'Could not load tournaments'));
  }, [authUser?.uid, canManageTournaments]);

  useEffect(() => {
    refreshHostTournaments();
  }, [refreshHostTournaments]);

  useEffect(() => {
    return () => {
      if (saveOkTimer.current !== null) window.clearTimeout(saveOkTimer.current);
      if (emojiConfirmTimer.current !== null) window.clearTimeout(emojiConfirmTimer.current);
    };
  }, []);

  // Keep draft name in sync if cloud hydrate updates profile while Settings is open.
  useEffect(() => {
    const migrated = migrateMasterYodaSelection(profile, ownerMigrateOpts);
    setName(migrated.displayName);
    setAvatarId(migrated.avatarId);
    setAvatarDataUrl(migrated.avatarDataUrl);
    setSound(migrated.settings?.sound ?? true);
    setTheme(normalizeFeltId(migrated.settings?.theme));
    setBoard(normalizeBoardId(migrated.settings?.board));
    setEquippedRail(normalizeEquippedRailEmojiIds(migrated.equippedRailEmojiIds));
    setEquipSlot(null);
  }, [profile.displayName, profile.avatarId, profile.avatarDataUrl, profile.settings?.sound, profile.settings?.theme, profile.settings?.board, profile.equippedRailEmojiIds, profile.ownedEmojiIds, profile.ownedBoardIds, ownerMigrateOpts]);

  const draft: Profile = migrateMasterYodaSelection(
    {
      ...profile,
      displayName: name.trim() || 'Player',
      avatarId,
      avatarDataUrl,
      settings: { sound, theme, board },
      equippedRailEmojiIds: normalizeEquippedRailEmojiIds(equippedRail),
      // Auto-inject Mad Finger + Trash Toss for Dummy / Owner into owned list.
      ownedEmojiIds: effectiveOwnedEmojiIds(
        authUser?.uid ?? uid,
        authUser?.email ?? null,
        profile.ownedEmojiIds,
      ),
    },
    ownerMigrateOpts,
  );

  const assignOwnedToSlot = (emojiId: ReactEmojiId, slotIndex?: number) => {
    setSaveOk(null);
    const next = [...normalizeEquippedRailEmojiIds(equippedRail)];
    let slot = slotIndex !== undefined ? slotIndex : equipSlot;
    if (slot == null) {
      const existing = next.indexOf(emojiId);
      if (existing >= 0) {
        setEquipSlot(existing);
        return;
      }
      slot = 0;
    }
    const dup = next.indexOf(emojiId);
    if (dup >= 0 && dup !== slot) {
      // Swap to keep unique slots
      next[dup] = next[slot];
    }
    next[slot] = emojiId;
    setEquippedRail(normalizeEquippedRailEmojiIds(next));
    setEquipSlot(null);
    return slot;
  };

  const flashEmojiEquipConfirm = (msg: string) => {
    setEmojiEquipConfirm(msg);
    if (emojiConfirmTimer.current !== null) window.clearTimeout(emojiConfirmTimer.current);
    emojiConfirmTimer.current = window.setTimeout(() => {
      setEmojiEquipConfirm(null);
      emojiConfirmTimer.current = null;
    }, 1200);
  };

  const putPreviewOnDockSlot = (slotIndex: number) => {
    if (emojiPreviewId == null) return;
    const slot = assignOwnedToSlot(emojiPreviewId, slotIndex);
    if (slot == null) return;
    flashEmojiEquipConfirm(`On dock slot ${slot + 1}`);
  };

  const closeEmojiPreview = () => {
    setEmojiPreviewId(null);
    setEmojiEquipConfirm(null);
    if (emojiConfirmTimer.current !== null) {
      window.clearTimeout(emojiConfirmTimer.current);
      emojiConfirmTimer.current = null;
    }
  };

  useEffect(() => {
    if (emojiPreviewId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEmojiPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emojiPreviewId]);


  const persist = () => {
    setSaving(true);
    setError(null);
    setSaveOk(null);
    void saveProfileForAccountDetailed(draft, uid, authUser?.email ?? null)
      .then(({ value, synced, syncError }) => {
        onSave(value);
        if (syncError) {
          setError(syncError);
          setSaveOk(null);
          return;
        }
        const msg = synced
          ? 'Saved · synced to your account'
          : 'Saved on this device';
        setSaveOk(msg);
        if (saveOkTimer.current !== null) window.clearTimeout(saveOkTimer.current);
        saveOkTimer.current = window.setTimeout(() => {
          onBack();
        }, 700);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not save profile.');
      })
      .finally(() => setSaving(false));
  };


  const record = profile.record ?? { wins: 0, losses: 0, gamesPlayed: 0 };
  const wins = record.wins ?? 0;
  const losses = record.losses ?? 0;
  const gamesPlayed = record.gamesPlayed ?? 0;
  const online = profile.onlineRecord ?? { wins: 0, losses: 0, gamesPlayed: 0 };
  const oWins = online.wins ?? 0;
  const oLosses = online.losses ?? 0;
  const oGames = online.gamesPlayed ?? 0;
  const tr = profile.tournamentRecord;
  const trPlayed = tr?.played ?? 0;
  const trWins = tr?.wins ?? 0;
  const trTop4 = tr?.top4 ?? 0;
  const trGP = tr?.gamePoints ?? 0;
  const trSkunks = tr?.skunksGiven ?? 0;
  const trSkunksR = tr?.skunksReceived ?? 0;
  const trBest = tr?.bestFinish ?? null;
  const trHosted = tr?.hosted ?? 0;

  const providerLabel = authProviderLabel(authUser);
  const accountName = authUser?.displayName?.trim() || null;
  const accountEmail = authUser?.email?.trim() || null;

  const submitEmailSignIn = () => {
    setEmailLocalError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailLocalError('Enter your email.');
      return;
    }
    if (!password) {
      setEmailLocalError('Enter your password.');
      return;
    }
    if (password.length < 6) {
      setEmailLocalError('Password must be at least 6 characters.');
      return;
    }
    onSignInWithEmail?.(trimmed, password);
  };

  return (
    <div className="panel-screen settings-screen">
      <h1 className="title title-coin">SETTINGS</h1>
      <p className="subtitle">
        {signedIn ? 'Account · equip cosmetics you own' : 'Local profile · equip cosmetics you own'}
      </p>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={settingsTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            className={`settings-tab${settingsTab === tab.id ? ' active' : ''}`}
            onClick={() => setSettingsTab(tab.id)}
          >
            <span className="coin-metal-text">{tab.label}</span>
          </button>
        ))}
      </div>

      {settingsTab === 'account' && (
        <div
          className="settings-tab-panel"
          role="tabpanel"
          id="settings-panel-account"
          aria-labelledby="settings-tab-account"
        >
          <section className="account-card" aria-label="Account">
            <p className="section-label">Account</p>
            {owner && (
              <div className="account-super-coins" aria-label="Super Coins">
                <p className="section-label account-super-coins-label">Super Coins</p>
                <div className="account-super-coins-row">
                  <CoinPurse
                    coins={profile.coins}
                    className="coin-purse-account"
                    onClick={onOpenStore}
                  />
                  <button
                    type="button"
                    className="btn primary account-super-coins-add"
                    onClick={scrollToDoctor}
                  >
                    Doctor
                  </button>
                  <button
                    type="button"
                    className="btn account-super-coins-add"
                    onClick={() => onOpenStore?.()}
                  >
                    Store
                  </button>
                </div>
              </div>
            )}
            {signedIn && authUser ? (
              <>
                <div className="account-identity">
                  <span className="account-status-pill signed-in">
                    Signed in with {providerLabel}
                  </span>
                  {accountName && <span className="account-google-name">{accountName}</span>}
                  {accountEmail && <span className="account-google-email">{accountEmail}</span>}
                </div>
                <p className="account-sync-status" role="status">
                  Friends &amp; career records sync across devices
                </p>
                {profile.playerCode && (
                  <div className="player-code-card account-player-code" role="status">
                    <span className="player-code-label">Your code</span>
                    <span className="player-code-value">{profile.playerCode}</span>
                    <button
                      type="button"
                      className="btn player-code-copy"
                      onClick={() => {
                        const code = profile.playerCode!;
                        void (async () => {
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(code);
                              return;
                            }
                          } catch {
                            /* fall through */
                          }
                          try {
                            const ta = document.createElement('textarea');
                            ta.value = code;
                            ta.setAttribute('readonly', '');
                            ta.style.position = 'fixed';
                            ta.style.left = '-9999px';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                          } catch {
                            /* ignore */
                          }
                        })();
                      }}
                    >
                      Copy
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="btn auth-btn account-auth-btn"
                  disabled={authBusy || !onSignOut}
                  onClick={() => onSignOut?.()}
                >
                  {authBusy ? 'Signing out…' : 'Sign out'}
                </button>
              </>
            ) : (
              <>
                <div className="account-identity">
                  <span className="account-status-pill guest">Guest</span>
                  <span className="account-guest-note">
                    Play Vs AI and room codes without signing in. Sign in to sync profile &amp; friends.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn primary auth-btn account-auth-btn"
                  disabled={authBusy || !authConfigured || !onSignIn}
                  onClick={() => onSignIn?.()}
                >
                  {authBusy ? 'Signing in…' : 'Sign in with Google'}
                </button>
                {authConfigured && onSignInWithEmail && (
                  <>
                    {!emailOpen ? (
                      <button
                        type="button"
                        className="btn auth-btn account-auth-btn"
                        disabled={authBusy}
                        onClick={() => {
                          setEmailOpen(true);
                          setEmailLocalError(null);
                        }}
                      >
                        Sign in with email
                      </button>
                    ) : (
                      <div className="settings-email-panel">
                        <p className="account-guest-note">
                          Prefer creating an account? Use the Login screen (email + Create account).
                        </p>
                        <label className="field-label" htmlFor="settings-email">
                          Email
                        </label>
                        <input
                          id="settings-email"
                          className="field-input"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={email}
                          disabled={authBusy}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setEmailLocalError(null);
                          }}
                        />
                        <label className="field-label" htmlFor="settings-password">
                          Password
                        </label>
                        <input
                          id="settings-password"
                          className="field-input"
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          disabled={authBusy}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            setEmailLocalError(null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn primary auth-btn account-auth-btn"
                          disabled={authBusy}
                          onClick={submitEmailSignIn}
                        >
                          {authBusy ? 'Signing in…' : 'Sign in with email'}
                        </button>
                      </div>
                    )}
                  </>
                )}
                {!authConfigured && (
                  <p className="auth-hint account-inline-hint" role="status">
                    Firebase Auth not configured — guest play still works.
                  </p>
                )}
                {emailLocalError && (
                  <p className="auth-error account-inline-hint" role="alert">
                    {emailLocalError}
                  </p>
                )}
              </>
            )}
            {authError && (
              <p className="auth-error account-inline-hint" role="alert">
                {authError}
              </p>
            )}
          </section>

          <div className="profile-preview">
            <AvatarView profile={draft} size="lg" />
          </div>

          <label className="field-label" htmlFor="settings-name">
            Display name
          </label>
          <input
            id="settings-name"
            className="field-input"
            type="text"
            maxLength={24}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaveOk(null);
            }}
            autoComplete="nickname"
          />
          {signedIn && (
            <p className="field-hint">Saved to this phone and your Supercrib account</p>
          )}

          <div className="record-card">
            <p className="section-label">Tournament record</p>
            <div className="record-stats record-stats-tournament">
              <div>
                <strong>{trPlayed}</strong>
                <span>Played</span>
              </div>
              <div>
                <strong>{trWins}</strong>
                <span>Wins</span>
              </div>
              <div>
                <strong>{trTop4}</strong>
                <span>Top4</span>
              </div>
              <div>
                <strong>{trGP}</strong>
                <span>GP</span>
              </div>
              <div>
                <strong>{trSkunks}</strong>
                <span>Sk+</span>
              </div>
              <div>
                <strong>{trSkunksR}</strong>
                <span>Sk−</span>
              </div>
              <div>
                <strong>{trBest ?? '—'}</strong>
                <span>Best</span>
              </div>
              <div>
                <strong>{trHosted}</strong>
                <span>Hosted</span>
              </div>
            </div>
            <p className="record-note">
              {tr?.lastName
                ? `Last: ${tr.lastName}${tr.lastPlace ? ` · ${tr.lastPlace}` : ''}${tr.lastDate ? ` · ${new Date(tr.lastDate).toLocaleDateString()}` : ''}`
                : 'Tournament results appear here after a completed event.'}
            </p>
          </div>
          <div className="record-card">
            <p className="section-label">Career vs AI</p>
            <div className="record-stats">
              <div>
                <strong>{wins}</strong>
                <span>Wins</span>
              </div>
              <div>
                <strong>{losses}</strong>
                <span>Losses</span>
              </div>
              <div>
                <strong>{gamesPlayed}</strong>
                <span>Games</span>
              </div>
            </div>
            <p className="record-note">
              {signedIn
                ? 'Finished Vs AI matches · synced to your account when online.'
                : 'Only finished Vs AI matches count here.'}
            </p>
          </div>

          <div className="record-card">
            <p className="section-label">Career online</p>
            <div className="record-stats">
              <div>
                <strong>{oWins}</strong>
                <span>Wins</span>
              </div>
              <div>
                <strong>{oLosses}</strong>
                <span>Losses</span>
              </div>
              <div>
                <strong>{oGames}</strong>
                <span>Games</span>
              </div>
            </div>
            <p className="record-note">
              {signedIn
                ? 'Finished online matches · highest counts merge across devices.'
                : 'Only finished online matches on this phone count here.'}
            </p>
          </div>

          <div className="toggle-row">
            <label>
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  const next = e.target.checked;
                  setSound(next);
                  setSoundEnabled(next);
                  // Live mute — no Save / restart required.
                  const updated = {
                    ...draft,
                    settings: { sound: next, theme, board },
                  };
                  const saved = saveProfile(updated, uid);
                  onSave(saved);
                  if (uid) void pushCloudProfile(uid, saved);
                }}
              />
              Sound
            </label>
          </div>

          <SuperCoinsPanel
            profile={profile}
            authUser={authUser}
            uid={uid}
            onSave={onSave}
          />

          {canManageTournaments && (
            <div className="panel" style={{ textAlign: 'left', marginTop: 12 }}>
              <p className="section-label">Tournaments</p>
              <p className="record-note">
                Delete events here — they are removed permanently and the join code is freed.
              </p>
              {hostTournaments.length === 0 && (
                <p className="record-note">No tournaments to manage.</p>
              )}
              <ul className="tournament-list">
                {hostTournaments.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>{' '}
                    <span className="record-note">
                      · {t.status} · {t.joinCode}
                    </span>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="tl-danger-btn"
                        disabled={tourneyBusy}
                        onClick={() => {
                          if (!authUser) return;
                          const ok = window.confirm(
                            `Delete "${t.name}"? This cannot be undone.`,
                          );
                          if (!ok) return;
                          setTournyBusy(true);
                          setTournyError(null);
                          void deleteTournament(authUser, t.id)
                            .then(() => refreshHostTournaments())
                            .catch((e) =>
                              setTournyError(e instanceof Error ? e.message : 'Delete failed'),
                            )
                            .finally(() => setTournyBusy(false));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {tourneyError && (
                <p className="auth-error" role="alert">
                  {tourneyError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {settingsTab === 'avatars' && (
        <div
          className="settings-tab-panel"
          role="tabpanel"
          id="settings-panel-avatars"
          aria-labelledby="settings-tab-avatars"
        >
          <p className="section-label">Owned Avatars</p>
          <p className="field-hint settings-tab-blurb">
            Tap to equip · tap the big preview to zoom. Buy more in the Store — unlocks appear here.
          </p>
          <div className="profile-preview">
            <button
              type="button"
              className="profile-preview-hit"
              title="Tap to preview"
              aria-label="Preview equipped avatar"
              onClick={() => {
                const selected = selectableAvatars.find((x) => x.id === avatarId);
                const src =
                  selected?.imageSrc ??
                  (avatarId === CRIB_MASTER_ID && avatarDataUrl ? avatarDataUrl : undefined);
                if (src) {
                  setAvatarPreview({ src, label: selected?.label ?? 'Avatar' });
                }
              }}
            >
              <AvatarView profile={draft} size="lg" />
            </button>
            <p className="avatar-equip-name">{equippedAvatarLabel}</p>
          </div>
          {signatureAvatars.length > 0 && (
            <div className="avatar-section">
              <p className="section-label">Signature</p>
              <div className="avatar-grid">
                {signatureAvatars.map((a) => {
                  const selected = avatarId === a.id;
                  const thumbSrc = a.imageSrc;
                  return (
                    <div key={a.id} className="avatar-pick-wrap">
                      <button
                        type="button"
                        className={`avatar-pick ${selected ? 'selected' : ''}`}
                        style={{ background: a.bg }}
                        title={a.label}
                        aria-label={a.label}
                        aria-pressed={selected}
                        onClick={() => {
                          const already = avatarId === a.id;
                          setAvatarId(a.id);
                          // Crib Master uses stylized PNG; clear any legacy data URL.
                          setAvatarDataUrl(null);
                          setSaveOk(null);
                          if (already && thumbSrc) {
                            setAvatarPreview({ src: thumbSrc, label: a.label });
                          }
                        }}
                      >
                        {thumbSrc ? (
                          <img src={thumbSrc} alt="" className="avatar-glyph-img" />
                        ) : (
                          <span className="avatar-glyph">{a.glyph}</span>
                        )}
                      </button>
                      <span className="avatar-pick-label">{a.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="avatar-section">
            <p className="section-label">Defaults</p>
            <div className="avatar-grid">
              {defaultAvatars.map((a) => {
                const selected = avatarId === a.id;
                const thumbSrc = a.imageSrc;
                return (
                  <div key={a.id} className="avatar-pick-wrap">
                    <button
                      type="button"
                      className={`avatar-pick ${selected ? 'selected' : ''}`}
                      style={{ background: a.bg }}
                      title={a.label}
                      aria-label={a.label}
                      aria-pressed={selected}
                      onClick={() => {
                        const already = avatarId === a.id;
                        setAvatarId(a.id);
                        setAvatarDataUrl(null);
                        setSaveOk(null);
                        if (already && thumbSrc) {
                          setAvatarPreview({ src: thumbSrc, label: a.label });
                        }
                      }}
                    >
                      {thumbSrc ? (
                        <img src={thumbSrc} alt="" className="avatar-glyph-img" />
                      ) : (
                        <span className="avatar-glyph">{a.glyph}</span>
                      )}
                    </button>
                    <span className="avatar-pick-label">{a.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="field-hint">Equipped avatar shows on your profile and at the table.</p>
        </div>
      )}

      {settingsTab === 'emoji' && (
        <div
          className="settings-tab-panel"
          role="tabpanel"
          id="settings-panel-emoji"
          aria-labelledby="settings-tab-emoji"
        >
          <p className="section-label">Reaction rail</p>
          <p className="field-hint settings-tab-blurb">
            Tap an owned emoji to preview big. Use Put on dock to load it into a slot. Save to apply.
          </p>
          <div className="owned-emoji-pack" aria-label="Equipped reaction rail">
            <div className="owned-emoji-pack-header">
              <span className="owned-emoji-pack-title coin-metal-text">Dock loadout</span>
              <span className="owned-emoji-equipped-pill" role="status">
                {RAIL_SLOT_COUNT} slots
              </span>
            </div>
            <ul className="owned-emoji-grid owned-emoji-rail-slots">
              {equippedRail.map((id, slot) => {
                const art = artForReactEmojiId(id);
                const textMode = isTextRailEmoji(id);
                const selected = equipSlot === slot;
                return (
                  <li key={`slot-${slot}`}>
                    <button
                      type="button"
                      className={`owned-emoji-slot owned-emoji-slot-owned owned-emoji-slot-btn${selected ? ' selected' : ''}`}
                      aria-label={`Slot ${slot + 1}: ${labelForReactEmojiId(id)}`}
                      aria-pressed={selected}
                      title={`Slot ${slot + 1}`}
                      onClick={() => {
                        setEquipSlot((prev) => (prev === slot ? null : slot));
                        setSaveOk(null);
                      }}
                    >
                      <span className="owned-emoji-face" aria-hidden>
                        {textMode ? (
                          <span className="owned-emoji-text">
                            <span>good</span>
                            <span>luck</span>
                          </span>
                        ) : art ? (
                          <img src={art} alt="" className="owned-emoji-art" width={36} height={36} draggable={false} />
                        ) : (
                          <span className="owned-emoji-glyph">{glyphForReactEmojiId(id)}</span>
                        )}
                      </span>
                      <span className="owned-emoji-label">{labelForReactEmojiId(id)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="record-note">
              {equipSlot == null
                ? 'Tap a dock slot to select it, or tap an owned emoji to preview and Put on dock.'
                : `Slot ${equipSlot + 1} selected — open an owned emoji and Equip to slot ${equipSlot + 1}.`}
            </p>
          </div>

          <p className="section-label" style={{ marginTop: '0.85rem' }}>
            Owned Emoji
          </p>
          <p className="field-hint settings-tab-blurb">
            Free defaults always owned. Tap an owned emoji to preview big and load it into the dock. Store unlocks appear here when you buy them.
          </p>
          <ul className="owned-emoji-grid owned-emoji-owned-list" aria-label="Owned reactions">
            {ownedEmojis.map((id) => {
              const art = artForReactEmojiId(id);
              const textMode = isTextRailEmoji(id);
              const onRail = equippedRail.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`owned-emoji-slot owned-emoji-slot-owned owned-emoji-slot-btn${onRail ? ' on-rail' : ''}`}
                    aria-label={`Preview ${labelForReactEmojiId(id)}`}
                    onClick={() => {
                      setEmojiEquipConfirm(null);
                      setEmojiPreviewId(id);
                      setSaveOk(null);
                    }}
                  >
                    <span className="owned-emoji-face" aria-hidden>
                      {textMode ? (
                        <span className="owned-emoji-text">
                          <span>good</span>
                          <span>luck</span>
                        </span>
                      ) : art ? (
                        <img src={art} alt="" className="owned-emoji-art" width={36} height={36} draggable={false} />
                      ) : (
                        <span className="owned-emoji-glyph">{glyphForReactEmojiId(id)}</span>
                      )}
                    </span>
                    <span className="owned-emoji-label">{labelForReactEmojiId(id)}</span>
                    {onRail && (
                      <span className="owned-emoji-on-rail-tag" aria-hidden>
                        On rail
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {settingsTab === 'felt' && (
        <div
          className="settings-tab-panel"
          role="tabpanel"
          id="settings-panel-felt"
          aria-labelledby="settings-tab-felt"
        >
          <p className="section-label">Owned Felts</p>
          <p className="field-hint settings-tab-blurb">
            Table cloth themes you own. Buy more in the Store when Felt opens.
          </p>
          <div className="owned-felt-grid" role="list">
            {getSelectableFelts(effectiveOwnedFeltIds(authUser?.uid, profile.ownedFeltIds, authUser?.email)).map((felt: FeltTheme) => {
              const locked = !!felt.locked || !ownsFelt(effectiveOwnedFeltIds(authUser?.uid, profile.ownedFeltIds, authUser?.email), felt.id);
              const selected = theme === felt.id;
              return (
                <button
                  key={felt.id}
                  type="button"
                  role="listitem"
                  className={`owned-cosmetic-card${selected ? ' selected' : ''}${locked ? ' owned-cosmetic-locked' : ''}`}
                  aria-pressed={selected}
                  disabled={locked}
                  title={locked ? 'Coming soon' : felt.label}
                  onClick={() => {
                    if (locked) return;
                    setTheme(normalizeFeltId(felt.id));
                    setSaveOk(null);
                  }}
                >
                  {felt.thumbSrc || felt.imageSrc ? (
                    <span
                      className="owned-felt-swatch owned-felt-swatch-img"
                      style={{
                        backgroundImage: `url(${felt.thumbSrc || felt.imageSrc})`,
                      }}
                      aria-hidden
                    />
                  ) : (
                    <span className="owned-felt-swatch owned-felt-swatch-green" aria-hidden />
                  )}
                  <span className="owned-cosmetic-meta">
                    <span className="owned-cosmetic-name coin-metal-text">{felt.label}</span>
                    <span className="owned-cosmetic-blurb">
                      {locked ? 'Coming soon' : felt.blurb}
                    </span>
                  </span>
                  {locked ? (
                    <span className="owned-emoji-lock" aria-hidden>
                      🔒
                    </span>
                  ) : selected ? (
                    <span className="owned-emoji-equipped-pill" role="status">
                      Equipped
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className="section-label" style={{ marginTop: '1rem' }}>
            Owned Boards
          </p>
          <p className="field-hint settings-tab-blurb">
            Pegboard skins you own. Buy more in the Store (Board shelf).
          </p>
          <div className="owned-felt-grid" role="list">
            {getSelectableBoards(effectiveOwnedBoardIds(authUser?.uid, profile.ownedBoardIds, authUser?.email)).map((skin: BoardSkin) => {
              const locked = !!skin.locked || !ownsBoard(effectiveOwnedBoardIds(authUser?.uid, profile.ownedBoardIds, authUser?.email), skin.id);
              const selected = board === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  role="listitem"
                  className={`owned-cosmetic-card${selected ? ' selected' : ''}${locked ? ' owned-cosmetic-locked' : ''}`}
                  aria-pressed={selected}
                  disabled={locked}
                  title={locked ? 'Coming soon' : skin.label}
                  onClick={() => {
                    if (locked) return;
                    setBoard(normalizeBoardId(skin.id));
                    setSaveOk(null);
                  }}
                >
                  <span
                    className={`owned-board-swatch${skin.thumbClass ? ` ${skin.thumbClass}` : ''}`}
                    aria-hidden
                  />
                  <span className="owned-cosmetic-meta">
                    <span className="owned-cosmetic-name coin-metal-text">{skin.label}</span>
                    <span className="owned-cosmetic-blurb">
                      {locked ? 'Coming soon' : skin.blurb}
                    </span>
                  </span>
                  {locked ? (
                    <span className="owned-emoji-lock" aria-hidden>
                      🔒
                    </span>
                  ) : selected ? (
                    <span className="owned-emoji-equipped-pill" role="status">
                      Equipped
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saveOk && (
        <p className="form-ok" role="status">
          {saveOk}
        </p>
      )}

      <button type="button" className="primary menu-action" onClick={persist} disabled={saving}>
        <span className="coin-metal-text">{saving ? 'Saving…' : 'Save'}</span>
      </button>
      <button type="button" className="menu-action" onClick={onFriends}>
        <span className="coin-metal-text">Friends</span>
      </button>
      <button type="button" className="menu-action" onClick={onBack}>
        <span className="coin-metal-text">Back to home</span>
      </button>

      {emojiPreviewId && (
        <div
          className="emoji-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labelForReactEmojiId(emojiPreviewId)}
          onClick={closeEmojiPreview}
        >
          <div
            className="emoji-preview-modal overlay-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="emoji-preview-title coin-metal-text">
              {labelForReactEmojiId(emojiPreviewId)}
            </h2>
            <div className="emoji-preview-stage">
              <ReactEmoji
                key={emojiPreviewId}
                id={emojiPreviewId}
                mode="preview"
                autoPlayOnMount
                className="emoji-preview-react"
                label={`Replay ${labelForReactEmojiId(emojiPreviewId)}`}
              />
              <p className="emoji-preview-replay-hint">Tap emote to replay</p>
            </div>
            {equippedRail.includes(emojiPreviewId) && (
              <p className="emoji-preview-on-rail" role="status">
                On rail
                {equippedRail.indexOf(emojiPreviewId) >= 0
                  ? ` · slot ${equippedRail.indexOf(emojiPreviewId) + 1}`
                  : ''}
                {' — move to another slot below'}
              </p>
            )}
            <div className="emoji-preview-dock">
              <p className="section-label emoji-preview-dock-label">Put on dock</p>
              <ul className="emoji-preview-slot-grid" aria-label="Dock slots">
                {equippedRail.map((slotId, slot) => {
                  const art = artForReactEmojiId(slotId);
                  const textMode = isTextRailEmoji(slotId);
                  const selected = equipSlot === slot;
                  const isTarget = selected;
                  return (
                    <li key={`preview-slot-${slot}`}>
                      <button
                        type="button"
                        className={`emoji-preview-slot-btn${isTarget ? ' selected' : ''}${slotId === emojiPreviewId ? ' is-current' : ''}`}
                        aria-label={`Put on dock slot ${slot + 1}`}
                        onClick={() => putPreviewOnDockSlot(slot)}
                      >
                        <span className="emoji-preview-slot-num">{slot + 1}</span>
                        <span className="emoji-preview-slot-face" aria-hidden>
                          {textMode ? (
                            <span className="owned-emoji-text">
                              <span>good</span>
                              <span>luck</span>
                            </span>
                          ) : art ? (
                            <img src={art} alt="" width={28} height={28} draggable={false} />
                          ) : (
                            <span className="owned-emoji-glyph">{glyphForReactEmojiId(slotId)}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {equipSlot != null && (
                <button
                  type="button"
                  className="primary emoji-preview-equip-primary"
                  onClick={() => putPreviewOnDockSlot(equipSlot)}
                >
                  <span className="coin-metal-text">Equip to slot {equipSlot + 1}</span>
                </button>
              )}
              {emojiEquipConfirm && (
                <p className="emoji-preview-confirm form-ok" role="status">
                  {emojiEquipConfirm}
                </p>
              )}
            </div>
            <button type="button" className="menu-action emoji-preview-close" onClick={closeEmojiPreview}>
              <span className="coin-metal-text">Close</span>
            </button>
          </div>
        </div>
      )}

      {avatarPreview && (
        <AvatarPreviewModal
          src={avatarPreview.src}
          label={avatarPreview.label}
          onClose={() => setAvatarPreview(null)}
        />
      )}
    </div>
  );
}
