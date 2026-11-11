import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ObjectRecipe } from '@/lib/object-shape';
import { recipeMesh } from '../utils/object-geometry';
import { AO_MIN, applyVertexAo } from '../utils/vertex-ao';

/** A white box of the given size centred at `at`, with normals and a white colour attribute. */
const box = (at: [number, number, number], size: [number, number, number]) => {
  const g = new THREE.BoxGeometry(...size).translate(...at);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
};

/** Colour factor (red channel) of the vertices of `g` whose position satisfies `pick`. */
const factors = (g: THREE.BufferGeometry, pick: (x: number, y: number, z: number) => boolean) => {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++)
    if (pick(pos.getX(i), pos.getY(i), pos.getZ(i))) out.push(col.getX(i));
  return out;
};

describe('vertex-ao (PQ-T27)', () => {
  it('vertices at a joint are darker than free ones; the ground is darkened too', () => {
    // Wall 1 × 0.5 × 1 on the ground, a roof slab 1 × 0.1 × 1 sitting on it, 0.6 above the ground.
    const wall = box([0, 0.25, 0], [1, 0.5, 1]);
    const roof = box([0, 0.55, 0], [1, 0.1, 1]);
    const free = box([0, 2, 0], [0.2, 0.2, 0.2]);
    applyVertexAo([wall, roof, free]);
    const underside = factors(roof, (_x, y) => y < 0.51);
    const top = factors(roof, (_x, y) => y > 0.59);
    expect(Math.min(...underside)).toBeLessThan(1);
    expect(Math.min(...top)).toBe(1);
    expect(Math.min(...factors(wall, (_x, y) => y < 0.01))).toBeLessThan(1);
    expect(Math.min(...factors(free, () => true))).toBe(1);
  });

  it('a decal on a wall face keeps its colour (it faces away from the wall)', () => {
    const wall = box([0, 0.5, 0], [1, 1, 1]);
    const window = box([0, 0.5, 0.51], [0.2, 0.2, 0.02]);
    applyVertexAo([wall, window]);
    expect(Math.min(...factors(window, (_x, _y, z) => z > 0.515))).toBe(1);
  });

  it('never goes under the floor: no part falls to black', () => {
    const stack = Array.from({ length: 8 }, (_, i) => box([0, i * 0.01, 0], [0.5, 0.5, 0.5]));
    applyVertexAo(stack);
    for (const g of stack)
      expect(Math.min(...factors(g, () => true))).toBeGreaterThanOrEqual(AO_MIN);
  });

  it('a recipe mesh builds with the occlusion and stays inside the geometry budget', () => {
    const parts: ObjectRecipe['parts'] = Array.from({ length: 24 }, (_, i) => ({
      shape: 'box' as const,
      at: [((i % 6) - 2.5) * 0.15, -0.3 + Math.floor(i / 6) * 0.15, 0] as [number, number, number],
      size: [0.14, 0.14, 0.3] as [number, number, number],
      color: '#c9a36a',
      material: 'plaster' as const,
    }));
    recipeMesh({ proportions: { w: 1, h: 0.6, d: 0.4 }, parts }); // warm-up: module and JIT
    const t0 = performance.now();
    const mesh = recipeMesh({ proportions: { w: 1, h: 0.6, d: 0.4 }, parts });
    expect(performance.now() - t0).toBeLessThan(500);
    const col = mesh.getAttribute('color');
    let darker = 0;
    for (let i = 0; i < col.count; i++) if (col.getX(i) < 0.99 * col.getX(0)) darker++;
    expect(darker).toBeGreaterThan(0);
  });
});
