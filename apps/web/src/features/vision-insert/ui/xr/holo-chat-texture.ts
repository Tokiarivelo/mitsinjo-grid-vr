import * as THREE from 'three';
import { HOLO, holoFont, wrapText } from './holo-style';

/** One line of the chat as drawn: the text is already translated. */
export interface ChatBubbleItem {
  role: 'user' | 'bot';
  text: string;
  /** Bot line still working (drawn pulsing-free, with a trailing ellipsis glyph colour). */
  pending?: boolean;
  /** Bot line reporting a failure. */
  error?: boolean;
}

export interface ChatBubble {
  item: ChatBubbleItem;
  rows: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default text size (px on the 1024-wide canvas); callers pass a dmm-based size. */
const FONT_SIZE = 34;
const MAX_ROWS = 4;
/** Row height, bubble padding and gap scale with the text size. */
const metrics = (font: number) => ({ row: font * 1.25, pad: font * 0.53, gap: font * 0.47 });

/**
 * Bubbles of the chat history on a `w`×`h` canvas, newest at the bottom: the operator's on the
 * right, the bot's on the left, each wrapped to 72 % of the width (4 rows at most). Older bubbles
 * that no longer fit are left out (the history scrolls by itself as it grows).
 */
export function layoutChat(
  measure: (s: string) => number,
  items: readonly ChatBubbleItem[],
  w: number,
  h: number,
  font = FONT_SIZE
): ChatBubble[] {
  const { row: ROW, pad: PAD, gap: GAP } = metrics(font);
  const maxText = w * 0.72 - 2 * PAD;
  const out: ChatBubble[] = [];
  let bottom = h - GAP;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const rows = wrapText(measure, item.text, maxText, MAX_ROWS);
    const width = Math.min(w * 0.72, Math.max(...rows.map(measure), 40) + 2 * PAD);
    const height = rows.length * ROW + 2 * PAD - (ROW - font);
    const y = bottom - height;
    if (y < GAP) break;
    out.unshift({ item, rows, x: item.role === 'user' ? w - GAP - width : GAP, y, width, height });
    bottom = y - GAP;
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Canvas texture of the chat history (VS-T27). Bot (AI) bubbles are violet, the operator's cyan
 * (AI text visually distinct). One texture per history, redrawn only when it changes.
 */
export function drawChatTexture(
  items: readonly ChatBubbleItem[],
  empty: string,
  w = 1024,
  h = 640,
  reuse?: THREE.CanvasTexture,
  font = FONT_SIZE
): THREE.CanvasTexture {
  const { row: ROW, pad: PAD } = metrics(font);
  const canvas =
    (reuse?.image as HTMLCanvasElement | undefined) ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = holoFont(font, 600);
    ctx.textBaseline = 'top';
    if (!items.length) {
      ctx.fillStyle = HOLO.ink;
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'center';
      const rows = wrapText((s) => ctx.measureText(s).width, empty, w * 0.8, 3);
      rows.forEach((r, i) => ctx.fillText(r, w / 2, h / 2 - (rows.length * ROW) / 2 + i * ROW));
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    for (const b of layoutChat((s) => ctx.measureText(s).width, items, w, h, font)) {
      const bot = b.item.role === 'bot';
      const tint = b.item.error ? HOLO.red : bot ? HOLO.violet : HOLO.cyan;
      roundRect(ctx, b.x, b.y, b.width, b.height);
      ctx.globalAlpha = bot ? 0.42 : 0.2;
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = tint;
      ctx.stroke();
      ctx.fillStyle = b.item.pending ? HOLO.amber : HOLO.ink;
      b.rows.forEach((r, i) => ctx.fillText(r, b.x + PAD, b.y + PAD + i * ROW));
    }
  }
  const texture = reuse ?? new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
