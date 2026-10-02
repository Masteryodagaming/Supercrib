import { useEffect, useRef, useState } from 'react';
import { Card } from '../engine/cards';
import {
  createCutStock,
  dealerFromCutCards,
  takeCutCard,
} from '../engine/cutForDeal';
import type { PlayerId } from '../engine/supercrib';
import { CardView } from './CardView';
import { cutFanSlots, type AiCutAnimView } from './CutFan';
import { QuitConfirm } from './QuitConfirm';
import { playCut, playShuffle } from '../audio/gameSfx';
import {
  CUT_DEAL_AI_REVEAL_MS,
  CUT_DEAL_AI_SELECT_MS,
  CUT_DEAL_RESULT_HOLD_MS,
  CUT_DEAL_TIE_HOLD_MS,
} from './playPace';

const AI_REVEAL_MS = CUT_DEAL_AI_REVEAL_MS;
const AI_SELECT_MS = CUT_DEAL_AI_SELECT_MS;
const RESULT_HOLD_MS = CUT_DEAL_RESULT_HOLD_MS;
const TIE_HOLD_MS = CUT_DEAL_TIE_HOLD_MS;

type Stage =
  | 'cut0'
  | 'cut1'
  | 'ai-anim'
  | 'reveal'
  | 'tie'
  | 'winner';

export interface OnlineCutProps {
  /** Synced deck length + stage for online. */
  stage: Stage;
  deckCount: number;
  cuts: [Card | null, Card | null];
  winner: PlayerId | null;
  round: number;
  viewer: PlayerId | null;
  onCutIndex: (index: number) => void;
  /** Host (or any) advances tie → new round. */
  onTieAdvance?: () => void;
}

interface Props {
  mode: 'hotseat' | 'ai' | 'online';
  seatLabels: [string, string];
  /** Called once cut resolves; parent should startDeal with this dealer. */
  onResolved: (dealer: PlayerId) => void;
  onQuit: () => void;
  /** Required when mode === 'online' — controlled synced cut. */
  online?: OnlineCutProps;
}

/**
 * Match-start cut for deal — low card deals (Ace low).
 * Human seat 0 always cuts first; seat 1 is friend (hot-seat tap) or AI (~1s reveal).
 */
