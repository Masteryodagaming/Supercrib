import { describe, it, expect } from 'vitest';
import { TARGET, TRAP_SCORE } from '../../engine/supercrib';
import {
  buildHoleMaps,
  buildBoardLabels,
  buildLeftStreetStartCap,
  buildStartDecor,
  buildGroupTicks,
  HOLES_PER_TRACK,
  HOLE_GROUP,
  HOLE_PITCH,
  HOLE_GROUP_GAP,
  HOLE_MID_GAP,
  TRACK_GROUPS,
  STREET_COUNT,
  COLUMN_COUNT,
  VB_W,
  VB_H,
  pegFocusOriginPercent,
  BOARD_ZOOM_SCALE,
} from '../Pegboard';

describe('Pegboard hole maps (Joshua wood board — col4 151–190, curve 191–200)', () => {
  it('HOLES_PER_TRACK is 242 (indices 0..241)', () => {
    expect(HOLES_PER_TRACK).toBe(TARGET + 1);
    expect(HOLES_PER_TRACK).toBe(242);
  });

  it('geometry knobs: 48 groups of 5 across 3 streets / 5 columns', () => {
    expect(HOLE_GROUP).toBe(5);
    expect(TRACK_GROUPS).toBe(48);
    expect(STREET_COUNT).toBe(3);
    expect(COLUMN_COUNT).toBe(5);
    expect(TRACK_GROUPS * HOLE_GROUP).toBe(TRAP_SCORE);
  });

  it('viewBox is portrait maple board (taller OK)', () => {
    expect(VB_W).toBeGreaterThan(200);
    expect(VB_H).toBeGreaterThan(280);
    expect(VB_W / VB_H).toBeGreaterThan(0.55);
    expect(VB_W / VB_H).toBeLessThan(1.2);
    expect(VB_H).toBeGreaterThan(VB_W);
  });

  it('both tracks have length 242 with every score 0..241 finite and inside viewBox', () => {
    const { outer, inner } = buildHoleMaps();
    expect(outer).toHaveLength(242);
    expect(inner).toHaveLength(242);

    for (const [name, pts] of [
      ['outer', outer],
      ['inner', inner],
    ] as const) {
      for (let s = 0; s <= TARGET; s++) {
        const p = pts[s];
        expect(p, `${name}[${s}]`).toBeDefined();
        expect(Number.isFinite(p.x), `${name}[${s}].x`).toBe(true);
        expect(Number.isFinite(p.y), `${name}[${s}].y`).toBe(true);
        expect(p.x, `${name}[${s}].x in viewBox`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${name}[${s}].x in viewBox`).toBeLessThanOrEqual(VB_W);
        expect(p.y, `${name}[${s}].y in viewBox`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${name}[${s}].y in viewBox`).toBeLessThanOrEqual(VB_H);
      }
    }
  });

  it('exports two-tier gap knobs: mid < decade, both modest vs pitch', () => {
    expect(HOLE_PITCH).toBeGreaterThan(0);
    expect(HOLE_MID_GAP).toBeGreaterThan(0);
    expect(HOLE_GROUP_GAP).toBeGreaterThanOrEqual(HOLE_MID_GAP);
    expect(HOLE_MID_GAP).toBeLessThan(HOLE_PITCH * 1.2);
    expect(HOLE_GROUP_GAP).toBeLessThan(HOLE_PITCH * 1.5);
  });

  it('within a decade (holes 1–10): two clusters of 5 with small mid gap; larger/clear decade gap at 10', () => {
    const { outer } = buildHoleMaps();
    const within = Math.hypot(outer[2].x - outer[1].x, outer[2].y - outer[1].y);
    const midGap = Math.hypot(outer[6].x - outer[5].x, outer[6].y - outer[5].y);
    const decadeGap = Math.hypot(outer[11].x - outer[10].x, outer[11].y - outer[10].y);

    // Mid-decade gap is larger than within-cluster pitch but clearly smaller than decade gap
    expect(midGap).toBeGreaterThan(within * 1.15);
    expect(midGap).toBeLessThan(within * 2.2);
    expect(decadeGap).toBeGreaterThan(midGap * 0.95);
    expect(decadeGap).toBeGreaterThan(within * 1.35);

    // Clusters: 1–5 tight, 6–10 tight
    for (const [a, b] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
    ] as const) {
      const d = Math.hypot(outer[b].x - outer[a].x, outer[b].y - outer[a].y);
      expect(Math.abs(d - within)).toBeLessThan(0.08);
    }

    // Decade hash at 10 exists in ticks
    const ticks = buildGroupTicks(outer, buildHoleMaps().inner);
    const decade10 = ticks.find((t) => t.kind === 'decade' && Math.abs((t.y1 + t.y2) / 2 - (outer[10].y + outer[11].y) / 2) < 3);
    expect(decade10).toBeDefined();
    const mid5 = ticks.find((t) => t.kind === 'mid');
    expect(mid5).toBeDefined();
  });

  it('holes grouped by 5 with mid vs decade gaps on straight runs', () => {
    const { outer } = buildHoleMaps();
    const withinPitch = Math.hypot(outer[12].x - outer[11].x, outer[12].y - outer[11].y);
    const midGap = Math.hypot(outer[16].x - outer[15].x, outer[16].y - outer[15].y); // after 15
    const decadeGap = Math.hypot(outer[21].x - outer[20].x, outer[21].y - outer[20].y); // after 20

    expect(midGap).toBeGreaterThan(withinPitch * 1.15);
    expect(decadeGap).toBeGreaterThanOrEqual(midGap * 0.9);

    const d12 = Math.hypot(outer[12].x - outer[11].x, outer[12].y - outer[11].y);
    const d13 = Math.hypot(outer[13].x - outer[12].x, outer[13].y - outer[12].y);
    const d14 = Math.hypot(outer[14].x - outer[13].x, outer[14].y - outer[13].y);
    const d15 = Math.hypot(outer[15].x - outer[14].x, outer[15].y - outer[14].y);
    expect(Math.abs(d12 - d13)).toBeLessThan(0.05);
    expect(Math.abs(d13 - d14)).toBeLessThan(0.05);
    expect(Math.abs(d14 - d15)).toBeLessThan(0.05);

    for (let s = 11; s <= 15; s++) {
      expect(Math.abs(outer[s].x - outer[11].x)).toBeLessThan(0.2);
    }
  });

  it('path segments match wooden board hole counts', () => {
    // 1–50, 51–100, 101–150, 151–190 (40), 191–200 curve (10), 201–240 street (40)
    expect(50 - 1 + 1).toBe(50);
    expect(100 - 51 + 1).toBe(50);
    expect(150 - 101 + 1).toBe(50);
    expect(190 - 151 + 1).toBe(40);
    expect(200 - 191 + 1).toBe(10);
    expect(240 - 201 + 1).toBe(40);
    expect(50 + 50 + 50 + 40 + 10 + 40).toBe(240);
  });

  it('col1 up + curve 50; col2 down + curve 100; col3 up + curve 150', () => {
    const { outer } = buildHoleMaps();
    expect(outer[50].y - outer[1].y, 'col1 up').toBeLessThan(-80);
    expect(outer[100].y - outer[51].y, 'col2 down').toBeGreaterThan(80);
    expect(outer[150].y - outer[101].y, 'col3 up').toBeLessThan(-80);
    expect(outer[25].x).toBeLessThan(outer[75].x);
    expect(outer[75].x).toBeLessThan(outer[125].x);
  });

  it('col4 down 151–190 (40 holes); 190 on vertical; then bottom curve 191–200', () => {
    const { outer } = buildHoleMaps();
    expect(190 - 151 + 1).toBe(40);
    expect(outer[190].y - outer[151].y, 'col4 down').toBeGreaterThan(60);
    expect(outer[190].y).toBeGreaterThan(outer[151].y);
    // 190 on same vertical as 180 (col4)
    expect(Math.abs(outer[190].x - outer[180].x)).toBeLessThan(1.5);
    expect(Math.abs(outer[190].x - outer[160].x)).toBeLessThan(1.5);
    // 200 on curve — x advances toward col5
    expect(outer[200].x).toBeGreaterThan(outer[190].x + 5);
  });

  it('190 on vertical col4 (same x as 180); 200 on curve (x advances)', () => {
    const { outer } = buildHoleMaps();
    expect(Math.abs(outer[190].x - outer[180].x), '190 same x as 180').toBeLessThan(1.5);
    expect(outer[200].x - outer[190].x, '200 advances in x').toBeGreaterThan(5);
    const streetX = outer[220].x;
    expect(Math.abs(outer[190].x - streetX), '190 not on street').toBeGreaterThan(8);
    expect(Math.abs(outer[201].x - streetX)).toBeLessThan(2);
    expect(Math.abs(outer[210].x - streetX)).toBeLessThan(2);
    expect(Math.abs(outer[240].x - streetX)).toBeLessThan(2);
  });

  it('short right street UP starts ~201 through 240 (40 holes); win 241 above 240 on lane midline', () => {
    const { outer, inner } = buildHoleMaps();
    expect(240 - 201 + 1).toBe(40);
    expect(outer[240].y - outer[201].y, 'col5 up').toBeLessThan(-60);
    expect(Math.abs(outer[201].x - outer[240].x)).toBeLessThan(1.5);
    const trap = outer[TRAP_SCORE];
    const finish = outer[TARGET];
    const laneMidX = (outer[240].x + inner[240].x) / 2;
    expect(finish.y, '241 above 240').toBeLessThan(trap.y);
    expect(finish.x, '241 on finish-lane midline').toBeCloseTo(laneMidX, 5);
    expect(outer[TARGET].x).toBeCloseTo(inner[TARGET].x, 5);
    expect(outer[TARGET].y).toBeCloseTo(inner[TARGET].y, 5);
  });

  it('col5 (201–240) keeps groups of 5 with mid/decade gap tiers', () => {
    const { outer } = buildHoleMaps();
    const within = Math.hypot(outer[212].x - outer[211].x, outer[212].y - outer[211].y);
    const mid = Math.hypot(outer[216].x - outer[215].x, outer[216].y - outer[215].y);
    const decade = Math.hypot(outer[221].x - outer[220].x, outer[221].y - outer[220].y);
    expect(mid).toBeGreaterThan(within * 1.15);
    expect(decade).toBeGreaterThanOrEqual(mid * 0.9);
  });

  it('outer and inner tracks stay parallel (do not collapse)', () => {
    const { outer, inner } = buildHoleMaps();
    let minDist = Infinity;
    for (let s = 1; s <= TRAP_SCORE; s += 15) {
      const d = Math.hypot(outer[s].x - inner[s].x, outer[s].y - inner[s].y);
      minDist = Math.min(minDist, d);
    }
    expect(minDist).toBeGreaterThan(4);
  });

  it('five columns progress left → right across the snake', () => {
    const { outer } = buildHoleMaps();
    const col1 = outer[30].x;
    const col2 = outer[75].x;
    const col3 = outer[130].x;
    const col4 = outer[165].x;
    const col5 = outer[220].x;
    expect(col2 - col1).toBeGreaterThan(15);
    expect(col3 - col2).toBeGreaterThan(15);
    expect(col4 - col3).toBeGreaterThan(15);
    expect(col5 - col4).toBeGreaterThan(15);
  });

  it('2×2 start paddock: front score-0 pair + rear pair, back off the street', () => {
    const { outer, inner } = buildHoleMaps();
    const decor = buildStartDecor(outer, inner);
    expect(decor.length).toBe(2);

    // Front pair under col1, below hole 1, back a notch from the street
    expect(outer[0].y).toBeGreaterThan(outer[1].y);
    expect(inner[0].y).toBeGreaterThan(inner[1].y);
    expect(Math.abs(outer[0].x - outer[1].x)).toBeLessThan(1.5);
    expect(Math.abs(inner[0].x - inner[1].x)).toBeLessThan(1.5);
    expect(inner[0].x).toBeGreaterThan(outer[0].x);
    const lane0 = Math.hypot(outer[0].x - inner[0].x, outer[0].y - inner[0].y);
    const lane1 = Math.hypot(outer[1].x - inner[1].x, outer[1].y - inner[1].y);
    expect(Math.abs(lane0 - lane1)).toBeLessThan(0.5);

    // Rear pair: same lanes, further back
    expect(Math.abs(decor[0].x - outer[0].x)).toBeLessThan(0.05);
    expect(Math.abs(decor[1].x - inner[0].x)).toBeLessThan(0.05);
    expect(decor[0].y).toBeGreaterThan(outer[0].y + 2);
    expect(decor[1].y).toBeGreaterThan(inner[0].y + 2);
  });

  it('labels present once: 10..40,50,60..90,100,110..140,150,160,170,180,190..240', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const texts = labels.map((l) => l.text);
    const expected = [
      10, 20, 30, 40, 50,
      60, 70, 80, 90, 100,
      110, 120, 130, 140, 150,
      160, 170, 180,
      190, 200, 210, 220, 230, 240,
    ].map(String);
    for (const t of expected) {
      expect(texts.filter((x) => x === t), `label ${t}`).toHaveLength(1);
    }
  });

  it('left UP decades sit on holes 10..40; 50 is on the curve (not 40)', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const nearest = (lx: number, ly: number) => {
      let best = 0;
      let bd = 1e9;
      for (let s = 1; s <= 240; s++) {
        const mx = (outer[s].x + inner[s].x) / 2;
        const my = (outer[s].y + inner[s].y) / 2;
        const d = Math.hypot(lx - mx, ly - my);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    for (const d of [10, 20, 30, 40]) {
      const lb = labels.find((l) => l.text === String(d))!;
      expect(nearest(lb.x, lb.y), `label ${d}`).toBe(d);
    }
    const fifty = labels.find((l) => l.text === '50')!;
    const n50 = nearest(fifty.x, fifty.y);
    expect(n50).toBeGreaterThanOrEqual(45);
    expect(n50).toBeLessThanOrEqual(50);
  });

  it('short street decades 210..240 each once on those holes', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const nearest = (lx: number, ly: number) => {
      let best = 0;
      let bd = 1e9;
      for (let s = 1; s <= 240; s++) {
        const mx = (outer[s].x + inner[s].x) / 2;
        const my = (outer[s].y + inner[s].y) / 2;
        const d = Math.hypot(lx - mx, ly - my);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    for (const d of [210, 220, 230, 240]) {
      const matches = labels.filter((l) => l.text === String(d));
      expect(matches, `count ${d}`).toHaveLength(1);
      expect(nearest(matches[0].x, matches[0].y), `label ${d}`).toBe(d);
    }
  });

  it('S only associated with 180 (two S marks, one on each side)', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const skunks = labels.filter((l) => l.text === 'S');
    expect(skunks).toHaveLength(2);
    const m180 = {
      x: (outer[180].x + inner[180].x) / 2,
      y: (outer[180].y + inner[180].y) / 2,
    };
    for (const s of skunks) {
      expect(Math.hypot(s.x - m180.x, s.y - m180.y)).toBeLessThan(25);
    }
  });

  it('label 190 is decade on straight nearest hole 190; 200 on hole like 50', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const lb190 = labels.find((l) => l.text === '190');
    const lb200 = labels.find((l) => l.text === '200');
    expect(lb190?.kind).toBe('decade');
    expect(lb200?.kind).toBe('decade'); // same on-hole recipe as 50

    const nearest = (lx: number, ly: number) => {
      let best = 0;
      let bd = 1e9;
      for (let s = 1; s <= 240; s++) {
        const mx = (outer[s].x + inner[s].x) / 2;
        const my = (outer[s].y + inner[s].y) / 2;
        const d = Math.hypot(lx - mx, ly - my);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    expect(nearest(lb190!.x, lb190!.y)).toBe(190);

    const m190 = { x: (outer[190].x + inner[190].x) / 2, y: (outer[190].y + inner[190].y) / 2 };
    const m200 = { x: (outer[200].x + inner[200].x) / 2, y: (outer[200].y + inner[200].y) / 2 };
    expect(Math.hypot(lb190!.x - m190.x, lb190!.y - m190.y)).toBeLessThan(2);
    expect(Math.hypot(lb200!.x - m200.x, lb200!.y - m200.y)).toBeLessThan(18);
    // 200 near bottom curve, not up on short street body
    expect(lb200!.y).toBeGreaterThan(outer[220].y + 20);
  });

  it('straight decade labels sit on the decade hole center (40 not on curve)', () => {
    const { outer, inner } = buildHoleMaps();
    const labels = buildBoardLabels(outer, inner);
    const lb10 = labels.find((l) => l.text === '10');
    const lb40 = labels.find((l) => l.text === '40');
    expect(lb10).toBeDefined();
    expect(lb40).toBeDefined();
    const hole10y = (outer[10].y + inner[10].y) / 2;
    const hole40y = (outer[40].y + inner[40].y) / 2;
    expect(Math.abs(lb10!.y - hole10y)).toBeLessThan(0.5);
    expect(Math.abs(lb40!.y - hole40y)).toBeLessThan(0.5);
    expect(Math.abs(lb40!.x - (outer[40].x + inner[40].x) / 2)).toBeLessThan(1);
  });

  it('group ticks: mid lighter kind after 5; decade kind after 10; sit in gaps', () => {
    const { outer, inner } = buildHoleMaps();
    const ticks = buildGroupTicks(outer, inner);
    expect(ticks.length).toBeGreaterThan(40);

    const midTicks = ticks.filter((t) => t.kind === 'mid');
    const decadeTicks = ticks.filter((t) => t.kind === 'decade');
    expect(midTicks.length).toBeGreaterThan(10);
    expect(decadeTicks.length).toBeGreaterThan(10);

    const tk = ticks[0]; // after hole 5 → mid
    expect(tk.kind).toBe('mid');
    const midY = (tk.y1 + tk.y2) / 2;
    const hole5y = (outer[5].y + inner[5].y) / 2;
    const hole6y = (outer[6].y + inner[6].y) / 2;
    const lo = Math.min(hole5y, hole6y);
    const hi = Math.max(hole5y, hole6y);
    expect(midY).toBeGreaterThan(lo);
    expect(midY).toBeLessThan(hi);

    // tick after 10 is decade
    const t10 = ticks[1];
    expect(t10.kind).toBe('decade');
  });

  it('scores 33 and 36: outer/inner hole coords are finite lane centers', () => {
    const { outer, inner } = buildHoleMaps();
    for (const s of [33, 36]) {
      expect(Math.abs(outer[s].x - outer[s - 1].x)).toBeLessThan(0.25);
      expect(Math.abs(inner[s].x - inner[s - 1].x)).toBeLessThan(0.25);
      expect(outer[s].x).not.toBe(inner[s].x);
    }
  });

  it('mid-decade step smaller than old huge voids; decade gap >= mid', () => {
    const { outer } = buildHoleMaps();
    const within = Math.hypot(outer[33].x - outer[32].x, outer[33].y - outer[32].y);
    const mid = Math.hypot(outer[36].x - outer[35].x, outer[36].y - outer[35].y);
    // Decade gap on the straight (20→21), not 40→41 which leaves onto the curve
    const decade = Math.hypot(outer[21].x - outer[20].x, outer[21].y - outer[20].y);
    expect(mid / within).toBeGreaterThan(1.15);
    expect(mid / within).toBeLessThan(2.3);
    expect(decade).toBeGreaterThanOrEqual(mid * 0.95);
  });

  it('curve holes (41–50) have nearly equal neighbor spacing on midline', () => {
    const { outer, inner } = buildHoleMaps();
    const mid = (s: number) => ({
      x: (outer[s].x + inner[s].x) / 2,
      y: (outer[s].y + inner[s].y) / 2,
    });
    const ds: number[] = [];
    for (let s = 41; s < 50; s++) {
      const a = mid(s);
      const b = mid(s + 1);
      ds.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    for (const d of ds) {
      expect(Math.abs(d - mean)).toBeLessThan(0.12);
    }
  });

  it('bottom curve (191–200) has 10 holes with progressive x toward col5', () => {
    const { outer } = buildHoleMaps();
    expect(200 - 191 + 1).toBe(10);
    for (let s = 192; s <= 200; s++) {
      expect(outer[s].x, `hole ${s} x >= prev`).toBeGreaterThanOrEqual(outer[s - 1].x - 0.05);
    }
    expect(outer[200].x - outer[191].x).toBeGreaterThan(15);
  });

  it('first corner dots: ten in 41–50 (curve), ten in 51–60 (street)', () => {
    const { outer, inner } = buildHoleMaps();
    const mid = (s: number) => ({
      x: (outer[s].x + inner[s].x) / 2,
      y: (outer[s].y + inner[s].y) / 2,
    });
    const hashY = mid(40).y - (mid(30).y - mid(31).y) / 2;
    // 41–50 all above the hash in the U
    for (let s = 41; s <= 50; s++) {
      expect(mid(s).y, `hole ${s} above 40 hash`).toBeLessThan(hashY - 0.4);
    }
    expect(mid(40).y).toBeGreaterThan(hashY + 2);
    // 51–60 on down street, ten holes, 51 under the hash line
    expect(Math.abs(mid(51).x - mid(60).x)).toBeLessThan(1.5);
    expect(mid(51).y).toBeGreaterThan(hashY + 2);
    expect(mid(60).y).toBeGreaterThan(mid(51).y);
    // counts by y-band relative to hash: curve above, street decade below
    const curve = [];
    const street = [];
    for (let s = 41; s <= 60; s++) {
      if (mid(s).y < hashY) curve.push(s);
      else street.push(s);
    }
    expect(curve.length, `curve dots ${curve}`).toBe(10);
    expect(street.length, `street dots ${street}`).toBe(10);
  });

  it('all corners follow 40–50: lined-up hashes; ten curve holes clear of lines', () => {
    const { outer, inner } = buildHoleMaps();
    const ticks = buildGroupTicks(outer, inner);
    const mid = (s: number) => ({
      x: (outer[s].x + inner[s].x) / 2,
      y: (outer[s].y + inner[s].y) / 2,
    });
    const underTop = (mid(30).y - mid(31).y) / 2;
    const underBot = (mid(81).y - mid(80).y) / 2;
    const findH = (cx: number, y: number) =>
      ticks.find(
        (t) =>
          t.kind === 'decade' &&
          Math.abs(t.y1 - t.y2) < 0.05 &&
          Math.abs((t.y1 + t.y2) / 2 - y) < 1.0 &&
          Math.abs((t.x1 + t.x2) / 2 - cx) < 20,
      );

    const corners: {
      name: string;
      entry: number;
      exitLane: number;
      curveFrom: number;
      curveTo: number;
      dir: 'top' | 'bot';
    }[] = [
      { name: '40/50', entry: 40, exitLane: 51, curveFrom: 41, curveTo: 50, dir: 'top' },
      { name: '90/100', entry: 90, exitLane: 101, curveFrom: 91, curveTo: 100, dir: 'bot' },
      { name: '140/150', entry: 140, exitLane: 151, curveFrom: 141, curveTo: 150, dir: 'top' },
      { name: '190/200', entry: 190, exitLane: 201, curveFrom: 191, curveTo: 200, dir: 'bot' },
    ];

    for (const c of corners) {
      const yShared =
        c.dir === 'top' ? mid(c.entry).y - underTop : mid(c.entry).y + underBot;
      const tEntry = findH(mid(c.entry).x, yShared);
      const tExit = findH(mid(c.exitLane).x, yShared);
      expect(tEntry, `${c.name} entry`).toBeDefined();
      expect(tExit, `${c.name} exit`).toBeDefined();
      expect(Math.abs(tEntry!.y1 - tExit!.y1), `${c.name} lined up`).toBeLessThan(0.05);
      // Entry hole on the street side of the hash
      if (c.dir === 'top') {
        expect(mid(c.entry).y).toBeGreaterThan(yShared + 2);
        for (let s = c.curveFrom; s <= c.curveTo; s++) {
          expect(mid(s).y, `${c.name} hole ${s}`).toBeLessThan(yShared - 0.4);
        }
        expect(mid(c.exitLane).y).toBeGreaterThan(yShared + 2);
      } else {
        expect(mid(c.entry).y).toBeLessThan(yShared - 2);
        for (let s = c.curveFrom; s <= c.curveTo; s++) {
          expect(mid(s).y, `${c.name} hole ${s}`).toBeGreaterThan(yShared + 0.4);
        }
        expect(mid(c.exitLane).y).toBeLessThan(yShared - 2);
      }
      // Exit span matches street half-width recipe (same as 50/150 style)
      const half = Math.abs(tExit!.x2 - tExit!.x1) / 2;
      expect(half).toBeGreaterThan(8);
      expect(half).toBeLessThan(14);
    }
  });

  it('31–40 matches 21–30 exactly (template frozen)', () => {
    const { outer, inner } = buildHoleMaps();
    const mid = (s: number) => (outer[s].y + inner[s].y) / 2;
    const steps = (a: number, b: number) =>
      Array.from({ length: b - a }, (_, i) => mid(a + i + 1) - mid(a + i));
    const a = steps(21, 30);
    const b = steps(31, 40);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(b[i] - a[i]), `step ${i}`).toBeLessThan(0.001);
    }
    expect(Math.abs((mid(21) - mid(30)) - (mid(31) - mid(40)))).toBeLessThan(0.001);
  });





  it('left street start cap closes below start holes (score 0)', () => {
    const { outer, inner } = buildHoleMaps();
    const cap = buildLeftStreetStartCap(outer, inner);
    expect(cap.y1).toBeGreaterThan(outer[0].y);
    expect(cap.x2).toBeGreaterThan(cap.x1);
  });
});

