import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLabRoom, LAB_CLEAR_RADIUS, LAB_ROOM } from '../utils/lab-room';

describe('buildLabRoom', () => {
  const room = buildLabRoom();

  it('merges the room into one geometry per material (a few draw calls)', () => {
    const keys = Object.keys(room);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys.length).toBeLessThanOrEqual(11);
    for (const g of Object.values(room))
      expect(g!.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('stays inside the room shell', () => {
    for (const g of Object.values(room)) {
      g!.computeBoundingBox();
      const b = g!.boundingBox!;
      expect(b.min.x).toBeGreaterThanOrEqual(-LAB_ROOM.halfWidth - 0.05);
      expect(b.max.x).toBeLessThanOrEqual(LAB_ROOM.halfWidth + 0.05);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.03);
      expect(b.max.y).toBeLessThanOrEqual(LAB_ROOM.height + 0.03);
    }
  });

  it('leaves the studio area around the viewer free (no furniture vertex within the clear radius)', () => {
    const v = new THREE.Vector3();
    for (const [key, g] of Object.entries(room)) {
      if (key === 'floor' || key === 'wall' || key === 'lamp' || key === 'shadow') continue; // shell spans the whole room
      const pos = g!.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.y > 2.0) continue; // above head height: nothing to bump into or to hide a panel
        expect(Math.hypot(v.x, v.z)).toBeGreaterThan(LAB_CLEAR_RADIUS);
      }
    }
  });
});
