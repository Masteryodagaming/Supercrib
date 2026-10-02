import { useEffect, useState } from 'react';
import { Card, isRed } from '../engine/cards';
import {
  GameState,
  PlayerId,
  competitiveShowActive,
  competitiveClaimant,
  competitiveMugginsRespondent,
  competitiveReviewRespondent,
  type ShowClaimStep,
} from '../engine/supercrib';
import { ScoreBreakdown } from '../engine/scoreHand';
import { CardView } from './CardView';
import { appendClaimDigit, backspaceClaim } from './claimKeypad';

interface Props {
  state: GameState;
  seatLabels: [string, string];
  onContinue: () => void;
  /** When phase is zeroHandOffer — Redeal vs Continue with 0 */
  onZeroHandChoice?: (choice: 'redeal' | 'continue') => void;
  /** Competitive: submit a claimed count for the current step. */
  onClaim?: (claimed: number) => void;
  /** Competitive: opponent Approve (keep hand total) after announcement. */
  onConfirmClaim?: () => void;
  /** Competitive: opponent Adjust — ref picks kept total then resolve. */
  onAdjustClaim?: (adjusted: number) => void;
  /** Competitive: Accept underclaim or take Muggins. */
  onMuggins?: (choice: 'accept' | 'muggins') => void;
  /** Competitive: dismiss blocking Ref modal after Adjust. */
  onAcknowledgeRef?: () => void;
  /** Online: this client's seat ready flag */
  myReady?: boolean;
  /** Online: opponent ready flag */
  oppReady?: boolean;
  online?: boolean;
  /** Read-only spectator — hide continue / zero-hand controls. */
  spectate?: boolean;
  /** Local viewer seat (vs-AI = 0). */
  viewer?: PlayerId;
}

function winnerLabel(state: GameState, labels: [string, string]): string {
  if (state.winner === null) return '';
  return `${labels[state.winner] || `P${state.winner}`} wins!`;
}

function seatName(labels: [string, string], id: PlayerId): string {
  return labels[id] || `P${id}`;
}

/** Competitive hand announce line: original (+ adjusted/kept/true when known). */
function formatHandAnnounce(opts: {
  original?: number | null;
  adjusted?: number | null;
  kept?: number | null;
  trueRaw?: number | null;
}): string | null {
  if (opts.original == null) return null;
  const parts = [`Hand ${opts.original}`];
  if (opts.adjusted != null && opts.adjusted !== opts.original) {
    parts.push(`adjusted ${opts.adjusted}`);
  }
  if (
    opts.kept != null &&
    opts.kept !== opts.original &&
    opts.kept !== opts.adjusted
  ) {
    parts.push(`kept ${opts.kept}`);
  } else if (
    opts.kept != null &&
    opts.kept !== opts.original &&
    opts.adjusted == null
  ) {
    parts.push(`kept ${opts.kept}`);
  }
  if (opts.trueRaw != null) {
    parts.push(`true ${opts.trueRaw}`);
  }
  return parts.join(' · ');
}

function HandBlock({
  title,
  cards,
  starter,
  breakdown,
  footnote,
  hideTotals,
  handAnnounce,
}: {
  title: string;
  cards: Card[];
  starter: Card | null;
  breakdown: ScoreBreakdown;
  footnote?: string;
  hideTotals?: boolean;
  /** Competitive: show original hand total (and adjust/ref/true if set). */
  handAnnounce?: string | null;
}) {
  return (
    <div className="show-hand-block">
      <div className="show-hand-title">{title}</div>
      <div className="show-cards-row">
        <div className="row show-cards show-hand-fan" aria-label={`${title} hand`}>
          {cards.map((c) => (
            <span key={`show-${title}-${c.id}`} className="show-fan-slot">
              <CardView card={c} />
            </span>
          ))}
        </div>
        {starter && (
          <div className="show-hand-starter" aria-label="starter">
            <span className="show-plus">+</span>
            <CardView card={starter} className="show-starter-card" />
          </div>
        )}
      </div>
      {handAnnounce ? (
        <div className="show-total show-hand-announce" aria-label="Announced hand">
          {handAnnounce}
        </div>
      ) : null}
      {!hideTotals && (
        <>
          <div className="show-total">
            raw {breakdown.raw} ×{breakdown.multiplier} ={' '}
            <strong>{breakdown.total}</strong>
            {footnote ? <span className="show-note"> {footnote}</span> : null}
          </div>
          <div className="show-parts">
            15s {breakdown.fifteens} · pairs {breakdown.pairs} · runs{' '}
            {breakdown.runs} · flush {breakdown.flush} · nobs {breakdown.nobs}
          </div>
        </>
      )}
      {hideTotals && !handAnnounce && (
        <div className="show-total show-total-hidden">Count this hand…</div>
      )}
    </div>
  );
}

