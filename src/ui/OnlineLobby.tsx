import type { ScoringMode } from '../engine/supercrib';
import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../multiplayer/types';
import { isValidRoomCode, normalizeRoomCode } from '../multiplayer/roomCode';
import { roomShareUrl } from '../multiplayer/roomSession';
import { SideLiveChatButton } from './SideLiveChatButton';
import type { SideLiveChatUiStatus } from '../multiplayer/useSideLiveChat';
import {
  deriveLobbyVoiceHint,
  effectiveLobbyVoiceJoined,
  shouldPulseConnectVoice,
  shouldShowPeerNeedsConnect,
  shouldShowVoiceDebugLine,
} from '../multiplayer/useSideLiveChat';

type Step = 'menu' | 'create' | 'join' | 'waiting';

interface Props {
  configured: boolean;
  displayName: string;
  code: string | null;
  shareUrl: string | null;
  connection: ConnectionStatus;
  error: string | null;
  onCreate: (name: string) => Promise<string>;
  onJoin: (code: string, name: string) => Promise<void>;
  onLeave: () => void;
  onBack: () => void;
  /** When cut UI or game ready, parent takes over — keep lobby mounted otherwise. */
  busy?: boolean;
  /** Status is cutting but cut payload not yet complete for CutForDeal. */
  preparingCut?: boolean;
  /** Room status playing / deal syncing — show Loading deal, not cut hint. */
  loadingDeal?: boolean;
  roomStatus?: string | null;
  /** Host (seat 0) — show Play when connected and no game yet. */
  isHost?: boolean;
  /** Host Play: write full cut stock (ensureCut). Does not deal. */
  onPlay?: () => void | Promise<void>;
  /**
   * Tournament board match — hide share/code; opponent joins via Live board Play game.
   */
  tournamentMatch?: { opponentName?: string } | null;
  /** Host-picked scoring mode on the room (guest inherits). */
  scoringMode?: ScoringMode | null;
  /**
   * Host-only: change scoring mode in waiting lobby (writes RTDB).
   * Omit / undefined for guest (read-only badge).
   */
  onSetScoringMode?: (mode: ScoringMode) => void | Promise<void>;
  /** Mobile-only lobby Connect voice (preview + live; carries into table). */
  lobbyVoice?: {
    available: boolean;
    joined: boolean;
    localReady?: boolean;
    peerReady?: boolean;
    indicator: 'green' | 'red' | 'none';
    uiStatus: SideLiveChatUiStatus;
    remoteTalking: boolean;
    localSpeaking: boolean;
    inlineError: string | null;
    statusDetail: string | null;
    debugLine: string | null;
    remoteStream: MediaStream | null;
    onConnect: () => void;
    onDisconnect: () => void;
    /** Other seat display name for “X needs Connect”. */
    peerSeatName?: string | null;
  } | null;
}

function connectionLabel(c: ConnectionStatus): string {
  if (c === 'waiting') return "You're in — waiting for your opponent to join";
  if (c === 'connected') return 'Both here — ready to cut';
  if (c === 'disconnected') return 'Opponent disconnected';
  return 'Offline';
}

