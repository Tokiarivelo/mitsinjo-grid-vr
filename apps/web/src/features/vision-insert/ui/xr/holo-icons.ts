import * as THREE from 'three';

/** Line icons of the holo buttons, drawn on a canvas (no emoji font in the headset browser). */
export const HOLO_ICONS = ['keyboard', 'mic', 'stop', 'send', 'insert', 'go', 'back'] as const;
export type HoloIcon = (typeof HOLO_ICONS)[number];

type Ctx = CanvasRenderingContext2D;

/** Rounded rectangle path (no fill / stroke). */
function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Each icon on a unit box (0..1), drawn with the current stroke / fill style. */
const DRAW: Record<HoloIcon, (ctx: Ctx, s: number) => void> = {
  keyboard: (ctx, s) => {
    rounded(ctx, 0.06 * s, 0.24 * s, 0.88 * s, 0.52 * s, 0.08 * s);
    ctx.stroke();
    // Two key rows (5 then 4, offset like a real keyboard), then the space bar.
    for (const [row, n, x0, span] of [
      [0.37, 5, 0.2, 0.6],
      [0.5, 4, 0.27, 0.46],
    ] as const)
      for (let i = 0; i < n; i++) {
        const x = (x0 + (i * span) / (n - 1)) * s;
        ctx.fillRect(x - 0.035 * s, row * s - 0.035 * s, 0.07 * s, 0.07 * s);
      }
    ctx.fillRect(0.3 * s, 0.6 * s, 0.4 * s, 0.06 * s);
  },
  mic: (ctx, s) => {
    rounded(ctx, 0.37 * s, 0.08 * s, 0.26 * s, 0.48 * s, 0.13 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.5 * s, 0.44 * s, 0.25 * s, 0, Math.PI);
    ctx.moveTo(0.5 * s, 0.69 * s);
    ctx.lineTo(0.5 * s, 0.86 * s);
    ctx.moveTo(0.33 * s, 0.88 * s);
    ctx.lineTo(0.67 * s, 0.88 * s);
    ctx.stroke();
  },
  stop: (ctx, s) => {
    rounded(ctx, 0.24 * s, 0.24 * s, 0.52 * s, 0.52 * s, 0.07 * s);
    ctx.fill();
  },
  send: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(0.1 * s, 0.14 * s);
    ctx.lineTo(0.9 * s, 0.5 * s);
    ctx.lineTo(0.1 * s, 0.86 * s);
    ctx.lineTo(0.24 * s, 0.5 * s);
    ctx.closePath();
    ctx.fill();
  },
  insert: (ctx, s) => {
    ctx.beginPath();
    ctx.arc(0.5 * s, 0.5 * s, 0.38 * s, 0, Math.PI * 2);
    ctx.moveTo(0.5 * s, 0.3 * s);
    ctx.lineTo(0.5 * s, 0.7 * s);
    ctx.moveTo(0.3 * s, 0.5 * s);
    ctx.lineTo(0.7 * s, 0.5 * s);
    ctx.stroke();
  },
  go: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(0.14 * s, 0.5 * s);
    ctx.lineTo(0.82 * s, 0.5 * s);
    ctx.moveTo(0.56 * s, 0.24 * s);
    ctx.lineTo(0.84 * s, 0.5 * s);
    ctx.lineTo(0.56 * s, 0.76 * s);
    ctx.stroke();
  },
  back: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(0.86 * s, 0.5 * s);
    ctx.lineTo(0.18 * s, 0.5 * s);
    ctx.moveTo(0.44 * s, 0.24 * s);
    ctx.lineTo(0.16 * s, 0.5 * s);
    ctx.lineTo(0.44 * s, 0.76 * s);
    ctx.stroke();
  },
};

/** Draws `icon` in a `size` px square at (x, y). */
export function drawHoloIcon(
  ctx: Ctx,
  icon: HoloIcon,
  x: number,
  y: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.12;
  DRAW[icon](ctx, size);
  ctx.restore();
}

const cache = new Map<string, THREE.CanvasTexture>();

/** Square canvas texture of `icon` in `color` (cached; a handful of icon × colour pairs). */
export function holoIconTexture(icon: HoloIcon, color: string): THREE.CanvasTexture {
  const key = `${icon}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) drawHoloIcon(ctx, icon, 8, 8, 112, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}
