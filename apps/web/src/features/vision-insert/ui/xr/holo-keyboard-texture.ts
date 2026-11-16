import * as THREE from 'three';
import type { KeyRect } from '../../utils/xr-keyboard';
import { HOLO, holoFont } from './holo-style';

/** Translated captions of the action keys. */
export interface KeyCaptions {
  shift: string;
  space: string;
  back: string;
  clear: string;
}

/**
 * Canvas texture of the VR chat keyboard (VS-T27): every key a rounded hologram cell, letters
 * upper-cased while shift is on. Drawn on open and when shift or the locale changes, never per frame.
 */
export function drawKeyboardTexture(
  rects: readonly KeyRect[],
  shift: boolean,
  captions: KeyCaptions,
  w = 1024,
  h = 420
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = HOLO.glass;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of rects) {
      const x = k.x * w + 4;
      const y = k.y * h + 4;
      const kw = k.width * w - 8;
      const kh = k.height * h - 8;
      const action = k.action !== 'char';
      const on = k.action === 'shift' && shift;
      ctx.globalAlpha = on ? 0.55 : action ? 0.28 : 0.16;
      ctx.fillStyle = action ? HOLO.violet : HOLO.cyan;
      ctx.fillRect(x, y, kw, kh);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.strokeStyle = action ? HOLO.violet : HOLO.cyan;
      ctx.strokeRect(x, y, kw, kh);
      ctx.globalAlpha = 1;
      const label =
        k.action === 'char'
          ? shift
            ? k.value.toUpperCase()
            : k.value
          : captions[k.action as keyof KeyCaptions];
      ctx.font = holoFont(action ? 30 : 40, 700);
      ctx.fillStyle = HOLO.ink;
      ctx.fillText(label, x + kw / 2, y + kh / 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