export function OnlineLobby({
  configured,
  displayName,
  code,
  shareUrl,
  connection,
  error,
  onCreate,
  onJoin,
  onLeave,
  onBack,
  busy,
  preparingCut,
  loadingDeal,
  roomStatus,
  isHost,
  onPlay,
  tournamentMatch = null,
  scoringMode = null,
  onSetScoringMode,
  lobbyVoice = null,
}: Props) {
  const [step, setStep] = useState<Step>(() => (code ? 'waiting' : 'menu'));
  const [joinCode, setJoinCode] = useState('');
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (code) setStep('waiting');
  }, [code]);

  const err = localError || error;

  const doCreate = async () => {
    if (!configured) {
      setLocalError('Firebase is not configured. See README for setup.');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onCreate(displayName);
      setStep('waiting');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to create room');
    } finally {
      setPending(false);
    }
  };

  const doJoin = async () => {
    if (!configured) {
      setLocalError('Firebase is not configured. See README for setup.');
      return;
    }
    const c = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(c)) {
      setLocalError('Enter a valid 4–6 character room code');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onJoin(c, displayName);
      setStep('waiting');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to join room');
    } finally {
      setPending(false);
    }
  };

  const doPlay = async () => {
    if (!onPlay) return;
    setPending(true);
    setLocalError(null);
    try {
      await onPlay();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to start cut');
    } finally {
      setPending(false);
    }
  };

  const copyLink = async () => {
    const url = shareUrl || (code ? roomShareUrl(code) : '');
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setLocalError('Could not copy — long-press the link to copy');
    }
  };

  const share = async () => {
    const url = shareUrl || (code ? roomShareUrl(code) : '');
    if (!url || !code) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'SUPERCRIB',
          text: `Join my Supercrib game — room ${code}`,
          url,
        });
        return;
      } catch {
        // user cancelled or share failed → fall through to copy
      }
    }
    await copyLink();
  };

  if (busy) return null;

  return (
    <div className="home online-lobby">
      <h1 className="title">Play Online</h1>
      {tournamentMatch ? (
        <p className="subtitle">Both tap Play game on the live board · no codes</p>
      ) : (
        <p className="subtitle">2-player · no accounts · share a room link</p>
      )}

      {!configured && (
        <p className="online-warn" role="alert">
          Firebase env vars missing. Copy <code>.env.example</code> → <code>.env</code> and
          follow the README (free Spark plan).
        </p>
      )}

      {step === 'menu' && tournamentMatch && (
        <>
          <h1 className="title title-coin" style={{ fontSize: '1.35rem' }}>
            TOURNAMENT MATCH
          </h1>
          <p className="online-warn" role="alert">
            {err || 'Couldn’t open the table from here.'}
          </p>
          <p className="find-match-hint">
            Tap Back to live board, then Play game on your match — no Create / Join codes.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setLocalError(null);
              onBack();
            }}
          >
            Back to live board
          </button>
        </>
      )}

      {step === 'menu' && !tournamentMatch && (
        <>
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() => void doCreate()}
          >
            Create room
          </button>
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() => setStep('join')}
          >
            Join room
          </button>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              onBack();
            }}
          >
            Back
          </button>
          {err && (
            <p className="find-match-hint" role="status">
              If rejoining failed, tap Back and open your match from Tournaments → Play game.
            </p>
          )}
        </>
      )}

      {step === 'join' && (
        <>
          <label className="online-label" htmlFor="room-code-input">
            Room code
          </label>
          <input
            id="room-code-input"
            className="online-code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            placeholder="e.g. H7K2P"
            value={joinCode}
            onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
          />
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() => void doJoin()}
          >
            {pending ? 'Joining…' : 'Join'}
          </button>
          <button type="button" onClick={() => setStep('menu')}>
            Back
          </button>
        </>
      )}

      {step === 'waiting' && code && (
        <>
          {tournamentMatch ? (
            <h1 className="title title-coin" style={{ fontSize: '1.35rem' }}>
              TOURNAMENT MATCH
            </h1>
          ) : null}
          <div className="online-status" aria-live="polite">
            <span
              className={`online-dot status-${connection}`}
              aria-hidden
            />
            {tournamentMatch
              ? connection === 'waiting'
                ? `Waiting for ${tournamentMatch.opponentName || 'your opponent'}…`
                : connection === 'connected'
                  ? 'Both here — ready to cut'
                  : connectionLabel(connection)
              : connectionLabel(connection)}
          </div>
          {/* Scoring mode: only once both seats filled; host writable until cut/deal */}
          {(() => {
            const bothPresent = connection === 'connected';
            const locked =
              loadingDeal ||
              roomStatus === 'playing' ||
              roomStatus === 'cutting' ||
              !!preparingCut;
            const mode = scoringMode === 'competitive' ? 'competitive' : 'auto';
            // Hide mode picker while waiting alone (same signal as "Both here").
            if (!bothPresent && !locked) {
              return (
                <p className="find-match-hint">
                  Waiting for opponent… Scoring mode unlocks when both are here.
                </p>
              );
            }
            const canHostPick = bothPresent && !!isHost && !!onSetScoringMode && !locked;
            if (canHostPick) {
              return (
                <div className="online-scoring-chooser" role="group" aria-label="Scoring mode">
                  <div className="section-label">Scoring mode</div>
                  <div className="online-scoring-row">
                    <button
                      type="button"
                      className={`btn find-match-option ai-diff-option${mode === 'auto' ? ' primary' : ''}`}
                      disabled={pending}
                      onClick={() => {
                        if (mode === 'auto') return;
                        setPending(true);
                        setLocalError(null);
                        void Promise.resolve(onSetScoringMode('auto'))
                          .catch((e) => {
                            setLocalError(
                              e instanceof Error ? e.message : 'Failed to set scoring',
                            );
                          })
                          .finally(() => setPending(false));
                      }}
                    >
                      <span className="ai-diff-label">Normal</span>
                      <span className="ai-diff-hint">(auto count)</span>
                    </button>
                    <button
                      type="button"
                      className={`btn find-match-option ai-diff-option${mode === 'competitive' ? ' primary' : ''}`}
                      disabled={pending}
                      onClick={() => {
                        if (mode === 'competitive') return;
                        setPending(true);
                        setLocalError(null);
                        void Promise.resolve(onSetScoringMode('competitive'))
                          .catch((e) => {
                            setLocalError(
                              e instanceof Error ? e.message : 'Failed to set scoring',
                            );
                          })
                          .finally(() => setPending(false));
                      }}
                    >
                      <span className="ai-diff-label">Competitive</span>
                      <span className="ai-diff-hint">(count your own &amp; Muggins)</span>
                    </button>
                  </div>
                  <p className="find-match-hint">Host can change until Play / cut</p>
                </div>
              );
            }
            // Guest (read-only) once both present, or locked badge after Play/cut.
            if (mode === 'competitive') {
              return (
                <p className="find-match-hint">
                  Scoring: Competitive · (count your own &amp; Muggins)
                  {locked ? ' · locked' : ''}
                </p>
              );
            }
            return (
              <p className="find-match-hint">
                Scoring: Normal · (auto count)
                {locked ? ' · locked' : ''}
              </p>
            );
          })()}
          {!tournamentMatch && (
            <>
              <div className="online-code-block">
                <div className="section-label">Room code</div>
                <div className="online-code-big" aria-label={`Room code ${code}`}>
                  {code}
                </div>
              </div>
              <button type="button" className="primary" onClick={() => void share()}>
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function'
                  ? 'Share link'
                  : 'Copy link'}
              </button>
              <button type="button" onClick={() => void copyLink()}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <p className="online-link-preview">{shareUrl}</p>
            </>
          )}
          {tournamentMatch && connection === 'waiting' && !loadingDeal && roomStatus !== 'playing' && (
            <p className="find-match-hint">
              Stay here. {tournamentMatch.opponentName || 'They'} open the same tournament live
              board and tap <strong>Play game</strong> — no codes to send.
            </p>
          )}
          {!tournamentMatch && connection === 'waiting' && !loadingDeal && roomStatus !== 'playing' && (
            <p className="find-match-hint">
              You&apos;re seated — waiting for your opponent to join. Cut starts when both are here.
            </p>
          )}
          {(loadingDeal || roomStatus === 'playing') && (
            <p className="find-match-hint">Loading deal…</p>
          )}
          {!loadingDeal && roomStatus !== 'playing' && (connection === 'connected' || preparingCut) && (
            <p className="find-match-hint">
              {preparingCut
                ? 'Both here — preparing cut for deal…'
                : 'Both here — ready to cut. Low card gets the crib first.'}
            </p>
          )}
          {lobbyVoice?.available && connection === 'connected' && (
            <div className="online-lobby-voice" aria-label="Voice chat">
              <div className="section-label">Voice</div>
              <p className="find-match-hint">
                {deriveLobbyVoiceHint({
                  joined: lobbyVoice.joined,
                  localReady: !!lobbyVoice.localReady,
                  peerReady: !!lobbyVoice.peerReady,
                  uiStatus: lobbyVoice.uiStatus,
                  peerSeatName: lobbyVoice.peerSeatName,
                })}
              </p>
              <SideLiveChatButton
                joined={effectiveLobbyVoiceJoined({
                  joined: lobbyVoice.joined,
                  localReady: !!lobbyVoice.localReady,
                  uiStatus: lobbyVoice.uiStatus,
                })}
                indicator={
                  effectiveLobbyVoiceJoined({
                    joined: lobbyVoice.joined,
                    localReady: !!lobbyVoice.localReady,
                    uiStatus: lobbyVoice.uiStatus,
                  })
                    ? lobbyVoice.indicator
                    : 'none'
                }
                uiStatus={
                  effectiveLobbyVoiceJoined({
                    joined: lobbyVoice.joined,
                    localReady: !!lobbyVoice.localReady,
                    uiStatus: lobbyVoice.uiStatus,
                  })
                    ? lobbyVoice.uiStatus
                    : 'idle'
                }
                remoteTalking={lobbyVoice.remoteTalking}
                localSpeaking={lobbyVoice.localSpeaking}
                inlineError={lobbyVoice.inlineError}
                statusDetail={lobbyVoice.statusDetail}
                debugLine={
                  shouldShowVoiceDebugLine({
                    joined: effectiveLobbyVoiceJoined({
                      joined: lobbyVoice.joined,
                      localReady: !!lobbyVoice.localReady,
                      uiStatus: lobbyVoice.uiStatus,
                    }),
                    debugLine: lobbyVoice.debugLine,
                    inlineError: lobbyVoice.inlineError,
                  })
                    ? lobbyVoice.debugLine
                    : null
                }
                remoteStream={lobbyVoice.remoteStream}
                onJoin={lobbyVoice.onConnect}
                onLeave={lobbyVoice.onDisconnect}
                connectLabel="Connect voice"
                pulseConnect={shouldPulseConnectVoice({
                  joined: lobbyVoice.joined,
                  localReady: !!lobbyVoice.localReady,
                  uiStatus: lobbyVoice.uiStatus,
                })}
                peerNeedsConnectName={
                  shouldShowPeerNeedsConnect({
                    joined: lobbyVoice.joined,
                    localReady: !!lobbyVoice.localReady,
                    peerReady: !!lobbyVoice.peerReady,
                    uiStatus: lobbyVoice.uiStatus,
                  })
                    ? lobbyVoice.peerSeatName || 'Opponent'
                    : null
                }
              />
            </div>
          )}
          {/* Optional gate: block Play until lobbyVoice.uiStatus==='live' when both
              opted Connect. Soft hint above already says start after green Live;
              enforcing needs peer voice-ready (not only local joined) — skip for now. */}
          {connection === 'connected' &&
            isHost &&
            onPlay &&
            !loadingDeal &&
            roomStatus !== 'playing' && (
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() => void doPlay()}
            >
              {pending ? 'Starting…' : 'Play'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onLeave();
              if (!tournamentMatch) setStep('menu');
            }}
          >
            {tournamentMatch ? 'Back to live board' : 'Leave room'}
          </button>
        </>
      )}

      {err && (
        <p className="online-warn" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
