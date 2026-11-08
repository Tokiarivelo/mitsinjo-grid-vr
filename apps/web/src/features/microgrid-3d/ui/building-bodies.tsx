'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Instance, Instances } from '@react-three/drei';
import type { SectorId } from '@mitsinjo/engine';
import { createHipRoofGeometry } from '../utils/hip-roof';
import { mergeParts, type Part } from '../utils/merge-parts';
import { HouseCluster, VillageHouse, windowColor } from './village-house';
import type { HouseSpec } from '../utils/house-geometry';
import { stripeTexture } from './procedural-textures';
import { UNLIT_BULB_HEX } from '../utils/scene-palette';
import { ClinicBuilding } from './clinic-building';

/**
 * Building meshes per sector (look only). Each body gets `glow` (0..1), the window/lamp
 * light already derived from the sector status by the parent; bodies never read energy data.
 * Footprints stay inside the sector keep-out radius (utils/landscape KEEP_OUT_ZONES).
 */
export interface BodyProps {
  glow: number;
}

const STEEL = new THREE.MeshStandardMaterial({
  color: '#a7b0bb',
  metalness: 0.75,
  roughness: 0.35,
});

// ---------------- Clinic ----------------
function ClinicBody({ glow }: BodyProps) {
  return <ClinicBuilding glow={glow} />;
}

// ---------------- Water station ----------------
const LEG = 0.85;
const TOWER_H = 3.4;

function WaterBody({ glow }: BodyProps) {
  // Legs, X-braces and platform: one merged steel geometry (1 draw call).
  const steel = useMemo(() => {
    const parts: Part[] = [];
    for (const x of [-LEG, LEG]) {
      for (const z of [-LEG, LEG]) {
        parts.push({
          shape: { kind: 'box', size: [0.09, TOWER_H, 0.09] },
          position: [x, TOWER_H / 2, z],
        });
      }
    }
    const span = 1.55;
    const len = Math.hypot(LEG * 2, span);
    // Box runs along local Y; tilt it so it spans 2·LEG sideways over `span` height.
    const ang = Math.atan2(LEG * 2, span);
    for (const y0 of [0.2, 1.75]) {
      const yc = y0 + span / 2;
      for (const side of [1, -1]) {
        for (const sign of [1, -1]) {
          parts.push({
            shape: { kind: 'box', size: [0.04, len, 0.04] },
            position: [0, yc, side * LEG],
            rotation: [0, 0, sign * ang],
          });
          parts.push({
            shape: { kind: 'box', size: [0.04, len, 0.04] },
            position: [side * LEG, yc, 0],
            rotation: [sign * ang, 0, 0],
          });
        }
      }
    }
    parts.push({ shape: { kind: 'box', size: [2.1, 0.1, 2.1] }, position: [0, TOWER_H, 0] });
    // Platform safety railings
    for (const side of [1, -1]) {
      parts.push({
        shape: { kind: 'box', size: [2.1, 0.04, 0.04] },
        position: [0, TOWER_H + 0.5, side * 1.0],
      });
      parts.push({
        shape: { kind: 'box', size: [0.04, 0.04, 2.1] },
        position: [side * 1.0, TOWER_H + 0.5, 0],
      });
      for (const ox of [-0.95, 0, 0.95]) {
        parts.push({
          shape: { kind: 'box', size: [0.035, 0.5, 0.035] },
          position: [ox, TOWER_H + 0.25, side * 1.0],
        });
      }
    }
    // Vertical maintenance ladder along one support leg
    for (let h = 0.3; h < TOWER_H; h += 0.28) {
      parts.push({
        shape: { kind: 'box', size: [0.32, 0.025, 0.025] },
        position: [-LEG, h, -LEG - 0.06],
      });
    }
    for (const lx of [-LEG - 0.15, -LEG + 0.15]) {
      parts.push({
        shape: { kind: 'box', size: [0.025, TOWER_H, 0.025] },
        position: [lx, TOWER_H / 2, -LEG - 0.06],
      });
    }
    return mergeParts(parts);
  }, []);
  const pipes = useMemo(
    () =>
      mergeParts([
        {
          shape: {
            kind: 'cylinder',
            radiusTop: 0.07,
            radiusBottom: 0.07,
            height: TOWER_H + 0.4,
            segments: 10,
          },
          position: [0.5, TOWER_H / 2 + 0.2, 0.5],
        },
        {
          shape: {
            kind: 'cylinder',
            radiusTop: 0.07,
            radiusBottom: 0.07,
            height: 2.2,
            segments: 10,
          },
          position: [-1.5, 0.18, 1.05],
          rotation: [0, -0.62, Math.PI / 2],
        },
      ]),
    []
  );

  return (
    <group name="water-pump-mesh">
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[2.3, 0.16, 2.3]} />
        <meshStandardMaterial color="#8b8f94" roughness={0.9} />
      </mesh>
      {/* Lattice tower */}
      <mesh geometry={steel} material={STEEL} castShadow />
      {/* Tank + cap */}
      <mesh position={[0, TOWER_H + 0.8, 0]} castShadow>
        <cylinderGeometry args={[1.05, 1.05, 1.5, 28]} />
        <meshStandardMaterial color="#d8dde3" metalness={0.45} roughness={0.35} />
      </mesh>
      {[0.75].map((y) => (
        <mesh key={y} position={[0, TOWER_H + 0.05 + y, 0]}>
          <torusGeometry args={[1.06, 0.025, 6, 28]} />
          <meshStandardMaterial color="#9aa4ae" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, TOWER_H + 1.78, 0]} castShadow>
        <coneGeometry args={[1.12, 0.45, 28]} />
        <meshStandardMaterial color="#b9c2cc" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Riser + discharge pipe towards the pond */}
      <mesh geometry={pipes} castShadow>
        <meshStandardMaterial color="#3d8fd1" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Pump house */}
      <VillageHouse
        width={1.6}
        depth={1.3}
        wallHeight={1.1}
        roofHeight={0.55}
        wallColor="#a88c6e"
        roofColor="#1a232e"
        roofStyle="gable"
        roofFinish="bipv"
        slatCladding
        windowGlow={glow}
        windowsPerSide={1}
        position={[1.9, 0, 1.4]}
        rotationY={-0.5}
      />
    </group>
  );
}

