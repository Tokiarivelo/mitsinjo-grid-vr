import * as THREE from 'three';

export interface AirButtonTexts {
  title: string;
  subtitle: string;
  badge: string;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Generates or retrieves from cache a crisp CanvasTexture for the in-air spatial button.
 */
export function getSpatialAirButtonTexture(
  status: 'idle' | 'scanning' | 'detected',
  hovered: boolean,
  texts: AirButtonTexts
): THREE.CanvasTexture {
  const key = `air-btn:${status}:${hovered}:${texts.title}:${texts.subtitle}:${texts.badge}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 512;
  const h = 220;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Dark glass rounded panel
    drawRoundedRect(ctx, 8, 8, w - 16, h - 16, 26);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    if (status === 'scanning') {
      bgGrad.addColorStop(0, 'rgba(49, 46, 129, 0.95)'); // Violet indigo
      bgGrad.addColorStop(1, 'rgba(30, 27, 75, 0.95)');
    } else if (status === 'detected') {
      bgGrad.addColorStop(0, 'rgba(6, 78, 59, 0.95)'); // Emerald green
      bgGrad.addColorStop(1, 'rgba(4, 47, 46, 0.95)');
    } else {
      bgGrad.addColorStop(0, 'rgba(15, 23, 42, 0.95)'); // Slate cyan
      bgGrad.addColorStop(1, 'rgba(8, 47, 73, 0.95)');
    }
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // 2. Glowing border
    ctx.lineWidth = hovered ? 6 : 4;
    if (status === 'scanning') {
      ctx.strokeStyle = hovered ? '#c084fc' : '#a855f7';
    } else if (status === 'detected') {
      ctx.strokeStyle = hovered ? '#4ade80' : '#22c55e';
    } else {
      ctx.strokeStyle = hovered ? '#38bdf8' : '#0284c7';
    }
    ctx.stroke();

    // 3. Top category badge pill
    const pillW = 240;
    const pillH = 34;
    const pillX = (w - pillW) / 2;
    const pillY = 22;
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
    ctx.fillStyle =
      status === 'scanning'
        ? 'rgba(168, 85, 247, 0.25)'
        : status === 'detected'
          ? 'rgba(34, 197, 94, 0.25)'
          : 'rgba(56, 189, 248, 0.25)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle =
      status === 'scanning'
        ? 'rgba(216, 180, 254, 0.6)'
        : status === 'detected'
          ? 'rgba(134, 239, 172, 0.6)'
          : 'rgba(125, 211, 252, 0.6)';
    ctx.stroke();

    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(texts.badge.toUpperCase(), w / 2, pillY + pillH / 2);

    // 4. Main Title
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(texts.title, w / 2, 98);

    // 5. Subtitle / Hint
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = hovered ? '#e0f2fe' : '#94a3b8';
    ctx.fillText(texts.subtitle, w / 2, 140);

    // 6. Action button indicator at bottom
    const actW = 200;
    const actH = 32;
    drawRoundedRect(ctx, (w - actW) / 2, 168, actW, actH, 12);
    ctx.fillStyle = hovered ? 'rgba(56, 189, 248, 0.8)' : 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = hovered ? '#0f172a' : '#cbd5e1';
    ctx.fillText(hovered ? '🎯 PULL TRIGGER / CLICK' : 'AIM & TRIGGER', w / 2, 184);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

export function resetSpatialAirButtonTextureCache(): void {
  for (const t of textureCache.values()) t.dispose();
  textureCache.clear();
}
