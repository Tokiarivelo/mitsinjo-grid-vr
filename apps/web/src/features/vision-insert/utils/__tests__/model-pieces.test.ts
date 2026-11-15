import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAR_SLOTS } from '@/lib/car-mesh';
import { HOUSE_SLOTS } from '@/lib/house-mesh';
import {
  bakePieceEdits,
  connectedTriangles,
  ITEMS_MAX,
  maskGeometry,
  maskPlanes,
  modelBox,
  modelKind,
  pieceNames,
  splitPieces,
  withPieceEdits,
} from '../model-pieces';

/** Two unit boxes side by side on x (−1…0 and 0…1), one group each: slots 0 (roof) and 5. */
function twoBoxes() {
  const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(-0.5, 0, 0);
  const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(0.5, 0, 0);
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = a.getAttribute(name) as THREE.BufferAttribute;
    const y = b.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array);
    arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  const n = a.getAttribute('position').count;
  g.addGroup(0, n, 0);
  g.addGroup(n, n, 5);
  return { g, n };
}
const names = HOUSE_SLOTS;

describe('model pieces (3D Studio, PQ-T77)', () => {
  it('names the pieces by how the model is built', () => {
    expect(modelKind({ house: {} as never })).toBe('house');
    expect(modelKind({ car: { body: {} } as never })).toBe('car');
    expect(modelKind({ yaw: 0.3, house: {} as never })).toBe('parts');
    expect(pieceNames('car')).toBe(CAR_SLOTS);
  });

  it('splits one piece per group, centred on its own pivot', () => {
    const { g } = twoBoxes();
    const pieces = splitPieces(g, names);
    expect(pieces.map((p) => p.name)).toEqual([names[0], names[5]]);
    expect(pieces[0]!.center[0]).toBeCloseTo(-0.5);
    pieces[0]!.geometry.computeBoundingBox();
    expect(pieces[0]!.geometry.boundingBox!.min.x).toBeCloseTo(-0.5);
  });

  it('bakes: hidden pieces dropped, moved pieces moved, groups kept', () => {
    const { g, n } = twoBoxes();
    const box = modelBox(g);
    expect(bakePieceEdits(g, names, undefined)).toBe(g);
    const hidden = bakePieceEdits(g, names, { [names[0]!]: { hidden: true } }, box);
    expect(hidden.getAttribute('position').count).toBe(n);
    expect(hidden.groups).toEqual([{ start: 0, count: n, materialIndex: 5 }]);
    // Up by half the model's height (1 m): the roof piece now sits 0.5 m higher.
    const moved = bakePieceEdits(g, names, { [names[0]!]: { offset: [0, 0.5, 0] } }, box);
    moved.computeBoundingBox();
    expect(moved.boundingBox!.max.y).toBeCloseTo(1);
    expect(moved.getAttribute('uv').count).toBe(2 * n);
  });

  it('bakes a mask: keeps the triangles inside its box, the outside when inverted', () => {
    const { g, n } = twoBoxes();
    const left = { box: [0, 0.45, 0, 1, 0, 1] as [number, number, number, number, number, number] };
    // Both boxes in one piece would be cut; here the right box (slot 5) is masked to the left half.
    const cut = bakePieceEdits(g, names, { [names[5]!]: { mask: left } });
    expect(cut.getAttribute('position').count).toBe(n);
    const inv = bakePieceEdits(g, names, { [names[5]!]: { mask: { ...left, invert: true } } });
    expect(inv.getAttribute('position').count).toBe(2 * n);
  });

  it('turns a mask into clipping planes in the scaled view', () => {
    const { g } = twoBoxes();
    const m = maskPlanes({ box: [0, 0.5, 0, 1, 0, 1] }, modelBox(g), 2)!;
    expect(m.planes).toHaveLength(6);
    expect(m.intersection).toBe(false);
    // x ≤ 0 (the middle of the box, scaled) is kept, x = 1 clipped by one plane.
    const p = new THREE.Vector3(1, 0, 0);
    expect(m.planes.some((pl) => pl.distanceToPoint(p) < 0)).toBe(true);
    expect(m.planes.every((pl) => pl.distanceToPoint(new THREE.Vector3(-1, 0, 0)) >= 0)).toBe(true);
    expect(maskPlanes({ box: [0, 1, 0, 1, 0, 1], off: true }, modelBox(g))).toBeNull();
  });

  it("bakes a recipe's edits for the village and Blender, by its kind of model", () => {
    const { g, n } = twoBoxes();
    const house = { house: {} as never };
    expect(withPieceEdits(g, house)).toBe(g);
    const baked = withPieceEdits(g, { ...house, pieces: { roof: { hidden: true } } });
    expect(baked).not.toBe(g);
    expect(baked.getAttribute('position').count).toBe(n);
  });

  /** Area of a non-indexed geometry's triangles. */
  const area = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position');
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let sum = 0;
    for (let t = 0; t < p.count / 3; t++) {
      a.fromBufferAttribute(p, t * 3);
      b.fromBufferAttribute(p, t * 3 + 1);
      c.fromBufferAttribute(p, t * 3 + 2);
      sum += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return sum;
  };

  it('cuts a piece along its mask like the studio planes, not triangle by triangle (PQ-T78)', () => {
    const cube = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const box = modelBox(cube);
    const mask = { box: [0, 0.25, 0, 1, 0, 1] as [number, number, number, number, number, number] };
    const cut = maskGeometry(cube, mask, box);
    cut.computeBoundingBox();
    // The quarter x ≤ −0.25 of the cube: its end face and a quarter of the four faces round it.
    expect(cut.boundingBox!.max.x).toBeCloseTo(-0.25, 6);
    expect(area(cut)).toBeCloseTo(1 + 4 * 0.25, 6);
    expect(cut.getAttribute('uv').count).toBe(cut.getAttribute('position').count);
    // Inverted: the rest of the cube, nothing lost and nothing kept twice.
    const rest = maskGeometry(cube, { ...mask, invert: true }, box);
    rest.computeBoundingBox();
    expect(rest.boundingBox!.min.x).toBeCloseTo(-0.25, 6);
    expect(area(cut) + area(rest)).toBeCloseTo(6, 6);
  });

  it('gives a car one piece per window, tyre and wheel face (PQ-T78)', () => {
    const { g, n } = twoBoxes();
    // Both boxes in the glass slot of a car: two separate things, two pieces.
    g.clearGroups();
    g.addGroup(0, 2 * n, CAR_SLOTS.indexOf('glass'));
    expect(connectedTriangles(g)).toHaveLength(1); // the boxes touch at x = 0
    g.getAttribute('position').array.forEach((_, i, arr) => {
      if (i % 3 === 0 && i >= n * 3) (arr as Float32Array)[i]! += 0.5;
    });
    const pieces = splitPieces(g, CAR_SLOTS);
    expect(pieces.map((p) => p.name)).toEqual(['glass-1', 'glass-2']);
    expect(pieces[0]!.center[0]).toBeCloseTo(-0.5);
    expect(pieces[1]!.center[0]).toBeCloseTo(1);
    expect(pieces.every((p) => p.slot === CAR_SLOTS.indexOf('glass'))).toBe(true);
    // The same slot index of a house is one piece; a moved window is baked alone.
    expect(splitPieces(g, HOUSE_SLOTS)).toHaveLength(1);
    const baked = bakePieceEdits(g, CAR_SLOTS, { 'glass-2': { hidden: true } });
    expect(baked.getAttribute('position').count).toBe(n);
    expect(ITEMS_MAX).toBeGreaterThanOrEqual(8);
  });
});
