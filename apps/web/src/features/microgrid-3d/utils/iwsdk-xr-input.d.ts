import type * as THREE from 'three';

type Side = 'left' | 'right';

/** The members of IWSDK's `XRInputManager` (`@iwsdk/xr-input` 1.1.0) this app uses. */
export class XRInputManager {
  constructor(options: { scene: THREE.Scene; camera: THREE.PerspectiveCamera });
  readonly xrOrigin: THREE.Group;
  readonly multiPointers: Record<
    Side,
    { toggleSubPointer(kind: 'ray' | 'grab' | 'touch', enabled: boolean): boolean }
  >;
  readonly visualAdapters: Record<
    'hand' | 'controller',
    Record<Side, { visual?: { model: THREE.Object3D } }>
  >;
  update(xrManager: THREE.WebXRManager, delta: number, time: number): void;
}

/** The Quest-style hand's two shared materials (outline colour / thickness uniforms). */
export const outlineMaterial: THREE.ShaderMaterial;
export const stencilMaterial: THREE.ShaderMaterial;
