'use client';

import { type RefObject, useMemo } from 'react';
import { Html, Instance, Instances } from '@react-three/drei';
import { Sun } from 'lucide-react';
import { fmtKw } from '@/lib/format';
import { SOLAR_POSITION } from '../utils/to-scene-model';
import { TOKEN_HEX } from '../utils/scene-palette';
import type { SolarSceneModel } from '../types';
import { solarCellTexture } from './procedural-textures';
import { mergeParts, type Part } from '../utils/merge-parts';

const ROWS = 5;
const COLS = 4;
const TABLE_COUNT = ROWS * COLS;
const PANEL_HEIGHT = 0.65;
const TILT_RAD = -0.32; // ~18.5° tilt towards sunset
const PANEL_TILT: [number, number, number] = [TILT_RAD, 0, 0];
const CELL_OFFSET_Y = 0.03 * Math.cos(TILT_RAD);
const CELL_OFFSET_Z = 0.03 * Math.sin(TILT_RAD);

export interface SolarArrayProps {
  model: SolarSceneModel;
  nameLabel?: string;
  outputLabel?: string;
  htmlPortal?: RefObject<HTMLElement | null>;
}

export function SolarArray({
  model,
  nameLabel = 'Solar PV Array',
  outputLabel,
  htmlPortal,
}: SolarArrayProps) {
  const { currentKw, glowIntensity, isGenerating } = model;

  const panelLayout = useMemo(() => {
    const items: [number, number, number][] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        items.push([col * 2.2 - 3.3, 0, row * 1.6 - 3.2]);
      }
    }
    return items;
  }, []);

  // Generation glow (data): a soft cyan sheen that bloom picks up at high output.
  const emissiveIntensity = Math.min(0.9, glowIntensity * 0.75);
  const cellMap = useMemo(() => {
    const tex = solarCellTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(2, 1);
    return tex;
  }, []);
  // Perimeter fence: posts + 4 rails merged into one geometry (1 draw call).
  const fence = useMemo(() => {
    const hx = 4.7;
    const hz = 4.3;
    const parts: Part[] = [];
    const post = (x: number, z: number) =>
      parts.push({ shape: { kind: 'box', size: [0.06, 0.9, 0.06] }, position: [x, 0.45, z] });
    for (let x = -hx; x <= hx + 0.01; x += 1.175) {
      post(x, -hz);
      post(x, hz);
    }
    for (let z = -hz + 1.075; z < hz - 0.01; z += 1.075) {
      post(-hx, z);
      post(hx, z);
    }
    for (const z of [-hz, hz]) {
      parts.push({ shape: { kind: 'box', size: [hx * 2, 0.035, 0.035] }, position: [0, 0.8, z] });
    }
    for (const x of [-hx, hx]) {
      parts.push({ shape: { kind: 'box', size: [0.035, 0.035, hz * 2] }, position: [x, 0.8, 0] });
    }
    return mergeParts(parts);
  }, []);

  return (
    <group position={SOLAR_POSITION} name="solar-array">
      {/* 1. Perimeter fence (posts instanced + 4 rails) */}
      <mesh geometry={fence} name="solar-fence" castShadow>
        <meshStandardMaterial color="#9aa3ad" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* 2. Racks of solar panels: 4 instanced draw calls total */}
      <Instances limit={TABLE_COUNT} name="solar-legs-short" castShadow receiveShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 6]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
        {panelLayout.map(([x, y, z], idx) => (
          <Instance key={idx} position={[x, y + 0.35, z - 0.35]} />
        ))}
      </Instances>

      <Instances limit={TABLE_COUNT} name="solar-legs-long" castShadow receiveShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.15, 6]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
        {panelLayout.map(([x, y, z], idx) => (
          <Instance key={idx} position={[x, y + 0.58, z + 0.35]} />
        ))}
      </Instances>

      <Instances limit={TABLE_COUNT} name="solar-backplates" castShadow receiveShadow>
        <boxGeometry args={[2.05, 0.05, 1.3]} />
        <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
        {panelLayout.map(([x, y, z], idx) => (
          <Instance key={idx} position={[x, y + PANEL_HEIGHT, z]} rotation={PANEL_TILT} />
        ))}
      </Instances>

      <Instances limit={TABLE_COUNT} name="solar-cells" castShadow receiveShadow>
        <boxGeometry args={[1.98, 0.02, 1.24]} />
        <meshStandardMaterial
          map={cellMap}
          color="#ffffff"
          roughness={0.18}
          metalness={0.55}
          envMapIntensity={1.5}
          emissive={TOKEN_HEX.energyCyan}
          emissiveIntensity={emissiveIntensity}
        />
        {panelLayout.map(([x, y, z], idx) => (
          <Instance
            key={idx}
            position={[x, y + PANEL_HEIGHT + CELL_OFFSET_Y, z + CELL_OFFSET_Z]}
            rotation={PANEL_TILT}
          />
        ))}
      </Instances>

      {/* 3. Solar Inverter Station Cabinet */}
      <group position={[3.9, 0, 3.7]}>
        {/* Concrete equipment pad */}
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <boxGeometry args={[1.1, 0.12, 0.9]} />
          <meshStandardMaterial color="#8b929a" roughness={0.9} />
        </mesh>
        {/* Main industrial enclosure */}
        <mesh position={[0, 0.81, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.82, 1.38, 0.62]} />
          <meshStandardMaterial color="#3e4c59" roughness={0.45} metalness={0.55} />
        </mesh>
        {/* Cooling louver ventilation grilles */}
        <mesh position={[0, 0.65, 0.32]}>
          <planeGeometry args={[0.55, 0.35]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        {/* Cable conduits entering the ground */}
        <mesh position={[-0.2, 0.2, 0.32]}>
          <cylinderGeometry args={[0.025, 0.025, 0.4, 6]} />
          <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0.2, 0.2, 0.32]}>
          <cylinderGeometry args={[0.025, 0.025, 0.4, 6]} />
          <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Status beacon indicator */}
        <mesh position={[0, 1.25, 0.32]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshBasicMaterial
            color={isGenerating ? TOKEN_HEX.solarAmber : TOKEN_HEX.idle}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* 5. In-Scene Floating 3D Telemetry Badge */}
      <Html
        position={[0, 3.4, 0]}
        center
        distanceFactor={18}
        portal={htmlPortal as RefObject<HTMLElement>}
        className="pointer-events-auto select-none"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full shadow-xl backdrop-blur-md bg-surface/90 border border-border text-[11px] font-sans text-text-primary transition-all whitespace-nowrap">
          <div className="w-5 h-5 rounded-full bg-solar-amber/20 flex items-center justify-center shrink-0 border border-solar-amber/40">
            <Sun className="w-3.5 h-3.5 text-solar-amber" aria-hidden="true" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-text-primary text-[11px]">{nameLabel}</span>
            <span className="font-mono text-[10px] text-solar-amber font-medium">
              {outputLabel ?? `Production : ${fmtKw(currentKw)}`}
            </span>
          </div>
        </div>
      </Html>
    </group>
  );
}
