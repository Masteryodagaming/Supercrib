/**
 * Competitive show: manual count + muggins.
 * Players type the RAW hand/crib total (pre–Spade×2). Claim / overclaim /
 * muggins compare against raw only. SuperCrib ×2 (non-spade starter) is a
 * separate peg applied after an exact or snapped-to-raw resolution — never
 * part of the number the player must type.
 * Overclaim steal is returned as RAW delta here; the apply path multiplies
 * by showMultiplier (×2 non-spade, ×1 spade).
 */

export type ScoringMode = 'auto' | 'competitive';

export type ShowClaimStep = 'pone' | 'dealer' | 'crib';

export type ClaimOutcomeKind = 'exact' | 'overclaim' | 'underclaim';

export interface ClaimResolution {
  kind: ClaimOutcomeKind;
  trueTotal: number;
  claimed: number;
  /** Points applied to the scorer via applyPoints (before any overclaim penalty). */
  applyToScorer: number;
  /** Raw overclaim steal (claimed − true). Apply path × showMultiplier. */
  overclaimPenalty: number;
  /** Missed points the opponent may steal via muggins (underclaim only). */
  mugginsAvailable: number;
}

/**
 * Resolve a claimed show count vs the engine's true RAW total.
 *
 * Overclaim (raw 8, claim 12): apply 8, overclaimPenalty = 4 (raw steal).
 *   Caller multiplies steal by showMultiplier when applying (×2 non-spade).
 * Underclaim (raw 8, claim 5): apply 5; opponent may muggins +3.
 * Exact: apply raw (caller may then peg SuperCrib ×2 bonus).
 */
export function resolveClaim(trueTotal: number, claimed: number): ClaimResolution {
  const t = Math.max(0, Math.floor(trueTotal));
  const c = Math.max(0, Math.floor(claimed));
  if (c === t) {
    return {
      kind: 'exact',
      trueTotal: t,
      claimed: c,
      applyToScorer: t,
      overclaimPenalty: 0,
      mugginsAvailable: 0,
    };
  }
  if (c > t) {
    const over = c - t;
    return {
      kind: 'overclaim',
      trueTotal: t,
      claimed: c,
      applyToScorer: t,
      overclaimPenalty: over,
      mugginsAvailable: 0,
    };
  }
  return {
    kind: 'underclaim',
    trueTotal: t,
    claimed: c,
    applyToScorer: c,
    overclaimPenalty: 0,
    mugginsAvailable: t - c,
  };
}


/**
 * After opponent Adjusts a hand total, the game referees which announced
 * number to keep before existing resolve (exact / overclaim steal×2 /
 * underclaim → Accept|Muggins).
 *
 * - Adjuster exact, claimant not → keep adjuster
 * - Claimant exact, adjuster not → keep claimant (wrong Adjust does not win)
 * - Both exact → keep claimant (same number)
 * - Neither exact → keep closer to true; on equal distance prefer claimant
 */
export type RefKeepSide = 'claimant' | 'adjuster';

export interface RefereeAdjustDecision {
  kept: number;
  sidedWith: RefKeepSide;
  /** Neither matched true; kept by closeness (claimant on tie). */
  neitherExact: boolean;
  /** Adjuster's announced number ≠ true raw. */
  adjusterWrong: boolean;
}

export function refereeAdjustKeep(
  originalClaim: number,
  adjusted: number,
  trueRaw: number,
): RefereeAdjustDecision {
  const orig = Math.max(0, Math.floor(originalClaim));
  const adj = Math.max(0, Math.floor(adjusted));
  const t = Math.max(0, Math.floor(trueRaw));
  const adjusterWrong = adj !== t;

  if (adj === t && orig !== t) {
    return { kept: adj, sidedWith: 'adjuster', neitherExact: false, adjusterWrong };
  }
  if (orig === t && adj !== t) {
    return { kept: orig, sidedWith: 'claimant', neitherExact: false, adjusterWrong };
  }
  if (orig === t && adj === t) {
    return { kept: orig, sidedWith: 'claimant', neitherExact: false, adjusterWrong };
  }
  // Neither exact — closer wins; tie → claimant (adjuster must improve).
  const dOrig = Math.abs(orig - t);
  const dAdj = Math.abs(adj - t);
  if (dAdj < dOrig) {
    return { kept: adj, sidedWith: 'adjuster', neitherExact: true, adjusterWrong };
  }
  return { kept: orig, sidedWith: 'claimant', neitherExact: true, adjusterWrong };
}

/**
 * Raw wrong-corrector delta (|adjusted − true|) when adjuster ≠ true; else 0.
 * Apply path multiplies by showMultiplier (×2 non-spade, ×1 spade) — same
 * shape as overclaim steal.
 */
export function wrongCorrectorPenaltyRaw(
  adjusted: number,
  trueRaw: number,
): number {
  const adj = Math.max(0, Math.floor(adjusted));
  const t = Math.max(0, Math.floor(trueRaw));
  return adj === t ? 0 : Math.abs(adj - t);
}

/** Human-readable Ref verdict for modal / DEPLOY copy. */
export function buildRefVerdict(
  decision: RefereeAdjustDecision,
  originalClaim: number,
  adjusted: number,
  trueRaw: number,
  appliedPenalty: number,
): string {
  const orig = Math.max(0, Math.floor(originalClaim));
  const adj = Math.max(0, Math.floor(adjusted));
  const t = Math.max(0, Math.floor(trueRaw));
  const pen = Math.max(0, Math.floor(appliedPenalty));

  if (adj === t && orig === t) {
    return 'Both exact';
  }
  if (adj === t && orig !== t) {
    return 'Adjuster right';
  }
  if (orig === t && adj !== t) {
    return pen > 0
      ? `Claimant was already exact — adjuster wrong, penalized −${pen}`
      : 'Claimant was already exact';
  }
  const keptWho = decision.sidedWith === 'adjuster' ? 'adjuster' : 'claimant';
  if (pen > 0) {
    return `Neither exact — kept ${keptWho} (closer); adjuster wrong, penalized −${pen}`;
  }
  return `Neither exact — kept ${keptWho} (closer)`;
}

export function isCompetitiveMode(mode: ScoringMode | undefined | null): boolean {
  return mode === 'competitive';
}

/**
 * Normalize room / UI scoring mode (default Normal / auto).
 * Unknown values → auto so older rooms stay safe.
 */
export function normalizeScoringMode(raw: unknown): ScoringMode {
  return raw === 'competitive' ? 'competitive' : 'auto';
}

/**
 * Preview: Competitive chooser is available whenever creating an online match.
 * (AI Competitive remains Dummy-gated in Home.) Default remains Normal / auto.
 */
export function canOfferCompetitiveOnline(): boolean {
  return true;
}
