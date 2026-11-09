import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PROCEDURAL_PALM_VARIANTS = [
  'tree_palmTall',
  'tree_palmBend',
  'tree_palmShort',
] as const;

export type ProceduralPalmVariant = (typeof PROCEDURAL_PALM_VARIANTS)[number];

export interface PalmGeometry {
  foliage: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry;
}

interface PalmSpec {
  height: number;
  leanX: number;
  leanZ: number;
  baseRadius: number;
  topRadius: number;
  frondCount: number;
  frondLength: number;
  frondWidth: number;
  frondArch: number;
  frondDroop: number;
  coconuts: number;
}

const PALM_SPECS: Record<ProceduralPalmVariant, PalmSpec> = {
  tree_palmTall: {
    height: 2.5,
    leanX: 0.32,
    leanZ: 0.14,
    baseRadius: 0.085,
    topRadius: 0.045,
    frondCount: 14,
    frondLength: 1.25,
    frondWidth: 0.22,
    frondArch: 0.28,
    frondDroop: 0.42,
    coconuts: 5,
  },
  tree_palmBend: {
    height: 2.1,
    leanX: 0.68,
    leanZ: 0.28,
    baseRadius: 0.095,
    topRadius: 0.05,
    frondCount: 12,
    frondLength: 1.35,
    frondWidth: 0.25,
    frondArch: 0.35,
    frondDroop: 0.52,
    coconuts: 4,
  },
  tree_palmShort: {
    height: 1.5,
    leanX: 0.18,
    leanZ: 0.08,
    baseRadius: 0.08,
    topRadius: 0.04,
    frondCount: 10,
    frondLength: 1.05,
    frondWidth: 0.2,
    frondArch: 0.24,
    frondDroop: 0.32,
    coconuts: 3,
  },
};

/**
 * Creates an arching palm frond with a central spine and V-gutter leaflets.
 * Droops gracefully at the tip under gravity.
 */