// ---------------- School ----------------
const SCHOOL = { width: 7.2, depth: 2.8, wall: 1.7, roof: 1.25, overhang: 0.35 };

function SchoolBody({ glow }: BodyProps) {
  return (
    <group name="school-mesh">
      <VillageHouse
        width={SCHOOL.width}
        depth={SCHOOL.depth}
        wallHeight={SCHOOL.wall}
        roofHeight={SCHOOL.roof}
        overhang={SCHOOL.overhang}
        wallColor="#e2ceaa"
        roofColor="#1a232e"
        roofStyle="gable"
        roofFinish="bipv"
        slatCladding
        windowGlow={glow}
        windowsPerSide={5}
        deckFurniture
      />
      {/* Official school entrance name board */}
      <mesh position={[0, SCHOOL.wall * 0.88 + 0.12, SCHOOL.depth / 2 + 0.03]}>
        <planeGeometry args={[1.3, 0.35]} />
        <meshStandardMaterial color="#1f4f99" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Community flagpole */}
      <mesh position={[-4.1, 1.65, 2.3]} material={STEEL} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 3.3, 12]} />
      </mesh>
    </group>
  );
}

// ---------------- Households ----------------
const HOMES: {
  pos: [number, number, number];
  rot: number;
  w: number;
  d: number;
  wall: string;
  roof: string;
}[] = [
  { pos: [-2.4, 0, -1.6], rot: 0.22, w: 2.3, d: 1.8, wall: '#c48849', roof: '#1a232e' },
  { pos: [0.6, 0, -2.5], rot: -0.12, w: 2.1, d: 1.6, wall: '#b87b3e', roof: '#18212c' },
  { pos: [2.9, 0, -0.3], rot: -0.32, w: 2.4, d: 1.8, wall: '#d19757', roof: '#1b2532' },
  { pos: [-2.6, 0, 1.8], rot: 0.16, w: 2.2, d: 1.7, wall: '#be8346', roof: '#1a232e' },
  { pos: [0.2, 0, 0.7], rot: 0.06, w: 2.5, d: 1.8, wall: '#a86c34', roof: '#19222d' },
  { pos: [2.2, 0, 2.8], rot: -0.22, w: 2.0, d: 1.6, wall: '#cf9a5b', roof: '#1e2835' },
];

