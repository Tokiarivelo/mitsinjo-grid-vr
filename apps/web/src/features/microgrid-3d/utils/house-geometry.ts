import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHipRoofGeometry } from './hip-roof';
import { mergeParts, type Part } from './merge-parts';

/** One house of a cluster. Colors are sRGB hex; position/rotation place it in the cluster. */
export interface HouseSpec {
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  wallColor: string;
  roofColor: string;
  /** Eave overhang beyond the walls. */
  overhang?: number;
  windowsPerSide?: number;
  /** Covered front veranda with posts. */
  veranda?: boolean;
  position?: [number, number, number];
  rotationY?: number;
}

/**
 * Every house of a cluster merged per part: 4 draw calls (+1 with verandas) whatever the
 * number of houses. Per-house wall and roof colors live in a `color` vertex attribute.
 */
export interface HouseClusterGeometry {
  trim: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  roofs: THREE.BufferGeometry;
  windows: THREE.BufferGeometry;
  verandas: THREE.BufferGeometry | null;
}

/** Number of meshes (draw calls) a cluster renders. */
export function houseClusterDrawCalls(houses: readonly HouseSpec[]): number {
  if (houses.length === 0) return 0;
  return houses.some((h) => h.veranda) ? 5 : 4;
}

const tmpColor = new THREE.Color();

function paint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  tmpColor.set(hex); // converted to the linear working space, like a material color
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function placement(h: HouseSpec): THREE.Matrix4 {
  const [x, y, z] = h.position ?? [0, 0, 0];
  return new THREE.Matrix4().makeRotationY(h.rotationY ?? 0).setPosition(x, y, z);
}

function windowParts(h: HouseSpec): Part[] {
  const n = Math.max(1, h.windowsPerSide ?? 2);
  const winW = Math.min(0.42, (h.width * 0.6) / n);
  const winH = h.wallHeight * 0.38;
  const winY = h.wallHeight * 0.58 + 0.12;
  const usable = h.width * 0.72;
  const xs = Array.from({ length: n }, (_, i) =>
    n === 1 ? 0 : -usable / 2 + (usable / (n - 1)) * i
  );
  const doorW = 0.36;
  const doorX = n > 1 ? 0 : h.width * 0.28;
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    for (const x of xs) {
      if (side === 1 && Math.abs(x - doorX) < (winW + doorW) / 2) continue;
      parts.push({
        shape: { kind: 'plane', size: [winW, winH] },
        position: [x, winY, side * (h.depth / 2 + 0.014)],
        rotation: [0, side === 1 ? 0 : Math.PI, 0],
      });
    }
    parts.push({
      shape: { kind: 'plane', size: [winW, winH] },
      position: [side * (h.width / 2 + 0.014), winY, 0],
      rotation: [0, (side * Math.PI) / 2, 0],
    });
  }
  return parts;
}

