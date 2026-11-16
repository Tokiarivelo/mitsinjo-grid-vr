import { describe, expect, it } from 'vitest';
import { drawVillageMap } from '../sim-xr-map-draw';
import { MAP_FEATURES, MAP_PINS, mapTransform } from '../sim-xr-minimap';

/** A 2D context that records the calls the map makes. */
function recorder() {
  const calls: Record<string, unknown[][]> = {};
  const ctx = new Proxy(
    {},
    {
      get:
        (_, key: string) =>
        (...args: unknown[]) => {
          (calls[key] ??= []).push(args);
        },
      set: () => true,
    }
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawVillageMap (VS-T38)', () => {
  const transform = mapTransform(2.5, -0.5, 0, -1, 512, 30, []);

  it('draws roads and paths, the lake and pond, the paddy, every pin, the walker arrow', () => {
    const { ctx, calls } = recorder();
    drawVillageMap(ctx, { size: 512, transform, tone: () => 'x', arrow: 0.3 });
    expect(calls.stroke!.length).toBeGreaterThanOrEqual(
      MAP_FEATURES.paths.length + MAP_PINS.length
    );
    expect(calls.fillRect!.length).toBe(2); // glass + paddy
    expect(calls.rotate).toEqual([[-0.3]]);
    expect(calls.fillText).toBeUndefined(); // mini map: no names
  });

  it('big map writes each name and « You », upright', () => {
    const { ctx, calls } = recorder();
    drawVillageMap(ctx, {
      size: 1024,
      transform,
      tone: () => 'x',
      names: (id) => `name-${id}`,
      arrow: 0,
      you: 'You',
    });
    const texts = calls.fillText!.map((c) => c[0]);
    expect(texts).toContain('name-dispatcher');
    expect(texts).toContain('name-market');
    expect(texts).toContain('You');
    expect(texts).toHaveLength(MAP_PINS.length + 1);
  });

  it('/village lab table (VS-T39): no walker arrow, names at a larger size', () => {
    const { ctx, calls } = recorder();
    drawVillageMap(ctx, {
      size: 1024,
      transform,
      tone: () => 'x',
      names: (id) => `name-${id}`,
      fontScale: 1.5,
    });
    expect(calls.rotate).toBeUndefined();
    expect(calls.fillText).toHaveLength(MAP_PINS.length);
  });
});
