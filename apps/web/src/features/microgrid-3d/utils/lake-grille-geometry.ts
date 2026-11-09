import * as THREE from 'three';
import { mergeParts, type Part } from './merge-parts';
import { LAKE_CENTER, terrainHeight, POND_CENTER, POND_RADIUS } from './landscape';

export interface LakeGrilleGeometries {
  /** Metal posts, handrails, curb and security grille balusters. */
  metalGrille: THREE.BufferGeometry;
  /** Luminous beacon lantern caps atop the posts. */
  lanterns: THREE.BufferGeometry;
}

/**
 * Procedural geometry generator for the security grille and illuminated promenade
 * railing around the lake near the hilltop wind turbines, with safety edging at the pond.
 */
export function createLakeGrilleGeometry(arcSteps = 24): LakeGrilleGeometries {
  const metalParts: Part[] = [];
  const lanternParts: Part[] = [];

  // =========================================================================
  // 1. PROMENADE GRILLE ALONG THE LAKE SHORE FACING THE WIND TURBINES
  // Lake center is [34, -70], radius ~24.5m
  // Arc spans from theta = 0.35 rad (~20°) to 2.80 rad (~160°), directly below
  // Turbine #3 (22, -58) and Turbine #4 (48, -42).
  // =========================================================================
  const lakeR = 24.6;
  const thetaStart = 0.35;
  const thetaEnd = 2.8;

  interface ShoreNode {
    x: number;
    y: number;
    z: number;
  }

  const nodes: ShoreNode[] = [];
  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps;
    const theta = thetaStart + t * (thetaEnd - thetaStart);
    const x = LAKE_CENTER[0] + lakeR * Math.cos(theta);
    const z = LAKE_CENTER[1] + lakeR * Math.sin(theta);
    // Keep post base securely founded on shoreline ground
    const y = Math.max(-0.55, terrainHeight(x, z) + 0.04);
    nodes.push({ x, y, z });
  }

  // A. Vertical steel posts and lantern bollards at each node
  for (const node of nodes) {
    const { x, y, z } = node;

    // Main post
    metalParts.push(
      {
        shape: { kind: 'box', size: [0.08, 1.05, 0.08] },
        position: [x, y + 0.52, z],
      },
      // Post flange base
      {
        shape: { kind: 'box', size: [0.14, 0.06, 0.14] },
        position: [x, y + 0.03, z],
      },
      // Post top cap plate
      {
        shape: { kind: 'box', size: [0.12, 0.03, 0.12] },
        position: [x, y + 1.05, z],
      },
      // Lantern protective top hood
      {
        shape: { kind: 'box', size: [0.12, 0.025, 0.12] },
        position: [x, y + 1.22, z],
      }
    );

    // Luminescent lantern glass cylinder
    lanternParts.push({
      shape: {
        kind: 'cylinder',
        radiusTop: 0.045,
        radiusBottom: 0.045,
        height: 0.12,
        segments: 8,
      },
      position: [x, y + 1.13, z],
    });
  }

  // B. Horizontal railings, bottom curbs, and vertical security grille balusters between nodes
  for (let i = 0; i < nodes.length - 1; i++) {
    const p1 = nodes[i];
    const p2 = nodes[i + 1];
    if (!p1 || !p2) continue;

    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const span = Math.hypot(dx, dz);
    const yaw = Math.atan2(dz, dx);

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const mz = (p1.z + p2.z) / 2;

    // Top safety handrail
    metalParts.push({
      shape: { kind: 'box', size: [span, 0.05, 0.05] },
      position: [mx, my + 0.98, mz],
      rotation: [0, -yaw, 0],
    });

    // Mid guard rail
    metalParts.push({
      shape: { kind: 'box', size: [span, 0.035, 0.035] },
      position: [mx, my + 0.55, mz],
      rotation: [0, -yaw, 0],
    });

    // Bottom kick rail
    metalParts.push({
      shape: { kind: 'box', size: [span, 0.035, 0.035] },
      position: [mx, my + 0.14, mz],
      rotation: [0, -yaw, 0],
    });

    // Vertical security grille balusters (3 balusters per segment)
    for (let b = 1; b <= 3; b++) {
      const frac = b / 4;
      const bx = p1.x + dx * frac;
      const by = p1.y + (p2.y - p1.y) * frac;
      const bz = p1.z + dz * frac;

      metalParts.push({
        shape: { kind: 'box', size: [0.025, 0.82, 0.025] },
        position: [bx, by + 0.55, bz],
      });
    }
  }

  // =========================================================================
  // 2. VILLAGE POND SAFETY RAILING BESIDE WATER STATION
  // Pond center is [-11.5, 4.5], radius ~2.6m
  // =========================================================================
  const pondR = POND_RADIUS + 0.55;
  const pondSteps = 10;
  const pondThetaStart = -Math.PI * 0.4;
  const pondThetaEnd = Math.PI * 0.7;

  const pondNodes: ShoreNode[] = [];
  for (let i = 0; i <= pondSteps; i++) {
    const t = i / pondSteps;
    const theta = pondThetaStart + t * (pondThetaEnd - pondThetaStart);
    const x = POND_CENTER[0] + pondR * Math.cos(theta);
    const z = POND_CENTER[1] + pondR * Math.sin(theta);
    const y = terrainHeight(x, z) + 0.02;
    pondNodes.push({ x, y, z });
  }

  for (let i = 0; i < pondNodes.length; i++) {
    const node = pondNodes[i];
    if (!node) continue;
    const { x, y, z } = node;
    metalParts.push(
      {
        shape: { kind: 'box', size: [0.07, 0.95, 0.07] },
        position: [x, y + 0.48, z],
      },
      {
        shape: { kind: 'box', size: [0.1, 0.025, 0.1] },
        position: [x, y + 0.96, z],
      }
    );
    // Lanterns on alternating pond posts
    if (i % 2 === 0) {
      lanternParts.push({
        shape: {
          kind: 'cylinder',
          radiusTop: 0.04,
          radiusBottom: 0.04,
          height: 0.1,
          segments: 8,
        },
        position: [x, y + 1.02, z],
      });
    }
  }

  for (let i = 0; i < pondNodes.length - 1; i++) {
    const p1 = pondNodes[i];
    const p2 = pondNodes[i + 1];
    if (!p1 || !p2) continue;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const span = Math.hypot(dx, dz);
    const yaw = Math.atan2(dz, dx);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const mz = (p1.z + p2.z) / 2;

    metalParts.push(
      {
        shape: { kind: 'box', size: [span, 0.04, 0.04] },
        position: [mx, my + 0.88, mz],
        rotation: [0, -yaw, 0],
      },
      {
        shape: { kind: 'box', size: [span, 0.03, 0.03] },
        position: [mx, my + 0.45, mz],
        rotation: [0, -yaw, 0],
      }
    );
  }

  return {
    metalGrille: mergeParts(metalParts),
    lanterns: mergeParts(lanternParts),
  };
}