export function CutForDeal({ mode, seatLabels, onResolved, onQuit, online }: Props) {
  const isOnline = mode === 'online';
  const [deck, setDeck] = useState<Card[]>(() => createCutStock());
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [cutsLocal, setCutsLocal] = useState<[Card | null, Card | null]>([null, null]);
  const [stageLocal, setStageLocal] = useState<Stage>('cut0');
  const [winnerLocal, setWinnerLocal] = useState<PlayerId | null>(null);
  const [aiAnim, setAiAnim] = useState<AiCutAnimView | null>(null);
  const [roundLocal, setRoundLocal] = useState(1);
  const resolvedRef = useRef(false);
  const shuffleOnceRef = useRef(false);
  /** One clear cut WAV per seat per round (tap + remote sync + AI share keys). */
  const cutSfxPlayedRef = useRef<Set<string>>(new Set());

  const fireCutSfx = (seat: 0 | 1, roundKey: number) => {
    const key = `${roundKey}-${seat}`;
    if (cutSfxPlayedRef.current.has(key)) return;
    cutSfxPlayedRef.current.add(key);
    playCut();
  };

  // Card-shuffle cue when cut-for-deal UI first appears.
  useEffect(() => {
    if (shuffleOnceRef.current) return;
    shuffleOnceRef.current = true;
    playShuffle();
  }, []);

  const cuts = isOnline && online ? online.cuts : cutsLocal;
  const stage = isOnline && online ? online.stage : stageLocal;
  const winner = isOnline && online ? online.winner : winnerLocal;
  const round = isOnline && online ? online.round : roundLocal;
  const setCuts = setCutsLocal;
  const setStage = setStageLocal;
  const setWinner = setWinnerLocal;
  const setRound = setRoundLocal;

  // Remote / online / local: hear cut when a seat's card lands (deduped w/ tap).
  // Keys include round so ties do not need a Set clear (avoids Strict Mode double).
  useEffect(() => {
    if (cuts[0]) fireCutSfx(0, round);
    if (cuts[1]) fireCutSfx(1, round);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuts[0], cuts[1], round]);

  // Allow a fresh onResolved if online cut round restarts after leave/rejoin.
  useEffect(() => {
    if (!isOnline) return;
    if (stage === 'cut0' && !cuts[0] && !cuts[1]) {
      resolvedRef.current = false;
    }
  }, [isOnline, stage, round, cuts]);

  const resetRound = () => {
    setDeck(createCutStock());
    setCuts([null, null]);
    setStage('cut0');
    setWinner(null);
    setAiAnim(null);
    setRound((r) => r + 1);
    playShuffle();
  };

  const applyHumanCut = (seat: 0 | 1, index: number) => {
    if (stage !== (seat === 0 ? 'cut0' : 'cut1')) return;
    fireCutSfx(seat, round);
    if (isOnline) {
      online?.onCutIndex(index);
      return;
    }
    if (deck.length === 0) return;
    const { card, remaining } = takeCutCard(deck, index);
    const nextCuts: [Card | null, Card | null] = [...cuts];
    nextCuts[seat] = card;
    setCuts(nextCuts);
    setDeck(remaining);

    if (seat === 0) {
      if (mode === 'ai') {
        setStage('ai-anim');
      } else {
        setStage('cut1');
      }
      return;
    }
    // Both cut — go to reveal
    setStage('reveal');
  };

  // AI auto-cut with short visible fan → select → reveal (~1s)
  useEffect(() => {
    if (stage !== 'ai-anim') return;
    if (deck.length === 0) return;

    const slots = cutFanSlots(deck.length);
    if (slots.length === 0) return;
    const visualI = Math.floor(Math.random() * slots.length);
    const cutIndex = slots[visualI];
    const revealCard = deck[cutIndex];
    if (!revealCard) return;

    setAiAnim({
      stage: 'scanning',
      visualI,
      cutIndex,
      revealCard,
    });

    const tSelect = window.setTimeout(() => {
      fireCutSfx(1, round);
      setAiAnim((a) => (a ? { ...a, stage: 'select' } : a));
    }, AI_SELECT_MS);

    // Match starter-cut staging: select → hold → face-up reveal → settle.
    const tReveal = window.setTimeout(() => {
      setAiAnim((a) => (a ? { ...a, stage: 'reveal' } : a));
    }, Math.min(AI_SELECT_MS + 1000, AI_REVEAL_MS - 900));

    const tDone = window.setTimeout(() => {
      const { card, remaining } = takeCutCard(deck, cutIndex);
      setCuts((prev) => [prev[0], card]);
      setDeck(remaining);
      setAiAnim(null);
      setStage('reveal');
    }, AI_REVEAL_MS);

    return () => {
      window.clearTimeout(tSelect);
      window.clearTimeout(tReveal);
      window.clearTimeout(tDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, round]);

  // After both cards known: compare only — set winner/tie stage.
  // Do NOT schedule onResolved/resetRound here: Strict Mode cleanup would
  // clear the timer after stage flips, and remount early-returns → freeze.
  // Online: stage/winner already computed in synced cut payload.
  useEffect(() => {
    if (isOnline) return;
    if (stage !== 'reveal') return;
    const [c0, c1] = cuts;
    if (!c0 || !c1) return;

    const dealer = dealerFromCutCards(c0, c1);
    if (dealer === null) {
      setStage('tie');
      return;
    }

    setWinner(dealer);
    setStage('winner');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, cuts, isOnline]);

  // Dedicated winner effect: re-arms after Strict Mode cleanup while stage stays 'winner'.
  useEffect(() => {
    if (stage !== 'winner' || winner === null) return;
    if (resolvedRef.current) return;
    const dealer = winner;
    const t = window.setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResolved(dealer);
    }, RESULT_HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, winner]);

  // Online tie: advance synced cut after hold (any client may push; rev guards).
  useEffect(() => {
    if (!isOnline) return;
    if (stage !== 'tie') return;
    const t = window.setTimeout(() => {
      online?.onTieAdvance?.();
    }, TIE_HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, stage, round]);

  // Dedicated tie effect: same Strict Mode pattern as winner → onResolved.
  useEffect(() => {
    if (isOnline) return;
    if (stage !== 'tie') return;
    const t = window.setTimeout(() => resetRound(), TIE_HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, round, isOnline]);

  const cutSeat: 0 | 1 = stage === 'cut1' ? 1 : 0;
  const awaitingHuman = isOnline
    ? (stage === 'cut0' || stage === 'cut1') &&
      !!online &&
      online.viewer !== null &&
      online.viewer !== undefined &&
      online.viewer === cutSeat
    : stage === 'cut0' || (stage === 'cut1' && mode === 'hotseat');
  const showFan =
    awaitingHuman ||
    stage === 'ai-anim';
  const showWaitingFan =
    isOnline && !awaitingHuman && (stage === 'cut0' || stage === 'cut1');

  const prompt =
    stage === 'tie'
      ? 'Tie — cut again'
      : stage === 'winner' && winner !== null
        ? `${seatLabels[winner]} deals`
        : stage === 'ai-anim'
          ? `${seatLabels[1]} is cutting…`
          : stage === 'cut1'
            ? `${seatLabels[1]} — cut a card`
            : 'Cut for deal — low card deals';

  const hint =
    stage === 'tie'
      ? 'Same rank — Ace low, suit ignored. Cutting again…'
      : stage === 'winner' && winner !== null
        ? `${seatLabels[winner]} won the cut (lower card). Dealing…`
        : stage === 'ai-anim'
          ? 'Watch the cut — lowest rank deals'
          : stage === 'cut1'
            ? isOnline
              ? awaitingHuman
                ? 'Your turn — tap a face-down card'
                : 'Waiting for opponent to cut…'
              : 'Pass the phone — tap a face-down card'
            : isOnline && stage === 'cut0' && !awaitingHuman
              ? 'Waiting for opponent to cut…'
              : 'Tap a face-down card — Ace is low (A beats 2…K)';

  const bothKnown = !!(cuts[0] && cuts[1]);

  return (
    <div className="cut-for-deal" role="dialog" aria-label="Cut for deal">
      <div className="meta cut-for-deal-meta">
        <button
          type="button"
          className="btn"
          style={{ width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}
          onClick={() => setQuitConfirm(true)}
        >
          Quit
        </button>
        <h1 className="title" style={{ fontSize: '1.05rem', margin: 0 }}>
          SUPERCRIB
        </h1>
        <span className="cut-for-deal-round">Cut #{round}</span>
      </div>

      <div className="cut-for-deal-body">
        <div className="cut-panel cut-for-deal-panel">
          <div className="cut-prompt">{prompt}</div>
          <p className="cut-hint">{hint}</p>

          {(cuts[0] || cuts[1] || stage === 'reveal' || stage === 'tie' || stage === 'winner') && (
            <div className="cut-for-deal-reveals" aria-live="polite">
              <CutReveal
                label={seatLabels[0]}
                card={cuts[0]}
                highlight={winner === 0}
                dim={winner === 1}
              />
              <div className="cut-for-deal-vs">vs</div>
              <CutReveal
                label={seatLabels[1]}
                card={cuts[1]}
                highlight={winner === 1}
                dim={winner === 0}
              />
            </div>
          )}

          {bothKnown && (stage === 'reveal' || stage === 'winner' || stage === 'tie') && (
            <div className="cut-for-deal-result">
              {stage === 'tie' && <span className="badge mute">Tie</span>}
              {winner !== null && (
                <span className="badge x2">Low card · {seatLabels[winner]} deals</span>
              )}
            </div>
          )}

          {(showFan || showWaitingFan) && (
            <DealCutFan
              deckCount={isOnline && online ? online.deckCount : deck.length}
              disabled={!awaitingHuman || showWaitingFan}
              watchMode={showWaitingFan}
              aiAnim={stage === 'ai-anim' ? aiAnim : null}
              onCut={(index) => applyHumanCut(cutSeat, index)}
            />
          )}
          {showWaitingFan && (
            <p className="cut-waiting-placeholder" role="status">
              Opponent is cutting — watch the deck…
            </p>
          )}
        </div>
      </div>
      <QuitConfirm
        open={quitConfirm}
        onCancel={() => setQuitConfirm(false)}
        onConfirm={() => {
          setQuitConfirm(false);
          onQuit();
        }}
      />
    </div>
  );
}

function CutReveal({
  label,
  card,
  highlight,
  dim,
}: {
  label: string;
  card: Card | null;
  highlight?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`cut-for-deal-seat${highlight ? ' winner' : ''}${dim ? ' dim' : ''}`}
    >
      <div className="section-label">{label}</div>
      {card ? (
        <>
          <CardView card={card} />
          <div className="cut-for-deal-rank">
            {card.rank}
            <span className="cut-for-deal-suit"> {card.suit}</span>
          </div>
        </>
      ) : (
        <div className="card back cut-for-deal-placeholder" aria-hidden />
      )}
    </div>
  );
}

/** Compact fan for cut-for-deal (reuses CutFan slot math). */
function DealCutFan({
  deckCount,
  onCut,
  disabled,
  aiAnim,
  watchMode = false,
}: {
  deckCount: number;
  onCut: (index: number) => void;
  disabled?: boolean;
  aiAnim?: AiCutAnimView | null;
  /** Online non-cutter: show full-opacity waiting fan */
  watchMode?: boolean;
}) {
  const n = Math.max(0, deckCount);
  const slots = cutFanSlots(n);
  const aiMode = !!aiAnim;

  return (
    <div
      className={`cut-fan${aiMode ? ' ai-cutting' : ''}${watchMode && !aiMode ? ' cut-watching' : ''}`}
      role="group"
      aria-label={watchMode ? 'Waiting for opponent to cut' : 'Cut for deal'}
    >
      {slots.map((deckIndex, visualI) => {
        const selected = aiMode && aiAnim!.visualI === visualI;
        const revealing =
          selected && aiAnim!.stage === 'reveal' && aiAnim!.revealCard;
        const selecting =
          selected && (aiAnim!.stage === 'select' || aiAnim!.stage === 'reveal');

        if (revealing) {
          return (
            <div
              key={`deal-ai-reveal-${deckIndex}-${visualI}`}
              className="cut-card-wrap ai-selected ai-reveal"
              style={{ zIndex: visualI + 1 }}
            >
              <CardView card={aiAnim!.revealCard} />
            </div>
          );
        }

        return (
          <button
            key={`deal-${deckIndex}-${visualI}`}
            type="button"
            className={`card back cut-card tappable${selecting ? ' ai-selected' : ''}${
              aiMode && aiAnim!.stage === 'scanning' ? ' ai-scan' : ''
            }`}
            disabled={disabled || aiMode}
            style={{
              /* Fan stack order only — never bump selected to front */
              zIndex: visualI + 1,
              ['--scan-i' as string]: String(visualI),
            }}
            aria-label={`Cut card ${deckIndex + 1} of ${n}`}
            onClick={() => {
              if (aiMode || disabled) return;
              onCut(deckIndex);
            }}
          />
        );
      })}
    </div>
  );
}