function trimParts(h: HouseSpec): Part[] {
  const n = h.windowsPerSide ?? 2;
  const doorW = 0.36;
  const doorH = h.wallHeight * 0.62;
  const doorX = n > 1 ? 0 : h.width * 0.28;
  const doorZ = h.depth / 2 + 0.014;
  const doorY = 0.12 + doorH / 2;

  const parts: Part[] = [
    // Foundation plinth band
    {
      shape: { kind: 'box', size: [h.width + 0.16, 0.12, h.depth + 0.16] },
      position: [0, 0.06, 0],
    },
    // Door leaf
    {
      shape: { kind: 'plane', size: [doorW, doorH] },
      position: [doorX, doorY, doorZ],
    },
    // Door frame: top lintel
    {
      shape: { kind: 'box', size: [doorW + 0.07, 0.035, 0.03] },
      position: [doorX, doorY + doorH / 2 + 0.015, doorZ + 0.008],
    },
    // Door frame: left post
    {
      shape: { kind: 'box', size: [0.035, doorH, 0.03] },
      position: [doorX - doorW / 2 - 0.015, doorY, doorZ + 0.008],
    },
    // Door frame: right post
    {
      shape: { kind: 'box', size: [0.035, doorH, 0.03] },
      position: [doorX + doorW / 2 + 0.015, doorY, doorZ + 0.008],
    },
    // Door handle
    {
      shape: { kind: 'box', size: [0.02, 0.07, 0.025] },
      position: [doorX + doorW * 0.32, doorY, doorZ + 0.02],
    },
  ];

  // Architectural window frames, mullions, and projecting sills
  const winW = Math.min(0.42, (h.width * 0.6) / n);
  const winH = h.wallHeight * 0.38;
  const winY = h.wallHeight * 0.58 + 0.12;
  const usable = h.width * 0.72;
  const xs = Array.from({ length: n }, (_, i) =>
    n === 1 ? 0 : -usable / 2 + (usable / (n - 1)) * i
  );

  for (const side of [1, -1]) {
    // Front & back windows
    for (const x of xs) {
      if (side === 1 && Math.abs(x - doorX) < (winW + doorW) / 2) continue;
      const z = side * (h.depth / 2 + 0.018);
      // Top frame header
      parts.push({
        shape: { kind: 'box', size: [winW + 0.05, 0.03, 0.028] },
        position: [x, winY + winH / 2 + 0.014, z],
      });
      // Bottom frame sill support
      parts.push({
        shape: { kind: 'box', size: [winW + 0.05, 0.03, 0.028] },
        position: [x, winY - winH / 2 - 0.014, z],
      });
      // Left vertical jamb
      parts.push({
        shape: { kind: 'box', size: [0.028, winH, 0.028] },
        position: [x - winW / 2 - 0.014, winY, z],
      });
      // Right vertical jamb
      parts.push({
        shape: { kind: 'box', size: [0.028, winH, 0.028] },
        position: [x + winW / 2 + 0.014, winY, z],
      });
      // Center vertical mullion bar
      parts.push({
        shape: { kind: 'box', size: [0.02, winH, 0.024] },
        position: [x, winY, z],
      });
      // Protruding window sill (appui de fenêtre)
      parts.push({
        shape: { kind: 'box', size: [winW + 0.09, 0.03, 0.05] },
        position: [x, winY - winH / 2 - 0.028, z + side * 0.012],
      });
    }

    // Side windows (left & right facades)
    const sideX = side * (h.width / 2 + 0.018);
    // Top frame header
    parts.push({
      shape: { kind: 'box', size: [0.028, 0.03, winW + 0.05] },
      position: [sideX, winY + winH / 2 + 0.014, 0],
    });
    // Bottom frame
    parts.push({
      shape: { kind: 'box', size: [0.028, 0.03, winW + 0.05] },
      position: [sideX, winY - winH / 2 - 0.014, 0],
    });
    // Side jambs
    parts.push({
      shape: { kind: 'box', size: [0.028, winH, 0.028] },
      position: [sideX, winY, -winW / 2 - 0.014],
    });
    parts.push({
      shape: { kind: 'box', size: [0.028, winH, 0.028] },
      position: [sideX, winY, winW / 2 + 0.014],
    });
    // Center mullion
    parts.push({
      shape: { kind: 'box', size: [0.024, winH, 0.02] },
      position: [sideX, winY, 0],
    });
    // Protruding side sill
    parts.push({
      shape: { kind: 'box', size: [0.05, 0.03, winW + 0.09] },
      position: [sideX + side * 0.012, winY - winH / 2 - 0.028, 0],
    });
  }

  return parts;
}

function verandaParts(h: HouseSpec): Part[] {
  const n = Math.max(2, Math.round(h.width / 1.3)) + 1;
  const parts: Part[] = [
    {
      shape: { kind: 'box', size: [h.width + 0.1, 0.08, 0.95] },
      position: [0, 0.1, h.depth / 2 + 0.5],
    },
  ];
  for (let i = 0; i < n; i++) {
    const x = -h.width / 2 + 0.08 + ((h.width - 0.16) / (n - 1)) * i;
    parts.push({
      shape: { kind: 'box', size: [0.08, h.wallHeight, 0.08] },
      position: [x, h.wallHeight / 2 + 0.1, h.depth / 2 + 0.88],
    });
  }
  return parts;
}

function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  if (!merged) throw new Error('buildHouseCluster: incompatible geometries');
  return merged;
}

/** Builds the merged geometries of a house cluster (pure; no React, no materials). */
export function buildHouseCluster(houses: readonly HouseSpec[]): HouseClusterGeometry {
  const trim: THREE.BufferGeometry[] = [];
  const walls: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const verandas: THREE.BufferGeometry[] = [];

  for (const h of houses) {
    const m = placement(h);
    const overhang = h.overhang ?? 0.32;

    trim.push(mergeParts(trimParts(h)).applyMatrix4(m));
    windows.push(mergeParts(windowParts(h)).applyMatrix4(m));

    const wall = new THREE.BoxGeometry(h.width, h.wallHeight, h.depth).toNonIndexed();
    wall.translate(0, h.wallHeight / 2 + 0.12, 0);
    walls.push(paint(wall, h.wallColor).applyMatrix4(m));

    const roofW = h.width + overhang * 2;
    const roofD = h.depth + overhang * 2 + (h.veranda ? 0.9 : 0);
    const roof = createHipRoofGeometry(roofW, roofD, h.roofHeight);
    roof.translate(0, h.wallHeight + 0.1, h.veranda ? 0.45 : 0);
    roofs.push(paint(roof, h.roofColor).applyMatrix4(m));

    if (h.veranda) verandas.push(mergeParts(verandaParts(h)).applyMatrix4(m));
  }

  return {
    trim: merge(trim),
    walls: merge(walls),
    roofs: merge(roofs),
    windows: merge(windows),
    verandas: verandas.length ? merge(verandas) : null,
  };
}
