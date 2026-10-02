import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getMatchPickerBoards,
  getMatchPickerFelts,
  MATCH_SKIN_PICK_TIMEOUT_MS,
  type MatchSkinChoice,
} from '../profile/matchSkins';
import type { FeltTheme } from '../profile/felts';
import type { BoardSkin } from '../profile/boards';

interface Props {
  uid: string | null | undefined;
  email?: string | null;
  ownedFeltIds: string[] | undefined;
  ownedBoardIds: string[] | undefined;
  /** Preselect winner's equipped (or defaults). */
  initial: MatchSkinChoice;
  onConfirm: (choice: MatchSkinChoice) => void;
  timeoutMs?: number;
}

/**
 * Short post-cut picker for the cut-for-deal winner.
 * Match-scoped only — does not write profile equip.
 * Timeout / "Use equipped" → initial (equipped) skins.
 */
export function MatchSkinPicker({
  uid,
  email = null,
  ownedFeltIds,
  ownedBoardIds,
  initial,
  onConfirm,
  timeoutMs = MATCH_SKIN_PICK_TIMEOUT_MS,
}: Props) {
  const felts = useMemo(
    () => getMatchPickerFelts(ownedFeltIds, uid, email),
    [ownedFeltIds, uid, email],
  );
  const boards = useMemo(
    () => getMatchPickerBoards(uid, ownedBoardIds, email),
    [uid, ownedBoardIds, email],
  );
  const [feltId, setFeltId] = useState(initial.feltId);
  const [boardSkinId, setBoardSkinId] = useState(initial.boardSkinId);
  const [remainMs, setRemainMs] = useState(timeoutMs);
  const doneRef = useRef(false);
  const choiceRef = useRef<MatchSkinChoice>({ feltId, boardSkinId });
  choiceRef.current = { feltId, boardSkinId };
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const finish = (choice: MatchSkinChoice) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onConfirm(choice);
  };

  // Auto-fallback to equipped / initial on timeout.
  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = Math.max(0, timeoutMs - (Date.now() - started));
      setRemainMs(left);
      if (left <= 0) {
        window.clearInterval(tick);
        finish(initialRef.current);
      }
    }, 200);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs]);

  const showBoard = boards.length > 0;
  const showFelt = felts.length > 0;
  const seconds = Math.ceil(remainMs / 1000);

  return (
    <div
      className="overlay match-skin-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Choose match skins"
    >
      <div className="overlay-card match-skin-card">
        <h2>You won the cut</h2>
        <p className="match-skin-blurb">
          Pick the table for this match
          <span className="match-skin-timer" aria-live="polite">
            {' '}
            · {seconds}s
          </span>
        </p>

        {showFelt && (
          <>
            <p className="section-label">Felt</p>
            <div className="owned-felt-grid match-skin-grid" role="list">
              {felts.map((felt: FeltTheme) => {
                const selected = feltId === felt.id;
                return (
                  <button
                    key={felt.id}
                    type="button"
                    role="listitem"
                    className={`owned-cosmetic-card${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setFeltId(felt.id)}
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
                      <span className="owned-cosmetic-blurb">{felt.blurb}</span>
                    </span>
                    {selected ? (
                      <span className="owned-emoji-equipped-pill" role="status">
                        Selected
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {showBoard && (
          <>
            <p className="section-label" style={{ marginTop: '0.75rem' }}>
              Board
            </p>
            <div className="owned-felt-grid match-skin-grid" role="list">
              {boards.map((skin: BoardSkin) => {
                const selected = boardSkinId === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    role="listitem"
                    className={`owned-cosmetic-card${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setBoardSkinId(skin.id)}
                  >
                    <span
                      className={`owned-board-swatch${skin.thumbClass ? ` ${skin.thumbClass}` : ''}`}
                      aria-hidden
                    />
                    <span className="owned-cosmetic-meta">
                      <span className="owned-cosmetic-name coin-metal-text">{skin.label}</span>
                      <span className="owned-cosmetic-blurb">{skin.blurb}</span>
                    </span>
                    {selected ? (
                      <span className="owned-emoji-equipped-pill" role="status">
                        Selected
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="match-skin-actions">
          <button
            type="button"
            className="btn"
            onClick={() => finish(initialRef.current)}
          >
            Use equipped
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => finish(choiceRef.current)}
          >
            Play
          </button>
        </div>
      </div>
    </div>
  );
}

/** Waiting panel for the non-winner while skins are chosen. */
export function MatchSkinWaiting({ winnerLabel }: { winnerLabel: string }) {
  return (
    <div className="home online-lobby match-skin-waiting" role="status" aria-live="polite">
      <h1 className="title">SUPERCRIB</h1>
      <p className="find-match-hint">
        {winnerLabel} won the cut — choosing table skins…
      </p>
    </div>
  );
}
