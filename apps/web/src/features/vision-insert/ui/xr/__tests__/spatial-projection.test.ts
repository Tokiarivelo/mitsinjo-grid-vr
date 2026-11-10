import { describe, expect, it } from 'vitest';
import type { ApplianceDetection } from '@/lib/vision';
import { projectDetectionsTo3D } from '../spatial-projection';
import { screenHitFromRay } from '../webcam-screen';

const EYE: [number, number, number] = [0, 1.6, 0];

function dirFromEye(p: [number, number, number]) {
  const d = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { x: d[0]! / len, y: d[1]! / len, z: d[2]! / len, len };
}

describe('projectDetectionsTo3D (VS-T3, aligned on the webcam video)', () => {
  const fridge: ApplianceDetection = {
    id: 'fridge-1',
    label: 'Fridge',
    category: 'fridge',
    box: { x: 0.128, y: 0.219, w: 0.171, h: 0.662 },
  };
  const lamp: ApplianceDetection = {
    id: 'lamp-1',
    label: 'Lamp',
    category: 'lamp',
    box: { x: 0.6, y: 0.05, w: 0.1, h: 0.1 },
  };

  it('returns an empty array when no detections are provided', () => {
    expect(projectDetectionsTo3D([])).toEqual([]);
  });

  it('places each frame on the line of sight to its object in the video', () => {
    for (const target of projectDetectionsTo3D([fridge, lamp])) {
      const d = dirFromEye(target.position);
      const hit = screenHitFromRay({ x: EYE[0], y: EYE[1], z: EYE[2] }, d)!;
      const { x, y, w, h } = target.detection.box;
      expect(hit.u).toBeCloseTo(x + w / 2, 2);
      expect(hit.v).toBeCloseTo(y + h / 2, 2);
    }
  });

  it('keeps left/right and up/down from the image', () => {
    const [f, l] = projectDetectionsTo3D([fridge, lamp]);
    expect(f!.position[0]).toBeLessThan(0);
    expect(l!.position[0]).toBeGreaterThan(0);
    expect(l!.position[1]).toBeGreaterThan(f!.position[1]);
  });

  it('pops the 3D model out toward the viewer at a comfortable size', () => {
    const [f] = projectDetectionsTo3D([fridge]);
    const frame = dirFromEye(f!.position);
    const spawn = dirFromEye(f!.spawnPosition);
    expect(spawn.len).toBeCloseTo(1.6, 2);
    expect(spawn.len).toBeLessThan(frame.len);
    // Same line of sight as the object in the video.
    expect(spawn.x).toBeCloseTo(frame.x, 2);
    expect(spawn.y).toBeCloseTo(frame.y, 2);
    expect(Math.max(...f!.spawnDimensions)).toBeLessThanOrEqual(0.9);
    // A tall fridge stays taller than wide.
    expect(f!.spawnDimensions[1]).toBeGreaterThan(f!.spawnDimensions[0]);
  });
});
