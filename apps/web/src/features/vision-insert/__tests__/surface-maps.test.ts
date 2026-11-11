import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ObjectRecipe } from '@/lib/object-shape';
import { recipeMesh } from '../utils/object-geometry';
import {
  MAP_SIZE,
  MAP_TILE,
  MAPPED_SURFACES,
  planarUvs,
  SHADE_SPAN,
  surfaceOffset,
  surfaceHeight,
  surfaceMaps,
} from '../utils/surface-maps';

const N = 64;
const mean = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / a.length;

describe('surfaceMaps (PR-1.4)', () => {
  it('maps every textured material, leaves glass / water / plastic / painted smooth', () => {
    for (const s of ['stone', 'brick', 'wood', 'thatch', 'slate', 'metal', 'rubber'] as const)
      expect(MAPPED_SURFACES).toContain(s);
    for (const s of ['glass', 'water', 'plastic', 'painted'] as const) {
      expect(surfaceMaps(s)).toBeNull();
      expect(surfaceHeight(s)).toBeNull();
    }
  });

  it('is deterministic and every material has its own pattern', () => {
    const a = surfaceHeight('stone', N)!;
    expect(Array.from(surfaceHeight('stone', N)!)).toEqual(Array.from(a));
    const seen = new Set(MAPPED_SURFACES.map((s) => Array.from(surfaceHeight(s, N)!).join()));
    expect(seen.size).toBe(MAPPED_SURFACES.length);
  });

  it.each(MAPPED_SURFACES.map((s) => [s]))(
    '%s tiles: the wrap seam is no stronger than the inside',
    (s) => {
      const h = surfaceHeight(s, N)!;
      let seam = 0;
      let inside = 0;
      for (let y = 0; y < N; y++) {
        seam += Math.abs(h[y * N]! - h[y * N + N - 1]!);
        inside += Math.abs(h[y * N + N / 2]! - h[y * N + N / 2 - 1]!);
      }
      // Same order as an ordinary neighbour step (patterns with sharp edges allow a margin).
      expect(seam).toBeLessThanOrEqual(inside * 2 + 2);
    }
  );

  it('normals are unit vectors pointing out of the surface; stone shows relief', () => {
    const m = surfaceMaps('stone', N)!;
    let tilted = 0;
    for (let i = 0; i < N * N; i++) {
      const [x, y, z] = [0, 1, 2].map((k) => (m.normal[i * 4 + k]! - 128) / 127);
      expect(Math.hypot(x!, y!, z!)).toBeCloseTo(1, 1);
      expect(z).toBeGreaterThan(0);
      if (z! < 0.95) tilted++;
    }
    expect(tilted).toBeGreaterThan(N * N * 0.05);
  });

  it('keeps the measured colour: shade is a light grey around 1, roughness factor ≤ 1.1', () => {
    const m = surfaceMaps('brick', N)!;
    const shade = Array.from(m.shade).filter((_, i) => i % 4 === 0);
    expect(Math.min(...shade)).toBeGreaterThanOrEqual(205);
    expect(mean(shade)).toBeGreaterThan(220);
    expect(MAP_SIZE).toBe(128);
  });

  it('carries a brightness gain to compensate for the shade map darkening (PR-1.5)', () => {
    const m = surfaceMaps('brick', N)!;
    expect(m.gain).toBeGreaterThan(1.1);
    expect(m.gain).toBeLessThan(1.4);
  });
});

