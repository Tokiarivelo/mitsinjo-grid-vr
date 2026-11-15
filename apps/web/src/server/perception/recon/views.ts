import { components, maskIou, median, mirror, open, type CellBox, type ViewImage } from './grid';

/**
 * Reading the drawn views (PQ-T69): what is object and what is paper, then the four views brought
 * to one frame. Object axes: x right and y up seen from the front, z toward the front camera.
 * A canonical view has its columns on an object axis: x for front and back, z for the two sides
 * (column 0 = left of the front / back of the object), rows top → bottom. Pure, no image library.
 */

export type ViewName = 'front' | 'right' | 'back' | 'left';
export const VIEW_NAMES: ReadonlyArray<ViewName> = ['front', 'right', 'back', 'left'];

/** A pixel this far (RGB distance) from the paper colour is drawn. */
export const PAPER_DISTANCE = 26;
/** Rows of the working grid: every view is resampled so the object fills this height. */
export const GRID_ROWS = 128;
/** Columns of a view on the working grid, whatever its aspect. */
export const GRID_COLS_MIN = 6;
export const GRID_COLS_MAX = 256;
/** A drawn blob smaller than this share of the largest one is not the object (specks, labels). */
export const BLOB_MIN_SHARE = 0.02;
/** Ground line: a stroke leaving the sheet, at least this share of its width and at most this share of its height. */
export const GROUND_LINE_MIN_WIDTH = 0.02;
export const GROUND_LINE_MAX_HEIGHT = 0.02;
/** A view counts as drawn mirrored when flipping it raises its match with the opposite view by this much. */
export const FLIP_GAIN = 0.03;
/** Two opposite views agree on the object's extent when their aspects differ by at most this share. */
export const ASPECT_AGREE = 0.25;
/**
 * The view from above is kept while its proportions differ from the elevations by at most this
 * share (a factor 3): past it the plan is turned or shows another object.
 */
export const TOP_ASPECT_AGREE = 0.67;

/** The object on one view: its mask and the box around it; null when the view is blank. */
export interface ViewObject {
  mask: Uint8Array;
  box: CellBox;
  /** Colour of the sheet (median of the border pixels). */
  paper: [number, number, number];
}

/**
 * Object mask of a drawing on plain paper. Paper = the median border colour; background = the
 * paper-coloured pixels reachable from the border, so pale walls and glass enclosed by the drawing
 * stay object. Thin strokes (ground line, dimension lines) and small blobs are dropped.
 */
export function readObject(img: ViewImage): ViewObject | null {
  const { cols, rows, rgb } = img;
  const border: [number[], number[], number[]] = [[], [], []];
  const push = (x: number, y: number) => {
    const i = (y * cols + x) * 3;
    border[0].push(rgb[i]!);
    border[1].push(rgb[i + 1]!);
    border[2].push(rgb[i + 2]!);
  };
  for (let x = 0; x < cols; x++) {
    push(x, 0);
    push(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    push(0, y);
    push(cols - 1, y);
  }
  const paper = border.map(median) as [number, number, number];
  const papery = (i: number) =>
    Math.hypot(rgb[i * 3]! - paper[0], rgb[i * 3 + 1]! - paper[1], rgb[i * 3 + 2]! - paper[2]) <
    PAPER_DISTANCE;
  const fine = Math.min(cols, rows) >= 48;
  // Ground line: a thin, long, flat stroke that runs off the sheet. On its rows every thin
  // stroke is paper, so the line never closes the gaps under the object (arches, legs, wheels).
  const drawn = Uint8Array.from({ length: cols * rows }, (_, i) => (papery(i) ? 0 : 1));
  const line = new Uint8Array(cols * rows);
  if (fine) {
    const bold = open(drawn, cols, rows, 1);
    const thin = (i: number) => drawn[i] === 1 && bold[i] === 0;
    const lineRows = new Uint8Array(rows);
    for (const c of components(cols, rows, thin)) {
      const [w, h] = [c.x1 - c.x0 + 1, c.y1 - c.y0 + 1];
      if ((c.x0 > 0 && c.x1 < cols - 1) || w < cols * GROUND_LINE_MIN_WIDTH) continue;
      if (h > Math.max(2, rows * GROUND_LINE_MAX_HEIGHT)) continue;
      for (let y = c.y0; y <= c.y1; y++) lineRows[y] = 1;
    }
    for (let y = 0; y < rows; y++)
      if (lineRows[y])
        for (let x = 0; x < cols; x++) if (thin(y * cols + x)) line[y * cols + x] = 1;
  }
  // Background: paper-coloured components that touch the border.
  const mask = new Uint8Array(cols * rows).fill(1);
  for (const c of components(cols, rows, (i) => papery(i) || line[i] === 1)) {
    if (c.x0 > 0 && c.y0 > 0 && c.x1 < cols - 1 && c.y1 < rows - 1) continue;
    for (const i of c.cells) mask[i] = 0;
  }
  const solid = fine ? open(mask, cols, rows, 1) : mask;
  const blobs = components(cols, rows, (i) => solid[i] === 1);
  if (!blobs.length) return null;
  const largest = Math.max(...blobs.map((b) => b.area));
  const out = new Uint8Array(cols * rows);
  const box: CellBox = { x0: cols, x1: -1, y0: rows, y1: -1 };
  for (const b of blobs) {
    if (b.area < largest * BLOB_MIN_SHARE) continue;
    for (const i of b.cells) out[i] = 1;
    box.x0 = Math.min(box.x0, b.x0);
    box.x1 = Math.max(box.x1, b.x1);
    box.y0 = Math.min(box.y0, b.y0);
    box.y1 = Math.max(box.y1, b.y1);
  }
  return { mask: out, box, paper };
}

/** Width / height of the object's box on a view. */
export const boxAspect = (b: CellBox) => (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1);

/** One view on the working grid: the object fills it edge to edge. */
export interface GridView {
  cols: number;
  rows: number;
  rgb: Uint8Array;
  /** 1 = object. */
  mask: Uint8Array;
}

/** The object's box resampled to `cols` × `rows` (nearest pixel at each cell centre). */
export function resample(img: ViewImage, obj: ViewObject, cols: number, rows: number): GridView {
  const { box } = obj;
  const [bw, bh] = [box.x1 - box.x0 + 1, box.y1 - box.y0 + 1];
  const rgb = new Uint8Array(cols * rows * 3);
  const mask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(img.rows - 1, box.y0 + Math.floor(((y + 0.5) / rows) * bh));
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(img.cols - 1, box.x0 + Math.floor(((x + 0.5) / cols) * bw));
      const s = sy * img.cols + sx;
      const d = y * cols + x;
      mask[d] = obj.mask[s]!;
      rgb[d * 3] = img.rgb[s * 3]!;
      rgb[d * 3 + 1] = img.rgb[s * 3 + 1]!;
      rgb[d * 3 + 2] = img.rgb[s * 3 + 2]!;
    }
  }
  return { cols, rows, rgb, mask };
}

