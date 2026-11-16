import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { dragPoint, findDraggable } from '../xr-drag';

const hit = (object: THREE.Object3D) => ({ object, distance: 1, point: new THREE.Vector3() });

describe('findDraggable', () => {
  it('finds the hit (or its parent) that can be dragged, panels first', () => {
    const group = new THREE.Group();
    group.userData.onDrag = vi.fn();
    const knob = new THREE.Mesh();
    group.add(knob);
    const wall = new THREE.Mesh();
    expect(findDraggable([hit(wall), hit(knob)] as THREE.Intersection[])).toBe(group);
    expect(findDraggable([hit(wall)] as THREE.Intersection[])).toBeNull();

    const panel = new THREE.Mesh();
    panel.userData = { xrUi: true, onDrag: vi.fn() };
    const behind = new THREE.Mesh();
    behind.userData.onDrag = vi.fn();
    expect(findDraggable([hit(behind), hit(panel)] as THREE.Intersection[])).toBe(panel);
  });
});

describe('dragPoint', () => {
  it('gives where the ray crosses the object plane, in its local space (scaled, moved)', () => {
    const track = new THREE.Mesh();
    track.position.set(0, 1, -2);
    const rig = new THREE.Group();
    rig.scale.setScalar(0.5);
    rig.add(track);
    const out = new THREE.Vector3();
    // Ray from the origin straight to the world point (0, 0.6, -1): local y = (0.6 − 0.5) / 0.5.
    const dir = new THREE.Vector3(0, 0.6, -1).normalize();
    const p = dragPoint(track, new THREE.Vector3(), dir, out)!;
    expect(p.y).toBeCloseTo(0.2, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it('returns null when the ray points away from the plane', () => {
    const track = new THREE.Mesh();
    track.position.set(0, 0, -2);
    expect(
      dragPoint(track, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3())
    ).toBeNull();
  });
});