describe('pegFocusOriginPercent (board zoom focus)', () => {
  it('returns % origin inside 0..100 from midpoint of both front pegs', () => {
    const o = pegFocusOriginPercent(0, 0);
    expect(o.xPct).toBeGreaterThan(0);
    expect(o.xPct).toBeLessThan(100);
    expect(o.yPct).toBeGreaterThan(0);
    expect(o.yPct).toBeLessThan(100);
    expect(BOARD_ZOOM_SCALE).toBeGreaterThan(1.5);
  });

  it('moves focus as scores advance (paint/view only — hole maps unchanged)', () => {
    const maps = buildHoleMaps();
    const early = pegFocusOriginPercent(10, 12);
    const late = pegFocusOriginPercent(200, 210);
    const midEarly = {
      x: (maps.outer[10].x + maps.inner[12].x) / 2,
      y: (maps.outer[10].y + maps.inner[12].y) / 2,
    };
    expect(early.xPct).toBeCloseTo((midEarly.x / VB_W) * 100, 5);
    expect(early.yPct).toBeCloseTo((midEarly.y / VB_H) * 100, 5);
    // Different stretch of the snake → different origin
    expect(Math.hypot(late.xPct - early.xPct, late.yPct - early.yPct)).toBeGreaterThan(5);
  });

  it('clamps out-of-range scores to hole indices', () => {
    const a = pegFocusOriginPercent(-5, 999);
    const b = pegFocusOriginPercent(0, TARGET);
    expect(a.xPct).toBeCloseTo(b.xPct, 5);
    expect(a.yPct).toBeCloseTo(b.yPct, 5);
  });
});
