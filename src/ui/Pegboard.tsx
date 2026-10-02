import { useEffect, useMemo, useRef, useState } from 'react';
import { TARGET, TRAP_SCORE } from '../engine/supercrib';
import { AvatarView } from './AvatarView';
import type { Profile } from '../profile/storage';
import { PEG_TRAVEL_MS as PLAY_PEG_TRAVEL_MS } from './playPace';

export type SideAvatarProfile = Pick<
  Profile,
  'displayName' | 'avatarId' | 'avatarDataUrl'
>;

interface Props {
  score0: number;
  score1: number;
  trapped: [boolean, boolean];
  label0?: string;
  label1?: string;
  /** Seat 0 — left gap, red ring (tone-a / You). */
  avatar0?: SideAvatarProfile | null;
  /** Seat 1 — right gap, blue ring (tone-b / AI·opp). */
  avatar1?: SideAvatarProfile | null;
}

const PEG_TRAVEL_MS = PLAY_PEG_TRAVEL_MS;

/**
 * Hole indices are 0..TARGET inclusive → length TARGET+1 = 242.
 * Scores 1..TRAP_SCORE (240) sit on the snake track; 0 = start; TARGET (241) = finish.
 */
export const HOLES_PER_TRACK = TARGET + 1;

/** Portrait maple board — flat top-down, five-column snake */
export const VB_W = 280;
export const VB_H = 400;

/** Geometry knobs exported for tests */
export const HOLE_GROUP = 5;
export const TRACK_GROUPS = 48; // 48 × 5 = 240 scoring holes on track
/** Cribbage three-street snake: left loop + middle loop + short right street */
export const STREET_COUNT = 3;
export const COLUMN_COUNT = 5;

type Pt = { x: number; y: number };

/**
 * Classic crib lattice knobs (pre-scale units).
 * Two gap tiers so each decade box shows TWO clusters of 5:
 *   mid-decade (after 5,15,25…): small gap + light tick
 *   decade (after 10,20,30…): similar/slightly larger gap + darker thicker hash
 */
export const HOLE_PITCH = 2.5;
/** Small within-decade gap after holes ending in 5 (5→6, 15→16, …). */
export const HOLE_MID_GAP = HOLE_PITCH * 0.35;
/** Decade-boundary gap after holes ending in 0 (10→11, 20→21, …). */
export const HOLE_GROUP_GAP = HOLE_PITCH * 0.95;
/** @deprecated alias — decade gap */
export const HOLE_DECADE_GAP = HOLE_GROUP_GAP;

/** @deprecated first corner no longer lifts the rail — 40/50 sit level on the streets. */
export const FIRST_CURVE_LIFT = 0;

/** Half-distance between the two player lanes (outer P0 / inner P1). */
const LANE_HALF = 5.4;
/** Track corridor half-width from centerline (border). */
const BORDER_HALF = 9.5;

/**
 * Cumulative distance along a straight with two gap tiers.
 * Index i is 0-based within the straight; extra gap is applied when *arriving* at i
 * (i.e. between hole i-1 and hole i).
 *   i % 10 === 0 → decade gap (after 10,20,…)
 *   i % 5 === 0  → mid-decade gap (after 5,15,…)
 */
function groupCum(count: number, pitch: number, midGap: number, decadeGap: number): number[] {
  const cum = new Array<number>(count);
  cum[0] = 0;
  for (let i = 1; i < count; i++) {
    let extra = 0;
    if (i % 10 === 0) extra = decadeGap;
    else if (i % HOLE_GROUP === 0) extra = midGap;
    cum[i] = cum[i - 1] + pitch + extra;
  }
  return cum;
}

