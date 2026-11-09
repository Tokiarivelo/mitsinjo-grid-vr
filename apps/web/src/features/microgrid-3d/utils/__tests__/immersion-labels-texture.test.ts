import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  drawRoundedRect,
  getAirOptionTexture,
  getVillageTypeTagTexture,
} from '../immersion-labels-texture';

describe('immersion-labels-texture', () => {
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

  it('creates and caches air option texture for active and inactive states', () => {
    const tActive = getAirOptionTexture(true, false, {
      title: 'Village Types',
      stateText: 'Labels: ON',
      hint: 'Click in the air to hide',
    });
    expect(tActive).toBeInstanceOf(THREE.CanvasTexture);
    expect(tActive.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tActive.image.width).toBe(512);
    expect(tActive.image.height).toBe(200);

    const tCached = getAirOptionTexture(true, false, {
      title: 'Village Types',
      stateText: 'Labels: ON',
      hint: 'Click in the air to hide',
    });
    expect(tCached).toBe(tActive);

    const tInactive = getAirOptionTexture(false, false, {
      title: 'Village Types',
      stateText: 'Labels: OFF',
      hint: 'Click in the air to show',
    });
    expect(tInactive).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('creates and caches village type badge texture with correct properties', () => {
    const tag = getVillageTypeTagTexture({
      id: 'households',
      title: 'Village Households',
      category: 'Residential',
      description: 'Living Quarters · Cottages',
      icon: '🏠',
      accentColor: '#38bdf8',
    });

    expect(tag).toBeInstanceOf(THREE.CanvasTexture);
    expect(tag.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tag.image.width).toBe(512);
    expect(tag.image.height).toBe(210);

    const tag2 = getVillageTypeTagTexture({
      id: 'households',
      title: 'Village Households',
      category: 'Residential',
      description: 'Living Quarters · Cottages',
      icon: '🏠',
      accentColor: '#38bdf8',
    });
    expect(tag2).toBe(tag);
  });
});
