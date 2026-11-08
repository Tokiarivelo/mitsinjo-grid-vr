'use client';

import { type RefObject, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { Cpu } from 'lucide-react';
import { SECTOR_IDS, type SectorId } from '@mitsinjo/engine';
import { cn } from '@/lib/utils';
import { fmtKw } from '@/lib/format';
import {
  BUS_INLET_POSITION,
  BUS_POSITION,
  FEEDER_EXIT_X,
  FEEDER_EXIT_Z,
} from '../utils/to-scene-model';
import { mergeParts, type Part } from '../utils/merge-parts';
import type { ControllerSceneModel, StatusColor } from '../types';
import { STATUS_HEX, TOKEN_HEX } from '../utils/scene-palette';
import { DispatchShareBar, type DispatchSegment } from './dispatch-share-bar';

export interface DispatchControllerUnitProps {
  model: ControllerSceneModel;
  /** Per-sector display tone (breaker + sector status), from `feederTone`. */
  tones?: Record<SectorId, StatusColor>;
  totalServedKw: number;
  /** Translated controller mode, e.g. "Rationing". */
  modeLabel: string;
  /** Tooltip per sector segment of the dispatch bar. */
  feederTitles?: Record<SectorId, string>;
  hasResult?: boolean;
  onFocus?: () => void;
  /** Translated name, e.g. "EMS Dispatch". */
  nameLabel: string;
  htmlPortal?: RefObject<HTMLElement | null> | null;
}

/** Merged technical shelter: concrete pad, frame, roof, enclosure, and cable conduits. */
function buildShelter() {
  const parts: Part[] = [];

  // Concrete foundation pad
  parts.push({
    shape: { kind: 'box', size: [2.6, 0.14, 2.0] },
    position: [0, 0.07, 0],
  });

  // 4 steel shelter posts
  const postXs = [-1.15, 1.15];
  const postZs = [-0.85, 0.85];
  for (const px of postXs) {
    for (const pz of postZs) {
      parts.push({
        shape: { kind: 'box', size: [0.08, 2.1, 0.08] },
        position: [px, 1.12, pz],
      });
    }
  }

  // Canopy roof with slight slope
  parts.push({
    shape: { kind: 'box', size: [2.8, 0.06, 2.2] },
    position: [0, 2.2, 0],
    rotation: [-0.05, 0, 0],
  });

  // Back wall panel
  parts.push({
    shape: { kind: 'box', size: [2.3, 1.7, 0.04] },
    position: [0, 1.05, -0.82],
  });

  // Main EMS enclosure / cabinet body
  parts.push({
    shape: { kind: 'box', size: [1.6, 1.35, 0.55] },
    position: [0, 0.95, -0.2],
  });

  // Base plinth
  parts.push({
    shape: { kind: 'box', size: [1.5, 0.18, 0.5] },
    position: [0, 0.23, -0.2],
  });

  // Roof gantry carrying the feeder departures: 2 posts + cross-arm, plus the inlet post.
  for (const gx of [-0.8, 0.8]) {
    parts.push({
      shape: { kind: 'box', size: [0.06, 0.4, 0.06] },
      position: [gx, 2.4, FEEDER_EXIT_Z],
    });
  }
  parts.push({
    shape: { kind: 'box', size: [1.7, 0.05, 0.07] },
    position: [0, 2.56, FEEDER_EXIT_Z],
  });
  parts.push({
    shape: { kind: 'box', size: [0.08, 0.45, 0.08] },
    position: [0, 2.4, BUS_INLET_POSITION[2] - BUS_POSITION[2]],
  });

  // Breaker mounting rail on the front face
  parts.push({
    shape: { kind: 'box', size: [1.35, 0.18, 0.04] },
    position: [0, 0.65, 0.09],
  });

  return mergeParts(parts);
}

/** Feeder riser: from the cabinet top, through the roof, to its gantry insulator. */
function buildRiser() {
  return mergeParts([
    {
      shape: { kind: 'cylinder', radiusTop: 0.025, radiusBottom: 0.025, height: 0.98 },
      position: [0, 2.11, 0],
    },
    {
      shape: { kind: 'cylinder', radiusTop: 0.035, radiusBottom: 0.05, height: 0.12 },
      position: [0, 2.6, 0],
    },
  ]);
}

/** EMS badge anchor (shelter-local): front of the pad, at breaker height. */
const CONTROLLER_LABEL_POSITION: [number, number, number] = [0, 0.55, 1.05];

const DEFAULT_TONES: Record<SectorId, StatusColor> = {
  health: 'battery-green',
  water: 'battery-green',
  school: 'battery-green',
  households: 'battery-green',
  market: 'battery-green',
  industry: 'battery-green',
};

export function DispatchControllerUnit({
  model,
  tones = DEFAULT_TONES,
  totalServedKw,
  modeLabel,
  feederTitles = {} as Record<SectorId, string>,
  hasResult = true,
  onFocus,
  nameLabel,
  htmlPortal,
}: DispatchControllerUnitProps) {
  const [hovered, setHovered] = useState(false);
  const shelterGeom = useMemo(() => buildShelter(), []);
  const riserGeom = useMemo(() => buildRiser(), []);
  const segments: DispatchSegment[] = SECTOR_IDS.map((id) => ({
    id,
    share: model.feeders[id]?.share ?? 0,
    tone: tones[id] ?? 'idle',
    title: feederTitles?.[id] ?? '',
  }));

  const mode = model.mode;
  const isNormal = mode === 'normal';
  const isEmergency = mode === 'lifeline_only';

  // Screen glow color based on dispatch mode
  const screenColorHex = isNormal ? TOKEN_HEX.energyCyan : TOKEN_HEX.solarAmber;

  const screenGlow = useMemo(
    () => new THREE.Color(screenColorHex).multiplyScalar(isEmergency ? 2.5 : 1.8),
    [screenColorHex, isEmergency]
  );

  return (
    <group
      position={BUS_POSITION}
      name="ems-dispatch-controller"
      onClick={(e) => {
        e.stopPropagation();
        onFocus?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* 1. Merged technical shelter structure (pad, frame, canopy, cabinet) */}
      <mesh geometry={shelterGeom} receiveShadow castShadow>
        <meshStandardMaterial
          color={hovered ? '#6b7280' : '#4b5563'}
          roughness={0.7}
          metalness={0.3}
        />
      </mesh>

      {/* 2. Emissive EMS status screen on the cabinet front */}
      <mesh position={[0, 1.25, 0.08]} castShadow={false}>
        <planeGeometry args={[0.55, 0.28]} />
        <meshStandardMaterial
          color={screenColorHex}
          emissive={screenGlow}
          emissiveIntensity={1.2}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* 3. One breaker + LED per feeder, and its riser up to the roof gantry where the
          sector cable leaves the controller (same west → east order as the cables). */}
      {SECTOR_IDS.map((sectorId) => {
        const feeder = model.feeders[sectorId];
        const posX = FEEDER_EXIT_X[sectorId];
        const hex = STATUS_HEX[tones[sectorId]];
        const live = (feeder?.servedKw ?? 0) > 0.05;
        return (
          <group key={sectorId}>
            <group position={[posX, 0.65, 0.11]}>
              <mesh>
                <boxGeometry args={[0.12, 0.14, 0.02]} />
                <meshStandardMaterial color="#1f2937" roughness={0.8} />
              </mesh>
              <mesh position={[0, 0.03, 0.015]}>
                <sphereGeometry args={[0.02, 8, 8]} />
                <meshBasicMaterial color={hex} toneMapped={false} />
              </mesh>
            </group>
            <mesh geometry={riserGeom} position={[posX, 0, FEEDER_EXIT_Z]}>
              <meshStandardMaterial
                color={live ? hex : '#2a2f36'}
                emissive={live ? hex : '#000000'}
                emissiveIntensity={live ? 1.4 : 0}
                roughness={0.5}
                toneMapped={!live}
              />
            </mesh>
          </group>
        );
      })}

      {/* 4. HUD badge centered on the shelter's front edge, below roof level: it stays
          attached to the unit and never covers the battery behind. */}
      {htmlPortal !== null && (
        <Html
          position={CONTROLLER_LABEL_POSITION}
          center
          distanceFactor={18}
          portal={htmlPortal as RefObject<HTMLElement>}
          zIndexRange={[10, 0]}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFocus?.();
            }}
            aria-label={`${nameLabel} · ${modeLabel} · ${fmtKw(hasResult ? totalServedKw : null)}`}
            className={cn(
              'pointer-events-auto flex w-36 cursor-pointer flex-col gap-1 rounded-control-sm border bg-surface/90 px-2 py-1 text-left shadow-lg backdrop-blur-sm transition-transform hover:scale-105',
              isEmergency
                ? 'border-warning-amber/70 ring-1 ring-warning-amber/40'
                : 'border-border/80 hover:border-energy-cyan/70'
            )}
          >
            <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[10px]">
              <Cpu
                className={cn(
                  'h-3 w-3 shrink-0',
                  isNormal ? 'text-energy-cyan' : 'text-warning-amber',
                  isEmergency && 'animate-pulse'
                )}
                aria-hidden="true"
              />
              <span className="truncate font-semibold text-text-primary">{nameLabel}</span>
            </span>
            <span className="flex items-center justify-between gap-1 whitespace-nowrap font-mono text-[9px]">
              <span
                className={cn(
                  'flex items-center gap-1 font-semibold',
                  isNormal ? 'text-battery-green' : 'text-warning-amber'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isNormal ? 'bg-battery-green' : 'bg-warning-amber',
                    isEmergency && 'animate-pulse'
                  )}
                  aria-hidden="true"
                />
                {modeLabel}
              </span>
              <span className="font-semibold text-energy-cyan">
                {fmtKw(hasResult ? totalServedKw : null)}
              </span>
            </span>
            {hasResult && <DispatchShareBar segments={segments} />}
          </button>
        </Html>
      )}
    </group>
  );
}
