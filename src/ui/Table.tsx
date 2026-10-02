import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Card } from '../engine/cards';
import {
  GameState,
  PlayerId,
  requiredDiscards,
  getLegalPegCards,
  type PegFlash,
} from '../engine/supercrib';
import { canPlayAny } from '../engine/pegging';
import { aiShouldAct } from '../engine/ai';
import { createDealAnimGuard } from './dealAnimGuard';
import { CardView } from './CardView';
import { Pegboard, type SideAvatarProfile } from './Pegboard';
import { GameOverBanner } from './GameOverBanner';
import { QuitConfirm } from './QuitConfirm';
import { ShowOverlay } from './ShowOverlay';
import { CutFan, type AiCutAnimView } from './CutFan';
import { shouldShowWaitingStarterCutFan } from './onlineCutWatch';
import { shouldShowPegScoreCallout } from './pegFlashGuard';
import { ReactionBar } from './ReactionBar';
import { PushToTalkButton } from './PushToTalkButton';
import { SideLiveChatButton } from './SideLiveChatButton';
import { VOICE_PTT_ENABLED } from '../multiplayer/voiceConfig';
import type { SideLiveChatUiStatus } from '../multiplayer/useSideLiveChat';
import type { SyncedReaction } from '../multiplayer/types';
import { spectatorHideHoleCards } from './spectateHands';
import {
  DEAL_STEP_MS,
  CRIB_GATHER_MS,
  PEG_FLASH_MS,
  MSG_BANNER_DEAL_MS,
  MSG_BANNER_YOUR_TURN_MS,
  MSG_BANNER_OTHER_MS,
} from './playPace';
import { playDeal, playShuffle } from '../audio/gameSfx';

const DEAL_TOTAL = 15; // 7 pone + 8 dealer

export type PegBannerView =
  | { kind: 'go'; player: PlayerId; name: string }
  | { kind: 'thirtyone'; points: number; label?: string };

interface Props {
  state: GameState;
  viewer: PlayerId;
  /** Display names for seats 0 and 1 (You/AI or You/Friend). */
  seatLabels: [string, string];
  /** Parent lock while deal/crib animations run (blocks AI). */
  dealAnimating: boolean;
  /** Staged AI cut animation (fan → select → reveal). */
  aiCutAnim?: AiCutAnimView | null;
  /** Big GO / 31 banner during peg pause (locks taps). */
  pegBanner?: PegBannerView | null;
  onDealAnimChange: (animating: boolean) => void;
  onAutoSortHands: () => void;
  onToggleDiscard: (player: PlayerId, card: Card) => void;
  onConfirmDiscard: (player: PlayerId) => void;
  onCut: (cutIndex: number) => void;
  onPeg: (player: PlayerId, card: Card) => void;
  onGo: (player: PlayerId) => void;
  onReorderHand: (player: PlayerId, from: number, to: number) => void;
  onShowContinue: () => void;
  onZeroHandChoice?: (choice: 'redeal' | 'continue') => void;
  onShowClaim?: (claimed: number) => void;
  onConfirmClaim?: () => void;
  onAdjustClaim?: (adjusted: number) => void;
  onMugginsChoice?: (choice: 'accept' | 'muggins') => void;
  onAcknowledgeRef?: () => void;
  onQuit: () => void;
  /** Online: latest room.reaction for opponent pops. */
  remoteReaction?: SyncedReaction | null;
  /** Vs-AI: synthetic opponent emoji pops (no Firebase). */
  externalOppReaction?: SyncedReaction | null;
  /** Online: push emoji to RTDB. AI: omit (local pop only). */
  onReact?: (emoji: string) => void;
  /** Equipped 8-slot reaction dock from profile (4 left + 4 right). */
  equippedRailEmojiIds?: readonly string[] | null;
  /**
   * Tournament live spectate — read-only full table.
   * Hole cards face-down until show/count; no discard/peg/cut controls.
   * UI privacy only (full state still arrives from RTDB).
   */
  spectate?: boolean;
  /** Seat 0 avatar (left / tone-a). */
  seatAvatar0?: SideAvatarProfile | null;
  /** Seat 1 avatar (right / tone-b). */
  seatAvatar1?: SideAvatarProfile | null;
  /** Online PTT — rendered when provided (online + not spectating). */
  voicePtt?: {
    holding: boolean;
    remoteTalking: boolean;
    /** WebRTC peer actually connected — gates Opp pulse. */
    peerLive?: boolean;
    inlineError: string | null;
    remoteStream: MediaStream | null;
    onHoldStart: () => void;
    onHoldEnd: () => void;
    /** Voice wiring ready (both seats connected). UI stays visible when false. */
    voiceReady?: boolean;
    /** Brief hint while WebRTC is connecting/ready (not live yet). */
    voiceStatusHint?: string | null;
  } | null;
  /** Side live chat (VAD) — compact Live after lobby Connect; separate from PTT. */
  sideLiveChat?: {
    joined: boolean;
    indicator: 'green' | 'red' | 'none';
    uiStatus: SideLiveChatUiStatus;
    remoteTalking: boolean;
    localSpeaking: boolean;
    inlineError: string | null;
    statusDetail: string | null;
    debugLine: string | null;
    remoteStream: MediaStream | null;
    onJoin: () => void;
    onLeave: () => void;
    /** Room peers connected — Connect still visible when false. */
    roomReady?: boolean;
    compact?: boolean;
    allowConnect?: boolean;
  } | null;
}