/** Unit tangent → left-hand normal (for lane / border offset). */
function normalFromTangent(tx: number, ty: number): Pt {
  const len = Math.hypot(tx, ty) || 1;
  return { x: -ty / len, y: tx / len };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Joshua's wooden board — ONE snake, TWO tracks, flat top-down:
 *   LEFT LOOP:  up outside 1–40; top U 41–49; 50 level with 40 on down street;
 *               down inside 51–90 + bottom curve 91–100 (label 100)
 *   MIDDLE:     up 101–140 + top curve 141–150 (label 150);
 *               down 151–190 (40 holes; S-180-S + 190 on this straight)
 *   BOTTOM CURVE 191–200 (10 holes) — label 200 on curve
 *   SHORT RIGHT STREET UP 201–240 (40 holes) — labels 210..240
 *   Shared win 241 ABOVE hole 240, centered on the finish lane (col5)
 * Straights: 5 + small mid gap + 5 + darker decade hash
 * Curves: equal arc-length holes (10 on all U-turns including final bottom)
 * Lanes: constant laneHalf on path normals (outer=P0, inner=P1)
 * Start: 2×2 paddock under left street (4 holes) — front pair = score 0, rear pair for second pegs
 */
export function buildHoleMaps(): { outer: Pt[]; inner: Pt[] } {
  const pitch0 = HOLE_PITCH;
  const mid0 = HOLE_MID_GAP;
  const dec0 = HOLE_GROUP_GAP;

  // Five column centerlines (flat orthographic — no 3D warp)
  const c1 = 48;
  const c2 = 90;
  const c3 = 132;
  const c4 = 174;
  const c5 = 216; // same column gap as c1–c4 so 190-turn matches 90-turn
  const yTop = 52;
  const yBot = 348;
  const colLen = yBot - yTop;

  const rTop12 = (c2 - c1) / 2;
  const rBot23 = (c3 - c2) / 2;
  const rTop34 = (c4 - c3) / 2;
  // Bottom curve into short street (10 holes: 191–200)
  const rBot45 = (c5 - c4) / 2;

  const nStr40 = 40; // cols 1–4 straights + short street 201–240

  // Shared lattice scale from a 40-hole straight spanning colLen (gap ratios preserved).
  const cum40raw = groupCum(nStr40, pitch0, mid0, dec0);
  const scale = colLen / (cum40raw[nStr40 - 1] || 1);
  const p = pitch0 * scale;
  const Gmid = mid0 * scale;
  const Gdec = dec0 * scale;

  function straightDists(n: number, pitch: number, midGap: number, decadeGap: number): number[] {
    return groupCum(n, pitch, midGap, decadeGap);
  }

  const dist40 = straightDists(nStr40, p, Gmid, Gdec);

  function yOnStraight(dist: number, goingUp: boolean, y0 = yBot, y1 = yTop): number {
    // goingUp: start at y0 (bottom), decrease y; goingDown: start at y1 (top), increase y
    return goingUp ? y0 - dist : y1 + dist;
  }

  /** Top semicircle left→right above yTop. t∈[0,1] */
  function topArc(leftX: number, rightX: number, t: number, radius: number, yRail = yTop): Pt {
    const cx = (leftX + rightX) / 2;
    const ang = Math.PI - t * Math.PI; // π → 0
    return { x: cx + radius * Math.cos(ang), y: yRail - radius * Math.sin(ang) };
  }

  /** Bottom semicircle left→right below yBot. t∈[0,1] */
  function botArc(leftX: number, rightX: number, t: number, radius: number, yRail = yBot): Pt {
    const cx = (leftX + rightX) / 2;
    const ang = Math.PI + t * Math.PI; // π → 2π
    return { x: cx + radius * Math.cos(ang), y: yRail - radius * Math.sin(ang) };
  }


  /** Centerline + unit tangent for score 1..240 */
  function centerAndTangent(score: number): { c: Pt; t: Pt } {
    // Col1 UP 1–40: same decade spacing as 11–20, but inset from the bottom rail
    // so hole 1 sits clear of the street end the way hole 11 sits clear of the 10 hash.
    if (score >= 1 && score <= nStr40) {
      const i = score - 1;
      const bottomClear = (dist40[10] - dist40[9]) / 2;
      const span = colLen - bottomClear;
      const y = yBot - bottomClear - dist40[i] * (span / dist40[nStr40 - 1]);
      return { c: { x: c1, y }, t: { x: 0, y: -1 } };
    }
    // First corner dots: ten holes 41–50 in the U (above the hash), ten holes 51–60 on the down street.
    if (score >= 41 && score <= 50) {
      const k = score - 41; // 0..9
      // Stay clear of rail ends so hashes sit between street holes and the arc.
      const u = 0.18 + (k / 9) * (0.82 - 0.18);
      const c = topArc(c1, c2, u, rTop12, yTop);
      const ang = Math.PI - u * Math.PI;
      const t = { x: Math.sin(ang), y: Math.cos(ang) };
      return { c, t };
    }

    // Col2 DOWN 51–90: standard 40-hole lattice (51–60 = ten dots).
    if (score >= 51 && score <= 90) {
      const i = score - 51;
      return { c: { x: c2, y: yOnStraight(dist40[i], false) }, t: { x: 0, y: 1 } };
    }
    // Bottom corner 91–100: ten holes in the U (40–50 pattern), clear of rail ends
    if (score >= 91 && score <= 100) {
      const k = score - 91; // 0..9
      const u = 0.18 + (k / 9) * (0.82 - 0.18);
      const c = botArc(c2, c3, u, rBot23);
      const ang = Math.PI + u * Math.PI;
      const t = { x: -Math.sin(ang), y: -Math.cos(ang) };
      return { c, t };
    }

    // Col3 UP 101–140 straight, then top U 141–150 (40–50 pattern)
    if (score >= 101 && score <= 140) {
      const i = score - 101;
      return { c: { x: c3, y: yOnStraight(dist40[i], true) }, t: { x: 0, y: -1 } };
    }
    if (score >= 141 && score <= 150) {
      const k = score - 141; // 0..9
      const u = 0.18 + (k / 9) * (0.82 - 0.18);
      const c = topArc(c3, c4, u, rTop34);
      const ang = Math.PI - u * Math.PI;
      const t = { x: Math.sin(ang), y: Math.cos(ang) };
      return { c, t };
    }

    // Col4 DOWN 151–190 (40 holes) — S-180-S and 190 on this straight
    if (score >= 151 && score <= 190) {
      const i = score - 151;
      return { c: { x: c4, y: yOnStraight(dist40[i], false) }, t: { x: 0, y: 1 } };
    }

    // Bottom corner 191–200: identical spacing to 91–100 (same radius / u samples).
    // Number 190 stays on the col4 street; curve still labeled 200.
    if (score >= 191 && score <= 200) {
      const k = score - 191; // 0..9
      const u = 0.18 + (k / 9) * (0.82 - 0.18);
      const c = botArc(c4, c5, u, rBot45);
      const ang = Math.PI + u * Math.PI;
      const t = { x: -Math.sin(ang), y: -Math.cos(ang) };
      return { c, t };
    }

    // Short right street UP 201–240 (40 holes)
    if (score >= 201 && score <= 240) {
      const i = score - 201;
      return {
        c: { x: c5, y: yOnStraight(dist40[i], true) },
        t: { x: 0, y: -1 },
      };
    }

    return { c: { x: c5, y: yTop }, t: { x: 0, y: -1 } };
  }

  // Start paddock (4 holes): bring back a notch off the street line, then a rear row.
  // Front pair = score 0 (peg targets). Rear pair drawn via buildStartDecor (second peg each).
  const startY = yBot + p * 2; // back a notch from the street (was 1 pitch)
  const startRearGap = p * 1.15;
  const startOuter = { x: c1 - LANE_HALF, y: startY };
  const startInner = { x: c1 + LANE_HALF, y: startY };

  // Shared win hole 241 — circled, ABOVE 240 and centered on the finish lane midline
  const top240 = yOnStraight(dist40[nStr40 - 1], true);
  const winHole: Pt = { x: c5, y: Math.min(top240, yTop) - 16 };

  function holesForTrack(isOuter: boolean): Pt[] {
    const sign = isOuter ? -1 : 1; // left-of-travel = outer (P0 / red)
    const pts: Pt[] = new Array(HOLES_PER_TRACK);

    pts[0] = isOuter ? { ...startOuter } : { ...startInner };
    pts[TARGET] = { ...winHole };

    for (let s = 1; s <= TRAP_SCORE; s++) {
      const { c, t } = centerAndTangent(s);
      const n = normalFromTangent(t.x, t.y);
      pts[s] = {
        x: c.x + sign * LANE_HALF * n.x,
        y: c.y + sign * LANE_HALF * n.y,
      };
    }
    return pts;
  }

  const outer = holesForTrack(true);
  const inner = holesForTrack(false);

  (outer as Pt[] & { _geom?: GeomCache })._geom = {
    c1, c2, c3, c4, c5, yTop, yBot, rTop12, rBot23, rTop34, rBot45, startY, startRearGap,
  };

  for (const [name, pts] of [
    ['outer', outer],
    ['inner', inner],
  ] as const) {
    if (pts.length !== HOLES_PER_TRACK) {
      throw new Error(`Pegboard ${name}: expected length ${HOLES_PER_TRACK}, got ${pts.length}`);
    }
    for (let i = 0; i < HOLES_PER_TRACK; i++) {
      const pt = pts[i];
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        throw new Error(`Pegboard ${name}: missing hole at score ${i}`);
      }
    }
  }

  return { outer, inner };
}