/** All homes merged: 5 draw calls instead of one set of meshes per home. */
const HOME_SPECS: HouseSpec[] = HOMES.map((h) => ({
  width: h.w,
  depth: h.d,
  wallHeight: 1.25,
  roofHeight: 0.82,
  wallColor: h.wall,
  roofColor: h.roof,
  windowsPerSide: 2,
  position: h.pos,
  rotationY: h.rot,
  roofStyle: 'gable',
  slatCladding: true,
  deckFurniture: true,
}));

function HouseholdsBody({ glow }: BodyProps) {
  return (
    <group name="households-group">
      <HouseCluster
        name="houses-cluster-mesh"
        houses={HOME_SPECS}
        windowGlow={glow}
        roofFinish="bipv"
      />
    </group>
  );
}

// ---------------- Market ----------------
const STALLS: { pos: [number, number, number]; a: string; b: string }[] = [
  { pos: [-1.8, 0, -1.1], a: '#d83b3b', b: '#f3efe6' },
  { pos: [0, 0, -1.1], a: '#2f6fd0', b: '#f3efe6' },
  { pos: [1.8, 0, -1.1], a: '#f2b134', b: '#e0682c' },
  { pos: [-1.8, 0, 1.1], a: '#2f6fd0', b: '#f2b134' },
  { pos: [0, 0, 1.1], a: '#d83b3b', b: '#f2b134' },
  { pos: [1.8, 0, 1.1], a: '#3c9a5f', b: '#f3efe6' },
];
const PRODUCE = ['#e0682c', '#c8d13a', '#8a3b8f', '#e2b13c', '#5aa046', '#d83b3b'];
const TENT = 1.6;

