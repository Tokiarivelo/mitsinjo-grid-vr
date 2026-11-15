import { describe, expect, it } from 'vitest';
import type { ApplianceDetection } from '@/lib/vision';
import { OUTLINE_MAX_POINTS, outlineRings, projectDetectionsTo3D } from '../spatial-projection';
import { screenHitFromRay, screenPoint, WEBCAM_SCREEN } from '../webcam-screen';

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

describe('outline on the view (VS-T18)', () => {
  const det = (over: Partial<ApplianceDetection> = {}): ApplianceDetection => ({
    id: 'det-1',
    label: 'Fridge',
    category: 'fridge',
    box: { x: 0.2, y: 0.2, w: 0.2, h: 0.4 },
    ...over,
  });

  it('falls back to the box ring when there is no SAM outline', () => {
    const rings = outlineRings(det());
    expect(rings).toHaveLength(1);
    const want = [
      [0.2, 0.2],
      [0.4, 0.2],
      [0.4, 0.6],
      [0.2, 0.6],
    ];
    rings[0]!.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(want[i]![0]!, 6);
      expect(p[1]).toBeCloseTo(want[i]![1]!, 6);
    });
  });

  it('keeps the largest SAM rings first, sampled to the point budget', () => {
    const many = Array.from({ length: 300 }, (_, i) => {
      const a = (i / 300) * Math.PI * 2;
      return `${i ? 'L' : 'M'}${(0.5 + 0.3 * Math.cos(a)).toFixed(4)} ${(0.5 + 0.3 * Math.sin(a)).toFixed(4)}`;
    }).join('');
    const rings = outlineRings(det({ outline: `M0.1 0.1L0.12 0.1L0.12 0.12Z${many}Z` }));
    expect(rings).toHaveLength(2);
    expect(rings[0]!.length).toBeLessThanOrEqual(OUTLINE_MAX_POINTS);
    expect(rings[0]!.length).toBeGreaterThan(50);
    expect(rings[1]).toHaveLength(3);
  });

  it('puts outline points and the label anchor on the eye line, in front of the screen', () => {
    const [t] = projectDetectionsTo3D([det()]);
    const eye = [0, 1.6, 0];
    for (const p of t!.outline[0]!) {
      expect(p[2]).toBeGreaterThan(WEBCAM_SCREEN.center[2]);
      expect(p[2]).toBeLessThan(0);
    }
    // Top of the box is above its centre.
    expect(t!.labelAnchor[1]).toBeGreaterThan(t!.position[1]);
    // The anchor sits on the ray from the eye to the box's top centre on the screen.
    const s = screenPoint(0.3, 0.2);
    const dir = s.map((v, i) => v - eye[i]!);
    const a = t!.labelAnchor.map((v, i) => v - eye[i]!);
    const cross = [
      dir[1]! * a[2]! - dir[2]! * a[1]!,
      dir[2]! * a[0]! - dir[0]! * a[2]!,
      dir[0]! * a[1]! - dir[1]! * a[0]!,
    ];
    expect(Math.hypot(...cross)).toBeLessThan(0.01);
  });
});
