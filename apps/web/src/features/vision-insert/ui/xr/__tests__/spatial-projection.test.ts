import { describe, expect, it } from 'vitest';
import type { ApplianceDetection } from '@/lib/vision';
import { projectDetectionsTo3D } from '../spatial-projection';

describe('projectDetectionsTo3D (VS-T3)', () => {
  const mockFridge: ApplianceDetection = {
    id: 'fridge-1',
    label: 'Fridge',
    category: 'fridge',
    box: { x: 0.1, y: 0.2, w: 0.3, h: 0.6 },
  };

  const mockLamp: ApplianceDetection = {
    id: 'lamp-1',
    label: 'Lamp',
    category: 'lamp',
    box: { x: 0.6, y: 0.05, w: 0.3, h: 0.3 },
  };

  it('returns an empty array when no detections are provided', () => {
    expect(projectDetectionsTo3D([])).toEqual([]);
  });

  it('projects single detection centered in front of the viewer facing -Z', () => {
    const targets = projectDetectionsTo3D([mockFridge]);
    expect(targets).toHaveLength(1);
    const target = targets[0]!;
    expect(target.id).toBe('fridge-1');
    expect(target.position[2]).toBeLessThan(0); // in front along -Z
    expect(target.position[1]).toBeGreaterThanOrEqual(0.6);
    expect(target.position[1]).toBeLessThanOrEqual(1.8);
    expect(target.hitRadius).toBeGreaterThan(0.2);
  });

  it('distributes multiple detections horizontally along the viewing arc without stacking', () => {
    const targets = projectDetectionsTo3D([mockFridge, mockLamp]);
    expect(targets).toHaveLength(2);
    // Fridge is on left side (x=0.1, w=0.3 -> xCenter=0.25 -> left)
    // Lamp is on right side (x=0.6, w=0.3 -> xCenter=0.75 -> right)
    expect(targets[0]!.position[0]).toBeLessThan(0);
    expect(targets[1]!.position[0]).toBeGreaterThan(0);
    // Both are placed in front (z < 0)
    expect(targets[0]!.position[2]).toBeLessThan(0);
    expect(targets[1]!.position[2]).toBeLessThan(0);
    // Upper item (lamp at y=0.05) has higher elevation y than lower item (fridge at y=0.2)
    expect(targets[1]!.position[1]).toBeGreaterThan(targets[0]!.position[1]);
  });
});
