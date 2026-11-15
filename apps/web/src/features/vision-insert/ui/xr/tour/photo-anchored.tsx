'use client';

import { useRef, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PhotoGround } from './grounded';

/**
 * Keeps its children on the 360° photo while the viewer walks: moved every frame by the photo's
 * live walk offset (same as the floor arrows). Without `photo` it stays put (webcam wall).
 */
export function PhotoAnchored({
  photo,
  children,
}: {
  photo: PhotoGround | null | undefined;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (photo) g.position.set(-photo.offset[0], -photo.offset[1], -photo.offset[2]);
    else g.position.set(0, 0, 0);
  });
  return (
    <group ref={ref} name="photo-anchored">
      {children}
    </group>
  );
}
