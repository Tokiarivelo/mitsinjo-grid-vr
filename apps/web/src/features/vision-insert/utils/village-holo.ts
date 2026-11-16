import type { AppliancePosition } from '@mitsinjo/engine';

/**
 * Village hologram of the VR lab (VS-T28): the village core (scene units, +x east, +z south as on
 * the page's placement map) shrunk onto a round table hologram. Pure: no three.js.
 */

/** Village radius shown (scene units): the flat core with every building, a little margin. */
export const VILLAGE_HOLO_RANGE = 30;

/** Table point (m, table centre at 0) of a village point, for a table of `radius` m. */
export function villageToTable(x: number, z: number, radius: number): [number, number] {
  const k = radius / VILLAGE_HOLO_RANGE;
  return [x * k, z * k];
}

/**
 * Village point under a table point (m), kept inside the shown disc (the page's placement then
 * snaps it onto the terrain and out of buildings, paths and other objects).
 */
export function tableToVillage(tx: number, tz: number, radius: number): AppliancePosition {
  const k = VILLAGE_HOLO_RANGE / radius;
  let x = tx * k;
  let z = tz * k;
  const d = Math.hypot(x, z);
  const max = VILLAGE_HOLO_RANGE * 0.97;
  if (d > max) {
    x *= max / d;
    z *= max / d;
  }
  return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
}

/**
 * Village point under a UV hit on the table disc (three's `CircleGeometry` laid flat by a -90° turn
 * about X: u runs east, v runs north).
 */
export function tableUvToVillage(u: number, v: number, radius: number): AppliancePosition {
  return tableToVillage((u * 2 - 1) * radius, -(v * 2 - 1) * radius, radius);
}

/**
 * Path segments of the village inside the shown disc, as flat [x1, z1, x2, z2] in scene units
 * (one line-segments geometry; segments leaving the disc are dropped).
 */
export function pathSegmentsInRange(
  paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  range = VILLAGE_HOLO_RANGE
): number[] {
  const inside = ([x, z]: readonly [number, number]) => Math.hypot(x, z) <= range;
  const out: number[] = [];
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      if (inside(a) && inside(b)) out.push(a[0], a[1], b[0], b[1]);
    }
  return out;
}