/** A grid view mirrored left ↔ right. */
export function mirrorView(v: GridView): GridView {
  const rgb = new Uint8Array(v.rgb.length);
  for (let y = 0; y < v.rows; y++) {
    for (let x = 0; x < v.cols; x++) {
      const s = (y * v.cols + (v.cols - 1 - x)) * 3;
      const d = (y * v.cols + x) * 3;
      rgb[d] = v.rgb[s]!;
      rgb[d + 1] = v.rgb[s + 1]!;
      rgb[d + 2] = v.rgb[s + 2]!;
    }
  }
  return { cols: v.cols, rows: v.rows, rgb, mask: mirror(v.mask, v.cols, v.rows) };
}

/** The views in one frame: W × H × D cells, each view canonical (columns on its object axis). */
export interface AlignedViews {
  W: number;
  H: number;
  D: number;
  /** Colour of the front drawing's sheet. */
  paper: [number, number, number];
  /** Canonical views; `right` is always present (the left one stands in when it is the only side). */
  views: { front: GridView; right: GridView; back?: GridView; left?: GridView };
  /** Views that were read (a blank or missing one is not listed). */
  read: ViewName[];
  /** Views found drawn mirrored and flipped back. */
  flipped: ViewName[];
  /** True when the right side is the left drawing standing in. */
  rightFromLeft: boolean;
  /** Silhouette agreement of the opposite views, 0–1 (absent without the pair). */
  agreement: { frontBack?: number; rightLeft?: number };
  /** Where each canonical view sits on its drawing (the face textures are cut there). */
  frames: Partial<Record<ViewName, ViewFrame>>;
  /**
   * Width and depth per unit height as drawn on the front and the side (PQ-T76), before the grid
   * clamps them: a profile longer than `GRID_COLS_MAX / GRID_ROWS` keeps its real length here.
   */
  aspects: { w: number; d: number };
}

/** A canonical view on its drawing: the object's box on a `cols` × `rows` image, mirrored or not. */
export interface ViewFrame {
  box: CellBox;
  cols: number;
  rows: number;
  /** True when the canonical view is the drawing mirrored left ↔ right. */
  mirrored: boolean;
  /** Colour of this drawing's sheet. */
  paper: [number, number, number];
}

/**
 * The view from above brought to the frame (PQ-T70): `W` columns (x, left → right seen from the
 * front) × `D` rows (z, row 0 = back, the front at the bottom of the drawing). Null when it is
 * blank or its proportions disagree with the elevations (wrong orientation, another object).
 */
export function alignTop(
  img: ViewImage,
  W: number,
  D: number
): { view: GridView; frame: ViewFrame; aspect: number } | null {
  const obj = readObject(img);
  if (!obj) return null;
  const [drawn, expected] = [boxAspect(obj.box), W / D];
  if (Math.abs(drawn - expected) / Math.max(drawn, expected) > TOP_ASPECT_AGREE) return null;
  return {
    view: resample(img, obj, W, D),
    frame: { box: obj.box, cols: img.cols, rows: img.rows, mirrored: false, paper: obj.paper },
    aspect: drawn,
  };
}

