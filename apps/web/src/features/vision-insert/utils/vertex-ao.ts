import * as THREE from 'three';

/**
 * Shadow where parts meet (PQ-T27): a cheap ambient occlusion baked into the vertex colours at merge time, so
 * a roof sits on its walls and a body on the ground instead of floating. Pure (three.js maths only), once per
 * recipe, the same on both quality tiers. A vertex darkens when it lies close to another part's surface AND
 * faces it (a roof underside faces the wall below it; a window on the wall face looks away, so it keeps its
 * colour), or when it is close to the ground. Colours never fall under `AO_MIN`, so no part goes black.
 */

/** Reach of the occlusion, object units (largest side = 1). */
export const AO_RADIUS = 0.05;

/** Darkening at contact (0 = none): contact reads 1 − 0.35 = 0.65 before the floor. */
export const AO_STRENGTH = 0.35;

/** Contact shadow under the object: a touch softer than a joint. */
export const GROUND_STRENGTH = 0.3;

/** No colour channel is ever multiplied by less than this. */
export const AO_MIN = 0.6;

/** A vertex faces another part when its normal points at the part's centre within this cosine. */
const FACING_COS = 0.2;

interface PartBox {
  box: THREE.Box3;
  centre: THREE.Vector3;
}

/** Distance from a point to the outside of a box; for a point inside, the distance to the nearest face. */
function surfaceDistance(p: THREE.Vector3, box: THREE.Box3): number {
  if (!box.containsPoint(p)) return box.distanceToPoint(p);
  return Math.min(
    p.x - box.min.x,
    box.max.x - p.x,
    p.y - box.min.y,
    box.max.y - p.y,
    p.z - box.min.z,
    box.max.z - p.z
  );
}

/**
 * Multiplies each geometry's `color` attribute by its occlusion factor, in place (once). Geometries need
 * `position`, `normal` and `color`. Returns the same array. The factor of a vertex is the strongest of its
 * joint and ground darkening, floored at `AO_MIN`.
 */
export function applyVertexAo(
  geometries: ReadonlyArray<THREE.BufferGeometry>,
  radius = AO_RADIUS
): ReadonlyArray<THREE.BufferGeometry> {
  if (geometries.length === 0) return geometries;
  const parts: PartBox[] = geometries.map((g) => {
    g.computeBoundingBox();
    const box = g.boundingBox!.clone();
    return { box, centre: box.getCenter(new THREE.Vector3()) };
  });
  const groundY = Math.min(...parts.map((p) => p.box.min.y));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const to = new THREE.Vector3();
  geometries.forEach((g, a) => {
    const pos = g.getAttribute('position');
    const normal = g.getAttribute('normal');
    const color = g.getAttribute('color');
    if (!pos || !normal || !color) return;
    // Parts that cannot reach this one are skipped once, not per vertex.
    const near = parts.filter(
      (o, b) => b !== a && o.box.clone().expandByScalar(radius).intersectsBox(parts[a]!.box)
    );
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(normal, i);
      let factor = 1;
      for (const o of near) {
        const d = surfaceDistance(p, o.box);
        if (d >= radius) continue;
        to.subVectors(o.centre, p).normalize();
        if (n.dot(to) < FACING_COS) continue;
        factor = Math.min(factor, 1 - AO_STRENGTH * (1 - d / radius));
      }
      const height = p.y - groundY;
      if (height < radius)
        factor = Math.min(factor, 1 - GROUND_STRENGTH * (1 - Math.max(0, height) / radius));
      factor = Math.max(AO_MIN, factor);
      if (factor < 1)
        color.setXYZ(i, color.getX(i) * factor, color.getY(i) * factor, color.getZ(i) * factor);
    }
    color.needsUpdate = true;
  });
  return geometries;
}
