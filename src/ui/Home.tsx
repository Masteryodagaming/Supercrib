import { useState } from 'react';
import type { AiDifficulty, ScoringMode } from '../engine/supercrib';
import type { Profile } from '../profile/storage';
import { authProviderLabel, type AuthUser } from '../profile/auth';
import { SUPER_COIN_PUBLIC_PATH } from '../profile/coins';
import { GOOGLE_SIGNIN_PROMO_SC } from '../profile/promos';
import { isBoardSkinTestDummy } from '../profile/boards';
import { AvatarView } from './AvatarView';
import { CoinPurse } from './CoinPurse';
import { HomeNotifications } from './HomeNotifications';
import { isOwner } from '../tournament/isOwner';

type ChooserStep = 'closed' | 'match' | 'aiScoring' | 'aiDifficulty';

const AI_DIFFICULTY_KEY = 'supercrib.aiDifficulty';

const DIFFICULTIES: { id: AiDifficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Forgiving — makes mistakes' },
  { id: 'normal', label: 'Normal', hint: 'Solid heuristics' },
  { id: 'hard', label: 'Hard', hint: 'Sharper crib & pegging' },
];

export function loadStoredAiDifficulty(): AiDifficulty {
  try {
    const v = localStorage.getItem(AI_DIFFICULTY_KEY);
    if (v === 'easy' || v === 'normal' || v === 'hard') return v;
  } catch {
    /* ignore */
  }
  return 'normal';
}

function storeAiDifficulty(d: AiDifficulty): void {
  try {
    localStorage.setItem(AI_DIFFICULTY_KEY, d);
  } catch {
    /* ignore */
  }
}

interface Props {
  profile: Profile;
  authUser: AuthUser | null;
  authConfigured: boolean;
  authBusy: boolean;
  authError: string | null;
  onSignIn: () => void;
  onAi: (difficulty: AiDifficulty, scoringMode?: ScoringMode) => void;
  onOnline: (scoringMode?: ScoringMode) => void;
  onRules: () => void;
  onSettings: () => void;
  onFriends: () => void;
  onTournaments: () => void;
  onEditProfile: () => void;
  /** Owner-only: open Settings and scroll to Doctor coins. */
  onOpenDoctor?: () => void;
  /** Owner-only: open Store screen. */
  onOpenStore?: () => void;
  /** After claiming an avatar gift — keep App profile.ownedAvatarIds in sync. */
  onProfileUpdate?: (p: Profile) => void;
}

