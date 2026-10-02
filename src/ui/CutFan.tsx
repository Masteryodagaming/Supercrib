import { Card } from '../engine/cards';
import { CardView } from './CardView';

/** Cap visual stack for layout; map evenly onto real deck indices. */
export const CUT_FAN_VISUAL_MAX = 18;

/** Visual slot → deck index mapping used by the cut fan. */
export function cutFanSlots(deckCount: number): number[] {
  const n = Math.max(0, deckCount);
  if (n <= CUT_FAN_VISUAL_MAX) {
    return Array.from({ length: n }, (_, i) => i);
  }
  return Array.from({ length: CUT_FAN_VISUAL_MAX }, (_, i) =>
    Math.round((i * (n - 1)) / (CUT_FAN_VISUAL_MAX - 1)),
  );
}

/** Staged cut animation state shown in the fan (AI or remote opponent). */
export type AiCutAnimView = {
  stage: 'scanning' | 'select' | 'reveal';
  /** Index into the visual fan slots. */
  visualI: number;
  /** Real deck index being cut. */
  cutIndex: number;
  /** Card that will become the starter (peek before engine apply). */
  revealCard: Card;
  /** Online spectator replay — do not call cutStarter again when done. */
  remote?: boolean;
  /** Name shown in prompts (AI / opponent). */
  actorLabel?: string;
};

interface Props {
  deckCount: number;
  onCut: (index: number) => void;
  disabled?: boolean;
  /** When set, fan is non-interactive and plays the cut animation. */
  aiAnim?: AiCutAnimView | null;
  /**
   * Online/hotseat spectator: show the stock fan while the other seat cuts
   * (no tap). Used when dealer watches pone cut the starter.
   */
  watchMode?: boolean;
  /** Who is cutting — used for watch / remote prompts. */
  actorLabel?: string;
}

/** Face-down fan of remaining stock — tap a card to cut that position as starter. */
export function CutFan({
  deckCount,
  onCut,
  disabled,
  aiAnim,
  watchMode = false,
  actorLabel,
}: Props) {
  const n = Math.max(0, deckCount);
  const slots = cutFanSlots(n);
  const aiMode = !!aiAnim;
  const cutter = aiAnim?.actorLabel || actorLabel || (aiAnim?.remote ? 'Opponent' : 'AI');
  const x2 =
    aiAnim?.stage === 'reveal' && aiAnim.revealCard
      ? aiAnim.revealCard.suit !== 'spades'
      : null;

  const prompt = aiMode
    ? aiAnim!.stage === 'reveal'
      ? 'Starter revealed'
      : `${cutter} is cutting…`
    : watchMode
      ? `${cutter} is cutting…`
      : 'Cut the deck';

  const hint = aiMode
    ? aiAnim!.stage === 'reveal'
      ? 'Dealer turns the starter'
      : 'Watch the cut — non-dealer selects, dealer turns starter'
    : watchMode
      ? 'Watch the cut — non-dealer selects, dealer turns starter'
      : 'Tap a face-down card — non-dealer cuts, dealer turns starter';

  return (
    <div
      className={`cut-panel${aiMode ? ' ai-cutting' : ''}${watchMode && !aiMode ? ' cut-watching' : ''}`}
    >
      <div className="cut-prompt">{prompt}</div>
      <p className="cut-hint">{hint}</p>
      <div
        className="cut-fan"
        role="group"
        aria-label={
          aiMode
            ? `${cutter} cutting deck`
            : watchMode
              ? `Waiting for ${cutter} to cut`
              : 'Deck to cut'
        }
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
                key={`ai-reveal-${deckIndex}-${visualI}`}
                className={`cut-card-wrap ai-selected ai-reveal`}
                style={{ zIndex: visualI + 1 }}
              >
                <CardView card={aiAnim!.revealCard} />
              </div>
            );
          }

          return (
            <button
              key={`${deckIndex}-${visualI}`}
              type="button"
              className={`card back cut-card tappable${selecting ? ' ai-selected' : ''}${
                aiMode && aiAnim!.stage === 'scanning' ? ' ai-scan' : ''
              }`}
              disabled={disabled || aiMode || watchMode}
              style={{
                /* Fan stack order only — never bump selected to front */
                zIndex: visualI + 1,
                ['--scan-i' as string]: String(visualI),
              }}
              title={
                aiMode
                  ? selecting
                    ? `${cutter} selected this card`
                    : undefined
                  : watchMode
                    ? undefined
                    : `Cut position ${deckIndex + 1} of ${n}`
              }
              aria-label={
                aiMode
                  ? selecting
                    ? `${cutter} selected card ${deckIndex + 1} of ${n}`
                    : `Stock card ${deckIndex + 1} of ${n}`
                  : watchMode
                    ? `Stock card ${deckIndex + 1} of ${n}`
                    : `Cut card ${deckIndex + 1} of ${n}`
              }
              onClick={() => {
                if (aiMode || watchMode) return;
                onCut(deckIndex);
              }}
            />
          );
        })}
      </div>
      {aiAnim?.stage === 'reveal' && aiAnim.revealCard && (
        <div className="cut-reveal-cue" aria-live="polite">
          {x2 === true && <span className="badge x2">×2 show</span>}
          {x2 === false && <span className="badge mute">spade · raw</span>}
          <span className="cut-reveal-name">
            {aiAnim.revealCard.rank} of {aiAnim.revealCard.suit}
          </span>
        </div>
      )}
      <div className="cut-count">{n} in stock</div>
    </div>
  );
}
