import type { Object3D } from 'three';

/** The members of three's XR model factories `xr-input-models.ts` uses (see the `.js` file). */
export class XRHandModelFactory {
  constructor(gltfLoader?: unknown, onLoad?: ((object: Object3D) => void) | null);
  setPath(path: string): this;
  createHandModel(controller: Object3D, profile?: 'spheres' | 'boxes' | 'mesh'): Object3D;
}

export class XRControllerModelFactory {
  constructor(gltfLoader?: unknown, onLoad?: ((scene: Object3D) => void) | null);
  path: string;
  setPath(path: string): this;
  createControllerModel(controller: Object3D): Object3D;
}
