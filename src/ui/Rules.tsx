interface Props {
  onBack: () => void;
}

export function Rules({ onBack }: Props) {
  return (
    <div className="rules">
      <h1 className="title">SUPERCRIB</h1>
      <button type="button" className="btn" onClick={onBack}>
        Back
      </button>
      <h2>Deal</h2>
      <p>Dealer 8 cards, opponent 7. After discard each keeps a 5-card hand.</p>
      <h2>Crib</h2>
      <p>Non-dealer discards 2, dealer discards 3. Crib is 5 cards owned by dealer.</p>
      <h2>Starter</h2>
      <p>
        Non-dealer cuts; dealer turns starter. Spade starter = RAW show (no ×2).
        Heart/diamond/club = raw then ×2. Pegging is never multiplied. Jack starter
        = his heels +2 to dealer (not doubled).
      </p>
      <h2>Pegging</h2>
      <p>
        Play to 31. 15=2, pair=2, trips=6, quads=12, run of n = n, exact 31=2,
        go/last card (not 31)=1.
      </p>
      <h2>Show</h2>
      <p>
        Standard fifteens, pairs, runs, flush, nobs; apply ×2 after raw. Crib flush
        only if all 5 crib + starter same suit.
      </p>
      <h2>Normal (auto count)</h2>
      <p>
        Default show: the engine auto-counts hand and crib with full SuperCrib rules
        (Spade ×2 when the starter isn’t a spade; Spade starter = raw).
      </p>
      <h2>Competitive (count your own &amp; Muggins)</h2>
      <p>
        Optional scoring mode (vs AI or online — host picks, guest inherits): same
        SuperCrib board rules as Normal. “Count
        your own” means the <strong>raw</strong> hand/crib total — Spade ×2 is{' '}
        <em>not</em> part of the number you type. After each hand count the opponent{' '}
        <em>Approve</em>s (keep) or <em>Adjust</em>s (types a different total).
        On Adjust the game refs vs true raw and shows a Ref breakdown (original
        hand, adjusted total, true, verdict) before continuing: if the adjuster
        matches true and the claimant did not, the adjuster&apos;s number stands;
        if the claimant was already exact, a wrong Adjust is ignored for the kept
        total; if neither is exact, the closer announcement is kept (claimant on a
        tie). <strong>Wrong corrector:</strong> when the adjuster&apos;s number ≠
        true, the adjuster is peg-penalized by |adjusted − true| × show multiplier
        (×2 non-spade / ×1 spade — same shape as overclaim steal), then normal
        overclaim / underclaim / Muggins apply to the kept number. Approve skips
        the wrong-corrector penalty. After an exact (or snapped) raw hand, ×2 still
        pegs as a separate show step on a non-spade starter. Overclaim: peg true
        raw (then ×2 if applicable), then snap-back steal ×2 unless the starter is
        a spade (raw 8, claim 12 non-spade → +8 +×2 then −8; spade → −4 only).
        Underclaim: opponent may <em>Muggins</em> missed <em>raw</em> points, or
        Accept. StinkHole / 241 trap rules still apply.
      </p>
      <h2>Special</h2>
      <ol>
        <li>
          <strong>Cut for deal:</strong> before the first deal of a match, each
          player cuts a card. Lowest rank deals (Ace low). Same rank → cut again.
          Later deals rotate the dealer.
        </li>
        <li>
          <strong>Zero-hand:</strong> if either hand is 0 after the starter rule
          (right after the cut, or at show), you may <em>Redeal</em> (void the deal;
          same dealer; no show points) or <em>Continue with 0</em>.
        </li>
        <li>
          <strong>Zero-crib:</strong> crib show 0 → dealer −30 (floor 0).
        </li>
        <li>
          <strong>StinkHole:</strong> target 241. On exactly 240 (the StinkHole) you
          cannot win via show or normal pegging (pairs, 15s, runs, go). Only escape
          from the StinkHole is pegging exact 31 — that card ends the count (last
          card for 31) and wins at 241. You do not need to empty your hand. Opponent
          can win normally while you are in the StinkHole.
        </li>
        <li>First to 241 wins, subject to the StinkHole.</li>
      </ol>
    </div>
  );
}
