import type { GameState, PlayerId } from '../engine/supercrib';
import { TARGET, TRAP_SCORE } from '../engine/supercrib';
import { isForfeitWin } from '../multiplayer/disconnectForfeit';

/** Board S-180 line — display flavor for “skunked” (loser under 180). */
export const SKUNK_LINE = 180;

/** After show Okay when a winner exists — drop show overlay so GameOverBanner can render. */
export function clearShowForGameOverBanner(state: GameState): GameState {
  if (state.winner === null || !state.showResult) return state;
  return { ...state, showResult: null, phase: 'gameOver' };
}

interface Props {
  state: GameState;
  viewer: PlayerId;
  seatLabels: [string, string];
  onQuit: () => void;
  /** Spectator: neutral winner headline (not YOU WIN/LOSE). */
  spectate?: boolean;
}

function label(labels: [string, string], id: PlayerId): string {
  return labels[id] || `P${id}`;
}

export function describeGameOver(
  state: GameState,
  viewer: PlayerId,
  seatLabels: [string, string],
): {
  youWon: boolean;
  headline: string;
  subline: string;
  tone: 'win' | 'lose' | 'skunk' | 'stink';
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
} | null {
  if (state.winner === null) return null;
  const winner = state.winner;
  const loser = (1 - winner) as PlayerId;
  const winnerScore = state.players[winner].score;
  const loserScore = state.players[loser].score;
  const winnerName = label(seatLabels, winner);
  const loserName = label(seatLabels, loser);
  const youWon = winner === viewer;
  const skunked = loserScore < SKUNK_LINE;
  const loserInStink =
    state.trapped[loser] || loserScore === TRAP_SCORE;
  const stinkEscape = Boolean(state.trapEscapeWin);
  const forfeit = isForfeitWin(state);

  let tone: 'win' | 'lose' | 'skunk' | 'stink' = youWon ? 'win' : 'lose';
  let headline = youWon ? 'YOU WIN!' : 'YOU LOSE';
  let subline = '';

  if (forfeit && youWon) {
    tone = 'win';
    headline = 'YOU WIN — FORFEIT';
    subline = 'Opponent disconnected for over 2 minutes';
  } else if (forfeit && !youWon) {
    tone = 'lose';
    headline = 'YOU FORFEITED';
    subline = 'Disconnected over 2 minutes';
  } else if (stinkEscape && youWon) {
    tone = 'stink';
    headline = 'STINKHOLE ESCAPE!';
    subline = 'Last-card exact 31 — out of the hole to 241';
  } else if (loserInStink && youWon) {
    tone = 'stink';
    headline = 'YOU WIN!';
    subline = `${loserName} stuck in the StinkHole (240)`;
  } else if (loserInStink && !youWon) {
    tone = 'stink';
    headline = 'STINKHOLE';
    subline = 'You were stuck on 240 — opponent reached 241';
  } else if (skunked && youWon) {
    tone = 'skunk';
    headline = 'YOU WIN — SKUNK!';
    subline = `${loserName} finished under ${SKUNK_LINE}`;
  } else if (skunked && !youWon) {
    tone = 'skunk';
    headline = 'SKUNKED!';
    subline = `You finished under ${SKUNK_LINE}`;
  } else if (youWon) {
    subline = `First to ${TARGET}`;
  } else {
    subline = `${winnerName} reached ${TARGET}`;
  }

  return {
    youWon,
    headline,
    subline,
    tone,
    winnerName,
    loserName,
    winnerScore,
    loserScore,
  };
}

export function GameOverBanner({
  state,
  viewer,
  seatLabels,
  onQuit,
  spectate = false,
}: Props) {
  const info = describeGameOver(state, viewer, seatLabels);
  if (!info) return null;

  const headline = spectate ? `${info.winnerName} wins!` : info.headline;
  const subline = spectate
    ? `${info.winnerName} ${info.winnerScore} · ${info.loserName} ${info.loserScore}`
    : info.subline;
  const tone = spectate ? 'win' : info.tone;

  return (
    <div className="overlay game-over-overlay" role="dialog" aria-modal="true" aria-label="Game over">
      <div className={`overlay-card game-over-card tone-${tone}`}>
        <div className={`game-over-banner tone-${tone}`}>
          <p className="game-over-headline">{headline}</p>
          {subline ? <p className="game-over-sub">{subline}</p> : null}
        </div>

        <div className="game-over-scores" aria-label="Final scores">
          <div className={`game-over-score-row${spectate ? '' : info.youWon ? ' is-you' : ''}`}>
            <span className="game-over-score-name">{info.winnerName}</span>
            <span className="game-over-score-tag win-tag">Winner</span>
            <strong className="game-over-score-num">{info.winnerScore}</strong>
          </div>
          <div className={`game-over-score-row${spectate ? '' : !info.youWon ? ' is-you' : ''}`}>
            <span className="game-over-score-name">{info.loserName}</span>
            <span className="game-over-score-tag lose-tag">
              {info.loserScore < SKUNK_LINE
                ? 'Skunked'
                : info.loserScore === TRAP_SCORE
                  ? 'StinkHole'
                  : 'Loser'}
            </span>
            <strong className="game-over-score-num">{info.loserScore}</strong>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn primary" onClick={onQuit}>
            {spectate ? 'Back' : 'Home'}
          </button>
        </div>
      </div>
    </div>
  );
}
