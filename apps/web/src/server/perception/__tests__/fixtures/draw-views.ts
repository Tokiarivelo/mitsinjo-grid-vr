import type { ViewImage } from '../../recon/grid';

/**
 * Tiny painter for synthetic view drawings (recon tests): flat shapes on white paper, exact pixels,
 * so a test states the object it draws and checks the solid that comes back.
 */

export type Rgb = readonly [number, number, number];

export const COLORS = {
  wall: [150, 90, 50],
  roof: [60, 55, 60],
  stone: [128, 128, 120],
  glass: [190, 225, 230],
  body: [200, 40, 40],
  tyre: [25, 25, 28],
  leaf: [50, 140, 60],
  trunk: [110, 75, 40],
} as const satisfies Record<string, Rgb>;

export class Canvas {
  readonly rgb: Uint8Array;
  constructor(
    readonly cols: number,
    readonly rows: number
  ) {
    this.rgb = new Uint8Array(cols * rows * 3).fill(255);
  }

  private set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = (y * this.cols + x) * 3;
    this.rgb[i] = r;
    this.rgb[i + 1] = g;
    this.rgb[i + 2] = b;
  }

  /** Filled rectangle, `x1` / `y1` exclusive. */
  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb): this {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, color);
    return this;
  }

  /** Filled triangle with a flat base on row `yBase` from `x0` to `x1` and its apex at (`ax`, `ay`). */
  triangle(x0: number, x1: number, yBase: number, ax: number, ay: number, color: Rgb): this {
    for (let y = ay; y < yBase; y++) {
      const t = (y - ay) / (yBase - ay);
      const lo = Math.round(ax + (x0 - ax) * t);
      const hi = Math.round(ax + (x1 - ax) * t);
      for (let x = lo; x < hi; x++) this.set(x, y, color);
    }
    return this;
  }

  disc(cx: number, cy: number, r: number, color: Rgb): this {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, color);
    return this;
  }

  /** The drawing mirrored left ↔ right. */
  mirrored(): Canvas {
    const out = new Canvas(this.cols, this.rows);
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        for (let c = 0; c < 3; c++)
          out.rgb[(y * this.cols + x) * 3 + c] =
            this.rgb[(y * this.cols + this.cols - 1 - x) * 3 + c]!;
    return out;
  }

  image(): ViewImage {
    return { cols: this.cols, rows: this.rows, rgb: this.rgb };
  }
}

/**
 * A house 160 wide, 100 deep, 120 tall: stone base, brown walls, a dark roof whose ridge runs along
 * the width (rectangle from the front, triangle from the side), a chimney near the right end and
 * toward the back, one window on the front and one on the right side.
 */
export function houseViews(): Record<'front' | 'right' | 'back' | 'left', ViewImage> {
  const { wall, roof, stone, glass } = COLORS;
  // Front: x 20–180, ground at row 140.
  const front = new Canvas(200, 160)
    .rect(140, 10, 152, 60, stone) // chimney, behind the roof face
    .rect(20, 20, 180, 60, roof)
    .rect(20, 60, 180, 128, wall)
    .rect(20, 128, 180, 140, stone)
    .rect(60, 80, 100, 110, glass);
  // Back: the same outline mirrored, no window.
  const back = new Canvas(200, 160)
    .rect(140, 10, 152, 60, stone)
    .rect(20, 20, 180, 60, roof)
    .rect(20, 60, 180, 128, wall)
    .rect(20, 128, 180, 140, stone)
    .mirrored();
  // Right side as drawn: image left = front of the house; depth x 30–130, chimney toward the back.
  const right = new Canvas(160, 160)
    .rect(96, 10, 108, 50, stone)
    .triangle(30, 130, 60, 80, 20, roof)
    .rect(30, 60, 130, 128, wall)
    .rect(30, 128, 130, 140, stone)
    .rect(60, 84, 84, 108, glass);
  const left = new Canvas(160, 160)
    .rect(96, 10, 108, 50, stone)
    .triangle(30, 130, 60, 80, 20, roof)
    .rect(30, 60, 130, 128, wall)
    .rect(30, 128, 130, 140, stone)
    .mirrored();
  return { front: front.image(), right: right.image(), back: back.image(), left: left.image() };
}

/** A car seen from its nose (front view) and its flank (side views): red body, four dark wheels. */
export function carViews(): Record<'front' | 'right' | 'back' | 'left', ViewImage> {
  const { body, tyre, glass } = COLORS;
  const nose = () =>
    new Canvas(140, 120)
      .rect(30, 40, 110, 90, body)
      .rect(40, 22, 100, 40, body)
      .rect(30, 84, 44, 104, tyre)
      .rect(96, 84, 110, 104, tyre);
  const flank = () =>
    new Canvas(260, 120)
      .rect(20, 50, 240, 90, body)
      .rect(80, 22, 190, 50, body)
      .rect(96, 28, 174, 46, glass)
      .disc(65, 90, 14, tyre)
      .disc(195, 90, 14, tyre);
  return {
    front: nose().rect(46, 26, 94, 38, glass).image(),
    back: nose().mirrored().image(),
    right: flank().image(),
    left: flank().mirrored().image(),
  };
}
