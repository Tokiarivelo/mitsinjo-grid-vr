import * as THREE from 'three';

export interface SpatialHUDTextureSpec {
  title: string;
  batteryLabel: string;
  batterySocPct: number;
  batteryStateText: string;
  solarLabel: string;
  solarKw: number;
  demandLabel: string;
  demandKw: number;
  netLabel: string;
  netIsSurplus: boolean;
  appliancesLabel: string;
  connectedCountText: string;
  recentEvent?: string | null;
  toggleLabel: string;
  isExpanded: boolean;
  isHovered: boolean;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

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
  ctx.arcTo(x, y + h, x, y, r);
  ctx.closePath();
}

/**
 * Creates high-resolution 2D canvas texture for the 3D Holographic Telemetry HUD in WebXR.
 */
export function getSpatialHUDTexture(spec: SpatialHUDTextureSpec): THREE.CanvasTexture {
  const key = [
    'hud',
    spec.isExpanded ? 'exp' : 'min',
    spec.isHovered ? 'hov' : 'idle',
    spec.batterySocPct,
    spec.solarKw.toFixed(1),
    spec.demandKw.toFixed(1),
    spec.netLabel,
    spec.connectedCountText,
    spec.recentEvent ?? '',
    spec.title,
    spec.toggleLabel,
  ].join(':');

  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 480;
  const h = spec.isExpanded ? 340 : 100;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Semi-translucent glass dark background
    drawRoundedRect(ctx, 4, 4, w - 8, h - 8, 16);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, 'rgba(8, 20, 36, 0.94)');
    bgGrad.addColorStop(1, 'rgba(4, 12, 24, 0.96)');
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // Border glow
    ctx.lineWidth = spec.isHovered ? 3.5 : 2;
    ctx.strokeStyle = spec.isHovered ? '#38bdf8' : 'rgba(56, 189, 248, 0.5)';
    ctx.stroke();

    // 2. Header Bar
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Status beacon dot
    ctx.beginPath();
    ctx.arc(28, 30, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#86efac';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.fillText(spec.title.toUpperCase(), 44, 30);

    // Toggle button pill in upper right
    const btnW = 104;
    const btnH = 26;
    const btnX = w - btnW - 20;
    const btnY = 17;
    drawRoundedRect(ctx, btnX, btnY, btnW, btnH, 13);
    ctx.fillStyle = spec.isHovered ? 'rgba(56, 189, 248, 0.3)' : 'rgba(30, 41, 59, 0.8)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = spec.isHovered ? '#38bdf8' : 'rgba(148, 163, 184, 0.4)';
    ctx.stroke();

    ctx.fillStyle = spec.isHovered ? '#38bdf8' : '#cbd5e1';
    ctx.font = '600 12px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.toggleLabel, btnX + btnW / 2, btnY + btnH / 2);

    if (spec.isExpanded) {
      // Separator line
      ctx.beginPath();
      ctx.moveTo(18, 54);
      ctx.lineTo(w - 18, 54);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Battery Tile
      drawRoundedRect(ctx, 20, 66, w - 40, 60, 10);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = '600 13px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`⚡ ${spec.batteryLabel.toUpperCase()}`, 34, 84);

      // Battery percentage
      ctx.textAlign = 'right';
      ctx.font = 'bold 20px "Inter", -apple-system, sans-serif';
      const socColor =
        spec.batterySocPct > 40 ? '#4ade80' : spec.batterySocPct > 20 ? '#fbbf24' : '#f87171';
      ctx.fillStyle = socColor;
      ctx.fillText(`${Math.round(spec.batterySocPct)} %`, w - 34, 84);

      // Battery progress bar track
      const barX = 34;
      const barY = 98;
      const barW = w - 68;
      const barH = 12;
      drawRoundedRect(ctx, barX, barY, barW, barH, 6);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.fill();

      // Progress fill
      const fillW = Math.max(12, (barW * Math.min(100, Math.max(0, spec.batterySocPct))) / 100);
      drawRoundedRect(ctx, barX, barY, fillW, barH, 6);
      ctx.fillStyle = socColor;
      ctx.fill();

      // Solar & Demand 2-Column tiles
      const colW = (w - 52) / 2;
      // Solar tile
      drawRoundedRect(ctx, 20, 138, colW, 64, 10);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.25)';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = '600 12px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#eab308';
      ctx.fillText(`☀ ${spec.solarLabel.toUpperCase()}`, 32, 156);

      ctx.font = 'bold 20px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#fef08a';
      ctx.fillText(`${spec.solarKw.toFixed(1)} kW`, 32, 185);

      // Demand tile
      const demandX = 20 + colW + 12;
      drawRoundedRect(ctx, demandX, 138, colW, 64, 10);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = '600 12px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`⚡ ${spec.demandLabel.toUpperCase()}`, demandX + 12, 156);

      ctx.font = 'bold 20px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText(`${spec.demandKw.toFixed(1)} kW`, demandX + 12, 185);

      // Net balance status pill & In-situ appliances row
      drawRoundedRect(ctx, 20, 214, w - 40, 52, 10);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = '600 12px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`🔌 ${spec.appliancesLabel}`, 34, 234);

      ctx.font = 'bold 15px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(spec.connectedCountText, 34, 253);

      // Net balance pill on right
      const pillW = 140;
      const pillH = 28;
      const pillX = w - pillW - 32;
      const pillY = 226;
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 14);
      ctx.fillStyle = spec.netIsSurplus ? 'rgba(22, 101, 52, 0.8)' : 'rgba(153, 27, 27, 0.8)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = spec.netIsSurplus ? '#4ade80' : '#f87171';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = 'bold 12px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = spec.netIsSurplus ? '#bbf7d0' : '#fecaca';
      ctx.fillText(spec.netLabel, pillX + pillW / 2, pillY + pillH / 2 + 1);

      // Transient Event Notification (bottom footer)
      if (spec.recentEvent) {
        drawRoundedRect(ctx, 20, 278, w - 40, 44, 8);
        ctx.fillStyle = 'rgba(6, 78, 59, 0.88)';
        ctx.fill();
        ctx.strokeStyle = '#34d399';
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.font = '600 13px "Inter", -apple-system, sans-serif';
        ctx.fillStyle = '#ecfdf5';
        ctx.fillText(spec.recentEvent, w / 2, 301);
      }
    } else {
      // Minimized State: summary pill in middle
      ctx.textAlign = 'left';
      ctx.font = '600 14px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`⚡ ${spec.batteryLabel}:`, 28, 70);

      ctx.font = 'bold 16px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = spec.batterySocPct > 40 ? '#4ade80' : '#fbbf24';
      ctx.fillText(`${Math.round(spec.batterySocPct)}%`, 110, 70);

      ctx.font = '600 14px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`☀ Solaire:`, 180, 70);

      ctx.font = 'bold 16px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = '#fef08a';
      ctx.fillText(`${spec.solarKw.toFixed(1)} kW`, 260, 70);

      // Net Pill
      const pillW = 120;
      const pillH = 26;
      const pillX = w - pillW - 24;
      const pillY = 56;
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 13);
      ctx.fillStyle = spec.netIsSurplus ? 'rgba(22, 101, 52, 0.8)' : 'rgba(153, 27, 27, 0.8)';
      ctx.fill();
      ctx.strokeStyle = spec.netIsSurplus ? '#4ade80' : '#f87171';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = 'bold 12px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = spec.netIsSurplus ? '#bbf7d0' : '#fecaca';
      ctx.fillText(spec.netLabel, pillX + pillW / 2, pillY + pillH / 2 + 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/** Clear cache helper for unit tests */
export function _resetSpatialHUDTextureCache(): void {
  textureCache.clear();
}
