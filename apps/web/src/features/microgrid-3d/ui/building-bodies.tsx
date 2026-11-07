'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Instance, Instances } from '@react-three/drei';
import type { SectorId } from '@mitsinjo/engine';
import { createHipRoofGeometry } from '../utils/hip-roof';
import { mergeParts, type Part } from '../utils/merge-parts';
import { HouseCluster, VillageHouse, windowColor } from './village-house';
import type { HouseSpec } from '../utils/house-geometry';
import { solarCellTexture, stripeTexture } from './procedural-textures';
import { UNLIT_BULB_HEX } from '../utils/scene-palette';

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
const CLINIC_RED = '#d63a3a';

// ---------------- Clinic ----------------
/** Two posts + white board, one geometry. */
const SIGN_BOARD = mergeParts([
  { shape: { kind: 'box', size: [0.06, 1.4, 0.06] }, position: [-0.38, 0.7, 0] },
  { shape: { kind: 'box', size: [0.06, 1.4, 0.06] }, position: [0.38, 0.7, 0] },
  { shape: { kind: 'box', size: [0.95, 0.95, 0.06] }, position: [0, 1.45, 0.02] },
]);

const crossCache = new Map<string, THREE.BufferGeometry>();
/** Red cross (two crossed planes) as one geometry, cached per size/position. */
function crossGeometry(len: number, bar: number, at: [number, number, number]) {
  const key = `${len}:${bar}:${at.join(',')}`;
  let g = crossCache.get(key);
  if (!g) {
    g = mergeParts([
      { shape: { kind: 'plane', size: [len, bar] }, position: at },
      { shape: { kind: 'plane', size: [bar, len] }, position: at },
    ]);
    crossCache.set(key, g);
  }
  return g;
}
let sharedPvMat: THREE.MeshStandardMaterial | null = null;
function getPvMaterial(): THREE.MeshStandardMaterial {
  if (!sharedPvMat) {
    const tex = solarCellTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(2, 1);
    sharedPvMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: '#ffffff',
      metalness: 0.65,
      roughness: 0.22,
      envMapIntensity: 1.5,
    });
  }
  return sharedPvMat;
}

function ClinicBody({ glow }: BodyProps) {
  const pvMat = useMemo(() => getPvMaterial(), []);
  return (
    <group name="health-clinic-mesh">
      <VillageHouse
        width={4.2}
        depth={2.6}
        wallHeight={1.7}
        roofHeight={1.05}
        wallColor="#f4f3ed"
        roofColor="#4a5d6e"
        windowGlow={glow}
        windowsPerSide={3}
        veranda
        position={[0, 0, -0.4]}
      />
      {/* Rooftop solar backup on Clinic (essential-first facility) */}
      <mesh
        position={[0, 1.7 + 0.1 + 1.05 / 2 + 0.05, -0.4 + 0.45 + (2.6 + 0.64 + 0.9) / 4]}
        rotation={[Math.atan2(1.05, (2.6 + 0.64 + 0.9) / 2), 0, 0]}
        material={pvMat}
        castShadow
      >
        <boxGeometry args={[2.5, 0.04, 0.95]} />
      </mesh>
      {/* Red-cross sign on two posts, angled to the camera */}
      <group position={[-2.6, 0, 1.6]} rotation={[0, 0.5, 0]}>
        <mesh geometry={SIGN_BOARD} castShadow>
          <meshStandardMaterial color="#f4f4f2" roughness={0.6} />
        </mesh>
        <mesh geometry={crossGeometry(0.66, 0.2, [0, 1.45, 0.06])}>
          <meshBasicMaterial color={CLINIC_RED} />
        </mesh>
      </group>
      {/* Red cross on the front wall, above the door */}
      <mesh geometry={crossGeometry(0.42, 0.13, [0, 1.55, 0.92])}>
        <meshBasicMaterial color={CLINIC_RED} />
      </mesh>
    </group>
  );
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
        width={1.4}
        depth={1.1}
        wallHeight={1.0}
        roofHeight={0.45}
        wallColor="#9fc0d8"
        roofColor="#6c7a88"
        windowGlow={glow}
        windowsPerSide={1}
        position={[1.9, 0, 1.4]}
        rotationY={-0.5}
      />
    </group>
  );
}

// ---------------- School ----------------
const SCHOOL = { width: 6.6, depth: 2.6, wall: 1.6, roof: 1.2, overhang: 0.32 };

