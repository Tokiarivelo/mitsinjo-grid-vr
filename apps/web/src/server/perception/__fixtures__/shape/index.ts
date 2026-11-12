/**
 * Golden set for the 3D shape math (PF-T9): five synthetic street photos (sky, road, one object), drawn
 * as SVG and encoded to JPEG by the test (no binary in the repo), with the expected SAM outline, the true
 * colours and, for the cottage row, the gable count. Spark's prior is deliberately wrong (colours, one
 * house) so the test proves the measurements win.
 */
import type { ObjectKit } from '@/lib/object-kit';

type Pt = [number, number];
export const PHOTO = { width: 320, height: 240 } as const;
const SKY = '#8fb8de';
const ROAD = '#6b6b6b';

/** Where a reference case comes from (PQ-T1): a drawn street (`synthetic`) or a captured photo (`real`). */
export type ShapeFixtureKind = 'real' | 'synthetic';

export interface GoldenCase {
  kind: 'synthetic';
  name: string;
  /** Object box in photo pixels. */
  px: { x: number; y: number; w: number; h: number };
  /** Drawing inside the box, box fractions (x right, y down): polygons with their fill. */
  shapes: Array<{ fill: string; points: Pt[] }>;
  /** Expected outline (what SAM returns), box fractions. */
  outline: Pt[];
  /** Spark's (wrong) answer. */
  prior: ObjectKit;
  expect: { main: string; secondary?: string; gables?: number };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const WRONG = { main: '#ffffff', secondary: '#000000', accent: '#ff00ff' };

const STONE = '#c8aa78';
const SLATE = '#5f5a55';
function cottageRow(n: number, eave: number): GoldenCase {
  const outline: Pt[] = [
    [0, 1],
    [1, 1],
    [1, eave],
  ];
  for (let i = n - 1; i >= 0; i--) outline.push([(i + 0.5) / n, 0], [i / n, eave]);
  const shapes: GoldenCase['shapes'] = [{ fill: STONE, points: rect(0, eave, 1, 1) }];
  for (let i = 0; i < n; i++) {
    shapes.push({
      fill: SLATE,
      points: [
        [i / n, eave],
        [(i + 0.5) / n, 0],
        [(i + 1) / n, eave],
      ],
    });
    shapes.push({ fill: '#2a2a2a', points: rect((i + 0.6) / n, 0.6, (i + 0.8) / n, 0.75) });
  }
  return {
    kind: 'synthetic',
    name: 'cottage row',
    px: { x: 40, y: 60, w: 240, h: 120 },
    shapes,
    outline,
    prior: {
      archetype: 'house',
      proportions: { w: 1, h: 0.5, d: 0.4 },
      colors: WRONG,
      materials: { main: 'stone', secondary: 'slate', accent: 'glass' },
      details: { units: 1, windows: 2 },
    },
    expect: { main: STONE, secondary: SLATE, gables: n },
  };
}

const POLE = '#3a3f44';
const lampPost: GoldenCase = {
  kind: 'synthetic',
  name: 'lamp post',
  px: { x: 150, y: 40, w: 40, h: 160 },
  shapes: [
    { fill: POLE, points: rect(0.42, 0.12, 0.58, 0.97) },
    { fill: '#f2d68a', points: rect(0.05, 0.02, 0.95, 0.18) },
    { fill: POLE, points: rect(0.3, 0.94, 0.7, 1) },
  ],
  outline: [
    [0.05, 0.02],
    [0.95, 0.02],
    [0.95, 0.18],
    [0.58, 0.18],
    [0.58, 0.94],
    [0.7, 0.94],
    [0.7, 1],
    [0.3, 1],
    [0.3, 0.94],
    [0.42, 0.94],
    [0.42, 0.18],
    [0.05, 0.18],
  ],
  prior: {
    archetype: 'lamp_post',
    proportions: { w: 0.2, h: 1, d: 0.2 },
    colors: WRONG,
    materials: { main: 'metal', secondary: 'metal', accent: 'glass' },
  },
  expect: { main: POLE },
};

const WHITE = '#e8eaec';
const fridge: GoldenCase = {
  kind: 'synthetic',
  name: 'fridge',
  px: { x: 120, y: 40, w: 80, h: 160 },
  shapes: [
    { fill: WHITE, points: rect(0, 0, 1, 1) },
    { fill: '#8a939c', points: rect(0.85, 0.3, 0.9, 0.55) },
  ],
  outline: rect(0, 0, 1, 1),
  prior: {
    archetype: 'cabinet',
    proportions: { w: 0.5, h: 1, d: 0.5 },
    colors: WRONG,
    materials: { accent: 'plastic' }, // enamelled body: no material (painted)
  },
  expect: { main: WHITE },
};

const RED = '#b03030';
const car: GoldenCase = {
  kind: 'synthetic',
  name: 'car',
  px: { x: 60, y: 130, w: 200, h: 80 },
  shapes: [
    { fill: RED, points: rect(0, 0.3, 1, 0.82) },
    { fill: '#8fa3b5', points: rect(0.2, 0, 0.75, 0.3) },
    { fill: '#1c1c1c', points: rect(0.12, 0.82, 0.38, 1) },
    { fill: '#1c1c1c', points: rect(0.62, 0.82, 0.88, 1) },
  ],
  outline: [
    [0, 0.3],
    [0.2, 0.3],
    [0.2, 0],
    [0.75, 0],
    [0.75, 0.3],
    [1, 0.3],
    [1, 0.82],
    [0.88, 0.82],
    [0.88, 1],
    [0.62, 1],
    [0.62, 0.82],
    [0.38, 0.82],
    [0.38, 1],
    [0.12, 1],
    [0.12, 0.82],
    [0, 0.82],
  ],
  prior: {
    archetype: 'vehicle',
    proportions: { w: 1, h: 0.4, d: 0.45 },
    colors: WRONG,
    materials: { main: 'metal', secondary: 'metal', accent: 'glass' },
    details: { wheels: 4 },
  },
  expect: { main: RED },
};

const LEAVES = '#3f7a35';
const BARK = '#6b4a2b';
function treeOutline(): Pt[] {
  const [cx, cy, rx, ry] = [0.5, 0.34, 0.5, 0.32];
  const half = 0.07;
  const d = Math.asin(half / rx);
  const pts: Pt[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI / 2 + d + ((2 * Math.PI - 2 * d) * i) / n;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  pts.push([cx + half, 1], [cx - half, 1]);
  return pts;
}
const tree: GoldenCase = {
  kind: 'synthetic',
  name: 'tree',
  px: { x: 100, y: 30, w: 120, h: 180 },
  shapes: [
    { fill: BARK, points: rect(0.43, 0.6, 0.57, 1) },
    { fill: LEAVES, points: treeOutline().slice(0, -2) },
  ],
  outline: treeOutline(),
  prior: {
    archetype: 'tree',
    proportions: { w: 0.7, h: 1, d: 0.7 },
    colors: WRONG,
    materials: { main: 'foliage', secondary: 'wood' },
  },
  expect: { main: LEAVES, secondary: BARK },
};

export const GOLDEN_SHAPES: GoldenCase[] = [cottageRow(4, 0.45), lampPost, fridge, car, tree];

const toPx = (c: GoldenCase, [x, y]: Pt) =>
  `${(c.px.x + x * c.px.w).toFixed(2)},${(c.px.y + y * c.px.h).toFixed(2)}`;

/** The case drawn on a street: sky above the horizon, road below. */
export function goldenSvg(c: GoldenCase): string {
  const { width, height } = PHOTO;
  const polys = c.shapes
    .map((s) => `<polygon fill="${s.fill}" points="${s.points.map((p) => toPx(c, p)).join(' ')}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="${width}" height="${height * 0.75}" fill="${SKY}"/>
<rect y="${height * 0.75}" width="${width}" height="${height * 0.25}" fill="${ROAD}"/>${polys}</svg>`;
}

/** Outline as a SAM path in photo fractions. */
export function goldenOutline(c: GoldenCase): string {
  const f = ([x, y]: Pt) =>
    `${((c.px.x + x * c.px.w) / PHOTO.width).toFixed(4)} ${((c.px.y + y * c.px.h) / PHOTO.height).toFixed(4)}`;
  return `M${c.outline.map(f).join('L')}Z`;
}

/** Box in photo fractions. */
export const goldenBox = (c: GoldenCase) => ({
  x: c.px.x / PHOTO.width,
  y: c.px.y / PHOTO.height,
  w: c.px.w / PHOTO.width,
  h: c.px.h / PHOTO.height,
});

/** Why a real case is hard (PQ-T1): mostly hidden (≥ 30 %), small (< 150 px) or against the light. */
export type RealHardness = 'hidden' | 'small' | 'backlit';

/** One real photo of the reference set: `make shape-capture PHOTO=… ID=<id>` writes it under `real/`. */
export interface RealCase {
  kind: 'real';
  /** Capture id = file name in `real/` (`<id>.capture.json` + `<id>.crop.jpg`). */
  id: string;
  /** What the photo should show. */
  subject: string;
  hard?: RealHardness;
}

const real = (id: string, subject: string, hard?: RealHardness): RealCase => ({
  kind: 'real',
  id,
  subject,
  ...(hard ? { hard } : {}),
});

/**
 * The real reference set (PQ-T1). `real/` is gitignored: photos that cannot be shared stay local and the
 * report skips the ones not captured on this machine (listed as missing).
 */
export const REAL_SHAPES: RealCase[] = [
  real('car-side', 'car seen from the side'),
  real('car-corner', 'car seen from a front corner'),
  real('car-hidden', 'car partly hidden', 'hidden'),
  real('motorbike', 'motorbike'),
  real('house-front', 'house front'),
  real('house-row', 'row of houses'),
  real('hut', 'thatched hut'),
  real('lamp', 'street lamp post'),
  real('utility-pole', 'utility pole', 'small'),
  real('refrigerator', 'fridge'),
  real('TV', 'television'),
  real('fan', 'standing fan'),
  real('pump', 'water pump or generator'),
  real('water-tank', 'water tank'),
  real('solar-panel', 'solar panel', 'backlit'),
  real('tree', 'tree'),
];
