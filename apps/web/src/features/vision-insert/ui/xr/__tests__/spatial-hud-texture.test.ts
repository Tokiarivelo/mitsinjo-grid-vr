import { describe, expect, it, vi } from 'vitest';
import {
  getSpatialHUDTexture,
  drawRoundedRect,
  _resetSpatialHUDTextureCache,
  type SpatialHUDTextureSpec,
} from '../spatial-hud-texture';

describe('spatial-hud-texture (VS-T8)', () => {
  it('draws rounded rectangle path on 2D context', () => {
    const mockCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawRoundedRect(mockCtx, 10, 10, 80, 80, 10);
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.arcTo).toHaveBeenCalledTimes(4);
    expect(mockCtx.closePath).toHaveBeenCalled();
  });
  const baseSpec: SpatialHUDTextureSpec = {
    title: 'Microgrid Telemetry',
    batteryLabel: 'Battery',
    batterySocPct: 82,
    batteryStateText: 'Charging',
    solarLabel: 'Solar',
    solarKw: 14.5,
    demandLabel: 'Demand',
    demandKw: 8.2,
    netLabel: 'Surplus +6.3 kW',
    netIsSurplus: true,
    appliancesLabel: 'VR Appliances',
    connectedCountText: '3 connected (+450 W)',
    recentEvent: null,
    toggleLabel: 'Minimize',
    isExpanded: true,
    isHovered: false,
  };

  it('generates a CanvasTexture for expanded state', () => {
    _resetSpatialHUDTextureCache();
    const texture = getSpatialHUDTexture(baseSpec);
    expect(texture).toBeDefined();
    expect(texture.image).toBeDefined();
    expect(texture.image.width).toBe(480);
    expect(texture.image.height).toBe(340);
  });

  it('generates a CanvasTexture for minimized state with reduced height', () => {
    const minSpec: SpatialHUDTextureSpec = {
      ...baseSpec,
      isExpanded: false,
      toggleLabel: 'Expand',
    };
    const texture = getSpatialHUDTexture(minSpec);
    expect(texture).toBeDefined();
    expect(texture.image.height).toBe(100);
  });

  it('reuses cached texture on identical specs', () => {
    _resetSpatialHUDTextureCache();
    const tex1 = getSpatialHUDTexture(baseSpec);
    const tex2 = getSpatialHUDTexture(baseSpec);
    expect(tex1).toBe(tex2);
  });

  it('renders transient event toast when recentEvent is provided', () => {
    const eventSpec: SpatialHUDTextureSpec = {
      ...baseSpec,
      recentEvent: '+180 W · Refrigerator connected',
    };
    const texture = getSpatialHUDTexture(eventSpec);
    expect(texture).toBeDefined();
    expect(texture.image).toBeDefined();
  });
});
