import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Icon of the wrist button: a "menu" glyph (three bars) when closed, a cross when open. Cached. */
export function getWristIconTexture(open: boolean): THREE.CanvasTexture {
  const key = `icon:${open}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = open ? '#3b0764' : '#082f49';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = open ? '#e9d5ff' : '#e0f2fe';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (open) {
      ctx.moveTo(42, 42);
      ctx.lineTo(86, 86);
      ctx.moveTo(86, 42);
      ctx.lineTo(42, 86);
    } else {
      for (const y of [44, 64, 84]) {
        ctx.moveTo(38, y);
        ctx.lineTo(90, y);
      }
    }
    ctx.stroke();
  }
  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/** Small pill label above the wrist button (translated text passed in). Cached per text. */
export function getWristLabelTexture(text: string, open: boolean): THREE.CanvasTexture {
  const key = `label:${open}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(8, 16, 32, 0.9)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 2, 252, 60, 28);
    else ctx.rect(2, 2, 252, 60);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = open ? '#c084fc' : '#38bdf8';
    ctx.stroke();
    ctx.font = 'bold 30px "Inter", -apple-system, sans-serif';
    ctx.fillStyle = '#f0f9ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 33);
  }
  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}
