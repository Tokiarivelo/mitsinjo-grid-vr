'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StudioDesk } from '../../utils/xr-extract';
import {
  DESK_TURN_SECONDS,
  deskPivot,
  deskTurnAngle,
  deskYaw,
  type PanelAnchor,
  type Vec3,
} from './xr-layout';

const restAngle = (desk: StudioDesk) => (desk === '3d' ? Math.PI : 0);

/**
 * The studio's two desks (VS-T31), back to back on a turntable round the viewer: the 2D lab
 * (`twoD`) and the 3D lab (`threeD`). When `desk` changes, the turntable turns (right to left
 * toward the 3D lab, left to right back) and both desks are drawn until it stops; at rest only
 * the desk ahead is mounted (no extra draw calls). Desk content keeps its own anchoring: it turns
 * as a whole about the viewer, the room around it stays still.
 */
export function StudioDesks({
  anchor,
  desk,
  twoD,
  threeD,
}: {
  anchor: PanelAnchor;
  desk: StudioDesk;
  twoD: ReactNode;
  threeD: ReactNode;
}) {
  // Derived state (React: « storing information from previous renders »): a desk change starts a turn.
  const [shownDesk, setShownDesk] = useState(desk);
  const [turning, setTurning] = useState<StudioDesk | null>(null);
  if (shownDesk !== desk) {
    setShownDesk(desk);
    setTurning(desk);
  }
  const elapsed = useRef(0);
  const running = useRef<StudioDesk | null>(null);

  const pivot = useMemo(() => deskPivot(anchor), [anchor]);
  const back = useMemo(() => pivot.map((v) => -v) as Vec3, [pivot]);
  const twoDRef = useRef<THREE.Group>(null);
  const threeDRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    let angle = restAngle(desk);
    if (turning !== running.current) {
      // A turn starts; reversed half way, it carries on from where the desks stand (eased symmetric).
      const was = running.current;
      running.current = turning;
      elapsed.current = was && turning ? Math.max(0, DESK_TURN_SECONDS - elapsed.current) : 0;
    }
    if (turning) {
      elapsed.current += Math.min(delta, 0.1);
      const k = elapsed.current / DESK_TURN_SECONDS;
      angle = deskTurnAngle(turning, k);
      if (k >= 1) setTurning(null);
    }
    if (twoDRef.current) twoDRef.current.rotation.y = deskYaw('2d', angle);
    if (threeDRef.current) threeDRef.current.rotation.y = deskYaw('3d', angle);
  });

  // Memoised: R3F re-applies a changed prop, so a re-render mid-turn must not snap the desks back.
  const start = turning ? deskTurnAngle(turning, 0) : restAngle(desk);
  const twoDStart = useMemo<Vec3>(() => [0, deskYaw('2d', start), 0], [start]);
  const threeDStart = useMemo<Vec3>(() => [0, deskYaw('3d', start), 0], [start]);
  return (
    <group position={pivot} name="xr-studio-desks">
      {(desk === '2d' || turning) && (
        <group ref={twoDRef} rotation={twoDStart} name="xr-desk-2d">
          <group position={back}>{twoD}</group>
        </group>
      )}
      {(desk === '3d' || turning) && (
        <group ref={threeDRef} rotation={threeDStart} name="xr-desk-3d">
          <group position={back}>{threeD}</group>
        </group>
      )}
    </group>
  );
}