function createFrondRibbon(
  length: number,
  maxWidth: number,
  archHeight: number,
  droop: number,
  steps = 8
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Parabolic upward arch transitioning into a downward gravity droop at the tip
    const y = Math.sin(t * Math.PI) * archHeight - Math.pow(t, 2.2) * droop;
    const z = t * length;
    // Leaf swells in the middle and tapers cleanly at base and tip
    const w = Math.sin(Math.pow(t, 0.75) * Math.PI) * maxWidth;
    // Gentle V-fold cross section catches realistic directional light
    const vFold = Math.sin(t * Math.PI) * 0.04;

    // 3 vertices per cross section: Left edge, spine peak, right edge
    positions.push(-w / 2, y - vFold, z);
    positions.push(0, y, z);
    positions.push(w / 2, y - vFold, z);

    uvs.push(0, t, 0.5, t, 1, t);
  }

  for (let i = 0; i < steps; i++) {
    const row1 = i * 3;
    const row2 = (i + 1) * 3;
    // Left wing
    indices.push(row1, row2, row1 + 1);
    indices.push(row1 + 1, row2, row2 + 1);
    // Right wing
    indices.push(row1 + 1, row2 + 1, row1 + 2);
    indices.push(row1 + 2, row2 + 1, row2 + 2);
    // Double-sided backfaces so the underside catches skylight
    indices.push(row1 + 1, row2, row1);
    indices.push(row2 + 1, row2, row1 + 1);
    indices.push(row1 + 2, row2 + 1, row1 + 1);
    indices.push(row2 + 2, row2 + 1, row1 + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates an organic curved trunk with base root flare and annular ring notches.
 */
function createCurvedTrunk(
  height: number,
  leanX: number,
  leanZ: number,
  baseR: number,
  topR: number
): { geometry: THREE.BufferGeometry; apex: THREE.Vector3 } {
  const steps = 14;
  const segments = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  let apexX = 0;
  let apexY = 0;
  let apexZ = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Lean curve accumulates towards the top
    const curveT = Math.pow(t, 1.35);
    const cx = curveT * leanX;
    const cz = curveT * leanZ;
    const cy = t * height;

    if (i === steps) {
      apexX = cx;
      apexY = cy;
      apexZ = cz;
    }

    // Annular palm rings (periodic swelling)
    const ringPulse = 1.0 + Math.sin(t * Math.PI * 14) * 0.055;
    const r = (baseR * (1 - t * 0.52) + topR * (t * 0.52)) * ringPulse;

    // Vertex shade: darker soil base -> warm bark -> subtle greenish crown collar
    const shade = 0.65 + t * 0.35;

    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      positions.push(cx + Math.cos(angle) * r, cy, cz + Math.sin(angle) * r);
      uvs.push(j / segments, t * 5);
      colors.push(shade, shade, shade);
    }
  }

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = (i + 1) * (segments + 1) + j;
      const c = (i + 1) * (segments + 1) + (j + 1);
      const d = i * (segments + 1) + (j + 1);
      indices.push(a, b, d);
      indices.push(d, b, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return { geometry: geo, apex: new THREE.Vector3(apexX, apexY, apexZ) };
}

/**
 * Procedural palm tree (Malagasy coconut palm style).
 * Produces organic curved trunk + multi-tiered arching fronds and coconuts in 2 merged geometries.
 */
export function createProceduralPalm(variant: ProceduralPalmVariant, _detail = 1): PalmGeometry {
  const spec = PALM_SPECS[variant];
  const { geometry: trunkBase, apex } = createCurvedTrunk(
    spec.height,
    spec.leanX,
    spec.leanZ,
    spec.baseRadius,
    spec.topRadius
  );

  // Build coconuts under the crown collar (merged with trunk geometry)
  const trunkParts: THREE.BufferGeometry[] = [trunkBase.toNonIndexed()];
  const nutR = 0.055;
  for (let i = 0; i < spec.coconuts; i++) {
    const angle = (i / spec.coconuts) * Math.PI * 2 + 0.4;
    const nut = new THREE.DodecahedronGeometry(nutR, 0);
    const count = nut.getAttribute('position').count;
    // Provide matching color and uv attributes
    const nutColors = new Float32Array(count * 3).fill(0.65);
    const nutUvs = new Float32Array(count * 2).fill(0);
    nut.setAttribute('color', new THREE.BufferAttribute(nutColors, 3));
    nut.setAttribute('uv', new THREE.BufferAttribute(nutUvs, 2));
    const d = spec.topRadius * 1.1;
    nut.translate(
      apex.x + Math.cos(angle) * d,
      apex.y - 0.06 - (i % 2) * 0.04,
      apex.z + Math.sin(angle) * d
    );
    trunkParts.push(nut);
  }

  const mergedTrunk = mergeGeometries(trunkParts);
  trunkParts.forEach((g) => g.dispose());
  if (!mergedTrunk) throw new Error('palm trunk merge failed');

  // Build arching palm fronds in 2 tiers (upper youthful, lower drooping)
  const frondParts: THREE.BufferGeometry[] = [];
  const count = spec.frondCount;
  const upperCount = Math.floor(count * 0.4);
  const lowerCount = count - upperCount;

  // Upper tier (more upright, fresh growth)
  for (let i = 0; i < upperCount; i++) {
    const azimuth = (i / upperCount) * Math.PI * 2 + 0.2;
    const frond = createFrondRibbon(
      spec.frondLength * 0.9,
      spec.frondWidth * 0.95,
      spec.frondArch * 1.2,
      spec.frondDroop * 0.65
    );
    // Pitch upward from crown
    frond.rotateX(-THREE.MathUtils.degToRad(35));
    frond.rotateY(azimuth);
    frond.translate(apex.x, apex.y + 0.04, apex.z);
    frondParts.push(frond.toNonIndexed());
  }

  // Lower tier (mature drooping canopy)
  for (let i = 0; i < lowerCount; i++) {
    const azimuth = (i / lowerCount) * Math.PI * 2 + Math.PI / lowerCount;
    const frond = createFrondRibbon(
      spec.frondLength * 1.05,
      spec.frondWidth,
      spec.frondArch * 0.85,
      spec.frondDroop * 1.15
    );
    // Pitch slightly down/horizontal
    frond.rotateX(-THREE.MathUtils.degToRad(12));
    frond.rotateY(azimuth);
    frond.translate(apex.x, apex.y - 0.02, apex.z);
    frondParts.push(frond.toNonIndexed());
  }

  const mergedFoliage = mergeGeometries(frondParts);
  frondParts.forEach((g) => g.dispose());
  if (!mergedFoliage) throw new Error('palm foliage merge failed');

  const smoothedFoliage = mergeVertices(mergedFoliage, 0.001);
  mergedFoliage.dispose();
  smoothedFoliage.computeVertexNormals();

  return { foliage: smoothedFoliage, trunk: mergedTrunk };
}