function pickDiscardSeat(state: GameState): PlayerId {
  const pone = state.pone;
  const dealer = state.dealer;
  if (state.players[pone].hand.length > 5) return pone;
  if (state.players[dealer].hand.length > 5) return dealer;
  return pone;
}

function actingSeat(state: GameState): PlayerId {
  if (state.phase === 'discard') return pickDiscardSeat(state);
  if (state.phase === 'pegging' && state.peg) return state.peg.toPlay;
  if (state.phase === 'cut') return state.pone;
  return 0;
}

function seatLabel(labels: [string, string], id: PlayerId): string {
  return labels[id] || `P${id}`;
}

/** Reveal counts matching engine deal order: pone, dealer, … then dealer 8th. */
function revealCounts(revealed: number): { pone: number; dealer: number } {
  const r = Math.max(0, Math.min(DEAL_TOTAL, revealed));
  if (r <= 14) {
    return { pone: Math.ceil(r / 2), dealer: Math.floor(r / 2) };
  }
  return { pone: 7, dealer: 8 };
}

function CribPile({
  cards,
  gathering,
  label,
  side,
}: {
  cards: Card[];
  gathering?: boolean;
  label: string;
  side: 'top' | 'bottom';
}) {
  return (
    <div
      className={`dealer-crib-pile side-${side}${gathering ? ' gathering' : ''}`}
      aria-label={label}
    >
      <div className="section-label crib-pile-label">{label}</div>
      <div className="crib-pile-stack">
        {cards.length === 0 ? (
          <div className="crib-empty-slot" aria-hidden />
        ) : (
          cards.map((c, i) => (
            <div
              key={`crib-${c.id}-${i}`}
              className={`crib-stack-card${gathering ? ` crib-gather-in gather-${side}` : ''}`}
              style={{
                zIndex: i + 1,
                ['--crib-i' as string]: String(i),
              }}
            >
              <CardView faceDown />
            </div>
          ))
        )}
      </div>
      {cards.length > 0 && (
        <div className="crib-count">{cards.length} cards</div>
      )}
    </div>
  );
}

