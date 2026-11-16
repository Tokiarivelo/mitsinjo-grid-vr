import { describe, expect, it } from 'vitest';
import {
  pathSegmentsInRange,
  tableToVillage,
  tableUvToVillage,
  villageToTable,
  VILLAGE_HOLO_RANGE,
} from '../utils/village-holo';

describe('village hologram mapping (VS-T28)', () => {
  it('maps the village core onto the table and back', () => {
    const [tx, tz] = villageToTable(15, -9, 0.32);
    expect(tx).toBeCloseTo((15 * 0.32) / VILLAGE_HOLO_RANGE);
    expect(tableToVillage(tx, tz, 0.32)).toEqual({ x: 15, z: -9 });
  });

  it('keeps a point off the table inside the shown disc', () => {
    const p = tableToVillage(1, 0, 0.32);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(VILLAGE_HOLO_RANGE);
    expect(p.z).toBe(0);
  });

  it('reads a UV hit: u east, v north (-z)', () => {
    expect(tableUvToVillage(0.5, 0.5, 0.32)).toEqual({ x: 0, z: 0 });
    const ne = tableUvToVillage(0.75, 0.75, 0.32);
    expect(ne.x).toBeGreaterThan(0);
    expect(ne.z).toBeLessThan(0);
  });

  it('keeps only the path segments inside the disc', () => {
    const seg = pathSegmentsInRange([
      [
        [0, 0],
        [10, 0],
        [80, 0],
      ],
    ]);
    expect(seg).toEqual([0, 0, 10, 0]);
  });
});