type GeomCache = {
  c1: number; c2: number; c3: number; c4: number; c5: number;
  yTop: number; yBot: number;
  rTop12: number; rBot23: number; rTop34: number; rBot45: number;
  startY?: number;
  startRearGap?: number;
};

/** Rear start-pair holes (second peg each track), behind score-0 front pair. */
export function buildStartDecor(outer: Pt[], inner: Pt[]): Pt[] {
  const g = (outer as Pt[] & { _geom?: GeomCache })._geom;
  const gap = g?.startRearGap ?? HOLE_PITCH * 2.5;
  return [
    { x: outer[0].x, y: outer[0].y + gap },
    { x: inner[0].x, y: inner[0].y + gap },
  ];
}

/**
 * Decade / street labels — each number once, between the two lanes.
 * Curve apex labels: 50, 100, 150. Bottom-curve label: 200.
 * 190 is a decade on col4 straight (below S-180-S). Short street: 210..240. S only at 180.
 */
export function buildBoardLabels(outer: Pt[], inner: Pt[]): { x: number; y: number; text: string; kind?: 'decade' | 'curve' | 'skunk' }[] {
  const labels: { x: number; y: number; text: string; kind?: 'decade' | 'curve' | 'skunk' }[] = [];

  /** Decade number sits ON the decade hole (between lanes) — never on the next hole/curve. */
  const mid = (s: number): Pt => ({
    x: (outer[s].x + inner[s].x) / 2,
    y: (outer[s].y + inner[s].y) / 2,
  });

  // Left UP: 10..40. Left DOWN: 60..90. Middle UP: 110..140.
  // Col4 DOWN: 160,170,190 (190 on straight below S-180-S). Short right: 210..240.
  const holeDecades = [
    10, 20, 30, 40,
    60, 70, 80, 90,
    110, 120, 130, 140,
    160, 170, 190,
    210, 220, 230, 240,
  ];
  for (const d of holeDecades) {
    const pt = mid(d);
    // Nudge 240 up slightly so the 3-digit label stays readable near the finish
    const y = d === 240 ? pt.y - 3.2 : pt.y;
    labels.push({ x: pt.x, y, text: String(d), kind: 'decade' });
  }

  // Corner exit numbers 50/100/150/200: same location recipe — on their hole (like 50).
  for (const d of [50, 100, 150, 200]) {
    const pt = mid(d);
    labels.push({ x: pt.x, y: pt.y, text: String(d), kind: 'decade' });
  }

  // 180 + S on BOTH outsides of the double track (“S 180 S”)
  const s180 = mid(180);
  labels.push({ x: s180.x, y: s180.y, text: '180', kind: 'decade' });
  const left = outer[180];
  const right = inner[180];
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  labels.push({ x: left.x - nx * 10, y: left.y - ny * 10, text: 'S', kind: 'skunk' });
  labels.push({ x: right.x + nx * 10, y: right.y + ny * 10, text: 'S', kind: 'skunk' });

  return labels;
}