export function Table({
  state,
  viewer,
  seatLabels,
  dealAnimating,
  aiCutAnim = null,
  pegBanner = null,
  onDealAnimChange,
  onAutoSortHands,
  onToggleDiscard,
  onConfirmDiscard,
  onCut,
  onPeg,
  onGo,
  onReorderHand,
  onShowContinue,
  onZeroHandChoice,
  onShowClaim,
  onConfirmClaim,
  onAdjustClaim,
  onMugginsChoice,
  onAcknowledgeRef,
  onQuit,
  remoteReaction = null,
  externalOppReaction = null,
  onReact,
  equippedRailEmojiIds = null,
  spectate = false,
  seatAvatar0 = null,
  seatAvatar1 = null,
  voicePtt = null,
  sideLiveChat = null,
}: Props) {
  const aiMode = state.mode === 'ai';
  const onlineMode = state.mode === 'online';
  /** Fixed bottom seat (vs AI / online / spectate) vs hot-seat rotating view. */
  const fixedViewer = aiMode || onlineMode || spectate;
  const hideHoleCards = spectate && spectatorHideHoleCards(state.phase);
  const seat = actingSeat(state);

  // Hot-seat: rotating "your hand" = acting seat (or human hand during cut). Online/AI: viewer always bottom.
  const resolvedBottom: PlayerId = fixedViewer
    ? viewer
    : state.phase === 'cut'
      ? state.pone
      : seat;
  const topId: PlayerId = (1 - resolvedBottom) as PlayerId;

  const [dealRevealed, setDealRevealed] = useState(() => (dealAnimating ? 0 : DEAL_TOTAL));
  const [cribGathering, setCribGathering] = useState(false);
  const [quitConfirm, setQuitConfirm] = useState(false);
  /** Phone space: flash turn banner then collapse so the board fits. */
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [cribSettled, setCribSettled] = useState(state.crib.length === 5);
  /** Mark complete ONLY when timer finishes — never on effect start (Strict Mode). */
  const dealGuardRef = useRef(createDealAnimGuard());
  const sortedDealRef = useRef<number | null>(null);
  const cribGuardRef = useRef(createDealAnimGuard());

  // Deal animation on each new deal (discard phase)
  useEffect(() => {
    if (state.phase !== 'discard') {
      if (state.phase !== 'cut') {
        // leave crib settled state for show/pegging if crib still relevant
      }
      return;
    }

    // Guard is set only after the interval finishes. Marking earlier + cleanup of
    // the interval (React Strict Mode remount) would block restart forever.
    if (!dealGuardRef.current.shouldStart(state.dealNumber)) return;

    sortedDealRef.current = null;
    cribGuardRef.current.reset();
    setCribGathering(false);
    setCribSettled(false);
    setDealRevealed(0);
    onDealAnimChange(true);
    playShuffle();

    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setDealRevealed(n);
      playDeal();
      if (n >= DEAL_TOTAL) {
        window.clearInterval(id);
        dealGuardRef.current.markComplete(state.dealNumber);
        onDealAnimChange(false);
        if (sortedDealRef.current !== state.dealNumber) {
          sortedDealRef.current = state.dealNumber;
          onAutoSortHands();
        }
      }
    }, DEAL_STEP_MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dealNumber, state.phase]);

  // Crib gather when discard completes → cut (crib full)
  useEffect(() => {
    if (state.phase !== 'cut' || state.crib.length < 5) return;
    // Same Strict Mode rule as deal: mark complete only when timeout fires.
    if (!cribGuardRef.current.shouldStart(state.dealNumber)) return;

    setCribGathering(true);
    setCribSettled(false);
    onDealAnimChange(true);

    const t = window.setTimeout(() => {
      cribGuardRef.current.markComplete(state.dealNumber);
      setCribGathering(false);
      setCribSettled(true);
      onDealAnimChange(false);
    }, CRIB_GATHER_MS);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.crib.length, state.dealNumber]);

  // Keep settled crib visible through pegging; reset on redeal handled by deal effect
  useEffect(() => {
    if (state.phase === 'pegging' || state.phase === 'show') {
      setCribSettled(state.crib.length > 0);
      setCribGathering(false);
    }
    if (state.phase === 'redeal' || state.phase === 'gameOver') {
      setCribSettled(false);
      setCribGathering(false);
    }
  }, [state.phase, state.crib.length]);

  const dealing = state.phase === 'discard' && dealRevealed < DEAL_TOTAL;
  const pegBannerActive = !!pegBanner;
  const uiLocked = dealing || cribGathering || dealAnimating || pegBannerActive || !!aiCutAnim;

  const counts = revealCounts(dealing ? dealRevealed : DEAL_TOTAL);
  const fullBottom = state.players[resolvedBottom].hand;
  const fullTop = state.players[topId].hand;
  const bottomShown =
    dealing
      ? fullBottom.slice(
          0,
          resolvedBottom === state.pone ? counts.pone : counts.dealer,
        )
      : fullBottom;
  const topShown =
    dealing
      ? fullTop.slice(0, topId === state.pone ? counts.pone : counts.dealer)
      : fullTop;

  // Online/AI: each viewer discards their own hand independently (hand > 5).
  // Hot-seat: resolvedBottom is actingSeat/pickDiscardSeat, so only the actor is pending.
  const myDiscardPending =
    state.phase === 'discard' &&
    state.players[resolvedBottom].hand.length > 5;

  // Pegging: explicit toPlay check (fixed viewer = your seat; hot-seat = bottom/acting).
  const pegToPlay = state.phase === 'pegging' ? state.peg?.toPlay : undefined;
  const pegInteractiveSeat =
    pegToPlay !== undefined &&
    (fixedViewer ? pegToPlay === viewer : pegToPlay === resolvedBottom);
  const interactive =
    !spectate &&
    !uiLocked &&
    state.winner === null &&
    !(aiMode && aiShouldAct(state)) &&
    ((state.phase === 'discard' && myDiscardPending) ||
      (state.phase === 'pegging' && pegInteractiveSeat) ||
      (state.phase === 'cut' && (!fixedViewer || seat === viewer)));

  const need = myDiscardPending
    ? requiredDiscards(state, resolvedBottom)
    : 0;
  const sel = myDiscardPending
    ? state.players[resolvedBottom].discardSel
    : [];
  const legal =
    state.phase === 'pegging' &&
    !!state.peg &&
    state.peg.toPlay === resolvedBottom &&
    !uiLocked
      ? getLegalPegCards(state, resolvedBottom)
      : [];
  const legalIds = new Set(legal.map((c) => c.id));

  const starter = state.starter;
  const x2 =
    starter == null ? null : starter.suit !== 'spades';

  const showBottomActions =
    interactive &&
    ((state.phase === 'discard' && myDiscardPending) ||
      (state.phase === 'pegging' &&
        state.peg?.toPlay === resolvedBottom));

  const aiThinking = aiMode && !uiLocked && aiShouldAct(state);

  const canArrange =
    !spectate &&
    !uiLocked &&
    fullBottom.length > 1 &&
    state.winner === null &&
    state.phase !== 'pegging' &&
    state.phase !== 'show' &&
    state.phase !== 'redeal' &&
    state.phase !== 'gameOver' &&
    (!fixedViewer || resolvedBottom === viewer);

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [pegFlash, setPegFlash] = useState<PegFlash | null>(null);
  /** Seen flash ids — reset each deal (cross-client id reuse skipped round-2 pairs). */
  const flashSeenId = useRef<number | null>(null);
  const flashSeenDeal = useRef<number>(state.dealNumber);
  const flashClearTimer = useRef<number | null>(null);
  /** Wall-clock: do not replace/clear scoring callout before this time. */
  const flashHoldUntil = useRef<number>(0);
  /** Next scoring flash waiting until current hold completes. */
  const pendingFlash = useRef<PegFlash | null>(null);
  const pegFlashRef = useRef<PegFlash | null>(null);
  pegFlashRef.current = pegFlash;

  const clearFlashTimer = () => {
    if (flashClearTimer.current != null) {
      window.clearTimeout(flashClearTimer.current);
      flashClearTimer.current = null;
    }
  };

  const showPegFlash = (flash: PegFlash) => {
    flashSeenId.current = flash.id;
    setPegFlash(flash);
    flashHoldUntil.current = Date.now() + PEG_FLASH_MS;
    clearFlashTimer();
    flashClearTimer.current = window.setTimeout(() => {
      flashClearTimer.current = null;
      const queued = pendingFlash.current;
      pendingFlash.current = null;
      if (queued && queued.id !== flash.id) {
        showPegFlash(queued);
      } else {
        setPegFlash(null);
        flashHoldUntil.current = 0;
      }
    }, PEG_FLASH_MS);
  };

  // New deal / redeal: allow ids again and clear lingering callout.
  useEffect(() => {
    if (flashSeenDeal.current === state.dealNumber) return;
    flashSeenDeal.current = state.dealNumber;
    flashSeenId.current = null;
    pendingFlash.current = null;
    flashHoldUntil.current = 0;
    clearFlashTimer();
    setPegFlash(null);
  }, [state.dealNumber]);

  // Sticky local flash buffer (~2.5s):
  // - null Firebase snaps / non-scoring plays do NOT clear the callout
  // - a new scoring flash while one is held is queued (current finishes first)
  // - only the timer (or new deal) clears
  useEffect(() => {
    const flash = state.lastPegFlash;
    if (!flash) return; // never clear on null snap / non-scoring play
    if (flash.id === flashSeenId.current) return;
    // Exact 31 is announced by the full-screen banner only — never also show the
    // sticky peg-score callout (avoids double +2). Compound 15/pair/run+31 totals
    // are folded into that banner via lastPegFlash.points / kindLabel.
    if (!shouldShowPegScoreCallout(flash)) {
      flashSeenId.current = flash.id;
      pendingFlash.current = null;
      return;
    }
    // Already holding a scoring callout — queue instead of interrupting
    if (pegFlashRef.current && Date.now() < flashHoldUntil.current) {
      pendingFlash.current = flash;
      flashSeenId.current = flash.id; // consume id so snap churn does not re-queue
      return;
    }
    showPegFlash(flash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastPegFlash]);

  useEffect(() => {
    return () => clearFlashTimer();
  }, []);

  const showHumanCutFan =
    state.phase === 'cut' &&
    !cribGathering &&
    cribSettled &&
    interactive &&
    (!fixedViewer || state.pone === viewer);
  // AI anim while still in cut, OR online remote reveal after RTDB already advanced phase.
  const showAiCutFan =
    !!aiCutAnim &&
    !cribGathering &&
    cribSettled &&
    (state.phase === 'cut' || !!aiCutAnim.remote);
  const showWaitingCutFan = shouldShowWaitingStarterCutFan({
    phase: state.phase,
    cribGathering,
    cribSettled,
    humanCutFan: showHumanCutFan,
    animCutFan: showAiCutFan,
  });
  const showCutFan = showHumanCutFan || showAiCutFan || showWaitingCutFan;
  const cutActorLabel = seatLabel(seatLabels, state.pone);
  // Remote reveal runs after starter was removed from deck — restore visual count.
  const cutFanDeckCount =
    showAiCutFan && aiCutAnim?.remote
      ? state.deck.length + 1
      : state.deck.length;

  // Crib lives beside dealer after gather; center staging only while still discarding.
  const showDealerCrib =
    (cribGathering || cribSettled) &&
    state.crib.length > 0 &&
    state.phase !== 'redeal' &&
    state.phase !== 'discard';

  // Crib stays in a fixed dealer-side corner (does not reflow with hands/play pile).
  const cribByTop = showDealerCrib && topId === state.dealer;
  const cribOwnerLabel = (() => {
    const dealerId = state.dealer;
    if (spectate) {
      return `${seatLabels[dealerId]}'s crib`;
    }
    if (fixedViewer) {
      return dealerId === viewer ? 'Your crib' : `${seatLabels[topId]}'s crib`;
    }
    // Hot-seat: "Your crib" when the bottom (active) seat is dealer.
    if (dealerId === resolvedBottom) return 'Your crib';
    return `${seatLabels[dealerId]}'s crib`;
  })();

  const showCenterCribStaging =
    state.phase === 'discard' && state.crib.length > 0;

  const onHandTap = (_index: number, card: Card) => {
    if (uiLocked) return;
    if (state.phase === 'discard' && interactive && myDiscardPending) {
      onToggleDiscard(resolvedBottom, card);
      return;
    }
    if (
      state.phase === 'pegging' &&
      state.peg?.toPlay === resolvedBottom &&
      !uiLocked
    ) {
      if (legalIds.has(card.id)) onPeg(resolvedBottom, card);
    }
  };

  const beginPointerReorder = (index: number) => {
    if (!canArrange) return;
    dragFromRef.current = index;
    setDragFrom(index);
  };

  const endPointerReorder = (e: ReactPointerEvent) => {
    const from = dragFromRef.current;
    dragFromRef.current = null;
    setDragFrom(null);
    if (from === null || !canArrange) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = el?.closest?.('[data-hand-index]') as HTMLElement | null;
    if (!target) return;
    const to = Number(target.dataset.handIndex);
    if (!Number.isFinite(to) || to === from) return;
    onReorderHand(resolvedBottom, from, to);
  };

  const renderBottomHand = () =>
    bottomShown.map((card, index) => {
      const selectedDiscard = sel.some((c) => c.id === card.id);
      const inDiscard =
        state.phase === 'discard' && interactive && myDiscardPending;
      const inPeg =
        state.phase === 'pegging' &&
        state.peg?.toPlay === resolvedBottom &&
        !uiLocked;
      const ok = inPeg ? legalIds.has(card.id) : true;
      const tappable =
        !spectate && (inDiscard || (inPeg && ok)) && !uiLocked;

      return (
        <span
          key={card.id}
          className={`${dealing ? 'deal-fly-in' : ''}${dragFrom === index ? ' hand-dragging' : ''}`.trim()}
          style={{ zIndex: index + 1 }}
        >
          <CardView
            card={hideHoleCards ? undefined : card}
            faceDown={hideHoleCards}
            handIndex={index}
            tappable={tappable}
            draggable={!spectate && canArrange && !inDiscard}
            selected={!spectate && selectedDiscard}
            legal={!spectate && inPeg && ok}
            disabled={spectate || (inPeg && !ok)}
            onClick={() => onHandTap(index, card)}
            onPointerReorderStart={() => beginPointerReorder(index)}
            onPointerReorderEnd={endPointerReorder}
            onDragStart={() => {
              dragFromRef.current = index;
              setDragFrom(index);
            }}
            onDrop={() => {
              const from = dragFromRef.current;
              if (from !== null && from !== index) {
                onReorderHand(resolvedBottom, from, index);
              }
              dragFromRef.current = null;
              setDragFrom(null);
            }}
            onDragEnd={() => {
              dragFromRef.current = null;
              setDragFrom(null);
            }}
          />
        </span>
      );
    });

  const pegging = state.phase === 'pegging';
  const oppMustForcedGo =
    pegging &&
    !!state.peg &&
    !pegBannerActive &&
    state.peg.toPlay !== resolvedBottom &&
    !canPlayAny(state.players[state.peg.toPlay].hand, state.peg.count);
  const pegPrompt =
    pegBanner?.kind === 'go'
      ? `${pegBanner.name} — GO`
      : pegBanner?.kind === 'thirtyone'
        ? '31!'
        : pegging && state.peg?.toPlay === resolvedBottom && !uiLocked
          ? legal.length > 0
            ? 'Tap a highlighted card to play'
            : 'No legal card — going…'
          : pegging && aiThinking
            ? 'AI is pegging…'
            : pegging && oppMustForcedGo
              ? 'Opponent going…'
              : pegging
                ? 'Waiting for opponent…'
                : null;

  const isYourTurn =
    interactive &&
    !uiLocked &&
    !dealing &&
    !cribGathering &&
    !aiThinking &&
    !showAiCutFan &&
    (showHumanCutFan ||
      (state.phase === 'discard' && myDiscardPending) ||
      (pegging &&
        state.peg?.toPlay === resolvedBottom &&
        !pegBannerActive));

  const turnBanner = spectate
    ? dealing
      ? 'Dealing…'
      : cribGathering
        ? `Crib → ${cribOwnerLabel}…`
        : state.phase === 'cut' && !cribGathering && cribSettled
          ? `${seatLabel(seatLabels, state.pone)} is cutting…`
          : pegging && state.peg
            ? `${seatLabel(seatLabels, state.peg.toPlay)} to play`
            : state.message || 'Watching…'
    : dealing
    ? 'Dealing…'
    : cribGathering
      ? `Crib → ${cribOwnerLabel}…`
      : showAiCutFan
        ? aiCutAnim?.stage === 'reveal'
          ? 'Starter revealed — pegging next…'
          : `${seatLabel(seatLabels, state.pone)} is cutting…`
        : aiThinking
          ? 'AI is thinking…'
          : showHumanCutFan
            ? 'YOUR TURN — cut the deck'
            : showWaitingCutFan || (state.phase === 'cut' && !cribGathering && cribSettled)
              ? `${seatLabel(seatLabels, state.pone)} is cutting…`
              : state.phase === 'discard' && myDiscardPending && interactive
                ? resolvedBottom === state.dealer
                  ? 'YOUR TURN — pick 3 for the crib'
                  : 'YOUR TURN — pick 2 for the crib'
                : pegging && state.peg?.toPlay === resolvedBottom && !uiLocked && !pegBannerActive
                  ? legal.length > 0
                    ? 'YOUR TURN — tap a highlighted card'
                    : 'YOUR TURN — going…'
                  : pegPrompt && pegging
                    ? pegPrompt
                    : state.message;

  useEffect(() => {
    setBannerCollapsed(false);
    // Keep dealing/crib gather visible a bit longer; your-turn flashes then frees space.
    const ms = dealing || cribGathering ? MSG_BANNER_DEAL_MS : isYourTurn ? MSG_BANNER_YOUR_TURN_MS : MSG_BANNER_OTHER_MS;
    const id = window.setTimeout(() => setBannerCollapsed(true), ms);
    return () => window.clearTimeout(id);
  }, [turnBanner, dealing, cribGathering, isYourTurn]);

  /** Peg tap hint lives on the hand fan (not inside the count box). */
  const handPegHint =
    pegging &&
    state.peg?.toPlay === resolvedBottom &&
    !uiLocked &&
    !pegBannerActive
      ? legal.length > 0
        ? !state.peg.sequence.length
          ? 'Tap a highlighted card to lead'
          : 'Tap a highlighted card to play'
        : 'No legal card — going…'
      : null;

  return (
    <div
      className={`table phase-${state.phase}${showDealerCrib ? (cribByTop ? ' crib-top' : ' crib-bottom') : ''}${spectate ? ' spectate' : ''}${(state.trapped[0] || state.trapped[1]) && state.winner === null ? ' has-trap' : ''}`}
    >
      {showDealerCrib && (
        <div
          className={`fixed-crib-corner ${cribByTop ? 'corner-top' : 'corner-bottom'}`}
          aria-hidden={false}
        >
          <CribPile
            cards={state.crib}
            gathering={cribGathering}
            label={cribOwnerLabel}
            side={cribByTop ? 'top' : 'bottom'}
          />
        </div>
      )}
      {/* Pegging: starter on same end as crib, opposite side (crib right → starter left). */}
      {pegging && starter && (
        <div
          className={`fixed-starter-corner ${cribByTop ? 'corner-top' : 'corner-bottom'}`}
          aria-label="Starter card"
        >
          <div className="section-label">Starter</div>
          <div className="row">
            <CardView card={starter} />
          </div>
          {x2 === true && <span className="badge x2">×2</span>}
          {x2 === false && <span className="badge mute">♠</span>}
        </div>
      )}
      {/* Table-root callout: above board/crib/GO banner stacking contexts */}
      {pegFlash && (
        <div
          key={pegFlash.id}
          className={`peg-score-callout tone-${pegFlash.player === 0 ? 'a' : 'b'}${pegFlash.blocked ? ' blocked' : ''}`}
          aria-live="assertive"
        >
          <span className="peg-score-plus">
            {pegFlash.blocked ? 'Blocked' : `+${pegFlash.points}`}
          </span>
          <span className="peg-score-kinds">
            {(pegFlash.kindLabel
              ? pegFlash.kindLabel
              : pegFlash.events.map((ev) => ev.kind).join(' · ') || 'peg'
            ).toUpperCase()}
          </span>
        </div>
      )}
      <div className="meta">
        <div className="meta-leading">
          <button
            type="button"
            className="btn meta-quit-btn"
            style={{ width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}
            onClick={() => setQuitConfirm(true)}
          >
            {spectate ? 'Back' : 'Quit'}
          </button>
          {sideLiveChat &&
            onlineMode &&
            !spectate &&
            state.phase !== 'gameOver' && (
            <div className="table-side-live-chat">
              <SideLiveChatButton
                joined={sideLiveChat.joined}
                indicator={sideLiveChat.indicator}
                uiStatus={sideLiveChat.uiStatus}
                remoteTalking={sideLiveChat.remoteTalking}
                localSpeaking={sideLiveChat.localSpeaking}
                inlineError={sideLiveChat.inlineError}
                statusDetail={sideLiveChat.statusDetail}
                debugLine={sideLiveChat.debugLine}
                remoteStream={sideLiveChat.remoteStream}
                onJoin={sideLiveChat.onJoin}
                onLeave={sideLiveChat.onLeave}
                disabled={sideLiveChat.roomReady === false && !sideLiveChat.joined}
                compact={sideLiveChat.compact !== false}
                allowConnect={sideLiveChat.allowConnect !== false}
                connectLabel="Connect voice"
              />
            </div>
          )}
        </div>
        <h1 className="title" style={{ fontSize: '1.05rem', margin: 0 }}>
          SUPERCRIB
        </h1>
        <span className="badge">
          {state.phase}
          {spectate ? ' · watch' : aiMode ? ' · vs AI' : onlineMode ? ' · online' : ''}
        </span>
      </div>

      {spectate && (
        <div className="watching-banner" role="status">
          Watching · {seatLabel(seatLabels, 0)} vs {seatLabel(seatLabels, 1)}
        </div>
      )}

      {(state.trapped[0] || state.trapped[1]) && state.winner === null && (
        <div className="banner trap">
          {state.trapped[0] ? seatLabel(seatLabels, 0) : ''}
          {state.trapped[0] && state.trapped[1] ? ' & ' : ''}
          {state.trapped[1] ? seatLabel(seatLabels, 1) : ''} in the StinkHole — only
          last-card-31 wins
        </div>
      )}

      <div
        className={`message${isYourTurn ? ' your-turn' : ''}${bannerCollapsed ? ' is-collapsed' : ''}`}
        role="status"
        aria-hidden={bannerCollapsed}
      >
        {turnBanner}
      </div>

      {/* Opponent hand — top */}
      <div className="section-label">
        {seatLabel(seatLabels, topId)}
        {topId === state.dealer ? ' · dealer' : ''}
        {hideHoleCards || (!spectate && !pegging) ? ' · face down' : ''}
      </div>
      <div className="row opponent-row">
        {topShown.map((c, i) => (
          <span
            key={c.id}
            className={dealing ? 'deal-fly-in' : undefined}
            style={{ zIndex: i + 1 }}
          >
            {hideHoleCards || !spectate ? (
              <CardView faceDown />
            ) : (
              <CardView card={c} />
            )}
          </span>
        ))}
        {topShown.length === 0 &&
          state.players[topId].played.map((c) => (
            <CardView key={`played-top-${c.id}`} card={c} />
          ))}
      </div>

      {/* Mid zone: pegboard between hands + play/starter + score callout */}
      <div className="table-mid-zone">
        <Pegboard
          score0={state.players[0].score}
          score1={state.players[1].score}
          trapped={state.trapped}
          label0={seatLabel(seatLabels, 0) + (state.dealer === 0 ? ' ●' : '')}
          label1={seatLabel(seatLabels, 1) + (state.dealer === 1 ? ' ●' : '')}
          avatar0={seatAvatar0}
          avatar1={seatAvatar1}
        />

        {showCutFan ? (
          <CutFan
            deckCount={cutFanDeckCount}
            aiAnim={showAiCutFan ? aiCutAnim : null}
            disabled={!!showAiCutFan || showWaitingCutFan || uiLocked}
            watchMode={showWaitingCutFan && !showAiCutFan}
            actorLabel={cutActorLabel}
            onCut={(idx) => {
              onCut(idx);
            }}
          />
        ) : (
          <div className={`mid-play-row${pegging ? ' pegging' : ''}`}>
            {showCenterCribStaging && (
              <div className="crib-zone crib-staging">
                <div className="section-label">Crib</div>
                <div className="row crib-cards">
                  {state.crib.map((c, i) => (
                    <CardView key={`crib-stage-${c.id}-${i}`} faceDown />
                  ))}
                </div>
              </div>
            )}
            {!pegging && (
              <div className="starter-zone" aria-label="Starter card">
                <div className="section-label">Starter</div>
                <div className="row">
                  {starter ? <CardView card={starter} /> : <CardView faceDown />}
                </div>
                {x2 === true && <span className="badge x2">×2 show</span>}
                {x2 === false && (
                  <span className="badge mute">spade · raw</span>
                )}
              </div>
            )}
            <div className={`play-area${pegging ? ' peg-active' : ''}`} aria-live="polite">
              {pegging ? (
                <>
                  <div className="count-header">
                    <div className="count-label">Count</div>
                    <div className="count">{state.peg ? state.peg.count : 0}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="section-label">Play pile · count</div>
                  <div className="count">{state.peg ? state.peg.count : '—'}</div>
                </>
              )}
              <div className="play-pile-row">
                {state.peg && state.peg.sequence.length > 0
                  ? state.peg.sequence.map((p, i) => (
                      <CardView
                        key={`${p.card.id}-${i}`}
                        card={p.card}
                        className={
                          p.player === viewer ? 'peg-owner-you' : 'peg-owner-opp'
                        }
                      />
                    ))
                  : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PTT sits BETWEEN mid-zone and hand — sibling, never clipped by mid-zone overflow */}
      {VOICE_PTT_ENABLED &&
        onlineMode &&
        !spectate &&
        voicePtt &&
        state.phase !== 'gameOver' && (
        <div className="table-ptt-slot">
          <PushToTalkButton
            holding={voicePtt.holding}
            remoteTalking={voicePtt.remoteTalking}
            peerLive={voicePtt.peerLive === true}
            inlineError={voicePtt.inlineError}
            remoteStream={voicePtt.remoteStream}
            onHoldStart={voicePtt.onHoldStart}
            onHoldEnd={voicePtt.onHoldEnd}
            disabled={voicePtt.voiceReady === false}
            notReadyHint={
              voicePtt.voiceReady === false ? 'Connecting…' : null
            }
            voiceStatusHint={voicePtt.voiceStatusHint ?? null}
          />
        </div>
      )}

      <div className={`hand-area${handPegHint ? ' has-pick-banner' : ''}`}>
        <div className={`row hand-row${handPegHint ? ' has-pick-banner' : ''}`}>
          {renderBottomHand()}
          {fullBottom.length === 0 &&
            state.players[resolvedBottom].played.map((c) => (
              <CardView key={`played-bot-${c.id}`} card={c} />
            ))}
          {handPegHint && (
            <div className="hand-pick-banner" role="status">
              {handPegHint}
            </div>
          )}
          <div className="hand-label-row hand-label-overlay" aria-live="polite">
            <div
              className={`section-label hand-seat-label${isYourTurn ? ' your-turn' : ''}`}
            >
              {seatLabel(seatLabels, resolvedBottom)}
              {resolvedBottom === state.dealer ? ' · dealer' : ''}
              {hideHoleCards ? ' · face down' : ''}
              {state.phase === 'discard' && myDiscardPending && interactive
                ? resolvedBottom === state.dealer
                  ? ' — pick 3 for crib'
                  : ' — pick 2 for crib'
                : ''}
            </div>
          </div>
        </div>
      </div>

      <div className={`actions${spectate ? ' spectate-dim' : ''}`}>
        {showBottomActions &&
          state.phase === 'discard' &&
          myDiscardPending &&
          sel.length === need &&
          need > 0 && (
          <button
            type="button"
            className="btn primary"
            onClick={() => onConfirmDiscard(resolvedBottom)}
          >
            Confirm discard ({sel.length}/{need})
          </button>
        )}
        {showBottomActions &&
          state.phase === 'pegging' &&
          legal.length === 0 && (
            <button
              type="button"
              className="btn primary"
              onClick={() => onGo(resolvedBottom)}
            >
              Go
            </button>
          )}
      </div>

      {pegBanner?.kind === 'go' && (
        <div className="peg-banner-overlay" aria-live="assertive">
          <div className="peg-banner-card peg-banner-go">
            <div className="peg-banner-title">GO</div>
            <div className="peg-banner-sub">{pegBanner.name}</div>
          </div>
        </div>
      )}
      {pegBanner?.kind === 'thirtyone' && (
        <div className="peg-banner-overlay" aria-live="assertive">
          <div className="peg-banner-card peg-banner-31">
            <div className="peg-banner-title">31</div>
            <div className="peg-banner-sub">+{pegBanner.points}</div>
            {pegBanner.label ? (
              <div className="peg-banner-kinds">{pegBanner.label}</div>
            ) : null}
          </div>
        </div>
      )}

      {(state.phase === 'show' ||
        state.phase === 'redeal' ||
        state.phase === 'zeroHandOffer' ||
        (state.phase === 'gameOver' && state.showResult)) && (
        <ShowOverlay
          state={state}
          seatLabels={seatLabels}
          onContinue={onShowContinue}
          onZeroHandChoice={spectate ? undefined : onZeroHandChoice}
          onClaim={spectate ? undefined : onShowClaim}
          onConfirmClaim={spectate ? undefined : onConfirmClaim}
          onAdjustClaim={spectate ? undefined : onAdjustClaim}
          onMuggins={spectate ? undefined : onMugginsChoice}
          onAcknowledgeRef={spectate ? undefined : onAcknowledgeRef}
          online={state.mode === 'online' && !spectate}
          myReady={Boolean(state.showReady?.[viewer])}
          oppReady={Boolean(state.showReady?.[viewer === 0 ? 1 : 0])}
          spectate={spectate}
          viewer={viewer}
        />
      )}

      <QuitConfirm
        open={quitConfirm}
        title={spectate ? 'Stop watching and return to tournament?' : undefined}
        onCancel={() => setQuitConfirm(false)}
        onConfirm={() => {
          setQuitConfirm(false);
          onQuit();
        }}
      />


      {(aiMode || onlineMode) && !spectate && state.phase !== 'gameOver' && (
        <ReactionBar
          viewer={viewer}
          remoteReaction={onlineMode ? remoteReaction : null}
          externalOppReaction={aiMode ? externalOppReaction : null}
          onSend={onlineMode ? onReact : undefined}
          equippedRailEmojiIds={equippedRailEmojiIds}
        />
      )}

      {state.phase === 'gameOver' && !state.showResult && (
        <GameOverBanner
          state={state}
          viewer={viewer}
          seatLabels={seatLabels}
          onQuit={onQuit}
          spectate={spectate}
        />
      )}
    </div>
  );
}
