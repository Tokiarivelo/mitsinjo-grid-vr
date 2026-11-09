import * as THREE from 'three';

export interface AirOptionTexts {
  title: string;
  stateText: string;
  hint: string;
}

export interface VillageTypeTextureSpec {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: string;
  accentColor: string;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Robust cross-browser and test-compatible rounded rectangle path.
 */
export function drawRoundedRect(
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
 * Creates high-resolution 2D canvas texture for the floating Air Option Toggle.
 */
export function getAirOptionTexture(
  active: boolean,
  hovered: boolean,
  texts: AirOptionTexts
): THREE.CanvasTexture {
  const key = `air-opt:${active}:${hovered}:${texts.title}:${texts.stateText}:${texts.hint}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 512;
  const h = 200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Semi-translucent dark glass card background
    drawRoundedRect(ctx, 8, 8, w - 16, h - 16, 28);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    if (active) {
      bgGrad.addColorStop(0, 'rgba(12, 74, 110, 0.95)'); // Cyan deep blue
      bgGrad.addColorStop(1, 'rgba(8, 47, 73, 0.95)');
    } else {
      bgGrad.addColorStop(0, 'rgba(30, 41, 59, 0.94)'); // Dark slate
      bgGrad.addColorStop(1, 'rgba(15, 23, 42, 0.94)');
    }
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // 2. Glowing border
    ctx.lineWidth = hovered ? 6 : 4;
    ctx.strokeStyle = active ? (hovered ? '#7dd3fc' : '#38bdf8') : hovered ? '#fbbf24' : '#f59e0b';
    ctx.stroke();

    // 3. Top category pill: [ 🏷️ IMMERSION HUD ]
    const pillW = 220;
    const pillH = 34;
    const pillX = (w - pillW) / 2;
    const pillY = 24;
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 17);
    ctx.fillStyle = active ? 'rgba(56, 189, 248, 0.25)' : 'rgba(245, 158, 11, 0.25)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = active ? '#38bdf8' : '#f59e0b';
    ctx.stroke();

    ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = active ? '#bae6fd' : '#fde68a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texts.title, w / 2, pillY + pillH / 2);

    // 4. Center main status text (e.g. "LABELS: ON" / "LABELS: OFF")
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = active ? '#ffffff' : '#f8fafc';
    ctx.fillText(texts.stateText, w / 2, 108);

    // 5. Bottom hint / action caption
    ctx.font = '500 18px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = active ? '#93c5fd' : '#cbd5e1';
    ctx.fillText(texts.hint, w / 2, 158);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/**
 * Creates high-resolution 2D canvas texture for a tagged village type badge.
 */
export function getVillageTypeTagTexture(item: VillageTypeTextureSpec): THREE.CanvasTexture {
  const key = `vtag:${item.id}:${item.title}:${item.category}:${item.description}:${item.accentColor}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 512;
  const h = 210;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Dark glass rounded background
    drawRoundedRect(ctx, 8, 8, w - 16, h - 16, 26);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.fill();

    // 2. Glowing accent border
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = item.accentColor;
    ctx.stroke();

    // 3. Left vertical accent bar
    ctx.save();
    ctx.beginPath();
    drawRoundedRect(ctx, 8, 8, w - 16, h - 16, 26);
    ctx.clip();
    ctx.fillStyle = item.accentColor;
    ctx.fillRect(8, 8, 12, h - 16);
    ctx.restore();

    // 4. Circular icon medallion on the left
    const iconCx = 75;
    const iconCy = h / 2;
    const iconR = 44;
    ctx.beginPath();
    ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = item.accentColor;
    ctx.stroke();

    ctx.font = '40px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.icon, iconCx, iconCy + 2);

    // 5. Category pill top-right
    const textStartX = 140;
    const catPillY = 24;
    const catPillH = 28;
    ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
    const catTextW = ctx.measureText(item.category.toUpperCase()).width;
    const catPillW = catTextW + 28;

    drawRoundedRect(ctx, textStartX, catPillY, catPillW, catPillH, 14);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = item.accentColor;
    ctx.stroke();

    ctx.fillStyle = item.accentColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.category.toUpperCase(), textStartX + 14, catPillY + catPillH / 2);

    // 6. Main Title (e.g. "Village Households", "Primary School")
    ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.title, textStartX, 95);

    // 7. Subtitle / Type Description
    // Status indicator dot
    const dotX = textStartX + 6;
    const dotY = 152;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = item.accentColor;
    ctx.fill();

    ctx.font = '500 18px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(item.description, dotX + 16, dotY);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
