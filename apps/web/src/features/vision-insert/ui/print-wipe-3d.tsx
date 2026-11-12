'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';

/** Bottom-up reveal of a fresh build, like printing layers (ms). */
export const PRINT_WIPE_MS = 900;

/**
 * 3D-print reveal (streaming): while the model builds, each fresh geometry wipes in bottom-up
 * behind a violet print line, like layers coming off the bed. Local clipping on this canvas only;
 * cleared when the wipe ends — and skipped outright under reduced motion or once built (instant).
 * Scene-graph writes go through refs (repo lint forbids mutating hook/prop values in effects).
 */
export function PrintWipe({
  mesh,
  materials,
  scale,
  building,
  reducedMotion,
}: {
  /** Current geometry: a new identity while building restarts the wipe. */
  mesh: THREE.BufferGeometry;
  /** Every material of the model (clipped together). */
  materials: ReadonlyArray<THREE.Material>;
  /** Display scale of the model (the clip plane lives in world space). */
  scale: number;
  /** The model is still being streamed (live preview or staged improvement running). */
  building: boolean;
  reducedMotion: boolean;
}) {
  const get = useThree((s) => s.get);
  const line = useRef<THREE.Mesh>(null);
  const wipe = useRef<{ from: number; to: number; start: number } | null>(null);
  const planeRef = useRef<THREE.Plane | null>(null);
  if (planeRef.current === null) {
    // Keeps y <= constant: raising the constant reveals the model bottom-up.
    planeRef.current = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  }
  const matsRef = useRef<ReadonlyArray<THREE.Material>>([]);

  useEffect(() => {
    get().gl.localClippingEnabled = true;
    return () => {
      get().gl.localClippingEnabled = false;
    };
  }, [get]);

  const bounds = useMemo(() => {
    mesh.computeBoundingBox();
    const box = mesh.boundingBox;
    return { minY: (box?.min.y ?? -0.5) * scale, maxY: (box?.max.y ?? 0.5) * scale };
  }, [mesh, scale]);

  const active = building && !reducedMotion;

  useLayoutEffect(() => {
    matsRef.current = materials;
    const plane = planeRef.current;
    const mats = [...matsRef.current];
    if (!active || !plane) {
      wipe.current = null;
      for (const m of mats) m.clippingPlanes = null;
      if (line.current) line.current.visible = false;
      return;
    }
    for (const m of mats) m.clippingPlanes = [plane];
    plane.constant = bounds.minY;
    wipe.current = { from: bounds.minY, to: bounds.maxY, start: performance.now() };
    if (line.current) {
      line.current.visible = true;
      line.current.position.y = bounds.minY;
    }
  }, [mesh, materials, active, bounds]);

  useFrame((state) => {
    const w = wipe.current;
    const plane = planeRef.current;
    if (!w || !plane) return;
    const t = Math.min(1, (performance.now() - w.start) / PRINT_WIPE_MS);
    // Ease-out: fast first layers, gentle landing.
    const eased = 1 - (1 - t) * (1 - t);
    plane.constant = w.from + (w.to - w.from) * eased;
    if (line.current) line.current.position.y = plane.constant;
    if (t >= 1) {
      wipe.current = null;
      for (const m of [...matsRef.current]) m.clippingPlanes = null;
      if (line.current) line.current.visible = false;
    }
    // frameloop="demand": keep frames coming while the wipe runs.
    state.invalidate();
  });

  return (
    <mesh ref={line} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={9}>
      <planeGeometry args={[3, 3]} />
      <meshBasicMaterial
        color={TOKEN_HEX.aiViolet}
        transparent
        opacity={0.35}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
