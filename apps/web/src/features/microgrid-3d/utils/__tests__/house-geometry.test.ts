import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHouseCluster, houseClusterDrawCalls, type HouseSpec } from '../house-geometry';

const house = (over: Partial<HouseSpec> = {}): HouseSpec => ({
  width: 2,
  depth: 1.6,
  wallHeight: 1.15,
  roofHeight: 0.75,
  wallColor: '#d8c3a0',
  roofColor: '#5f6f7d',
  ...over,
});

const triangles = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;

describe('buildHouseCluster', () => {
  it('keeps a constant draw-call count whatever the number of houses', () => {
    expect(houseClusterDrawCalls([])).toBe(0);
    expect(houseClusterDrawCalls([house()])).toBe(4);
    expect(houseClusterDrawCalls(Array.from({ length: 20 }, () => house()))).toBe(4);
    expect(houseClusterDrawCalls([house(), house({ veranda: true })])).toBe(5);
  });

  it('merges N houses into the same geometry as N separate ones', () => {
    const one = buildHouseCluster([house()]);
    const six = buildHouseCluster(
      Array.from({ length: 6 }, (_, i) => house({ position: [i * 3, 0, 0] }))
    );
    expect(triangles(six.walls)).toBe(6 * triangles(one.walls));
    expect(triangles(six.roofs)).toBe(6 * triangles(one.roofs));
    expect(triangles(six.windows)).toBe(6 * triangles(one.windows));
    expect(six.verandas).toBeNull();
  });

  it('paints each house with its own wall color (vertex colors, linear space)', () => {
    const a = new THREE.Color('#ff0000');
    const b = new THREE.Color('#0000ff');
    const g = buildHouseCluster([
      house({ wallColor: '#ff0000' }),
      house({ wallColor: '#0000ff', position: [5, 0, 0] }),
    ]).walls;
    const color = g.getAttribute('color');
    const half = color.count / 2;
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([a.r, a.g, a.b]);
    expect([color.getX(half), color.getY(half), color.getZ(half)]).toEqual([b.r, b.g, b.b]);
  });

  it('places and rotates each house', () => {
    const g = buildHouseCluster([house({ position: [10, 0, -4], rotationY: Math.PI / 2 })]).walls;
    g.computeBoundingBox();
    const center = g.boundingBox!.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(10);
    expect(center.z).toBeCloseTo(-4);
    // Rotated 90°: the 2 m width now runs along z.
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(2);
    expect(size.x).toBeCloseTo(1.6);
  });

  it('supports modern eco-pavilions with gable roofs and terrace deck furniture', () => {
    const cluster = buildHouseCluster([
      house({
        roofStyle: 'gable',
        deckFurniture: true,
        slatCladding: true,
      }),
    ]);

    expect(cluster.roofs).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.windows).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.trim).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.verandas).toBeInstanceOf(THREE.BufferGeometry);

    cluster.roofs.computeBoundingBox();
    const roofBounds = cluster.roofs.boundingBox!;
    // Roof sits atop walls
    expect(roofBounds.max.y).toBeGreaterThan(1.15);
  });

  it('supports classic cottages with chimney, arched dormer, and front gabled porch', () => {
    const cluster = buildHouseCluster([
      house({
        roofStyle: 'gable',
        cottage: true,
      }),
    ]);

    expect(houseClusterDrawCalls([house({ cottage: true })])).toBe(5);
    expect(cluster.roofs).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.windows).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.trim).toBeInstanceOf(THREE.BufferGeometry);
    expect(cluster.verandas).toBeInstanceOf(THREE.BufferGeometry);

    cluster.trim.computeBoundingBox();
    const trimBounds = cluster.trim.boundingBox!;
    // Chimney sits higher than wallHeight (1.15)
    expect(trimBounds.max.y).toBeGreaterThan(1.5);
  });
});
