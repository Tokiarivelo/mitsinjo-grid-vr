'use client';

import { type RefObject, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { Battery } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtPct } from '@/lib/format';
import { BATTERY_POSITION } from '../utils/to-scene-model';
import { mergeParts, type Part } from '../utils/merge-parts';
import type { BatterySceneModel, BatteryStatusColor } from '../types';
import { BATTERY_STATUS_BG_CLASS, BATTERY_STATUS_HEX, TOKEN_HEX } from '../utils/scene-palette';

export interface BatteryUnitProps {
  model: BatterySceneModel;
  /** Translated status text per color (spec: color + text label). */
  statusLabels: Record<BatteryStatusColor, string>;
  /** Translated SoC text, e.g. "62% SoC". */
  socLabel: (pct: string) => string;
  nameLabel?: string;
  /** Stable DOM parent for the label (see VillageCanvas). */
  htmlPortal?: RefObject<HTMLElement | null> | null;
}

/** Fence sides: [x, z, length, rotationY], leaves a gate gap at the front. */
const FENCE_SIDES: [number, number, number, number][] = [
  [0, -2.1, 5.4, 0],
  [-1.75, 2.1, 1.9, 0],
  [1.75, 2.1, 1.9, 0],
  [-2.7, 0, 4.2, Math.PI / 2],
  [2.7, 0, 4.2, Math.PI / 2],
];

/** Evenly spaced post positions (~1.1 apart) along a side of length `len`. */
function fencePostXs(len: number): number[] {
  const n = Math.round(len / 1.1) + 1;
  return Array.from({ length: n }, (_, k) => -len / 2 + (len / (n - 1)) * k);
}

/** Fence geometry merged once: steel posts + rails, and the mesh panels. */
function buildFence() {
  const steel: Part[] = [];
  const mesh: Part[] = [];
  for (const [x, z, len, rot] of FENCE_SIDES) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Local offset along the side → world (rotation about Y).
    const at = (dx: number, y: number): [number, number, number] => [x + dx * cos, y, z - dx * sin];
    for (const y of [0.15, 1.05]) {
      steel.push({
        shape: { kind: 'box', size: [len, 0.035, 0.035] },
        position: at(0, y),
        rotation: [0, rot, 0],
      });
    }
    for (const dx of fencePostXs(len)) {
      steel.push({ shape: { kind: 'box', size: [0.06, 1.1, 0.06] }, position: at(dx, 0.55) });
    }
    mesh.push({
      shape: { kind: 'plane', size: [len, 0.9] },
      position: at(0, 0.6),
      rotation: [0, rot, 0],
    });
  }
  return { steel: mergeParts(steel), mesh: mergeParts(mesh) };
}

export function BatteryUnit({
  model,
  statusLabels,
  socLabel,
  nameLabel = 'BESS Storage',
  htmlPortal,
}: BatteryUnitProps) {
  const { socPct, isCharging, isDischarging, statusColor } = model;

  const statusHexColor = BATTERY_STATUS_HEX[statusColor];
  const flowHex = isCharging
    ? TOKEN_HEX.batteryGreen
    : isDischarging
      ? TOKEN_HEX.solarAmber
      : TOKEN_HEX.idle;

  // >1 so bloom haloes the badges (data color, brighter).
  const boltColor = useMemo(() => new THREE.Color(TOKEN_HEX.energyCyan).multiplyScalar(2.2), []);
  const flowColor = useMemo(() => new THREE.Color(flowHex).multiplyScalar(2), [flowHex]);

  const fence = useMemo(() => buildFence(), []);

  const fillHeight = Math.max(0.05, Math.min(1.2, (socPct / 100) * 1.2));

  return (
    <group position={BATTERY_POSITION} name="battery-bess">
      {/* 1. Concrete Foundation Pad */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[5.6, 0.12, 4.4]} />
        <meshStandardMaterial color="#8b8f94" roughness={0.9} />
      </mesh>

      {/* 2. Dual Modular BESS ISO Containers */}
      {[-1.25, 1.25].map((xOffset, cIdx) => (
        <group key={`container-${cIdx}`} position={[xOffset, 0, 0]}>
          {/* Main Container Enclosure (Cobalt Industrial Blue) */}
          <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.2, 2.1, 3.2]} />
            <meshStandardMaterial color="#1f6fb2" metalness={0.35} roughness={0.4} />
          </mesh>

          {/* White side accent panels */}
          <mesh position={[0, 1.15, 0]} castShadow>
            <boxGeometry args={[2.22, 1.6, 2.6]} />
            <meshStandardMaterial color="#eef2f6" metalness={0.15} roughness={0.45} />
          </mesh>

          {/* High-voltage lightning bolt badge (emissive cyan) */}
          <mesh position={[0, 1.25, 1.62]}>
            <planeGeometry args={[0.3, 0.5]} />
            <meshBasicMaterial color={boltColor} toneMapped={false} />
          </mesh>

          {/* Dual Heavy-duty Rooftop HVAC Chillers */}
          <mesh position={[0, 2.35, 0]} castShadow>
            <boxGeometry args={[1.5, 0.35, 2.2]} />
            <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* 3. SoC LED Charge Level Gauge on Front Panel */}
      <group position={[1.4, 0.2, 1.63]}>
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.2, 1.3, 0.04]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        {/* Continuous Active Charge Gauge Bar */}
        <mesh position={[0, 0.35 + fillHeight / 2, 0.03]}>
          <boxGeometry args={[0.12, fillHeight, 0.02]} />
          <meshBasicMaterial color={statusHexColor} />
        </mesh>
      </group>

      {/* 4. Active Flow Indicator Beacon */}
      <mesh position={[0, 2.7, 0]}>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial color={flowColor} toneMapped={false} />
      </mesh>

      {/* 5. Compound security fence: steel (posts + rails) and translucent mesh, 2 draw calls */}
      <mesh geometry={fence.steel} castShadow>
        <meshStandardMaterial color="#a3acb8" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh geometry={fence.mesh}>
        <meshStandardMaterial
          color="#c9d1da"
          metalness={0.5}
          roughness={0.5}
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* 6. In-Scene Floating 3D Telemetry Badge */}
      {htmlPortal !== null && (
        <Html
          position={[0, 3.4, 0]}
          center
          distanceFactor={18}
          portal={htmlPortal as RefObject<HTMLElement>}
          className="pointer-events-auto select-none"
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full shadow-xl backdrop-blur-md bg-surface/90 border border-border text-[11px] font-sans text-text-primary transition-all whitespace-nowrap">
            <div className="w-5 h-5 rounded-full bg-battery-green/20 flex items-center justify-center shrink-0 border border-battery-green/40">
              <Battery className="w-3.5 h-3.5 text-battery-green" aria-hidden="true" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-text-primary text-[11px]">{nameLabel}</span>
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    BATTERY_STATUS_BG_CLASS[statusColor]
                  )}
                  aria-hidden="true"
                />
                <span className="text-battery-green font-medium">
                  {socLabel(fmtPct(socPct, 0))}
                </span>
                <span className="text-text-muted">· {statusLabels[statusColor]}</span>
              </div>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