/** Horizontal cap closing below the 2×2 start paddock (under the rear pair). */
export function buildLeftStreetStartCap(outer: Pt[], inner: Pt[]): { x1: number; y1: number; x2: number; y2: number } {
  const decor = buildStartDecor(outer, inner);
  const bottomY = Math.max(outer[0].y, inner[0].y, ...decor.map((d) => d.y));
  const y = bottomY + 3.2;
  const pad = 6.2;
  const leftX = Math.min(outer[0].x, inner[0].x) - pad;
  const rightX = Math.max(outer[0].x, inner[0].x) + pad;
  return { x1: leftX, y1: y, x2: rightX, y2: y };
}

/** Tick/hash lines at mid-decade (light) and decade (darker/thicker) gaps. */
export function buildGroupTicks(
  outer: Pt[],
  inner: Pt[],
): { x1: number; y1: number; x2: number; y2: number; kind: 'mid' | 'decade' }[] {
  const ticks: { x1: number; y1: number; x2: number; y2: number; kind: 'mid' | 'decade' }[] = [];
  const decadeExt = 5.4;
  /** Keep hashes inside the wood face (inner decorative rect sits at 8). */
  const BOARD_PAD = 10;

  const clampTick = (t: { x1: number; y1: number; x2: number; y2: number; kind: 'mid' | 'decade' }) => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return {
      ...t,
      x1: clamp(t.x1, BOARD_PAD, VB_W - BOARD_PAD),
      x2: clamp(t.x2, BOARD_PAD, VB_W - BOARD_PAD),
      y1: clamp(t.y1, BOARD_PAD, VB_H - BOARD_PAD),
      y2: clamp(t.y2, BOARD_PAD, VB_H - BOARD_PAD),
    };
  };

  /** Horizontal hash flush across both lanes (wood-style). */
  const pushHorizontalDecade = (s: number, y: number, opts?: { xShift?: number; rightExtra?: number }) => {
    const o = outer[s];
    const inn = inner[s];
    if (!o || !inn) return;
    const mx = (o.x + inn.x) / 2 + (opts?.xShift ?? 0);
    const laneSpan = Math.hypot(o.x - inn.x, o.y - inn.y) || 2 * 5.4;
    const halfW = laneSpan / 2 + decadeExt;
    const rightExtra = opts?.rightExtra ?? 0;
    ticks.push({
      x1: mx - halfW,
      y1: y,
      x2: mx + halfW + rightExtra,
      y2: y,
      kind: 'decade',
    });
  };

  for (let s = 5; s < TRAP_SCORE; s += 5) {
    if (s + 1 > TRAP_SCORE) break;

    // All four corners follow the 40–50 reference:
    // entry + exit hashes lined up; entry uses 30-style under-gap; exit uses next-street span.
    //   top: 40→50 (exit lanes @51), 140→150 (exit lanes @151)
    //   bot: 90→100 (exit lanes @101), 190→200 (exit lanes @201)
    const cornerPairs: Record<number, { entry: number; exitLane: number; dir: 'top' | 'bot' }> = {
      40: { entry: 40, exitLane: 51, dir: 'top' },
      50: { entry: 40, exitLane: 51, dir: 'top' },
      90: { entry: 90, exitLane: 101, dir: 'bot' },
      100: { entry: 90, exitLane: 101, dir: 'bot' },
      140: { entry: 140, exitLane: 151, dir: 'top' },
      150: { entry: 140, exitLane: 151, dir: 'top' },
      190: { entry: 190, exitLane: 201, dir: 'bot' },
      200: { entry: 190, exitLane: 201, dir: 'bot' },
    };
    if (s in cornerPairs) {
      const { entry, exitLane, dir } = cornerPairs[s];
      const yEntry = (outer[entry].y + inner[entry].y) / 2;
      // Same under-gap magnitude as decade 30→31 (up) / 80→81 (down)
      const underGap =
        dir === 'top'
          ? ((outer[30].y + inner[30].y) / 2 - (outer[31].y + inner[31].y) / 2) / 2
          : ((outer[81].y + inner[81].y) / 2 - (outer[80].y + inner[80].y) / 2) / 2;
      const yShared = dir === 'top' ? yEntry - underGap : yEntry + underGap;
      if (s === entry) {
        pushHorizontalDecade(entry, yShared);
      } else {
        pushHorizontalDecade(exitLane, yShared);
      }
      continue;
    }

    const a0 = outer[s];
    const a1 = outer[s + 1];
    const b0 = inner[s];
    const b1 = inner[s + 1];
    if (!a0 || !a1 || !b0 || !b1) continue;
    const ao = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
    const bi = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
    const mx = (ao.x + bi.x) / 2;
    const my = (ao.y + bi.y) / 2;
    const dx = bi.x - ao.x;
    const dy = bi.y - ao.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const isDecade = s % 10 === 0;
    const ext = isDecade ? decadeExt : 4.2;
    ticks.push({
      x1: mx - nx * (len / 2 + ext),
      y1: my - ny * (len / 2 + ext),
      x2: mx + nx * (len / 2 + ext),
      y2: my + ny * (len / 2 + ext),
      kind: isDecade ? 'decade' : 'mid',
    });
  }
  return ticks.map(clampTick);
}

