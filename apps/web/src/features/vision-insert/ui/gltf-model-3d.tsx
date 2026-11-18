'use client';

import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/**
 * A glTF model fitted and placed for the scene (VS-T51 library, VS-T52 prepared mock models): its
 * largest side becomes `size` and it is centred on the origin (or, with `stand`, stands on it), or,
 * with `height`, it stands on the origin with that height. Shadows on. The loaded scene is cloned, so one file serves many copies.
 */
export const GltfModel3D = memo(function GltfModel3D({
  url,
  size,
  height,
  stand = false,
  name,
}: {
  url: string;
  /** Largest side, centred on the origin (lab pedestal). */
  size?: number;
  /** Height, standing on the origin (village ground). Wins over `size`. */
  height?: number;
  /** With `size`: its base on the origin instead of its centre (a model on a plate). */
  stand?: boolean;
  name?: string;
}) {
  const { scene } = useGLTF(url);
  const fitted = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const k =
      height !== undefined
        ? height / Math.max(dims.y, 1e-6)
        : (size ?? 1) / Math.max(dims.x, dims.y, dims.z, 1e-6);
    const y = height !== undefined || stand ? -box.min.y * k : -centre.y * k;
    root.position.set(-centre.x * k, y, -centre.z * k);
    root.scale.setScalar(k);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const g = new THREE.Group();
    g.add(root);
    return g;
  }, [scene, size, height, stand]);
  return <primitive object={fitted} name={name ?? 'gltf-model'} />;
});
