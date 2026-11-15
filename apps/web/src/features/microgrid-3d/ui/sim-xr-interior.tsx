'use client';

import { memo, useMemo } from 'react';
import type { SectorId } from '@mitsinjo/engine';
import { TOKEN_HEX } from '../utils/scene-palette';
import {
  INTERIOR_COLORS,
  INTERIOR_ORIGIN,
  INTERIOR_SIZE,
  interiorItems,
  lampLevel,
} from '../utils/sim-xr-place';

const {
  floor: FLOOR,
  wall: WALL,
  ceiling: CEILING,
  door: DOOR,
  lampOff: LAMP_OFF,
  unlit: UNLIT,
} = INTERIOR_COLORS;

/**
 * The room you enter from a building's panel (VSIM-T4): closed walls, its furniture and appliances.
 * Lamps and appliance lights follow what the engine serves the sector now: full coverage = bright,
 * cut = dark. The door (+Z wall) takes you back outside.
 */
export const SimXrInterior = memo(function SimXrInterior({
  sector,
  servedKw,
  coveragePct,
  onExit,
}: {
  sector: SectorId;
  servedKw: number;
  coveragePct: number | null;
  onExit: () => void;
}) {
  const items = useMemo(() => interiorItems(sector), [sector]);
  const level = lampLevel(coveragePct, servedKw);
  const { width: w, depth: d, height: h } = INTERIOR_SIZE;
  const lit = level > 0;

  return (
    <group name="sim-xr-interior" position={INTERIOR_ORIGIN}>
      {/* Floor, ceiling, four walls (inward faces). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={FLOOR} roughness={0.85} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={CEILING} roughness={0.9} />
      </mesh>
      <mesh position={[0, h / 2, -d / 2]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={WALL} roughness={0.9} />
      </mesh>
      <mesh position={[0, h / 2, d / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={WALL} roughness={0.9} />
      </mesh>
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial color={WALL} roughness={0.9} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial color={WALL} roughness={0.9} />
      </mesh>

      {/* Door: aim and select to go back outside. */}
      <mesh
        name="sim-xr-door"
        position={[w / 2 - 0.9, 1.05, d / 2 - 0.03]}
        userData={{ onSelect: onExit }}
        onClick={(e) => {
          e.stopPropagation();
          onExit();
        }}
      >
        <boxGeometry args={[0.95, 2.1, 0.05]} />
        <meshStandardMaterial color={DOOR} roughness={0.7} />
      </mesh>

      {/* Ceiling lamps + one light, as bright as the engine's coverage. */}
      {[-w / 4, w / 4].map((x) => (
        <mesh key={x} position={[x, h - 0.06, 0]}>
          <boxGeometry args={[0.6, 0.05, 0.25]} />
          <meshStandardMaterial
            color={lit ? TOKEN_HEX.warningAmber : LAMP_OFF}
            emissive={lit ? TOKEN_HEX.warningAmber : LAMP_OFF}
            emissiveIntensity={lit ? 1.5 * level : 0}
            toneMapped={!lit}
          />
        </mesh>
      ))}
      <pointLight position={[0, h - 0.4, 0]} intensity={6 * level} distance={9} decay={1.5} />
      <ambientLight intensity={lit ? 0.12 : 0.04} />

      {items.map((it) => (
        <mesh key={it.id} name={`sim-xr-item-${it.id}`} position={it.position}>
          <boxGeometry args={it.size} />
          <meshStandardMaterial
            color={it.color}
            roughness={0.6}
            emissive={it.powered && lit ? TOKEN_HEX.energyCyan : UNLIT}
            emissiveIntensity={it.powered && lit ? 0.35 * level : 0}
          />
        </mesh>
      ))}
    </group>
  );
});
