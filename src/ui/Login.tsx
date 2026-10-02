import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_AVATARS,
  getSelectableAvatars,
  migrateMasterYodaSelection,
  splitSelectableAvatars,
} from '../profile/avatars';
import { isOwner } from '../tournament/isOwner';
import { SUPER_COIN_SHOP } from '../profile/coins';
import {
  Profile,
  createDefaultProfile,
  loadProfile,
  saveProfile,
} from '../profile/storage';
import { authProviderLabel, type AuthUser } from '../profile/auth';
import { AvatarView } from './AvatarView';

type EmailMode = 'signin' | 'signup';

interface Props {
  /** Existing profile when editing / welcome-back; null = first create. */
  existing: Profile | null;
  onDone: (profile: Profile) => void;
  authUser?: AuthUser | null;
  authConfigured?: boolean;
  authBusy?: boolean;
  authError?: string | null;
  onSignIn?: () => void;
  onSignInWithEmail?: (email: string, password: string) => void;
  onSignUpWithEmail?: (email: string, password: string, displayName?: string) => void;
  /** Firebase Auth password reset for email/password accounts. */
  onForgotPassword?: (email: string) => Promise<boolean> | boolean | void;
}

const MIN_PASSWORD_LEN = 6;

export function Login({
  existing,
  onDone,
  authUser = null,
  authConfigured = false,
  authBusy = false,
  authError = null,
  onSignIn,
  onSignInWithEmail,
  onSignUpWithEmail,
  onForgotPassword,
}: Props) {
  const owner = isOwner(authUser);
  const ownerMigrateOpts = useMemo(
    () => (authUser ? { owner } : undefined),
    [authUser, owner],
  );
  const seeded = existing ? migrateMasterYodaSelection(existing, ownerMigrateOpts) : null;
  const [name, setName] = useState(seeded?.displayName ?? '');
  const [avatarId, setAvatarId] = useState(seeded?.avatarId ?? BUILTIN_AVATARS[0].id);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(
    seeded?.avatarDataUrl ?? null,
  );
  const selectableAvatars = useMemo(
    () => getSelectableAvatars(existing?.ownedAvatarIds, SUPER_COIN_SHOP, { owner }),
    [existing?.ownedAvatarIds, owner],
  );
  const { signature: signatureAvatars, defaults: defaultAvatars } = useMemo(
    () => splitSelectableAvatars(selectableAvatars),
    [selectableAvatars],
  );
  const equippedAvatarLabel =
    selectableAvatars.find((x) => x.id === avatarId)?.label ?? 'Avatar';
  const [error, setError] = useState<string | null>(null);
  const [guestOpen, setGuestOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<EmailMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [signupDisplayName, setSignupDisplayName] = useState('');
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  // Prefer auth display name when seeding a fresh guest form after sign-out.
  useEffect(() => {
    if (authUser?.displayName && (!name.trim() || name === 'Player')) {
      setName(authUser.displayName.trim().slice(0, 24));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  const preview: Profile = {
    ...(existing ?? createDefaultProfile(name)),
    displayName: name.trim() || 'Player',
    avatarId,
    avatarDataUrl,
  };

  const continueExisting = existing && loadProfile();

  const commitGuest = () => {
    const base = existing ?? createDefaultProfile(name);
    const saved = saveProfile(
      migrateMasterYodaSelection(
        {
          ...base,
          displayName: name.trim() || 'Player',
          avatarId,
          avatarDataUrl,
        },
        ownerMigrateOpts,
      ),
    );
    onDone(saved);
  };

  const continueSignedIn = () => {
    const base =
      loadProfile() ??
      existing ??
      createDefaultProfile(authUser?.displayName ?? name);
    const saved = saveProfile(
      migrateMasterYodaSelection(
        {
          ...base,
          displayName:
            (name.trim() || base.displayName || authUser?.displayName || 'Player').slice(0, 24),
          avatarId,
          avatarDataUrl,
        },
        ownerMigrateOpts,
      ),
    );
    onDone(saved);
  };


  const submitEmail = () => {
    setError(null);
    setResetInfo(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (emailMode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      onSignUpWithEmail?.(
        trimmedEmail,
        password,
        signupDisplayName.trim() || undefined,
      );
      return;
    }
    onSignInWithEmail?.(trimmedEmail, password);
  };

  const providerLabel = authProviderLabel(authUser);
  const accountName = authUser?.displayName?.trim() || null;
  const accountEmail = authUser?.email?.trim() || null;

  return (
    <div className="home login-screen">
      <h1 className="title">SUPERCRIB</h1>
      <p className="subtitle">
        {authUser ? 'Account ready — enter the table' : 'Sign in to sync your game'}
      </p>

      <section className="account-card login-account-card" aria-label="Account">
        <p className="section-label">Account</p>
        {authUser ? (
          <>
            <div className="account-identity">
              <span className="account-status-pill signed-in">
                Signed in with {providerLabel}
              </span>
              {accountName && <span className="account-google-name">{accountName}</span>}
              {accountEmail && <span className="account-google-email">{accountEmail}</span>}
            </div>
            <p className="account-sync-status" role="status">
              Profile &amp; friends sync across devices
            </p>
            <button
              type="button"
              className="btn primary auth-btn account-auth-btn"
              disabled={authBusy}
              onClick={continueSignedIn}
            >
              Enter SUPERCRIB
            </button>
          </>
        ) : (
          <>
            <p className="account-guest-note">
              Sign in with Google or email — creates your Supercrib account (first time or
              returning). Same cloud profile either way.
            </p>
            <button
              type="button"
              className="btn primary auth-btn account-auth-btn"
              disabled={authBusy || !authConfigured || !onSignIn}
              onClick={() => onSignIn?.()}
            >
              {authBusy ? 'Signing in…' : 'Sign in with Google'}
            </button>

            <div className="login-or login-or-in-card" aria-hidden>
              <span>or</span>
            </div>

            <div className="login-email-tabs" role="tablist" aria-label="Email account">
              <button
                type="button"
                role="tab"
                aria-selected={emailMode === 'signin'}
                className={`login-email-tab ${emailMode === 'signin' ? 'active' : ''}`}
                disabled={authBusy}
                onClick={() => {
                  setEmailMode('signin');
                  setError(null);
                  setResetInfo(null);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={emailMode === 'signup'}
                className={`login-email-tab ${emailMode === 'signup' ? 'active' : ''}`}
                disabled={authBusy}
                onClick={() => {
                  setEmailMode('signup');
                  setError(null);
                  setResetInfo(null);
                }}
              >
                Create account
              </button>
            </div>

            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="field-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              disabled={authBusy || !authConfigured}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setResetInfo(null);
              }}
            />

            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="field-input"
              type="password"
              autoComplete={emailMode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={`At least ${MIN_PASSWORD_LEN} characters`}
              value={password}
              disabled={authBusy || !authConfigured}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
                setResetInfo(null);
              }}
            />

            {emailMode === 'signin' && onForgotPassword && (
              <button
                type="button"
                className="login-forgot-link"
                disabled={authBusy || !authConfigured}
                onClick={() => {
                  void (async () => {
                    setError(null);
                    setResetInfo(null);
                    const trimmedEmail = email.trim();
                    if (!trimmedEmail) {
                      setError('Enter your email to reset the password.');
                      return;
                    }
                    const ok = await onForgotPassword(trimmedEmail);
                    if (ok) {
                      setResetInfo('Check your email for a reset link.');
                    }
                  })();
                }}
              >
                Forgot password?
              </button>
            )}

            {emailMode === 'signup' && (
              <>
                <label className="field-label" htmlFor="login-confirm-password">
                  Confirm password
                </label>
                <input
                  id="login-confirm-password"
                  className="field-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  disabled={authBusy || !authConfigured}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError(null);
                  }}
                />

                <label className="field-label" htmlFor="login-signup-name">
                  Display name <span className="field-optional">(optional)</span>
                </label>
                <input
                  id="login-signup-name"
                  className="field-input"
                  type="text"
                  maxLength={24}
                  autoComplete="nickname"
                  placeholder="Your name"
                  value={signupDisplayName}
                  disabled={authBusy || !authConfigured}
                  onChange={(e) => {
                    setSignupDisplayName(e.target.value);
                    setError(null);
                  }}
                />
              </>
            )}

            <button
              type="button"
              className="btn primary auth-btn account-auth-btn"
              disabled={
                authBusy ||
                !authConfigured ||
                (emailMode === 'signin' ? !onSignInWithEmail : !onSignUpWithEmail)
              }
              onClick={submitEmail}
            >
              {authBusy
                ? emailMode === 'signup'
                  ? 'Creating account…'
                  : 'Signing in…'
                : emailMode === 'signup'
                  ? 'Create account'
                  : 'Sign in with email'}
            </button>

            {!authConfigured && (
              <p className="auth-hint account-inline-hint" role="status">
                Firebase Auth not configured — use Login as guest below.
              </p>
            )}
          </>
        )}
        {(authError || error) && (
          <p className="auth-error account-inline-hint" role="alert">
            {authError || error}
          </p>
        )}
        {resetInfo && !authError && !error && (
          <p className="auth-hint account-inline-hint login-reset-info" role="status">
            {resetInfo}
          </p>
        )}
      </section>

      {!authUser && guestOpen && (
        <div className="login-guest-panel">
          <p className="section-label">Guest profile</p>
          <p className="account-guest-note login-guest-blurb">
            No account needed — Vs AI and room codes still work. Sign in later from Settings to
            sync.
          </p>

          <div className="profile-preview">
            <AvatarView profile={preview} size="lg" />
            <div className="profile-preview-name">{preview.displayName}</div>
            <p className="avatar-equip-name">{equippedAvatarLabel}</p>
          </div>

          <label className="field-label" htmlFor="login-name">
            Display name
          </label>
          <input
            id="login-name"
            className="field-input"
            type="text"
            maxLength={24}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />

          <p className="section-label">Avatar</p>
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
                        onClick={() => {
                          setAvatarId(a.id);
                          setAvatarDataUrl(null);
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
                      onClick={() => {
                        setAvatarId(a.id);
                        setAvatarDataUrl(null);
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
          <p className="field-hint">Win or buy new ones and they&apos;ll show up here.</p>

          <button type="button" className="primary" onClick={commitGuest}>
            {existing ? 'Continue as guest' : 'Enter as guest'}
          </button>

          {continueExisting && (
            <button type="button" onClick={() => onDone(continueExisting)}>
              Continue as {continueExisting.displayName}
            </button>
          )}

          <button
            type="button"
            className="login-guest-cancel"
            onClick={() => setGuestOpen(false)}
          >
            Back to sign in
          </button>
        </div>
      )}

      {authUser && (
        <p className="login-footnote">
          You can edit display name &amp; avatar anytime in Settings.
        </p>
      )}
      {!authUser && !guestOpen && (
        <>
          <p className="login-footnote">
            Google or email sign-in creates a free Supercrib account and syncs profile &amp;
            friends.
          </p>
          <button
            type="button"
            className="login-guest-link"
            onClick={() => setGuestOpen(true)}
          >
            Login as guest
          </button>
        </>
      )}
      {!authUser && guestOpen && (
        <p className="login-footnote">
          Guest play works offline. Sign in later from Settings to sync.
        </p>
      )}
    </div>
  );
}