describe('surface maps against repetition (PQ-T35)', () => {
  /** Mean grey of each of the `SHADE_SPAN`² tiles of the shade map. */
  const tileMeans = (surface: 'plaster' | 'stone' | 'brick') => {
    const m = surfaceMaps(surface, N)!;
    const means: number[] = [];
    for (let ty = 0; ty < SHADE_SPAN; ty++)
      for (let tx = 0; tx < SHADE_SPAN; tx++) {
        let sum = 0;
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++)
            sum += m.shade[((ty * N + y) * m.shadeSize + tx * N + x) * 4]!;
        means.push(sum / (N * N));
      }
    return means;
  };

  it('the shade map spans several tiles and the tiles differ: energy below the tile frequency', () => {
    const m = surfaceMaps('brick', N)!;
    expect(m.shadeSize).toBe(N * SHADE_SPAN);
    expect(m.shade.length).toBe(m.shadeSize * m.shadeSize * 4);
    for (const s of ['plaster', 'stone', 'brick'] as const) {
      const means = tileMeans(s);
      expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(0.5);
    }
  });

  it('same surface → same maps and offset; two surfaces start at different corners', () => {
    expect(Array.from(surfaceMaps('stone', N)!.shade)).toEqual(
      Array.from(surfaceMaps('stone', N)!.shade)
    );
    expect(surfaceOffset('stone')).toEqual(surfaceOffset('stone'));
    for (const o of [surfaceOffset('stone'), surfaceOffset('brick')])
      for (const v of o) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    expect(surfaceOffset('stone')).not.toEqual(surfaceOffset('brick'));
  });

  it('keeps the mean brightness: gain × mean linear shade ≈ 1', () => {
    const m = surfaceMaps('plaster', N)!;
    let sum = 0;
    for (let i = 0; i < m.shadeSize * m.shadeSize; i++) {
      const c = m.shade[i * 4]! / 255;
      sum += c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    expect((sum / (m.shadeSize * m.shadeSize)) * m.gain).toBeCloseTo(1, 2);
  });
});

describe('planarUvs (PR-1.4)', () => {
  it('tiles in object units: a part twice as wide gets twice the repeats', () => {
    const wall = (w: number): ObjectRecipe => ({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        { shape: 'box', at: [0, 0, 0], size: [w, 0.5, 0.5], color: '#808080', material: 'stone' },
      ],
    });
    const span = (g: THREE.BufferGeometry) => {
      const uv = g.getAttribute('uv');
      const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
      return Math.max(...us) - Math.min(...us);
    };
    const narrow = span(recipeMesh(wall(0.5)));
    expect(span(recipeMesh(wall(1)))).toBeCloseTo(narrow * 2, 1);
    expect(narrow).toBeCloseTo(0.5 / MAP_TILE, 1);
  });

  it('projects each face on the plane it faces (front: x/y, side: z/y, top: z/x)', () => {
    const tri = (n: [number, number, number]) =>
      planarUvs([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3], [...n, ...n, ...n]);
    const t = MAP_TILE;
    expect(Array.from(tri([0, 0, 1]).slice(0, 2))).toEqual([0.1 / t, 0.2 / t].map(Math.fround));
    expect(Array.from(tri([1, 0, 0]).slice(0, 2))).toEqual([0.3 / t, 0.2 / t].map(Math.fround));
    expect(Array.from(tri([0, 1, 0]).slice(0, 2))).toEqual([0.3 / t, 0.1 / t].map(Math.fround));
  });

  it('maps a roof slope in its own plane: v up the fall line, u along the eave (PG-T7)', () => {
    // Front slope of a 45° roof: normal (0, 1, 1)/√2; points at the eave and higher up the slope.
    const s = Math.SQRT1_2;
    const n = [0, s, s];
    const eaveL = [-1, 0, 0.5];
    const eaveR = [1, 0, 0.5];
    const high = [-1, 0.5, 0]; // 0.5 up and 0.5 back = √0.5 up the slope
    const uv = planarUvs([...eaveL, ...eaveR, ...high], [...n, ...n, ...n], true);
    const t = MAP_TILE;
    // Along the eave only u changes: the strands never shear across the eave.
    expect(uv[1]).toBeCloseTo(uv[3]!, 5);
    expect(Math.abs(uv[2]! - uv[0]!)).toBeCloseTo(2 / t, 4);
    // Up the slope only v changes, by the true slope length.
    expect(uv[4]).toBeCloseTo(uv[0]!, 5);
    expect(uv[5]! - uv[1]!).toBeCloseTo(Math.SQRT1_2 / t, 4);
    // Without `slopes` the same face is box-projected (stretched), as before.
    const box = planarUvs([...eaveL, ...eaveR, ...high], [...n, ...n, ...n]);
    expect(box[5]! - box[1]!).not.toBeCloseTo(Math.SQRT1_2 / t, 2);
  });

  it('keeps walls and flat tops box-projected even with slopes on', () => {
    const tri = (nn: [number, number, number]) =>
      planarUvs([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3], [...nn, ...nn, ...nn], true);
    const t = MAP_TILE;
    expect(Array.from(tri([0, 0, 1]).slice(0, 2))).toEqual([0.1 / t, 0.2 / t].map(Math.fround));
    expect(Array.from(tri([0, 1, 0]).slice(0, 2))).toEqual([0.3 / t, 0.1 / t].map(Math.fround));
  });
});
