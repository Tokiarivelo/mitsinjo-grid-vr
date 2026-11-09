import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise';

/**
 * Procedural broadleaf tree: short trunk + a cluster of round foliage blobs.
 * Reads as the lush, rounded canopy of the reference render when packed densely.
 * Foliage carries a vertex-color gradient (dark underside → light crown) for volume;
 * per-instance tints multiply on top. Height ≈ 1 unit at scale 1, base at y = 0.
 */
export const CANOPY_VARIANTS = ['canopy_round', 'canopy_wide', 'canopy_tall'] as const;
export type CanopyVariant = (typeof CANOPY_VARIANTS)[number];

interface VariantSpec {
  seed: number;
  blobs: number;
  spread: number;
  blobRadius: [number, number];
  crownY: number;
  trunkH: number;
}

const SPECS: Record<CanopyVariant, VariantSpec> = {
  canopy_round: {
    seed: 3,
    blobs: 4,
    spread: 0.2,
    blobRadius: [0.26, 0.34],
    crownY: 0.62,
    trunkH: 0.4,
  },
  canopy_wide: {
    seed: 8,
    blobs: 5,
    spread: 0.3,
    blobRadius: [0.22, 0.3],
    crownY: 0.55,
    trunkH: 0.34,
  },
  canopy_tall: {
    seed: 13,
    blobs: 4,
    spread: 0.14,
    blobRadius: [0.22, 0.28],
    crownY: 0.72,
    trunkH: 0.5,
  },
};

export interface CanopyTreeGeometry {
  foliage: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry;
}

export function createCanopyTree(variant: CanopyVariant, detail = 2): CanopyTreeGeometry {
  const spec = SPECS[variant];
  const rand = mulberry32(spec.seed);
  const blobs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spec.blobs; i++) {
    const r = spec.blobRadius[0] + rand() * (spec.blobRadius[1] - spec.blobRadius[0]);
    const g = new THREE.IcosahedronGeometry(r, detail);
    const a = (i / spec.blobs) * Math.PI * 2 + rand() * 0.8;
    const d = i === 0 ? 0 : spec.spread * (0.6 + rand() * 0.6);
    g.scale(1, 0.85, 1);
    g.translate(
      Math.cos(a) * d,
      spec.crownY + (i === 0 ? 0.08 : (rand() - 0.4) * 0.16),
      Math.sin(a) * d
    );
    blobs.push(g);
  }
  const merged = mergeGeometries(blobs);
  blobs.forEach((b) => b.dispose());
  if (!merged) throw new Error('canopy merge failed');
  const smoothed = mergeVertices(merged, 0.001);
  merged.dispose();
  smoothed.computeVertexNormals();
  smoothed.computeBoundingBox();
  const box = smoothed.boundingBox as THREE.Box3;

  // Vertical shade: underside 55 % brightness → crown 100 %.
  const pos = smoothed.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
    const v = 0.55 + 0.45 * Math.pow(t, 0.8);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  smoothed.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Smooth trunk: 12 radial segments with smooth normals
  const trunk = new THREE.CylinderGeometry(0.035, 0.06, spec.trunkH + 0.1, 12, 2, true);
  trunk.translate(0, (spec.trunkH + 0.1) / 2, 0);
  trunk.computeVertexNormals();
  return { foliage: smoothed, trunk };
}