function stepTitle(
  step: ShowClaimStep,
  state: GameState,
  labels: [string, string],
): string {
  if (step === 'pone') return `${seatName(labels, state.pone)} hand`;
  if (step === 'dealer') return `Dealer · ${seatName(labels, state.dealer)} hand`;
  return `Crib · ${seatName(labels, state.dealer)}`;
}

function ClaimPad({
  value,
  onChange,
  onConfirm,
  disabled,
  confirmLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  onConfirm: () => void;
  disabled?: boolean;
  confirmLabel?: string;
}) {
  const pressDigit = (d: number) => {
    if (disabled) return;
    onChange(appendClaimDigit(value, d));
  };

  return (
    <div className="claim-pad" aria-label="Claim count">
      <div className="claim-display" aria-live="polite" aria-label="Hand total">
        {value === 0 ? '\u00a0' : value}
      </div>
      <div className="claim-keypad" role="group" aria-label="Numeric keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button
            key={d}
            type="button"
            className="btn claim-key"
            disabled={disabled}
            onClick={() => pressDigit(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className="btn claim-key claim-key-clear"
          disabled={disabled || value === 0}
          onClick={() => onChange(0)}
          aria-label="Clear hand total"
        >
          C
        </button>
        <button
          type="button"
          className="btn claim-key"
          disabled={disabled}
          onClick={() => pressDigit(0)}
        >
          0
        </button>
        <button
          type="button"
          className="btn claim-key claim-key-back"
          disabled={disabled || value === 0}
          onClick={() => onChange(backspaceClaim(value))}
          aria-label="Backspace"
        >
          ⌫
        </button>
      </div>
      <button
        type="button"
        className="btn primary claim-confirm"
        disabled={disabled}
        onClick={onConfirm}
      >
        {confirmLabel ?? `Confirm hand (${value})`}
      </button>
    </div>
  );
}


function formatRefBanner(
  lastRef: NonNullable<NonNullable<GameState['competitiveShow']>['lastRef']>,
  viewer: PlayerId,
): string {
  const adjuster = (1 - lastRef.scorer) as PlayerId;
  const rightSeat =
    lastRef.sidedWith === 'adjuster' ? adjuster : lastRef.scorer;
  const who = rightSeat === viewer ? 'You' : 'Opponent';
  const pen =
    lastRef.wrongCorrectorPenalty > 0
      ? ` · adjuster −${lastRef.wrongCorrectorPenalty}`
      : '';
  if (lastRef.verdict) {
    return `Ref: ${lastRef.verdict}${pen ? '' : ''} · true ${lastRef.trueRaw}`;
  }
  const announce = `original hand ${lastRef.originalClaimed}, adjusted ${lastRef.adjustedClaimed}, kept ${lastRef.kept}`;
  if (lastRef.neitherExact) {
    return `Ref: true was ${lastRef.trueRaw} — neither exact; kept ${who}'s ${lastRef.kept} (closer) · ${announce}${pen}`;
  }
  return `Ref: true was ${lastRef.trueRaw} — ${who} was right · ${announce}${pen}`;
}

function logEntryAnnounce(
  entry: NonNullable<GameState['competitiveShow']>['log'][number],
): string {
  const original = entry.claimedOriginal ?? entry.claimed;
  const line = formatHandAnnounce({
    original,
    adjusted: entry.adjustedClaimed,
    kept:
      entry.claimedOriginal !== undefined &&
      entry.claimed !== entry.claimedOriginal
        ? entry.claimed
        : entry.adjustedClaimed !== undefined
          ? entry.claimed
          : null,
    trueRaw: entry.trueTotal,
  });
  return line ?? `Hand ${entry.claimed} · true ${entry.trueTotal}`;
}

export function ShowOverlay({
  state,
  seatLabels,
  onContinue,
  onZeroHandChoice,
  onClaim,
  onConfirmClaim,
  onAdjustClaim,
  onMuggins,
  onAcknowledgeRef,
  myReady = false,
  oppReady = false,
  online = false,
  spectate = false,
  viewer = 0,
}: Props) {
  const r = state.showResult;
  const [claim, setClaim] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const claimStepKey = state.competitiveShow?.step ?? 'idle';
  const reviewKey = state.competitiveShow?.pendingReview
    ? `${state.competitiveShow.pendingReview.step}-${state.competitiveShow.pendingReview.claimed}`
    : 'none';
  useEffect(() => {
    setClaim(0);
    setAdjusting(false);
  }, [claimStepKey, reviewKey]);
  if (!r) return null;

  const competitiveActive = competitiveShowActive(state);
  const cs = state.competitiveShow;
  const title =
    state.phase === 'zeroHandOffer'
      ? 'Zero-hand — choose'
      : r.zeroHandRedeal
        ? 'Zero-hand redeal'
        : state.winner !== null
          ? winnerLabel(state, seatLabels)
          : competitiveActive
            ? 'Competitive show'
            : 'Show';

  const l0 = seatName(seatLabels, 0);
  const l1 = seatName(seatLabels, 1);
  const starter = state.starter;
  const competitiveMode = state.scoringMode === 'competitive';

  const pickHand = (pid: typeof state.pone) => {
    const pl = state.players[pid];
    if (pl.played.length === 5) return pl.played;
    if (pl.hand.length === 5) return pl.hand;
    return [...pl.played, ...pl.hand];
  };
  const poneHand = pickHand(state.pone);
  const dealerHand = pickHand(state.dealer);
  const crib = state.crib;

  const isGameOver = state.winner !== null;
  const waitingForOpp = online && !isGameOver && myReady && !oppReady;
  const continueDisabled = waitingForOpp;

  let continueLabel: string;
  if (r.zeroHandRedeal) {
    continueLabel = waitingForOpp ? 'Waiting for opponent…' : 'Redeal';
  } else if (isGameOver) {
    continueLabel = 'Back to Home';
  } else {
    continueLabel = waitingForOpp ? 'Waiting for opponent…' : 'Next deal';
  }

  const claimant = competitiveClaimant(state);
  const reviewSeat = competitiveReviewRespondent(state);
  const mugginsSeat = competitiveMugginsRespondent(state);
  const refBlocking = !!cs?.pendingRef;
  const myClaimTurn =
    competitiveActive &&
    !spectate &&
    !cs?.pendingMuggins &&
    !cs?.pendingReview &&
    !refBlocking &&
    claimant === viewer &&
    !!onClaim;
  // Online: ONLY the review respondent seat gets Approve/Adjust.
  // vs-AI: human always sees them (Dummy2 review hotseat), even when AI is respondent.
  const isReviewRespondent =
    reviewSeat !== null && reviewSeat === viewer;
  const myReviewTurn =
    competitiveActive &&
    !spectate &&
    !!cs?.pendingReview &&
    (!!onConfirmClaim || !!onAdjustClaim) &&
    (isReviewRespondent || state.mode === 'ai');
  const myMugginsTurn =
    competitiveActive &&
    !spectate &&
    !!cs?.pendingMuggins &&
    !refBlocking &&
    mugginsSeat === viewer &&
    !!onMuggins;
  const waitingAiClaim =
    competitiveActive &&
    !cs?.pendingMuggins &&
    !cs?.pendingReview &&
    claimant !== null &&
    claimant !== viewer;
  // Claimant (or non-respondent) waits — never show them Approve/Adjust online.
  const waitingAiReview =
    competitiveActive &&
    state.mode === 'online' &&
    !!cs?.pendingReview &&
    !isReviewRespondent;
  const waitingAiMuggins =
    competitiveActive &&
    !!cs?.pendingMuggins &&
    mugginsSeat !== null &&
    mugginsSeat !== viewer;
  const reviewForAiSeat =
    myReviewTurn &&
    state.mode === 'ai' &&
    reviewSeat !== null &&
    reviewSeat !== viewer;

  const step = cs && cs.step !== 'done' ? cs.step : null;
  const focusCards =
    step === 'pone'
      ? poneHand
      : step === 'dealer'
        ? dealerHand
        : step === 'crib'
          ? crib
          : null;
  const focusBreakdown =
    step === 'pone' ? r.pone : step === 'dealer' ? r.dealer : step === 'crib' ? r.crib : null;

  const showFullSummary =
    !competitiveActive || (cs?.step === 'done' || isGameOver);

  const logFor = (s: 'pone' | 'dealer' | 'crib') =>
    cs?.log?.find((e) => e.step === s) ?? null;

  // Only for the current step's cards — do not use lastRef here (cleared
  // when the show segment advances / next claim starts).
  const focusHandAnnounce = (() => {
    if (!competitiveActive || !step) return null;
    if (cs?.pendingReview) {
      return formatHandAnnounce({ original: cs.pendingReview.claimed });
    }
    if (cs?.pendingMuggins) {
      return formatHandAnnounce({
        original: cs.pendingMuggins.claimedOriginal ?? cs.pendingMuggins.claimed,
        adjusted: cs.pendingMuggins.adjustedClaimed,
        kept:
          cs.pendingMuggins.claimedOriginal !== undefined &&
          cs.pendingMuggins.claimed !== cs.pendingMuggins.claimedOriginal
            ? cs.pendingMuggins.claimed
            : cs.pendingMuggins.adjustedClaimed !== undefined
              ? cs.pendingMuggins.claimed
              : null,
        trueRaw: cs.pendingMuggins.trueTotal,
      });
    }
    return null;
  })();

  return (
    <div className="overlay">
      <div className="overlay-card show-overlay">
        <h2>{title}</h2>
        {competitiveMode && (
          <div className="banner mute competitive-banner">
            Competitive · claim RAW (×2 pegs after) · (count your own & Muggins)
          </div>
        )}
        {state.trapEscapeWin && (
          <div className="banner win">Escaped the StinkHole via last-card-31!</div>
        )}
        {state.trapped[0] && state.winner === null && (
          <div className="banner trap">{l0} in the StinkHole</div>
        )}
        {state.trapped[1] && state.winner === null && (
          <div className="banner trap">{l1} in the StinkHole</div>
        )}
        {r.zeroHandRedeal && state.phase === 'zeroHandOffer' && (
          <div className="banner trap">
            A hand scores 0 with this starter. Redeal (same dealer, no show
            points), or Continue with 0.
          </div>
        )}
        {r.zeroHandRedeal && state.phase === 'redeal' && (
          <div className="banner trap">
            Deal voided — same dealer redeals. No show points kept.
          </div>
        )}
        {r.zeroCribPenalty > 0 && (
          <div className="banner trap">
            Zero crib — dealer −{r.zeroCribPenalty} (floor 0)
          </div>
        )}

        {starter && (
          <div className="show-starter-row show-starter-compact">
            <span className="section-label">Starter</span>
            <span
              className={`show-starter-chip${isRed(starter.suit) ? ' red' : ''}`}
            >
              {starter.rank}
              {starter.suit === 'hearts'
                ? '♥'
                : starter.suit === 'diamonds'
                  ? '♦'
                  : starter.suit === 'clubs'
                    ? '♣'
                    : '♠'}
            </span>
            {starter.suit === 'spades' ? (
              <span className="badge mute">spade · raw</span>
            ) : (
              <span className="badge x2">×2 show</span>
            )}
          </div>
        )}

        {/* Competitive in-progress: focus current hand + claim / muggins */}
        {competitiveActive && step && focusCards && focusBreakdown && (
          <>
            <HandBlock
              title={stepTitle(step, state, seatLabels)}
              cards={focusCards}
              starter={starter}
              breakdown={focusBreakdown}
              hideTotals
              handAnnounce={focusHandAnnounce}
            />
            {cs?.pendingReview && (
              <div className="banner mute">
                {reviewForAiSeat
                  ? `${seatName(seatLabels, reviewSeat!)} reviewing hand (${cs.pendingReview.claimed}) — Approve or Adjust`
                  : waitingAiReview
                    ? `Opponent reviewing hand (${cs.pendingReview.claimed})…`
                    : `Hand total ${cs.pendingReview.claimed} — Approve or Adjust`}
              </div>
            )}
            {cs?.pendingRef && (
              <div className="ref-modal" role="dialog" aria-label="Ref analysis">
                <div className="ref-modal-title">Ref</div>
                <ul className="ref-modal-list">
                  <li>
                    <span className="ref-k">Original hand</span>
                    <span className="ref-v">{cs.pendingRef.originalClaimed}</span>
                  </li>
                  <li>
                    <span className="ref-k">Opponent adjusted to</span>
                    <span className="ref-v">{cs.pendingRef.adjustedClaimed}</span>
                  </li>
                  <li>
                    <span className="ref-k">True</span>
                    <span className="ref-v">{cs.pendingRef.trueRaw}</span>
                  </li>
                  <li>
                    <span className="ref-k">Kept</span>
                    <span className="ref-v">{cs.pendingRef.kept}</span>
                  </li>
                  <li className="ref-verdict">
                    <span className="ref-k">Verdict</span>
                    <span className="ref-v">
                      {cs.pendingRef.verdict || formatRefBanner(cs.pendingRef, viewer)}
                    </span>
                  </li>
                  {cs.pendingRef.wrongCorrectorPenalty > 0 && (
                    <li className="ref-penalty">
                      <span className="ref-k">Wrong-corrector penalty</span>
                      <span className="ref-v">
                        Adjuster −{cs.pendingRef.wrongCorrectorPenalty} peg
                        {cs.pendingRef.wrongCorrectorPenalty === 1 ? '' : 's'}
                      </span>
                    </li>
                  )}
                </ul>
                {!spectate && onAcknowledgeRef && (
                  <button
                    type="button"
                    className="btn primary ref-modal-continue"
                    onClick={() => onAcknowledgeRef()}
                  >
                    {cs.pendingMuggins
                      ? `Continue to Muggins (+${cs.pendingMuggins.missed} available)`
                      : 'Continue'}
                  </button>
                )}
                {spectate && (
                  <p className="show-ready-status">Waiting for players to continue…</p>
                )}
              </div>
            )}
            {cs?.pendingMuggins && !cs.pendingRef && (
              <div className="banner trap">
                Underclaim kept {cs.pendingMuggins.claimed}
                {cs.pendingMuggins.claimedOriginal !== undefined &&
                cs.pendingMuggins.claimedOriginal !== cs.pendingMuggins.claimed
                  ? ` (original hand ${cs.pendingMuggins.claimedOriginal})`
                  : ''}{' '}
                (true {cs.pendingMuggins.trueTotal}) — missed{' '}
                {cs.pendingMuggins.missed}
                {' '}· Muggins +{cs.pendingMuggins.missed} available
              </div>
            )}
            {/* Ref summary only while still on that hand segment (e.g. Muggins).
                Hide once the next claimer can type — never under ClaimPad. */}
            {cs?.lastRef &&
              !cs.pendingReview &&
              !cs.pendingRef &&
              !!cs.pendingMuggins &&
              claimant === null && (
              <div className="banner mute" role="status">
                {formatRefBanner(cs.lastRef, viewer)}
              </div>
            )}
            {myClaimTurn && (
              <ClaimPad
                value={claim}
                onChange={setClaim}
                onConfirm={() => {
                  onClaim?.(claim);
                  setClaim(0);
                }}
              />
            )}
            {/* Actions above claim log so overflow:hidden cannot clip Approve/Adjust */}
            {myReviewTurn && !adjusting && (
              <div className="actions muggins-actions review-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onConfirmClaim?.()}
                >
                  Approve hand ({cs!.pendingReview!.claimed})
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    // Start blank — do not seed with pendingReview.claimed (avoids 12→1214).
                    setClaim(0);
                    setAdjusting(true);
                  }}
                >
                  Adjust hand
                </button>
              </div>
            )}
            {myReviewTurn && adjusting && (
              <>
                <p className="claim-their-hand" aria-live="polite">
                  Their hand: {cs!.pendingReview!.claimed}
                </p>
                <ClaimPad
                  value={claim}
                  onChange={setClaim}
                  confirmLabel={`Submit adjusted hand (${claim})`}
                  onConfirm={() => {
                    onAdjustClaim?.(claim);
                    setClaim(0);
                    setAdjusting(false);
                  }}
                />
              </>
            )}
            {myMugginsTurn && (
              <div className="actions muggins-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => onMuggins?.('accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onMuggins?.('muggins')}
                >
                  Muggins +{cs!.pendingMuggins!.missed}
                </button>
              </div>
            )}
            {!refBlocking &&
              (waitingAiClaim || waitingAiReview || waitingAiMuggins) && (
              <p className="show-ready-status" aria-live="polite">
                {waitingAiMuggins
                  ? 'Opponent deciding Muggins…'
                  : waitingAiReview
                    ? 'Opponent reviewing hand…'
                    : 'Opponent announcing count…'}
              </p>
            )}
            {cs?.log && cs.log.length > 0 && (
              <ul className="claim-log" aria-label="Resolved hands">
                {cs.log.map((entry, i) => (
                  <li key={`${entry.step}-${i}`}>
                    {entry.step}: {logEntryAnnounce(entry)}
                    {entry.kind === 'overclaim'
                      ? (() => {
                          const pen = entry.overclaimPenalty ?? 0;
                          const steal = entry.claimed - entry.trueTotal;
                          const x2 =
                            steal > 0 && pen === steal * 2
                              ? ' (steal ×2)'
                              : '';
                          return ` · Overclaim −${pen}${x2}`;
                        })()
                      : ''}
                    {entry.kind === 'underclaim'
                      ? entry.mugginsTaken
                        ? ` · muggins +${entry.mugginsTaken}`
                        : ' · accepted'
                      : ''}
                    {entry.wrongCorrectorPenalty
                      ? ` · wrong Adjust −${entry.wrongCorrectorPenalty}`
                      : ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {showFullSummary && (
          <>
            <HandBlock
              title={seatName(seatLabels, state.pone)}
              cards={poneHand}
              starter={starter}
              breakdown={r.pone}
              handAnnounce={
                logFor('pone') ? logEntryAnnounce(logFor('pone')!) : null
              }
            />
            <HandBlock
              title={`Dealer · ${seatName(seatLabels, state.dealer)}`}
              cards={dealerHand}
              starter={starter}
              breakdown={r.dealer}
              handAnnounce={
                logFor('dealer') ? logEntryAnnounce(logFor('dealer')!) : null
              }
            />
            <HandBlock
              title={`Crib · ${seatName(seatLabels, state.dealer)}`}
              cards={crib}
              starter={starter}
              breakdown={r.crib}
              footnote={
                r.zeroCribPenalty > 0 ? `→ dealer −${r.zeroCribPenalty}` : undefined
              }
              handAnnounce={
                logFor('crib') ? logEntryAnnounce(logFor('crib')!) : null
              }
            />
            {cs?.log && cs.log.length > 0 && (
              <ul className="claim-log" aria-label="Hand summary">
                {cs.log.map((entry, i) => (
                  <li key={`sum-${entry.step}-${i}`}>
                    {entry.step}: {entry.kind} — {logEntryAnnounce(entry)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="show-scores">
          Board: {l0} {r.scoresAfter[0]} · {l1} {r.scoresAfter[1]}
        </p>
        {online && !isGameOver && (
          <p className="show-ready-status" aria-live="polite">
            {myReady ? 'You are ready' : 'Press when ready'}
            {' · '}
            {oppReady ? 'Opponent ready' : 'Waiting for opponent'}
          </p>
        )}
        <div className="actions">
          {spectate ? (
            <p className="record-note" style={{ margin: 0 }}>
              Watching — waiting for players…
            </p>
          ) : state.phase === 'zeroHandOffer' && onZeroHandChoice ? (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => onZeroHandChoice('redeal')}
              >
                Redeal
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onZeroHandChoice('continue')}
              >
                Continue with 0
              </button>
            </>
          ) : competitiveActive ? null : (
            <button
              type="button"
              className="btn primary"
              onClick={onContinue}
              disabled={continueDisabled}
            >
              {continueLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
