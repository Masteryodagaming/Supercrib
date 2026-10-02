/**
 * Online cut visibility helpers.
 *
 * BUG: dealer (or any non-cutter) saw only "Waiting…" with no deck/cut UI while
 * the opponent cut — seat gating hid CutFan (`pone === viewer`) and cut-for-deal
 * used a text placeholder. AI Dummy2 cut timing does not cover online sync.
 */

import type { Card } from '../engine/cards';
import type { PlayerId } from '../engine/supercrib';
import { cutFanSlots } from './CutFan';

/** Show a non-interactive stock fan while waiting for the opponent/pone to cut. */
export function shouldShowWaitingStarterCutFan(args: {
  phase: string;
  cribGathering: boolean;
  cribSettled: boolean;
  humanCutFan: boolean;
  animCutFan: boolean;
}): boolean {
  return (
    args.phase === 'cut' &&
    !args.cribGathering &&
    args.cribSettled &&
    !args.humanCutFan &&
    !args.animCutFan
  );
}

/**
 * After RTDB applies the opponent's cutStarter, the spectator's phase jumps
 * past 'cut'. Detect that edge so we can replay a local select→reveal anim.
 */
export function shouldStartRemoteStarterCutReveal(args: {
  mode: string;
  prevPhase: string | null;
  prevDealNumber: number | null;
  nextPhase: string;
  dealNumber: number;
  starter: Card | null | undefined;
  viewerSeat: PlayerId | null;
  pone: PlayerId;
  alreadyStartedForDeal: number | null;
}): boolean {
  if (args.mode !== 'online') return false;
  if (args.viewerSeat === null) return false;
  // Cutter already saw their own tap — don't replay for them.
  if (args.viewerSeat === args.pone) return false;
  if (args.alreadyStartedForDeal === args.dealNumber) return false;
  if (args.prevDealNumber !== args.dealNumber) return false;
  if (args.prevPhase !== 'cut') return false;
  if (args.nextPhase === 'cut') return false;
  if (!args.starter) return false;
  return true;
}

/** Synthesize a fan select target for a remote reveal (deck already missing starter). */
export function remoteCutAnimSlots(postCutDeckLength: number): {
  deckCount: number;
  visualI: number;
  cutIndex: number;
} {
  const deckCount = Math.max(1, postCutDeckLength + 1);
  const slots = cutFanSlots(deckCount);
  const visualI = Math.min(
    slots.length - 1,
    Math.max(0, Math.floor(slots.length / 2)),
  );
  const cutIndex = slots[visualI] ?? 0;
  return { deckCount, visualI, cutIndex };
}
