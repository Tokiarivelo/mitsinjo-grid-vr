'use client';

import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { LibraryModel } from '@/lib/model-library';

/**
 * A library model (VS-T51) in the lab: its own glTF, fitted so its largest side is `size` and centred on
 * the origin (the lab's model anchor), shadows on. Shown only when the viewer asks for it, with its credit.
 */
export const LibraryModel3D = memo(function LibraryModel3D({
  entry,
  size,
}: {
  entry: LibraryModel;
  size: number;
}) {
  const { scene } = useGLTF(entry.url);
  const fitted = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    const k = size / Math.max(dims.x, dims.y, dims.z, 1e-6);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.set(-centre.x * k, -centre.y * k, -centre.z * k);
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
  }, [scene, size]);
  return <primitive object={fitted} name={`xr-library-model-${entry.id}`} />;
});