/**
 * Smooth track corridor from column centerlines + arcs (fixed half-width),
 * matching the real board: left+middle loops, wide bot curve, short col5.
 */
export function buildTrackBorderPath(outer: Pt[], inner: Pt[]): string {
  const g = (outer as Pt[] & { _geom?: GeomCache })._geom;
  const pad = BORDER_HALF;

  if (!g) {
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let s = 1; s <= TRAP_SCORE; s++) {
      const a = outer[s];
      const b = inner[s];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const prev =
        s > 1
          ? { x: (outer[s - 1].x + inner[s - 1].x) / 2, y: (outer[s - 1].y + inner[s - 1].y) / 2 }
          : { x: mx, y: my + 1 };
      const next =
        s < TRAP_SCORE
          ? { x: (outer[s + 1].x + inner[s + 1].x) / 2, y: (outer[s + 1].y + inner[s + 1].y) / 2 }
          : { x: mx, y: my - 1 };
      const n = normalFromTangent(next.x - prev.x, next.y - prev.y);
      left.push({ x: mx + n.x * pad, y: my + n.y * pad });
      right.push({ x: mx - n.x * pad, y: my - n.y * pad });
    }
    const parts: string[] = [];
    for (let i = 0; i < left.length; i++) {
      parts.push(`${i === 0 ? 'M' : 'L'}${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      parts.push(`L${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`);
    }
    parts.push('Z');
    return parts.join(' ');
  }

  const { c1, c2, c3, c4, c5, yTop, yBot, rTop12, rBot23, rTop34, rBot45 } = g;
  const samples: { c: Pt; t: Pt }[] = [];

  const pushLine = (x: number, y0: number, y1: number, steps: number) => {
    const goingDown = y1 > y0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      samples.push({
        c: { x, y: lerp(y0, y1, t) },
        t: { x: 0, y: goingDown ? 1 : -1 },
      });
    }
  };

  const pushTopArc = (leftX: number, rightX: number, radius: number, steps: number, yRail = yTop) => {
    const cx = (leftX + rightX) / 2;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const ang = Math.PI - u * Math.PI;
      samples.push({
        c: { x: cx + radius * Math.cos(ang), y: yRail - radius * Math.sin(ang) },
        t: { x: Math.sin(ang), y: Math.cos(ang) },
      });
    }
  };

  const pushBotArc = (leftX: number, rightX: number, radius: number, steps: number) => {
    const cx = (leftX + rightX) / 2;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const ang = Math.PI + u * Math.PI;
      samples.push({
        c: { x: cx + radius * Math.cos(ang), y: yBot - radius * Math.sin(ang) },
        t: { x: -Math.sin(ang), y: -Math.cos(ang) },
      });
    }
  };

  const mid240 = { x: (outer[240].x + inner[240].x) / 2, y: (outer[240].y + inner[240].y) / 2 };
  // Left street ends at yBot — start paddock sits below, off the track line
  pushLine(c1, yBot, yTop, 28);
  pushTopArc(c1, c2, rTop12, 20);
  pushLine(c2, yTop, yBot, 24);
  pushBotArc(c2, c3, rBot23, 20);
  pushLine(c3, yBot, yTop, 24);
  pushTopArc(c3, c4, rTop34, 20);
  pushLine(c4, yTop, yBot, 24);
  pushBotArc(c4, c5, rBot45, 20);
  pushLine(c5, yBot, mid240.y, 24);

  const left: Pt[] = [];
  const right: Pt[] = [];
  for (const s of samples) {
    const n = normalFromTangent(s.t.x, s.t.y);
    left.push({ x: s.c.x + n.x * pad, y: s.c.y + n.y * pad });
    right.push({ x: s.c.x - n.x * pad, y: s.c.y - n.y * pad });
  }

  const parts: string[] = [];
  for (let i = 0; i < left.length; i++) {
    parts.push(`${i === 0 ? 'M' : 'L'}${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`);
  }
  for (let i = right.length - 1; i >= 0; i--) {
    parts.push(`L${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Polyline points for printed black track midline (center divider between outer/inner). */
export function buildTrackMidline(outer: Pt[], inner: Pt[]): string {
  const parts: string[] = [];
  for (let s = 1; s <= TRAP_SCORE; s++) {
    const x = (outer[s].x + inner[s].x) / 2;
    const y = (outer[s].y + inner[s].y) / 2;
    parts.push(`${s === 1 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(TARGET, score));
}

/** Board zoom scale when the top-right plank toggle is on (paint/view only). */
export const BOARD_ZOOM_SCALE = 2.15;

/**
 * Focus for board zoom: midpoint of both front pegs in viewBox %,
 * used as CSS transform-origin. Paint/view only — does not touch hole math.
 */
export function pegFocusOriginPercent(
  score0: number,
  score1: number,
): { xPct: number; yPct: number } {
  const { outer, inner } = buildHoleMaps();
  const a = outer[clampScore(score0)];
  const b = inner[clampScore(score1)];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return {
    xPct: (mx / VB_W) * 100,
    yPct: (my / VB_H) * 100,
  };
}

/** Peg colors: tone-a = red (You / P0), tone-b = blue (AI / P1) — solid tops, matching rims */
const PEG_FILL: Record<'a' | 'b', { top: string; body: string; rim: string }> = {
  a: { top: '#e53935', body: '#c9a05a', rim: '#8b1e1e' },
  b: { top: '#1e88e5', body: '#c9a05a', rim: '#0d47a1' },
};

function PegPair({
  holes,
  score,
  trapped,
  tone,
  label,
}: {
  holes: Pt[];
  score: number;
  trapped: boolean;
  tone: 'a' | 'b';
  label: string;
}) {
  const [front, setFront] = useState(score);
  const [rear, setRear] = useState(Math.max(0, score));
  const [traveling, setTraveling] = useState(false);
  const frontRef = useRef(front);
  frontRef.current = front;

  useEffect(() => {
    if (score === frontRef.current) return;
    setRear(frontRef.current);
    setFront(score);
    setTraveling(true);
    const t1 = window.setTimeout(() => setTraveling(false), PEG_TRAVEL_MS);
    return () => window.clearTimeout(t1);
  }, [score]);

  const fScore = clampScore(front);
  const rScore = clampScore(rear);
  const f = holes[fScore];
  const r = holes[rScore];
  const colors = PEG_FILL[tone];
  const trapFill = trapped ? '#e04040' : colors.body;
  const trapTop = trapped ? '#ff8a8a' : colors.top;
  const trapRim = trapped ? '#8b1e1e' : colors.rim;

  const sameHole = front === rear;

  /**
   * Same-hole pair: offset along track tangent (centroid on hole).
   * At start (0/0): front stays on score-0 hole; rear sits in the paddock hole behind it.
   */
  let frontDx = 0;
  let frontDy = 0;
  let rearDx = 0;
  let rearDy = 0;
  let rearX = r.x;
  let rearY = r.y;
  if (sameHole && fScore === 0) {
    const g = (holes as Pt[] & { _geom?: GeomCache })._geom;
    const gap = g?.startRearGap ?? HOLE_PITCH * 2.5;
    rearX = f.x;
    rearY = f.y + gap;
  } else if (sameHole) {
    const prev = holes[Math.max(0, fScore - 1)] ?? f;
    const next = holes[Math.min(holes.length - 1, fScore + 1)] ?? f;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    const halfSep = 1.55;
    frontDx = tx * halfSep;
    frontDy = ty * halfSep;
    rearDx = -tx * halfSep;
    rearDy = -ty * halfSep;
  }

  return (
    <g className={`svg-peg-pair tone-${tone}`} aria-label={`${label} pegs`}>
      <g
        className={`svg-peg peg-rear${trapped ? ' peg-trapped' : ''}`}
        transform={`translate(${rearX + rearDx} ${rearY + rearDy})`}
      >
        <title>{`${label} rear: ${rear}`}</title>
        {/* Body centered at hole (0,0) — no upward bias on the geometric center */}
        <circle r={3.2} fill={trapRim} opacity={0.9} />
        <circle r={2.55} fill={trapFill} />
        <circle r={1.35} fill={trapTop} />
        <circle cx={-0.55} cy={-0.45} r={0.4} fill="#fff" opacity={0.35} />
      </g>
      <g
        className={`svg-peg peg-front${trapped ? ' peg-trapped' : ''}${traveling ? ' peg-traveling' : ''}`}
        transform={`translate(${f.x + frontDx} ${f.y + frontDy})`}
        filter={traveling ? 'url(#pegTravelGlow)' : undefined}
      >
        <title>{`${label}: ${front}`}</title>
        <circle r={3.75} fill={trapRim} opacity={0.95} />
        <circle r={3.0} fill={trapFill} />
        <circle r={1.55} fill={trapTop} />
        <circle cx={-0.65} cy={-0.55} r={0.5} fill="#fff" opacity={0.4} />
      </g>
    </g>
  );
}

function ScoreChip({
  label,
  score,
  trapped,
  tone,
}: {
  label: string;
  score: number;
  trapped: boolean;
  tone: 'a' | 'b';
}) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(score);

  useEffect(() => {
    if (score === prev.current) return;
    prev.current = score;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), PEG_TRAVEL_MS + 120);
    return () => window.clearTimeout(t);
  }, [score]);

  return (
    <div className={`board-chip tone-${tone}`}>
      <span className="board-name">{label}</span>
      <span
        className={`board-score${trapped ? ' trapped' : ''}${flash ? ' flash' : ''}`}
        title={trapped ? 'StinkHole — only last-card exact 31 wins' : undefined}
      >
        {score}
        {trapped ? ' 🔒' : ''}
      </span>
    </div>
  );
}

export function Pegboard({
  score0,
  score1,
  trapped,
  label0 = 'P0',
  label1 = 'P1',
  avatar0 = null,
  avatar1 = null,
}: Props) {
  const maps = useMemo(() => buildHoleMaps(), []);
  const labels = useMemo(() => buildBoardLabels(maps.outer, maps.inner), [maps]);
  const ticks = useMemo(() => buildGroupTicks(maps.outer, maps.inner), [maps]);
  const startCap = useMemo(() => buildLeftStreetStartCap(maps.outer, maps.inner), [maps]);
  const borderPath = useMemo(() => buildTrackBorderPath(maps.outer, maps.inner), [maps]);
  const midLine = useMemo(() => buildTrackMidline(maps.outer, maps.inner), [maps]);
  const startDecor = useMemo(() => buildStartDecor(maps.outer, maps.inner), [maps]);
  const [boardZoomed, setBoardZoomed] = useState(false);
  const focus = useMemo(
    () => pegFocusOriginPercent(score0, score1),
    [score0, score1],
  );

  return (
    <div className={`pegboard crib-board${boardZoomed ? ' board-zoomed' : ''}`}>
      <div className="board-side-scores">
        <ScoreChip label={label0} score={score0} trapped={trapped[0]} tone="a" />
        <span className="board-to">→ {TARGET}</span>
        <ScoreChip label={label1} score={score1} trapped={trapped[1]} tone="b" />
      </div>

      <div className="board-plank-with-zoom">
      <div className="board-side-gutter board-side-gutter-left" aria-hidden={!avatar0}>
        {avatar0 ? (
          <div className="board-side-avatar tone-you" title={avatar0.displayName || 'You'}>
            <AvatarView profile={avatar0} size="sm" className="board-side-avatar-img" />
          </div>
        ) : null}
      </div>
      <div className="board-plank-frame">
      <div
        className={`board-wood-plank${boardZoomed ? ' is-zoomed' : ''}`}
        aria-label="Cribbage board"
        style={
          boardZoomed
            ? { transformOrigin: `${focus.xPct}% ${focus.yPct}%` }
            : undefined
        }
      >
        <svg
          className="board-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
        >
          <defs>
            <linearGradient id="woodGrad" x1="0" y1="0" x2="0.08" y2="1">
              <stop offset="0%" stopColor="#f7efdc" />
              <stop offset="22%" stopColor="#f1e4c6" />
              <stop offset="48%" stopColor="#ead7ae" />
              <stop offset="72%" stopColor="#e2cc9a" />
              <stop offset="100%" stopColor="#d8bf8c" />
            </linearGradient>
            {/* Vertical maple grain */}
            <filter id="woodGrain" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9 0.045" numOctaves="5" result="noise" seed="11" />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0.70
                        0 0 0 0 0.55
                        0 0 0 0 0.34
                        0 0 0 0.055 0"
                in="noise"
                result="grain"
              />
              <feBlend in="SourceGraphic" in2="grain" mode="multiply" />
            </filter>
            <filter id="pegTravelGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.6" floodColor="#ffdc78" floodOpacity="0.95" />
              <feDropShadow dx="0" dy="0.9" stdDeviation="1.0" floodColor="#000" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* Maple plank */}
          <rect
            x="3"
            y="3"
            width={VB_W - 6}
            height={VB_H - 6}
            rx="10"
            ry="10"
            fill="url(#woodGrad)"
            filter="url(#woodGrain)"
            stroke="#a88455"
            strokeWidth="1.6"
          />
          <rect
            x="8"
            y="8"
            width={VB_W - 16}
            height={VB_H - 16}
            rx="7"
            ry="7"
            fill="none"
            stroke="rgba(70,45,20,0.12)"
            strokeWidth="0.7"
          />

          {/* Track border (printed black outline of the snake) */}
          <path
            d={borderPath}
            fill="none"
            stroke="#111"
            strokeWidth="1.35"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.92"
          />

          {/* Center divider between the two parallel tracks */}
          <path
            d={midLine}
            fill="none"
            stroke="#111"
            strokeWidth="0.7"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.55"
          />

          {/* Mid-decade ticks (light) + decade hashes (darker/thicker) */}
          {ticks.map((tk, i) => (
            <line
              key={`tick-${i}`}
              x1={tk.x1}
              y1={tk.y1}
              x2={tk.x2}
              y2={tk.y2}
              stroke="#111"
              strokeWidth={tk.kind === 'decade' ? 1.75 : 0.85}
              opacity={tk.kind === 'decade' ? 0.98 : 0.55}
            />
          ))}

          {/* Close LEFT street at the bottom (start), matching the wood photo */}
          <line
            x1={startCap.x1}
            y1={startCap.y1}
            x2={startCap.x2}
            y2={startCap.y2}
            stroke="#111"
            strokeWidth="1.45"
            strokeLinecap="square"
            opacity="0.98"
          />

          {/* Decade / S / curve labels — black print between lanes */}
          {labels.map((lb, i) => (
            <text
              key={`lb-${lb.text}-${i}`}
              x={lb.x}
              y={lb.y}
              className="hole-decade-label"
              fontSize={
                lb.kind === 'skunk'
                  ? 9.5
                  : lb.text.length >= 3
                    ? 4.6 // shrink 100/110/…/240 to fit like 2-digit labels
                    : lb.kind === 'curve'
                      ? 7.2
                      : 6.4
              }
              fill="#111"
              fontWeight="700"
              textAnchor="middle"
              opacity={lb.kind === 'skunk' ? 0.95 : 0.82}
            >
              {lb.text}
            </text>
          ))}

          {/* Scoring holes 1..240 (both lanes) — 241 drawn once as shared win */}
          {maps.outer.map((p, s) => {
            if (s === 0 || s === TARGET) return null;
            const isTrap = s === TRAP_SCORE;
            const isDecade = s % 10 === 0;
            const isGroupEnd = s % 5 === 0;
            return (
              <circle
                key={`o-${s}`}
                cx={p.x}
                cy={p.y}
                r={isTrap ? 1.55 : isDecade ? 1.55 : isGroupEnd ? 1.25 : 1.0}
                className={isTrap ? 'hole-trap' : isDecade ? 'hole-dot hole-decade' : 'hole-dot'}
                {...(isTrap ? { 'aria-label': 'StinkHole' } : {})}
              >
                {isTrap ? <title>StinkHole (240)</title> : null}
              </circle>
            );
          })}

          {maps.inner.map((p, s) => {
            if (s === 0 || s === TARGET) return null;
            const isTrap = s === TRAP_SCORE;
            const isDecade = s % 10 === 0;
            const isGroupEnd = s % 5 === 0;
            return (
              <circle
                key={`i-${s}`}
                cx={p.x}
                cy={p.y}
                r={isTrap ? 1.55 : isDecade ? 1.55 : isGroupEnd ? 1.25 : 1.0}
                className={isTrap ? 'hole-trap' : isDecade ? 'hole-dot hole-decade' : 'hole-dot'}
                {...(isTrap ? { 'aria-label': 'StinkHole' } : {})}
              />
            );
          })}

          {/* Single circled win hole 241 — target / bullseye above 240 */}
          <g className="hole-finish-group">
            <title>Win (241)</title>
            <circle
              cx={maps.outer[TARGET].x}
              cy={maps.outer[TARGET].y}
              r={6.2}
              className="hole-finish-ring"
              fill="none"
              stroke="#111"
              strokeWidth="1.45"
              opacity="0.95"
            />
            <circle
              cx={maps.outer[TARGET].x}
              cy={maps.outer[TARGET].y}
              r={4.3}
              className="hole-finish-ring"
              fill="none"
              stroke="#111"
              strokeWidth="0.85"
              opacity="0.85"
            />
            <circle
              cx={maps.outer[TARGET].x}
              cy={maps.outer[TARGET].y}
              r={2.2}
              className="hole-finish"
            />
            <text
              x={maps.outer[TARGET].x + 11}
              y={maps.outer[TARGET].y + 2.8}
              className="hole-finish-label"
              fontSize="5.2"
              fill="#111"
              fontWeight="800"
            >
              241
            </text>
          </g>

          {/* Start paddock: front score-0 pair + rear pair (4 holes) */}
          <circle cx={maps.outer[0].x} cy={maps.outer[0].y} r="1.35" className="hole-dot" />
          <circle cx={maps.inner[0].x} cy={maps.inner[0].y} r="1.35" className="hole-dot" />
          {startDecor.map((p, i) => (
            <circle key={`start-decor-${i}`} cx={p.x} cy={p.y} r="1.35" className="hole-dot" />
          ))}

          {/* Pegs in SAME SVG as holes — unified viewBox coords */}
          <PegPair holes={maps.outer} score={score0} trapped={trapped[0]} tone="a" label={label0} />
          <PegPair holes={maps.inner} score={score1} trapped={trapped[1]} tone="b" label={label1} />
        </svg>
      </div>
      </div>
      <div className="board-side-gutter board-side-gutter-right">
        <button
          type="button"
          className={`board-zoom-toggle${boardZoomed ? ' is-on' : ''}`}
          aria-pressed={boardZoomed}
          aria-label={boardZoomed ? 'Zoom out to full board' : 'Zoom in on current pegs'}
          title={boardZoomed ? 'Full board' : 'Zoom to pegs'}
          onClick={() => setBoardZoomed((z) => !z)}
        >
          <span className="board-zoom-icon" aria-hidden="true">
            {boardZoomed ? '🔎' : '🔍'}
          </span>
          <span className="board-zoom-label">{boardZoomed ? 'Full' : 'Zoom'}</span>
        </button>
        {avatar1 ? (
          <div className="board-side-avatar tone-opp" title={avatar1.displayName || 'Opponent'}>
            <AvatarView profile={avatar1} size="sm" className="board-side-avatar-img" />
          </div>
        ) : null}
      </div>
      </div>

      <div className="board-footnote">
        StinkHole (240) · only last-card exact 31 · first to {TARGET}
      </div>
    </div>
  );
}
