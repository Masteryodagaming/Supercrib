/**
 * Shared play-pace timings (ms / CSS-aligned).
 * Calmer readable pace (~1.5–1.6× prior values) for phone + desktop.
 * Engine GO/31 pause lives in engine/supercrib.ts as PEG_BANNER_MS.
 */

/** Delay before AI discard / peg / competitive claim / cut-start. */
export const AI_THINK_MS = 750;

/** Full AI starter-cut animation (fan → select → reveal). */
export const AI_CUT_ANIM_MS = 3600;
export const AI_CUT_SELECT_MS = 850;
export const AI_CUT_REVEAL_MS = 1900;

/** One card step during deal fly-in. */
export const DEAL_STEP_MS = 80;
/** Crib gather UI lock (matches CSS crib-gather + stagger). */
export const CRIB_GATHER_MS = 980;
/** Peg score callout / lastPegFlash hold. */
export const PEG_FLASH_MS = 3800;

/** Turn / phase message banner visible before collapse. */
export const MSG_BANNER_DEAL_MS = 2500;
export const MSG_BANNER_YOUR_TURN_MS = 4200;
export const MSG_BANNER_OTHER_MS = 3100;

/** Cut-for-deal (match start) AI + result holds — keep Dummy2 cut clearly visible. */
export const CUT_DEAL_AI_SELECT_MS = 900;
export const CUT_DEAL_AI_REVEAL_MS = 3200;
export const CUT_DEAL_RESULT_HOLD_MS = 2400;
export const CUT_DEAL_TIE_HOLD_MS = 1900;

/** Peg hole travel / flash on the board. */
export const PEG_TRAVEL_MS = 750;

/** Online "connected" status strip before collapse. */
export const CONN_BANNER_COLLAPSE_MS = 2500;
