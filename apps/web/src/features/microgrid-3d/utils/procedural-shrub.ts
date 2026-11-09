import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PROCEDURAL_SHRUB_VARIANTS = [
  'plant_bushLarge',
  'plant_bushDetailed',
  'plant_bushSmall',
] as const;

export type ProceduralShrubVariant = (typeof PROCEDURAL_SHRUB_VARIANTS)[number];

export interface ShrubGeometry {
  foliage: THREE.BufferGeometry;
  stem: THREE.BufferGeometry;
}

/**
 * Creates an arching broad tropical leaf (banana / young Ravinala paddle style).
 * Has an arched spine, curved blade cross-section, and droops at the tip.
 */
function createBroadLeafRibbon(
  length: number,
  maxWidth: number,
  archHeight: number,
  droop: number,
  steps = 6
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Leaf profile: narrow petiole -> broad rounded blade -> tapered tip
    const profile = Math.sin(Math.pow(t, 0.6) * Math.PI);
    const w = profile * maxWidth;
    const y = Math.sin(t * Math.PI) * archHeight - Math.pow(t, 2) * droop;
    const z = t * length;
    // V-shaped central gutter
    const vGutter = profile * 0.035;

    // 3 vertices: left edge, spine peak, right edge
    positions.push(-w / 2, y - vGutter, z);
    positions.push(0, y, z);
    positions.push(w / 2, y - vGutter, z);

    uvs.push(0, t, 0.5, t, 1, t);

    // Subtle sunlit gradient: darker near petiole stem, vibrant at leaf blade
    const shade = 0.75 + t * 0.25;
    colors.push(shade, shade, shade);
    colors.push(shade * 1.05, shade * 1.05, shade * 1.05);
    colors.push(shade, shade, shade);
  }

  for (let i = 0; i < steps; i++) {
    const r1 = i * 3;
    const r2 = (i + 1) * 3;
    // Front faces
    indices.push(r1, r2, r1 + 1);
    indices.push(r1 + 1, r2, r2 + 1);
    indices.push(r1 + 1, r2 + 1, r1 + 2);
    indices.push(r1 + 2, r2 + 1, r2 + 2);
    // Back faces so undersides receive ambient ground bounce
    indices.push(r1 + 1, r2, r1);
    indices.push(r2 + 1, r2, r1 + 1);
    indices.push(r1 + 2, r2 + 1, r1 + 1);
    indices.push(r2 + 2, r2 + 1, r1 + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates smooth foliage blobs for dome-shaped garden shrubs.
 */
function createDomeBush(detail = 1): ShrubGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  const offsets: [number, number, number, number][] = [
    [0, 0.45, 0, 0.38],
    [0.18, 0.35, 0.12, 0.28],
    [-0.16, 0.38, 0.14, 0.29],
    [0.12, 0.32, -0.16, 0.27],
    [-0.14, 0.34, -0.14, 0.28],
    [0, 0.22, 0.2, 0.24],
  ];

  for (const [ox, oy, oz, r] of offsets) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1.1, 0.9, 1.1);
    g.translate(ox, oy, oz);
    blobs.push(g.index ? g.toNonIndexed() : g);
  }

  const merged = mergeGeometries(blobs);
  blobs.forEach((b) => b.dispose());
  if (!merged) throw new Error('dome bush merge failed');

  const smoothed = mergeVertices(merged, 0.001);
  merged.dispose();
  smoothed.computeVertexNormals();
  smoothed.computeBoundingBox();
  const box = smoothed.boundingBox as THREE.Box3;

  // Vertical light gradient
  const pos = smoothed.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
    const v = 0.6 + 0.4 * Math.pow(t, 0.75);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = t;
  }
  smoothed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  smoothed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // Small woody root base
  const stem = new THREE.CylinderGeometry(0.04, 0.07, 0.22, 8, 1);
  stem.translate(0, 0.11, 0);
  stem.computeVertexNormals();
  const stemColors = new Float32Array(stem.getAttribute('position').count * 3).fill(0.7);
  stem.setAttribute('color', new THREE.BufferAttribute(stemColors, 3));

  return { foliage: smoothed, stem };
}

/**
 * Creates broadleaf tropical shrubs with arching paddle leaves (Ravinala / banana shrub style).
 */
function createBroadleafBush(
  leafCount: number,
  leafLength: number,
  leafWidth: number,
  arch: number,
  droop: number
): ShrubGeometry {
  const leafParts: THREE.BufferGeometry[] = [];
  const stemParts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < leafCount; i++) {
    const azimuth = (i / leafCount) * Math.PI * 2 + (i % 2) * 0.15;
    // Vary size naturally
    const scaleFactor = 0.85 + ((i * 7) % 5) * 0.06;
    const leaf = createBroadLeafRibbon(
      leafLength * scaleFactor,
      leafWidth * scaleFactor,
      arch * scaleFactor,
      droop * scaleFactor
    );

    // Arch outward from center
    const pitch = 22 + (i % 3) * 8;
    leaf.rotateX(-THREE.MathUtils.degToRad(pitch));
    leaf.rotateY(azimuth);
    leaf.translate(0, 0.08 + (i % 2) * 0.04, 0);
    leafParts.push(leaf.toNonIndexed());

    // Stem petiole
    const stemLen = 0.14 * scaleFactor;
    const petiole = new THREE.CylinderGeometry(0.012, 0.018, stemLen, 6);
    petiole.rotateX(-THREE.MathUtils.degToRad(pitch * 0.6));
    petiole.rotateY(azimuth);
    petiole.translate(0, stemLen / 2, 0);
    const pCount = petiole.getAttribute('position').count;
    petiole.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(pCount * 3).fill(0.75), 3)
    );
    stemParts.push(petiole.toNonIndexed());
  }

  const mergedFoliage = mergeGeometries(leafParts);
  leafParts.forEach((l) => l.dispose());
  if (!mergedFoliage) throw new Error('broadleaf bush merge failed');

  const smoothed = mergeVertices(mergedFoliage, 0.001);
  mergedFoliage.dispose();
  smoothed.computeVertexNormals();

  const mergedStem = mergeGeometries(stemParts);
  stemParts.forEach((s) => s.dispose());
  if (!mergedStem) throw new Error('stem merge failed');

  return { foliage: smoothed, stem: mergedStem };
}

/**
 * Procedural shrub generator.
 * Eliminates harsh origami angles and produces smooth tropical flora.
 */
export function createProceduralShrub(variant: ProceduralShrubVariant, detail = 1): ShrubGeometry {
  switch (variant) {
    case 'plant_bushLarge':
      return createDomeBush(detail);
    case 'plant_bushDetailed':
      // Iconic broad-leaf tropical plant with graceful drooping paddles
      return createBroadleafBush(8, 0.72, 0.22, 0.22, 0.28);
    case 'plant_bushSmall':
      // Low compact tropical shrub
      return createBroadleafBush(5, 0.48, 0.18, 0.14, 0.16);
  }
}