function SchoolBody({ glow }: BodyProps) {
  const pvMat = useMemo(() => getPvMaterial(), []);
  // Panel lies mid-way up the front roof slope.
  const roofD = SCHOOL.depth + SCHOOL.overhang * 2 + 0.9;
  const slope = Math.atan2(SCHOOL.roof, roofD / 2);
  const zMid = 0.45 + roofD / 4;
  const yMid = SCHOOL.wall + 0.1 + SCHOOL.roof / 2 + 0.06;

  return (
    <group name="school-mesh">
      <VillageHouse
        width={SCHOOL.width}
        depth={SCHOOL.depth}
        wallHeight={SCHOOL.wall}
        roofHeight={SCHOOL.roof}
        overhang={SCHOOL.overhang}
        wallColor="#ead9b8"
        roofColor="#8f3a22"
        windowGlow={glow}
        windowsPerSide={5}
        veranda
      />
      <mesh position={[0, yMid, zMid]} rotation={[slope, 0, 0]} material={pvMat} castShadow>
        <boxGeometry args={[3.4, 0.05, 1.15]} />
      </mesh>
      {/* Blue name board above the entrance */}
      <mesh position={[0, SCHOOL.wall * 0.86 + 0.12, SCHOOL.depth / 2 + 0.02]}>
        <planeGeometry args={[1.1, 0.32]} />
        <meshStandardMaterial color="#1f4f99" roughness={0.6} />
      </mesh>
      {/* Flag pole */}
      <mesh position={[-3.9, 1.6, 2.2]} material={STEEL} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 3.2, 8]} />
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
  solar?: boolean;
}[] = [
  {
    pos: [-2.3, 0, -1.5],
    rot: 0.25,
    w: 2.1,
    d: 1.6,
    wall: '#dfceb6',
    roof: '#333e4a',
    solar: true,
  },
  { pos: [0.6, 0, -2.4], rot: -0.1, w: 1.9, d: 1.5, wall: '#e8dcbe', roof: '#475463' },
  {
    pos: [2.8, 0, -0.2],
    rot: -0.35,
    w: 2.0,
    d: 1.6,
    wall: '#cdb18a',
    roof: '#2e3843',
    solar: true,
  },
  { pos: [-2.5, 0, 1.7], rot: 0.15, w: 1.9, d: 1.6, wall: '#c8a478', roof: '#804b32' },
  { pos: [0.2, 0, 0.6], rot: 0.05, w: 2.2, d: 1.6, wall: '#dec4a2', roof: '#3a4755', solar: true },
  { pos: [2.0, 0, 2.7], rot: -0.2, w: 1.8, d: 1.4, wall: '#e3d0ab', roof: '#7a422a' },
];

/** All homes merged: 5 draw calls instead of one set of meshes per home. */
const HOME_SPECS: HouseSpec[] = HOMES.map((h, i) => ({
  width: h.w,
  depth: h.d,
  wallHeight: 1.15,
  roofHeight: 0.75,
  wallColor: h.wall,
  roofColor: h.roof,
  windowsPerSide: 2,
  position: h.pos,
  rotationY: h.rot,
  veranda: i % 3 === 0,
}));

function HouseholdsBody({ glow }: BodyProps) {
  const pvMat = useMemo(() => getPvMaterial(), []);
  return (
    <group name="households-group">
      <HouseCluster name="houses-cluster-mesh" houses={HOME_SPECS} windowGlow={glow} />
      {/* Rooftop solar panels on modern eco-homes */}
      {HOMES.map((h, i) => {
        if (!h.solar) return null;
        const roofD = h.d + 0.64 + (i % 3 === 0 ? 0.9 : 0);
        const slope = Math.atan2(0.75, roofD / 2);
        const localZ = (i % 3 === 0 ? 0.45 : 0) + roofD / 4;
        const localY = 1.15 + 0.1 + 0.75 / 2 + 0.04;
        return (
          <group key={i} position={h.pos} rotation={[0, h.rot, 0]}>
            <mesh
              position={[0, localY, localZ]}
              rotation={[slope, 0, 0]}
              material={pvMat}
              castShadow
            >
              <boxGeometry args={[h.w * 0.65, 0.03, roofD * 0.32]} />
            </mesh>
          </group>
        );
      })}
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
  health: { ringInner: 3.4, ledY: 3.4 },
  water: { ringInner: 2.6, ledY: 6.0 },
  school: { ringInner: 4.2, ledY: 3.4 },
  households: { ringInner: 3.9, ledY: 2.6 },
  market: { ringInner: 3.4, ledY: 2.9 },
  industry: { ringInner: 3.7, ledY: 5.0 },
};