export function Home({
  profile,
  authUser,
  authConfigured,
  authBusy,
  authError,
  onSignIn,
  onAi,
  onOnline,
  onRules,
  onSettings,
  onFriends,
  onTournaments,
  onEditProfile,
  onOpenDoctor,
  onOpenStore,
  onProfileUpdate,
}: Props) {
  const record = profile.record ?? { wins: 0, losses: 0, gamesPlayed: 0 };
  const wins = record.wins ?? 0;
  const losses = record.losses ?? 0;
  const gamesPlayed = record.gamesPlayed ?? 0;
  const online = profile.onlineRecord ?? { wins: 0, losses: 0, gamesPlayed: 0 };
  const oWins = online.wins ?? 0;
  const oLosses = online.losses ?? 0;
  const oGames = online.gamesPlayed ?? 0;
  const [step, setStep] = useState<ChooserStep>('closed');
  const [aiDiff, setAiDiff] = useState<AiDifficulty>(() => loadStoredAiDifficulty());
  const [scoringMode, setScoringMode] = useState<ScoringMode>('auto');

  const openMatch = () => setStep('match');
  const closeChooser = () => setStep('closed');

  const dummyTester = isBoardSkinTestDummy(authUser?.uid, authUser?.email);

  const startAi = (d: AiDifficulty, mode: ScoringMode = scoringMode) => {
    storeAiDifficulty(d);
    setAiDiff(d);
    closeChooser();
    onAi(d, mode);
  };

  const goAiDifficulty = (mode: ScoringMode) => {
    setScoringMode(mode);
    setAiDiff(loadStoredAiDifficulty());
    setStep('aiDifficulty');
  };

  const chipName = profile.displayName;
  const providerLabel = authProviderLabel(authUser);
  const authHint =
    authUser?.displayName && authUser.displayName !== profile.displayName
      ? authUser.displayName
      : authUser?.email ?? null;

  const openDoctor = onOpenDoctor ?? onSettings;
  const openStore = onOpenStore ?? onSettings;
  const owner = isOwner(authUser);

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-top">
          <HomeNotifications
            uid={authUser?.uid ?? null}
            signedIn={Boolean(authUser)}
            onProfileUpdate={onProfileUpdate}
          />
          {authUser ? (
            <div className="home-coin-bar" aria-label="Super Coins">
              <CoinPurse
                coins={profile.coins}
                className="coin-purse-home"
                onClick={openStore}
              />
              {owner && (
                <button
                  type="button"
                  className="home-coin-add"
                  onClick={openDoctor}
                  aria-label="Doctor Super Coins"
                >
                  Add
                </button>
              )}
            </div>
          ) : (
            <div className="home-header-spacer" aria-hidden="true" />
          )}
        </div>
        <h1 className="title title-coin">SUPERCRIB</h1>
        <p className="subtitle">Race to 241 · StinkHole · Phone-first</p>
      </header>

      <button type="button" className="profile-chip" onClick={onEditProfile}>
        <AvatarView profile={profile} size="sm" />
        <div className="profile-chip-text">
          <span className="profile-chip-name-row">
            <span className="profile-chip-name">{chipName}</span>
          </span>
          {authUser && (
            <span className="profile-chip-auth">
              Signed in · {providerLabel}
              {authHint ? `: ${authHint}` : ''}
            </span>
          )}
          {!authUser && (
            <span className="profile-chip-auth">Guest · play without login OK</span>
          )}
          <span className="profile-chip-record">
            Vs AI · {wins}W – {losses}L
            {gamesPlayed > 0 ? ` · ${gamesPlayed}g` : ''}
          </span>
          <span className="profile-chip-record">
            Online · {oWins}W – {oLosses}L
            {oGames > 0 ? ` · ${oGames}g` : ''}
          </span>
        </div>
      </button>

      {!authUser && (
        <div className="google-promo-card" aria-label="Sign-in promo">
          <div className="google-promo-art">
            <img
              src={SUPER_COIN_PUBLIC_PATH}
              alt=""
              className="google-promo-coin"
              width={48}
              height={48}
            />
            <span className="google-promo-amount coin-metal-text">{GOOGLE_SIGNIN_PROMO_SC} SC</span>
          </div>
          <p className="google-promo-copy">
            Sign up or log in · get {GOOGLE_SIGNIN_PROMO_SC} SC
          </p>
          <p className="google-promo-sub">Google or email · one-time per account · never real money</p>
          <button
            type="button"
            className="btn primary google-promo-cta"
            disabled={authBusy || !authConfigured}
            onClick={onSignIn}
          >
            {authBusy ? 'Signing in…' : 'Continue with Google'}
          </button>
          <button
            type="button"
            className="btn google-promo-email"
            disabled={authBusy || !authConfigured}
            onClick={onSettings}
          >
            Or use email in Settings
          </button>
        </div>
      )}
      {!authConfigured && (
        <p className="auth-hint" role="status">
          Firebase Auth not configured — guest play still works.
        </p>
      )}
      {authError && (
        <p className="auth-error" role="alert">
          {authError}
        </p>
      )}

      <button type="button" className="primary" onClick={openMatch}>
        <span className="coin-metal-text">Find Match</span>
      </button>
      <button type="button" onClick={openStore}>
        <span className="coin-metal-text">Store</span>
      </button>
      <button type="button" onClick={onRules}>
        <span className="coin-metal-text">Rules</span>
      </button>
      <button type="button" onClick={onSettings}>
        <span className="coin-metal-text">Settings</span>
      </button>
      <button type="button" onClick={onTournaments}>
        <span className="coin-metal-text">Tournaments</span>
      </button>
      <button type="button" onClick={onFriends}>
        <span className="coin-metal-text">Friends</span>
      </button>

      {step === 'match' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Find Match">
          <div className="overlay-card find-match-card">
            <h2>Find Match</h2>
            <p className="find-match-hint">Choose how to play</p>
            <button
              type="button"
              className="btn primary find-match-option"
              onClick={() => {
                // Mode (Normal/Competitive) is picked in the waiting lobby
                // once both players are seated — not before Create/Join.
                closeChooser();
                onOnline('auto');
              }}
            >
              <span className="coin-metal-text">Play online</span>
            </button>
            <button
              type="button"
              className="btn primary find-match-option"
              onClick={() => {
                if (dummyTester) {
                  setStep('aiScoring');
                } else {
                  goAiDifficulty('auto');
                }
              }}
            >
              <span className="coin-metal-text">Random AI</span>
            </button>
            <button type="button" className="btn find-match-option" onClick={closeChooser}>
              <span className="coin-metal-text">Cancel</span>
            </button>
          </div>
        </div>
      )}

      {step === 'aiScoring' && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Scoring mode"
        >
          <div className="overlay-card find-match-card">
            <h2>Scoring mode</h2>
            <p className="find-match-hint">
              Both modes are SuperCrib. Competitive: (count your own &amp; Muggins)
            </p>
            <button
              type="button"
              className="btn primary find-match-option ai-diff-option"
              onClick={() => goAiDifficulty('auto')}
            >
              <span className="ai-diff-label">Normal</span>
              <span className="ai-diff-hint">(auto count)</span>
            </button>
            <button
              type="button"
              className="btn primary find-match-option ai-diff-option"
              onClick={() => goAiDifficulty('competitive')}
            >
              <span className="ai-diff-label">Competitive</span>
              <span className="ai-diff-hint">(count your own &amp; Muggins)</span>
            </button>
            <button type="button" className="btn find-match-option" onClick={() => setStep('match')}>
              <span className="coin-metal-text">Back</span>
            </button>
          </div>
        </div>
      )}


      {step === 'aiDifficulty' && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="AI Difficulty"
        >
          <div className="overlay-card find-match-card">
            <h2>AI Difficulty</h2>
            <p className="find-match-hint">
              {scoringMode === 'competitive'
                ? 'Competitive · (count your own & Muggins)'
                : 'Normal · (auto count)'}
            </p>
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`btn find-match-option ai-diff-option${aiDiff === d.id ? ' primary' : ''}`}
                onClick={() => startAi(d.id, scoringMode)}
              >
                <span className="ai-diff-label">{d.label}</span>
                <span className="ai-diff-hint">{d.hint}</span>
              </button>
            ))}
            <button
              type="button"
              className="btn find-match-option"
              onClick={() => setStep(dummyTester ? 'aiScoring' : 'match')}
            >
              <span className="coin-metal-text">Back</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
