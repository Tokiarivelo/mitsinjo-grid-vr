import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { approach, beamSpan, createRayVisual, cursorRadius, RAY_VISUAL } from '../xr-ray-visual';

describe('ray visual (Meta ray casting spec)', () => {
  it('draws a short beam after the gap: 25 cm for hands, 35 cm for controllers', () => {
    expect(beamSpan(5, 'hand')).toEqual({ start: 0.1, length: 0.25 });
    expect(beamSpan(5, 'controller')).toEqual({ start: 0.1, length: 0.35 });
  });

  it('never draws the beam past the hit, nor for the mouse', () => {
    expect(beamSpan(0.3, 'controller').length).toBeCloseTo(0.2);
    expect(beamSpan(0.05, 'hand').length).toBe(0);
    // VS-T38: in /simulation the beam reaches the hit, capped.
    expect(beamSpan(2, 'controller', true)).toEqual({ start: 0.1, length: 1.9 });
    expect(beamSpan(50, 'controller', true).length).toBe(RAY_VISUAL.reachMax);
    expect(beamSpan(5, 'mouse').length).toBe(0);
  });

  it('keeps the cursor the same angular size, 83 % while select is held', () => {
    expect(cursorRadius(2, 0) / 2).toBeCloseTo(cursorRadius(1, 0));
    expect(cursorRadius(1, 1) / cursorRadius(1, 0)).toBeCloseTo(RAY_VISUAL.selectScale);
  });

  it('eases toward a target at the given pace and never overshoots', () => {
    expect(approach(0, 1, 0.08, 0.08)).toBe(1);
    expect(approach(0, 1, 0.04, 0.08)).toBeCloseTo(0.5);
    expect(approach(1, 0, 1, 0.25)).toBe(0);
    expect(approach(0.3, 0.3, 0.1, 0.2)).toBe(0.3);
  });

  it('shows beam and cursor on something usable, fades out on nothing', () => {
    const v = createRayVisual();
    const frame = {
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      end: new THREE.Vector3(0, 0, -2),
      usable: true,
      input: 'controller' as const,
      pressed: false,
      tint: '#ffffff',
      dt: 1,
    };
    v.update(frame);
    expect(v.group.visible).toBe(true);
    const [beam, cursor] = v.group.children as [THREE.Mesh, THREE.Group];
    expect(beam.position.z).toBeCloseTo(-0.1);
    expect(beam.scale.y).toBeCloseTo(0.35);
    expect(cursor.position.z).toBeCloseTo(-2 + 0.004);
    v.update({ ...frame, usable: false });
    expect(v.group.visible).toBe(false);
    v.dispose();
  });
});
