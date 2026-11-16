import { HOLO, holoFont } from '@/features/vision-insert/ui/xr/holo-style';
import { GROUND_HEX } from './terrain-colors';
import { MAP_FEATURES, MAP_PINS, type MapPinId } from './sim-xr-minimap';

/**
 * Draws the /simulation VR map on a square canvas (VS-T38): dark glass disc, paddy, lake and pond,
 * laterite roads and paths, buildings and the dispatcher (status colour), their names (big map),
 * and the walker's arrow. `transform` comes from `mapTransform` (world x, z → canvas px).
 */
export interface MapDrawOptions {
  size: number;
  transform: readonly number[];
  /** Pin colour (engine status) per pin. */
  tone: (id: MapPinId) => string;
  /** Pin names (big map); none on the mini map. */
  names?: (id: MapPinId) => string;
  /** Walker arrow angle on the canvas (rad, counter-clockwise as seen; 0 = up); none = no walker. */
  arrow?: number;
  /** Name size multiplier (the /village lab table is read from farther). Default 1. */
  fontScale?: number;
  /** Walker label under the arrow (big map). */
  you?: string;
}

/** Canvas scale (px per scene unit) of a transform. */
const unitPx = (t: readonly number[]) => Math.hypot(t[0]!, t[1]!);

export function drawVillageMap(ctx: CanvasRenderingContext2D, o: MapDrawOptions): void {
  const { size, transform: t } = o;
  const c = size / 2;
  const px = unitPx(t);
  const at = (x: number, z: number): [number, number] => [
    t[0]! * x + t[2]! * z + t[4]!,
    t[1]! * x + t[3]! * z + t[5]!,
  ];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = HOLO.dome;
  ctx.globalAlpha = 0.86;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  // Land, in world units (the transform scales and turns them).
  ctx.setTransform(t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!);
  const p = MAP_FEATURES.paddy;
  ctx.fillStyle = GROUND_HEX.lush;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(p.x - p.w / 2, p.z - p.d / 2, p.w, p.d);
  ctx.fillStyle = HOLO.cyan;
  ctx.globalAlpha = 0.45;
  for (const w of MAP_FEATURES.water) {
    ctx.beginPath();
    ctx.arc(w.x, w.z, w.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = GROUND_HEX.laterite;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // At least 2 px wide, whatever the zoom.
  ctx.lineWidth = Math.max(MAP_FEATURES.pathWidth, 2 / px);
  for (const path of MAP_FEATURES.paths) {
    ctx.beginPath();
    path.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(x, z) : ctx.lineTo(x, z)));
    ctx.stroke();
  }

  // Pins and names in canvas px (text stays upright and sharp).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pinR = Math.max(4, size * 0.022);
  const fontPx = Math.round(size * 0.034 * (o.fontScale ?? 1));
  for (const pin of MAP_PINS) {
    let [x, y] = at(pin.x, pin.z);
    // Out of range: on the rim.
    const r = Math.hypot(x - c, y - c);
    const rim = c - pinR - 2;
    if (r > rim) {
      x = c + ((x - c) * rim) / r;
      y = c + ((y - c) * rim) / r;
    }
    ctx.fillStyle = o.tone(pin.id);
    ctx.strokeStyle = HOLO.ink;
    ctx.lineWidth = Math.max(1.5, size * 0.004);
    ctx.beginPath();
    if (pin.id === 'dispatcher') ctx.rect(x - pinR, y - pinR, pinR * 2, pinR * 2);
    else ctx.arc(x, y, pinR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const name = o.names?.(pin.id);
    if (name) {
      // The dispatcher sits between the sectors: its name goes under its pin, theirs above.
      const below = pin.id === 'dispatcher';
      const ty = below ? y + pinR + 4 : y - pinR - 4;
      ctx.font = holoFont(fontPx, 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = below ? 'top' : 'bottom';
      ctx.lineWidth = fontPx * 0.28;
      ctx.strokeStyle = HOLO.dome;
      ctx.strokeText(name, x, ty);
      ctx.fillStyle = HOLO.ink;
      ctx.fillText(name, x, ty);
    }
  }

  // Walker: arrow at its spot (the centre), pointing where the head looks.
  if (o.arrow !== undefined) drawWalker(ctx, c, size, fontPx, o.arrow, o.you);
  ctx.restore();

  // Rim.
  ctx.beginPath();
  ctx.arc(c, c, c - Math.max(2, size * 0.008), 0, Math.PI * 2);
  ctx.strokeStyle = HOLO.cyan;
  ctx.lineWidth = Math.max(3, size * 0.014);
  ctx.stroke();
}

function drawWalker(
  ctx: CanvasRenderingContext2D,
  c: number,
  size: number,
  fontPx: number,
  arrow: number,
  you: string | undefined
): void {
  const [wx, wy] = [c, c];
  const a = size * 0.035;
  ctx.translate(wx, wy);
  ctx.rotate(-arrow);
  ctx.beginPath();
  ctx.moveTo(0, -a);
  ctx.lineTo(a * 0.7, a * 0.8);
  ctx.lineTo(0, a * 0.4);
  ctx.lineTo(-a * 0.7, a * 0.8);
  ctx.closePath();
  ctx.fillStyle = HOLO.ink;
  ctx.strokeStyle = HOLO.dome;
  ctx.lineWidth = Math.max(1.5, size * 0.004);
  ctx.fill();
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (you) {
    ctx.font = holoFont(fontPx, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = fontPx * 0.28;
    ctx.strokeStyle = HOLO.dome;
    ctx.strokeText(you, wx, wy + a + 4);
    ctx.fillStyle = HOLO.ink;
    ctx.fillText(you, wx, wy + a + 4);
  }
}
