'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useGLTF } from '@react-three/drei';
import {
  clearingItemScale,
  scatterVegetation,
  type NatureKind,
  type NatureModel,
  type ScatterItem,
} from '../utils/scatter';
import type { SceneQuality } from '../hooks/use-scene-quality';
import { CANOPY_VARIANTS, createCanopyTree, type CanopyVariant } from '../utils/canopy-tree';
import {
  PROCEDURAL_PALM_VARIANTS,
  createProceduralPalm,
  type ProceduralPalmVariant,
} from '../utils/procedural-palm';
import {
  PROCEDURAL_SHRUB_VARIANTS,
  createProceduralShrub,
  type ProceduralShrubVariant,
} from '../utils/procedural-shrub';
import { toFloatGeometry } from '../utils/float-geometry';
import type { KeepOutZone } from '../utils/landscape';

export const NATURE_URL = '/3d/nature.glb';
/**
 * Trees per tier. Low keeps the village ring dense and thins the far forest (in the fog)
 * so the tier stays under its triangle budget with room for new buildings.
 */
export const VEGETATION_DENSITY = {
  high: { forestCount: 2000, villageCount: 170 },
  low: { forestCount: 520, villageCount: 90 },
} as const satisfies Record<SceneQuality, { forestCount: number; villageCount: number }>;

/** Trees closer than this to the village centre get full detail and cast shadows. */
const NEAR_BAND_RADIUS = 42;

type PartRole = 'leaf' | 'canopy' | 'bark' | 'rock';

interface ModelPart {
  geometry: THREE.BufferGeometry;
  role: PartRole;
}

const LEAF_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.62,
  metalness: 0.04,
});
const BARK_MAT = new THREE.MeshStandardMaterial({
  color: '#593e28',
  roughness: 0.85,
  metalness: 0.05,
});
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#827a6e', roughness: 0.9 });
/** Procedural canopies carry a vertex shade (dark underside); GLB foliage has no colors. */
const CANOPY_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  vertexColors: true,
  roughness: 0.68,
  metalness: 0.02,
  flatShading: false,
});
const MATERIAL_BY_ROLE: Record<PartRole, THREE.Material> = {
  leaf: LEAF_MAT,
  canopy: CANOPY_MAT,
  bark: BARK_MAT,
  rock: ROCK_MAT,
};

/** Leaf tints (sRGB) per kind: neighbours differ, like the reference canopy. */
const LEAF_TINTS: Record<NatureKind, string[]> = {
  broadleaf: [
    '#3f6f24',
    '#4b7d2a',
    '#2f5c1f',
    '#5a8a30',
    '#6b8f2e',
    '#3a6a2c',
    '#7a9a3a',
    '#56802a',
  ],
  palm: ['#5f8f2f', '#6f9a35', '#4f7f2a', '#7aa03c'],
  bush: ['#45752a', '#557f2c', '#3a6626', '#628a32'],
  rock: ['#5b7a34', '#6a8a3a'],
};

function roleFor(materialName: string, kind: NatureKind): PartRole {
  if (materialName === 'leafsGreen' || materialName === 'grass') return 'leaf';
  if (kind === 'rock') return 'rock';
  // tree_detailed's third primitive is a second foliage layer.
  if (materialName === '_defaultMat') return 'leaf';
  return 'bark';
}

const canopyCache = new Map<string, ModelPart[]>();
function canopyParts(variant: CanopyVariant, detail: number): ModelPart[] {
  const key = `${variant}:${detail}`;
  const hit = canopyCache.get(key);
  if (hit) return hit;
  const { foliage, trunk } = createCanopyTree(variant, detail);
  const parts: ModelPart[] = [
    { geometry: foliage, role: 'canopy' },
    { geometry: trunk, role: 'bark' },
  ];
  canopyCache.set(key, parts);
  return parts;
}

const palmCache = new Map<string, ModelPart[]>();
function palmParts(variant: ProceduralPalmVariant, detail: number): ModelPart[] {
  const key = `${variant}:${detail}`;
  const hit = palmCache.get(key);
  if (hit) return hit;
  const { foliage, trunk } = createProceduralPalm(variant, detail);
  const parts: ModelPart[] = [
    { geometry: foliage, role: 'leaf' },
    { geometry: trunk, role: 'bark' },
  ];
  palmCache.set(key, parts);
  return parts;
}

