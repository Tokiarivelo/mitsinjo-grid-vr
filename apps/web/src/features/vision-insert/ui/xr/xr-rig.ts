import * as THREE from 'three';

type Vec3 = [number, number, number];

/**
 * Offset of a reference space that turns the viewer by `angle` (rad, > 0 = to the right, our yaw
 * convention: 0 = -Z, right = +X) about the head at `head` (current reference-space coords),
 * so the head stays where it is: rotation about +Y by `angle`, then the head put back.
 */
export function snapTurnOffset(
  head: Vec3,
  angle: number
): { position: Vec3; orientation: [number, number, number, number] } {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const h = new THREE.Vector3(head[0], 0, head[2]);
  const turned = h.clone().applyQuaternion(q);
  return {
    position: [h.x - turned.x, 0, h.z - turned.z],
    orientation: [q.x, q.y, q.z, q.w],
  };
}

interface XrManagerLike {
  getReferenceSpace: () => XRReferenceSpace | null;
  setReferenceSpace: (space: XRReferenceSpace) => void;
}

/**
 * Snap turn (VS-T23): the WebXR reference space is offset, so the world, the controllers and the
 * hands turn together, instantly (Meta comfort: snap, never a smooth forced rotation). Returns
 * false when the session cannot (no XR space, or no `XRRigidTransform`).
 */
export function snapTurn(xr: XrManagerLike, head: THREE.Vector3, angle: number): boolean {
  const space = xr.getReferenceSpace();
  const Rigid = (globalThis as { XRRigidTransform?: typeof XRRigidTransform }).XRRigidTransform;
  if (!space || !Rigid) return false;
  const { position, orientation } = snapTurnOffset([head.x, head.y, head.z], angle);
  const [x, y, z] = position;
  const [qx, qy, qz, qw] = orientation;
  xr.setReferenceSpace(
    space.getOffsetReferenceSpace(new Rigid({ x, y, z }, { x: qx, y: qy, z: qz, w: qw }))
  );
  return true;
}