/**
 * Proportions with the depth read on the view from above (`aspect` = its width / depth). A side
 * elevation is drawn to fill its sheet, so its width says little about the real depth; the plan
 * shows width and depth on one drawing. Largest side = 1.
 */
export function depthFromPlan(
  p: { w: number; h: number; d: number },
  aspect: number
): { w: number; h: number; d: number } {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return p;
  const d = p.w / aspect;
  const max = Math.max(p.w, p.h, d);
  const unit = (v: number) => Math.max(0.01, Math.min(1, v / max));
  return { w: unit(p.w), h: unit(p.h), d: unit(d) };
}

const clampCols = (aspect: number) =>
  Math.max(GRID_COLS_MIN, Math.min(GRID_COLS_MAX, Math.round(GRID_ROWS * aspect)));

/**
 * The four drawings brought to one frame. The height is shared; the width comes from the front
 * (averaged with the back when they agree), the depth from the right side (averaged with the left
 * when they agree). A back or left view drawn mirrored is flipped back: in an orthographic set the
 * back silhouette is the mirror of the front one, and the left the mirror of the right.
 * Null when the front or both sides are unreadable: no depth can be measured.
 */
export function alignViews(input: Partial<Record<ViewName, ViewImage>>): AlignedViews | null {
  const objects: Partial<Record<ViewName, { img: ViewImage; obj: ViewObject }>> = {};
  for (const name of VIEW_NAMES) {
    const img = input[name];
    const obj = img ? readObject(img) : null;
    if (img && obj) objects[name] = { img, obj };
  }
  const { front, right, back, left } = objects;
  const side = right ?? left;
  if (!front || !side) return null;
  const agree = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) <= ASPECT_AGREE;
  const fa = boxAspect(front.obj.box);
  const ba = back ? boxAspect(back.obj.box) : null;
  const wAspect = ba !== null && agree(fa, ba) ? (fa + ba) / 2 : fa;
  const ra = right ? boxAspect(right.obj.box) : null;
  const la = left ? boxAspect(left.obj.box) : null;
  const dAspect =
    ra !== null && la !== null && agree(ra, la)
      ? (ra + la) / 2
      : (ra ?? la ?? boxAspect(side.obj.box));
  const [W, H, D] = [clampCols(wAspect), GRID_ROWS, clampCols(dAspect)];
  const flipped: ViewName[] = [];
  const agreement: AlignedViews['agreement'] = {};
  const frontView = resample(front.img, front.obj, W, H);
  // Right view as drawn: image left = object front, so canonical (column = z, back first) is its mirror.
  const rightView = right ? mirrorView(resample(right.img, right.obj, D, H)) : null;
  /** `drawn` oriented like `reference` when a flip matches clearly better; reports the match. */
  const orient = (name: ViewName, drawn: GridView, reference: GridView | null) => {
    if (!reference) return { view: drawn, iou: undefined };
    const flippedView = mirrorView(drawn);
    const [straight, turned] = [
      maskIou(drawn.mask, reference.mask),
      maskIou(flippedView.mask, reference.mask),
    ];
    if (turned > straight + FLIP_GAIN) {
      flipped.push(name);
      return { view: flippedView, iou: turned };
    }
    return { view: drawn, iou: straight };
  };
  let backView: GridView | undefined;
  if (back) {
    // Back as drawn: image left = object right, so canonical (column = x) is its mirror.
    const o = orient('back', mirrorView(resample(back.img, back.obj, W, H)), frontView);
    backView = o.view;
    if (o.iou !== undefined) agreement.frontBack = o.iou;
  }
  let leftView: GridView | undefined;
  if (left) {
    // Left as drawn: image right = object front, already canonical.
    const o = orient('left', resample(left.img, left.obj, D, H), rightView);
    leftView = o.view;
    if (o.iou !== undefined) agreement.rightLeft = o.iou;
  }
  const rightFinal = rightView ?? leftView!;
  const frame = (v: { img: ViewImage; obj: ViewObject }, mirrored: boolean): ViewFrame => ({
    box: v.obj.box,
    cols: v.img.cols,
    rows: v.img.rows,
    mirrored,
    paper: v.obj.paper,
  });
  const leftFrame = left ? frame(left, flipped.includes('left')) : undefined;
  const rightFrame = right ? frame(right, true) : leftFrame;
  return {
    W,
    H,
    D,
    paper: front.obj.paper,
    views: {
      front: frontView,
      right: rightFinal,
      ...(backView ? { back: backView } : {}),
      ...(leftView ? { left: leftView } : {}),
    },
    read: VIEW_NAMES.filter((n) => objects[n]),
    flipped,
    rightFromLeft: !rightView,
    agreement,
    frames: {
      front: frame(front, false),
      ...(rightFrame ? { right: rightFrame } : {}),
      ...(back ? { back: frame(back, !flipped.includes('back')) } : {}),
      ...(leftFrame ? { left: leftFrame } : {}),
    },
    aspects: { w: wAspect, d: dAspect },
  };
}
