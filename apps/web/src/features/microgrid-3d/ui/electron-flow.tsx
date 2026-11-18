'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LineFlowSceneModel } from '../types';
import { useAmbientFrame } from '../hooks/use-ambient-frame';
import { routeCable } from '../utils/cable-route';
import { easeToward } from '../utils/ease-toward';
import { NO_LOAD_KW } from '../utils/feeder-tone';
import { flowFactor } from '../utils/scene-palette';
import {
  buildArcPath,
  electronCount,
  electronPeriodS,
  sampleArcPath,
  type ArcPath,
} from '../utils/flow-path';

export interface ElectronFlowProps {
  /** Every cable of the scene; only `active` ones (current flowing) get electrons. */
  lines: LineFlowSceneModel[];
  /** False under reduced motion or a modified scenario: electrons stay frozen in place. */
  animate?: boolean;
}

/** Line `speed` (0.5–2.5) → world units per second. */
const SPEED_SCALE = 2.2;
const RADIUS = 0.085;
/** Slight lift so dots ride on top of the cable instead of z-fighting with it. */
const LIFT = 0.03;

interface Track {
  key: string;
  path: ArcPath;
  count: number;
  period: number;
  reverse: boolean;
  firstInstance: number;
  /** Line colour before the kW glow (the glow eases toward `glow`). */
  base: THREE.Color;
  /** Target emissive multiplier ∝ kW: faint glow in survival (1.3), full bloom at high power (3.2). */
  glow: number;
}

/**
 * Glowing dots that travel along powered cables, from the source toward the
 * consumers. One InstancedMesh for the whole grid (1 draw call); cut lines get none.
 */
export function ElectronFlow({ lines, animate = true }: ElectronFlowProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const requestFrame = useAmbientFrame();

  const { tracks, total } = useMemo(() => {
    const list: Track[] = [];
    let n = 0;
    for (const line of lines) {
      // Cut or idle cable: no particles (PL-T11)
      if (!line.active || line.direction === 'idle' || line.flowKw <= NO_LOAD_KW) continue;
      const path = buildArcPath(routeCable(line.from, line.to).points);

      // Density ∝ feeder kW: wider spacing (fewer dots) at low power, 2.2 → 1.1 world units
      const kwFactor = flowFactor(line.flowKw);
      const lineSpacing = 2.2 - 1.1 * kwFactor;
      const count = electronCount(path.total, lineSpacing);

      // Speed ∝ feeder kW
      const speed = Math.max(0.4, Math.min(3.0, line.speed * (0.6 + 1.2 * kwFactor)));
      const period = electronPeriodS(path.total, speed * SPEED_SCALE);
      const key = `${line.from.join(',')}-${line.to.join(',')}`;
      list.push({
        key,
        path,
        count,
        period,
        reverse: line.direction === 'backward',
        firstInstance: n,
        base: new THREE.Color(line.color).lerp(new THREE.Color('#ffffff'), 0.35),
        glow: 1.3 + 1.9 * kwFactor,
      });
      n += count;
    }
    return { tracks: list, total: n };
  }, [lines]);

  // Shown glow per line, eased toward its target: a capped feeder fades over ~1 s (no jump).
  const glowRef = useRef<Record<string, number>>({});
  const scratchColor = useMemo(() => new THREE.Color(), []);
  /** Writes each line's shown glow; `dt` > 0 eases it, `force` repaints all (a new mesh). */
  const paint = (dt: number, force: boolean) => {
    const mesh = meshRef.current;
    if (!mesh) return false;
    let moving = false;
    for (const tr of tracks) {
      const was = animate ? (glowRef.current[tr.key] ?? tr.glow) : tr.glow;
      const now = dt > 0 ? easeToward(was, tr.glow, dt) : was;
      if (now !== tr.glow) moving = true;
      if (!force && now === glowRef.current[tr.key]) continue;
      glowRef.current[tr.key] = now;
      scratchColor.copy(tr.base).multiplyScalar(now);
      for (let i = 0; i < tr.count; i++) mesh.setColorAt(tr.firstInstance + i, scratchColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return moving;
  };

  // Persistent continuous phase per line so dots never jump when speed changes or scrub happens.
  const phasesRef = useRef<Record<string, number>>({});

  // Scratch objects reused every frame (no per-frame allocation).
  const scratch = useMemo(() => ({ obj: new THREE.Object3D(), p: [0, 0, 0] }), []);

  const place = () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (const tr of tracks) {
      const basePhase = phasesRef.current[tr.key] ?? 0;
      for (let j = 0; j < tr.count; j++) {
        const phase = basePhase + j / tr.count;
        sampleArcPath(tr.path, tr.reverse ? -phase : phase, scratch.p);
        scratch.obj.position.set(scratch.p[0]!, scratch.p[1]! + LIFT, scratch.p[2]!);
        scratch.obj.updateMatrix();
        mesh.setMatrixAt(tr.firstInstance + j, scratch.obj.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Repaint from the shown glow (kept per line across remounts); the frame loop eases it on.
    if (paint(0, true)) requestFrame();
    place();
    invalidate();
    // place()/paint() only read tracks/scratch/refs, covered by the `tracks` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, invalidate, requestFrame]);

  const isFlowing = animate && total > 0;
  useEffect(() => {
    if (isFlowing) invalidate();
  }, [isFlowing, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (animate && total > 0 && paint(dt, false)) requestFrame();
    if (!isFlowing) return;
    for (const tr of tracks) {
      const current = phasesRef.current[tr.key] ?? 0;
      const advance = tr.period > 0 && isFinite(tr.period) ? dt / tr.period : 0;
      phasesRef.current[tr.key] = (current + advance) % 1;
    }
    place();
    requestFrame();
  });

  if (total === 0) return null;

  return (
    <instancedMesh
      // Remount when the instance count changes (InstancedMesh count is fixed at creation).
      key={total}
      ref={meshRef}
      args={[undefined, undefined, total]}
      name="electron-flow"
      frustumCulled={false}
    >
      <sphereGeometry args={[RADIUS, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