function MarketBody({ glow }: BodyProps) {
  const tentGeom = useMemo(() => createHipRoofGeometry(TENT, TENT, 0.75), []);
  const tentMats = useMemo(
    () =>
      STALLS.map(
        (s) =>
          new THREE.MeshStandardMaterial({
            map: stripeTexture(s.a, s.b),
            roughness: 0.85,
          })
      ),
    []
  );
  // Posts + counters of every stall: one wood geometry.
  const woodwork = useMemo(() => {
    const parts: Part[] = [];
    for (const s of STALLS) {
      for (const x of [-0.72, 0.72]) {
        for (const z of [-0.72, 0.72]) {
          parts.push({
            shape: { kind: 'box', size: [0.05, 1.6, 0.05] },
            position: [s.pos[0] + x, 0.8, s.pos[2] + z],
          });
        }
      }
      parts.push({
        shape: { kind: 'box', size: [1.3, 0.5, 0.55] },
        position: [s.pos[0], 0.42, s.pos[2] + 0.2],
      });
    }
    return mergeParts(parts);
  }, []);
  // String lights between the stalls: one geometry, glow follows the market's status.
  const bulbs = useMemo(() => {
    const parts: Part[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      parts.push({
        shape: { kind: 'sphere', radius: 0.06, segments: 8 },
        position: [-2.7 + 5.4 * t, 1.95 - Math.sin(t * Math.PI * 3) ** 2 * 0.22, 0],
      });
    }
    return mergeParts(parts);
  }, []);
  const bulbColor = useMemo(
    () => (glow <= 0 ? new THREE.Color(UNLIT_BULB_HEX) : windowColor(glow).multiplyScalar(1.3)),
    [glow]
  );

  return (
    <group name="market-mesh">
      <mesh geometry={woodwork} castShadow receiveShadow>
        <meshStandardMaterial color="#7a5638" roughness={0.9} />
      </mesh>
      {STALLS.map((s, i) => (
        <mesh
          key={i}
          geometry={tentGeom}
          material={tentMats[i]}
          position={[s.pos[0], 1.6, s.pos[2]]}
          castShadow
          receiveShadow
        />
      ))}
      <Instances limit={STALLS.length * 3} castShadow>
        <boxGeometry args={[0.32, 0.14, 0.4]} />
        <meshStandardMaterial roughness={0.8} />
        {STALLS.flatMap((s, i) =>
          [-0.4, 0, 0.4].map((x, k) => (
            <Instance
              key={`${i}-${k}`}
              position={[s.pos[0] + x, 0.74, s.pos[2] + 0.2]}
              color={PRODUCE[(i + k) % PRODUCE.length]}
            />
          ))
        )}
      </Instances>
      <mesh geometry={bulbs}>
        <meshBasicMaterial color={bulbColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------- Factory ----------------
/** Workshop hall: a wide one-storey shed with a long row of windows (reuses the house cluster). */
const FACTORY_HALL: HouseSpec[] = [
  {
    width: 4.4,
    depth: 3.0,
    wallHeight: 2.0,
    roofHeight: 0.6,
    overhang: 0.2,
    wallColor: '#a9b4bd',
    roofColor: '#6d7880',
    windowsPerSide: 4,
    // Main door faces the village (west).
    rotationY: -Math.PI / 2,
  },
];
/** Chimney, silo and loading-bay canopy posts: one steel geometry. */
const FACTORY_STEEL = mergeParts([
  {
    shape: { kind: 'cylinder', radiusTop: 0.16, radiusBottom: 0.22, height: 4.4, segments: 10 },
    position: [0.9, 2.2, -1.3],
  },
  {
    shape: { kind: 'cylinder', radiusTop: 0.55, radiusBottom: 0.55, height: 2.6, segments: 12 },
    position: [-0.9, 1.3, 2.75],
  },
  {
    shape: { kind: 'cylinder', radiusTop: 0.05, radiusBottom: 0.55, height: 0.5, segments: 12 },
    position: [-0.9, 2.85, 2.75],
  },
  { shape: { kind: 'box', size: [0.5, 0.1, 0.5] }, position: [0.9, 4.45, -1.3] },
]);

function FactoryBody({ glow }: BodyProps) {
  return (
    <group name="factory-mesh">
      <HouseCluster houses={FACTORY_HALL} windowGlow={glow} />
      <mesh geometry={FACTORY_STEEL} material={STEEL} castShadow receiveShadow />
    </group>
  );
}

export function BuildingBody({ id, glow }: { id: SectorId; glow: number }) {
  switch (id) {
    case 'health':
      return <ClinicBody glow={glow} />;
    case 'water':
      return <WaterBody glow={glow} />;
    case 'school':
      return <SchoolBody glow={glow} />;
    case 'households':
      return <HouseholdsBody glow={glow} />;
    case 'market':
      return <MarketBody glow={glow} />;
    case 'industry':
      return <FactoryBody glow={glow} />;
  }
}

/** Ring radius and status-beacon height per sector body. */
export const BODY_LAYOUT: Record<SectorId, { ringInner: number; ledY: number }> = {
  health: { ringInner: 3.8, ledY: 3.95 },
  water: { ringInner: 2.6, ledY: 6.0 },
  school: { ringInner: 4.2, ledY: 3.4 },
  households: { ringInner: 3.9, ledY: 2.6 },
  market: { ringInner: 3.4, ledY: 2.9 },
  industry: { ringInner: 3.7, ledY: 5.0 },
};
