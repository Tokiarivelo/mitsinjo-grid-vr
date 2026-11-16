import * as THREE from 'three';

/**
 * Laser drag for VR panels (VS-T34): an object with `userData.onDrag(local)` follows the ray while
 * the trigger is held (`local` = where the ray crosses the object's own XY plane, in its local
 * space), and gets `userData.onDragEnd()` at release. Used by the dispatcher faders.
 */
export interface XrDraggable extends THREE.Object3D {
  userData: {
    onDrag?: (local: THREE.Vector3) => void;
    onDragEnd?: () => void;
    [key: string]: unknown;
  };
}

/** The first hit that can be dragged (itself or a parent), panels drawn on top first. */
export function findDraggable(hits: readonly THREE.Intersection[]): XrDraggable | null {
  const ordered = [
    ...hits.filter((h) => h.object.userData?.xrUi),
    ...hits.filter((h) => !h.object.userData?.xrUi),
  ];
  for (const hit of ordered) {
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      if (typeof o.userData?.onDrag === 'function') return o as XrDraggable;
      o = o.parent;
    }
  }
  return null;
}

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();
const _ray = new THREE.Ray();
const _q = new THREE.Quaternion();

/**
 * Where the ray (origin, unit direction, world) crosses the object's local XY plane, in its local
 * space, written to `out`. Null when the ray runs parallel to it or points away.
 */
export function dragPoint(
  object: THREE.Object3D,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 | null {
  object.updateMatrixWorld(true);
  _normal.set(0, 0, 1).applyQuaternion(object.getWorldQuaternion(_q));
  _plane.setFromNormalAndCoplanarPoint(_normal, object.getWorldPosition(_point));
  _ray.set(origin, direction);
  if (!_ray.intersectPlane(_plane, out)) return null;
  return object.worldToLocal(out);
}
