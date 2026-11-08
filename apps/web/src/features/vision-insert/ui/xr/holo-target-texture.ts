import * as THREE from 'three';

export interface HoloTargetLabelSpec {
  title: string;
  category: string;
  powerHint: string;
  actionHint: string;
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
  ctx.arcTo(x, y + h, x, y, r);
  ctx.closePath();
}

/**
 * Creates high-resolution 2D canvas texture for the 3D Holographic Detection Target card.
 */
export function getHoloTargetTexture(
  hovered: boolean,
  isMaterialized: boolean,
  spec: HoloTargetLabelSpec
): THREE.CanvasTexture {
  const key = `holo-tgt:${hovered}:${isMaterialized}:${spec.title}:${spec.category}:${spec.powerHint}:${spec.actionHint}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 380;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Semi-translucent card background
    drawRoundedRect(ctx, 6, 6, w - 12, h - 12, 18);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    if (isMaterialized) {
      bgGrad.addColorStop(0, 'rgba(6, 78, 59, 0.92)'); // Emerald
      bgGrad.addColorStop(1, 'rgba(2, 44, 34, 0.92)');
    } else if (hovered) {
      bgGrad.addColorStop(0, 'rgba(120, 53, 15, 0.94)'); // Amber glow
      bgGrad.addColorStop(1, 'rgba(69, 26, 3, 0.94)');
    } else {
      bgGrad.addColorStop(0, 'rgba(12, 74, 110, 0.92)'); // Cyan slate
      bgGrad.addColorStop(1, 'rgba(8, 47, 73, 0.92)');
    }
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // 2. Glowing stroke
    ctx.lineWidth = hovered ? 4 : 2.5;
    ctx.strokeStyle = isMaterialized ? '#4ade80' : hovered ? '#f59e0b' : '#38bdf8';
    ctx.stroke();

    // 3. Category Pill
    const pillW = 140;
    const pillH = 24;
    drawRoundedRect(ctx, 16, 16, pillW, pillH, 12);
    ctx.fillStyle = hovered ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.25)';
    ctx.fill();
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = hovered ? '#fef08a' : '#bae6fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.category.toUpperCase(), 16 + pillW / 2, 16 + pillH / 2);

    // 4. Power hint on the right
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(spec.powerHint, w - 18, 28);

    // 5. Main Title (Appliance label)
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(spec.title, 18, 76);

    // 6. Action status hint at bottom
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = isMaterialized ? '#86efac' : hovered ? '#fde68a' : '#94a3b8';
    ctx.fillText(
      isMaterialized ? '✓ 3D INSTALLED' : hovered ? '⚡ PULL TRIGGER TO SHOOT' : spec.actionHint,
      18,
      118
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