const shrubCache = new Map<string, ModelPart[]>();
function shrubParts(variant: ProceduralShrubVariant, detail: number): ModelPart[] {
  const key = `${variant}:${detail}`;
  const hit = shrubCache.get(key);
  if (hit) return hit;
  const { foliage, stem } = createProceduralShrub(variant, detail);
  const parts: ModelPart[] = [
    { geometry: foliage, role: 'leaf' },
    { geometry: stem, role: 'bark' },
  ];
  shrubCache.set(key, parts);
  return parts;
}

/** Bake each model's meshes into base-at-origin geometries, tagged by role. */
function extractParts(scene: THREE.Object3D, name: string, kind: NatureKind): ModelPart[] {
  const node = scene.getObjectByName(name);
  if (!node) return [];
  scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  const box = new THREE.Box3();
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = toFloatGeometry(mesh.geometry);
    // Smooth Kenney geometries: weld duplicate vertices and compute smooth vertex normals
    if (kind === 'palm' || kind === 'bush' || kind === 'broadleaf') {
      geometry = mergeVertices(geometry, 0.005);
      geometry.computeVertexNormals();
    }
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
    const matName = (mesh.material as THREE.Material).name ?? '';
    parts.push({ geometry, role: roleFor(matName, kind) });
  });
  const center = box.getCenter(new THREE.Vector3());
  for (const p of parts) {
    p.geometry.translate(-center.x, -box.min.y, -center.z);
  }
  return parts;
}

function PartInstances({
  part,
  items,
  kind,
  castShadow,
  clearings,
}: {
  part: ModelPart;
  items: ScatterItem[];
  kind: NatureKind;
  castShadow: boolean;
  clearings?: readonly KeepOutZone[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const tints = LEAF_TINTS[kind];
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotationY);
      const scale = clearingItemScale(it, clearings);
      s.setScalar(scale);
      // Sink slightly so trunks never hover on slopes.
      p.set(it.position[0], it.position[1] - 0.05, it.position[2]);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (part.role === 'leaf' || part.role === 'canopy') {
        color.set(tints[Math.floor(it.tint * tints.length) % tints.length] ?? '#4b7d2a');
        mesh.setColorAt(i, color);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, kind, part.role, clearings]);

  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, MATERIAL_BY_ROLE[part.role], items.length]}
      castShadow={castShadow}
      receiveShadow
    />
  );
}

export interface VegetationProps {
  quality?: SceneQuality;
  clearings?: readonly KeepOutZone[];
}

export function Vegetation({ quality = 'high', clearings }: VegetationProps) {
  const { scene } = useGLTF(NATURE_URL);

  const groups = useMemo(() => {
    const items = scatterVegetation(VEGETATION_DENSITY[quality]);
    // Near band: full detail + shadow casting (high tier). Far band: light blobs, no shadow pass.
    const byKey = new Map<string, { model: NatureModel; near: boolean; items: ScatterItem[] }>();
    for (const it of items) {
      // Low tier: one band (no shadows, same detail) → fewer draw calls.
      const near =
        quality === 'high' && Math.hypot(it.position[0], it.position[2]) < NEAR_BAND_RADIUS;
      const key = `${it.model}|${near ? 'near' : 'far'}`;
      const entry = byKey.get(key) ?? { model: it.model, near, items: [] };
      entry.items.push(it);
      byKey.set(key, entry);
    }
    // A model always maps to one kind (see scatter), so the first item's kind holds.
    return [...byKey.entries()].map(([key, { model, near, items: list }]) => {
      const kind = list[0]?.kind ?? 'broadleaf';
      const detail = quality === 'high' && near ? 2 : 1;
      const parts = (CANOPY_VARIANTS as readonly string[]).includes(model)
        ? canopyParts(model as CanopyVariant, detail)
        : (PROCEDURAL_PALM_VARIANTS as readonly string[]).includes(model)
          ? palmParts(model as ProceduralPalmVariant, detail)
          : (PROCEDURAL_SHRUB_VARIANTS as readonly string[]).includes(model)
            ? shrubParts(model as ProceduralShrubVariant, detail)
            : extractParts(scene, model, kind);
      return { key, kind, items: list, parts, castShadow: quality === 'high' && near };
    });
  }, [scene, quality]);

  return (
    <group name="vegetation">
      {groups.map((g) =>
        g.parts.map((part, i) => (
          <PartInstances
            key={`${g.key}-${i}-${quality}`}
            part={part}
            items={g.items}
            kind={g.kind}
            castShadow={g.castShadow}
            clearings={clearings}
          />
        ))
      )}
    </group>
  );
}

useGLTF.preload(NATURE_URL);
