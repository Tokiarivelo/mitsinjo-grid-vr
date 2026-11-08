import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHipRoofGeometry } from './hip-roof';
import { createGableRoofGeometry } from './gable-roof';
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
  /** Architectural roof profile: 'gable' for modern eco-pavilions, 'hip' for traditional 4-slope. */
  roofStyle?: 'hip' | 'gable';
  /** Asymmetrical ridge offset along Z (negative shifts ridge backwards, expanding the front solar roof slope). */
  ridgeZOffset?: number;
  /** Outdoor terrace patio furniture (timber dining table + benches + stone curb). */
  deckFurniture?: boolean;
  /** Vertical timber slat battens (claire-voie) on the facade flanking panoramic glass. */
  slatCladding?: boolean;
  /** Charming cottage architecture (Image 1): chimney, arched attic window, gabled entrance porch with steps and railings. */
  cottage?: boolean;
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
  return houses.some((h) => h.veranda || h.deckFurniture || h.cottage) ? 5 : 4;
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
  // 1. Classic Cottage Architecture (Image 1): Multi-pane sash windows & arched attic window
  if (h.cottage) {
    const parts: Part[] = [];
    const winW = Math.min(0.48, h.width * 0.24);
    const winH = h.wallHeight * 0.44;
    const winY = 0.12 + winH / 2 + 0.15;
    const doorH = h.wallHeight * 0.68;

    // Front arched attic dormer window at the gable peak
    parts.push({
      shape: { kind: 'plane', size: [0.32, 0.24] },
      position: [0, h.wallHeight + h.roofHeight * 0.48, h.depth / 2 + 0.016],
      rotation: [0, 0, 0],
    });

    // Front door glass upper panels
    parts.push({
      shape: { kind: 'plane', size: [0.28, doorH * 0.36] },
      position: [0, 0.12 + doorH * 0.68, h.depth / 2 + 0.016],
      rotation: [0, 0, 0],
    });

    // Front multi-pane sash windows flanking the entrance
    const frontX = h.width * 0.32;
    for (const side of [-1, 1]) {
      parts.push({
        shape: { kind: 'plane', size: [winW, winH] },
        position: [side * frontX, winY, h.depth / 2 + 0.016],
        rotation: [0, 0, 0],
      });
    }

    // Side multi-pane windows
    for (const side of [-1, 1]) {
      parts.push({
        shape: { kind: 'plane', size: [winW, winH] },
        position: [side * (h.width / 2 + 0.016), winY, 0],
        rotation: [0, (side * Math.PI) / 2, 0],
      });
    }

    // Rear window
    parts.push({
      shape: { kind: 'plane', size: [winW, winH] },
      position: [0, winY, -h.depth / 2 - 0.016],
      rotation: [0, Math.PI, 0],
    });

    return parts;
  }

  // 2. Modern Eco-Pavilion (Gable / Saltbox): Floor-to-ceiling panoramic sliding glass doors
  if (h.roofStyle === 'gable') {
    const parts: Part[] = [];
    const panoW = h.width * 0.54;
    const panoH = h.wallHeight * 0.78;
    const panoY = 0.12 + panoH / 2;
    const panoX = -h.width * 0.08;
    const panoZ = h.depth / 2 + 0.014;

    // Front panoramic sliding glass
    parts.push({
      shape: { kind: 'plane', size: [panoW, panoH] },
      position: [panoX, panoY, panoZ],
      rotation: [0, 0, 0],
    });

    // Side floor-to-ceiling picture window facing the surrounding nature
    const sideW = Math.min(1.1, h.depth * 0.52);
    const sideH = h.wallHeight * 0.72;
    const sideY = 0.12 + sideH / 2;
    parts.push({
      shape: { kind: 'plane', size: [sideW, sideH] },
      position: [h.width / 2 + 0.014, sideY, 0],
      rotation: [0, Math.PI / 2, 0],
    });

    // Back clerestory / window
    const backW = Math.min(0.9, h.width * 0.45);
    const backH = h.wallHeight * 0.38;
    const backY = h.wallHeight * 0.62 + 0.12;
    parts.push({
      shape: { kind: 'plane', size: [backW, backH] },
      position: [0, backY, -h.depth / 2 - 0.014],
      rotation: [0, Math.PI, 0],
    });

    return parts;
  }

  // 2. Traditional Hip Roof Windows
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
  // 1. Classic Cottage Architectural Trim (Image 1): Chimney, arched dormer, window sills & muntins
  if (h.cottage) {
    const parts: Part[] = [];
    const winW = Math.min(0.48, h.width * 0.24);
    const winH = h.wallHeight * 0.44;
    const winY = 0.12 + winH / 2 + 0.15;
    const doorW = 0.44;
    const doorH = h.wallHeight * 0.68;
    const doorY = 0.12 + doorH / 2;
    const doorZ = h.depth / 2 + 0.015;

    // Foundation plinth band
    parts.push({
      shape: { kind: 'box', size: [h.width + 0.18, 0.12, h.depth + 0.18] },
      position: [0, 0.06, 0],
    });

    // Masonry Roof Chimney on roof slope
    const chimX = h.width * 0.22;
    const chimZ = -h.depth * 0.12;
    const chimY = h.wallHeight + h.roofHeight * 0.6;
    parts.push(
      {
        shape: { kind: 'box', size: [0.32, h.roofHeight * 0.95, 0.32] },
        position: [chimX, chimY, chimZ],
      },
      {
        shape: { kind: 'box', size: [0.38, 0.06, 0.38] },
        position: [chimX, chimY + h.roofHeight * 0.48, chimZ],
      },
      {
        shape: { kind: 'box', size: [0.22, 0.04, 0.22] },
        position: [chimX, chimY + h.roofHeight * 0.52, chimZ],
      }
    );

    // Arched attic dormer window surround & muntins
    const atticY = h.wallHeight + h.roofHeight * 0.48;
    parts.push(
      { shape: { kind: 'box', size: [0.36, 0.28, 0.035] }, position: [0, atticY, doorZ] },
      { shape: { kind: 'box', size: [0.3, 0.02, 0.045] }, position: [0, atticY, doorZ + 0.01] },
      { shape: { kind: 'box', size: [0.02, 0.24, 0.045] }, position: [0, atticY, doorZ + 0.01] },
      {
        shape: { kind: 'box', size: [0.42, 0.03, 0.05] },
        position: [0, atticY - 0.14, doorZ + 0.015],
      }
    );

    // Front door frame & panel
    parts.push(
      {
        shape: { kind: 'box', size: [doorW + 0.08, doorH + 0.04, 0.04] },
        position: [0, doorY, doorZ],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.18, 0.03] },
        position: [doorW * 0.35, doorY, doorZ + 0.02],
      }
    );

    // Front multi-pane window frames & sills (flanking door)
    const frontX = h.width * 0.32;
    for (const side of [-1, 1]) {
      const fx = side * frontX;
      parts.push(
        {
          shape: { kind: 'box', size: [winW + 0.08, winH + 0.08, 0.04] },
          position: [fx, winY, doorZ],
        },
        {
          shape: { kind: 'box', size: [winW + 0.14, 0.035, 0.06] },
          position: [fx, winY - winH / 2 - 0.02, doorZ + 0.015],
        },
        { shape: { kind: 'box', size: [winW, 0.02, 0.045] }, position: [fx, winY, doorZ + 0.01] },
        { shape: { kind: 'box', size: [0.02, winH, 0.045] }, position: [fx, winY, doorZ + 0.01] }
      );
    }

    // Side multi-pane window frames & sills
    for (const side of [-1, 1]) {
      const sx = side * (h.width / 2 + 0.015);
      parts.push(
        { shape: { kind: 'box', size: [0.04, winH + 0.08, winW + 0.08] }, position: [sx, winY, 0] },
        {
          shape: { kind: 'box', size: [0.06, 0.035, winW + 0.14] },
          position: [sx + side * 0.015, winY - winH / 2 - 0.02, 0],
        },
        {
          shape: { kind: 'box', size: [0.045, 0.02, winW] },
          position: [sx + side * 0.01, winY, 0],
        },
        { shape: { kind: 'box', size: [0.045, winH, 0.02] }, position: [sx + side * 0.01, winY, 0] }
      );
    }

    return parts;
  }

  // 2. Modern Eco-Pavilion Architectural Trim & Slat Battens
  if (h.roofStyle === 'gable') {
    const panoW = h.width * 0.54;
    const panoH = h.wallHeight * 0.78;
    const panoY = 0.12 + panoH / 2;
    const panoX = -h.width * 0.08;
    const panoZ = h.depth / 2 + 0.014;

    const parts: Part[] = [
      // Base plinth foundation band
      {
        shape: { kind: 'box', size: [h.width + 0.18, 0.12, h.depth + 0.18] },
        position: [0, 0.06, 0],
      },
      // Panoramic glass charcoal frame header
      {
        shape: { kind: 'box', size: [panoW + 0.07, 0.038, 0.035] },
        position: [panoX, panoY + panoH / 2 + 0.015, panoZ + 0.008],
      },
      // Floor threshold runner
      {
        shape: { kind: 'box', size: [panoW + 0.07, 0.025, 0.045] },
        position: [panoX, 0.12, panoZ + 0.008],
      },
      // Left vertical frame jamb
      {
        shape: { kind: 'box', size: [0.035, panoH, 0.035] },
        position: [panoX - panoW / 2 - 0.015, panoY, panoZ + 0.008],
      },
      // Right vertical frame jamb
      {
        shape: { kind: 'box', size: [0.035, panoH, 0.035] },
        position: [panoX + panoW / 2 + 0.015, panoY, panoZ + 0.008],
      },
      // Center sliding division mullion
      {
        shape: { kind: 'box', size: [0.03, panoH, 0.038] },
        position: [panoX, panoY, panoZ + 0.008],
      },
      // Minimalist vertical pull handle on sliding leaf
      {
        shape: { kind: 'box', size: [0.02, 0.22, 0.032] },
        position: [panoX + 0.04, panoY, panoZ + 0.024],
      },
      // Side window frame
      {
        shape: { kind: 'box', size: [0.035, 0.035, Math.min(1.1, h.depth * 0.52) + 0.07] },
        position: [h.width / 2 + 0.014, 0.12 + h.wallHeight * 0.72 + 0.015, 0],
      },
      {
        shape: { kind: 'box', size: [0.035, 0.025, Math.min(1.1, h.depth * 0.52) + 0.07] },
        position: [h.width / 2 + 0.014, 0.12, 0],
      },
      // Architectural fascia rakes along gable edges (dark trim defining roof silhouette)
      {
        shape: { kind: 'box', size: [h.width + 0.36, 0.05, 0.04] },
        position: [0, h.wallHeight + 0.1, -h.depth / 2 - 0.16],
      },
    ];

    // Vertical 3D cedar timber battens (claire-voie) flanking the sliding door
    if (h.slatCladding !== false) {
      const slatW = 0.032;
      const slatD = 0.025;
      const slatH = h.wallHeight * 0.88;
      const slatY = 0.12 + slatH / 2;
      const startX = panoX + panoW / 2 + 0.08;
      const endX = h.width / 2 - 0.05;
      const count = Math.max(2, Math.floor((endX - startX) / 0.11));
      for (let s = 0; s < count; s++) {
        const sx = startX + (s / (count - 1)) * (endX - startX);
        parts.push({
          shape: { kind: 'box', size: [slatW, slatH, slatD] },
          position: [sx, slatY, panoZ + 0.01],
        });
      }
    }

    return parts;
  }

  // 2. Traditional Hip Roof Trim
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
  // 1. Classic Cottage Front Entrance Porch with Gabled Canopy, Steps & Railings (Image 1)
  if (h.cottage) {
    const porchW = 0.78;
    const porchD = 0.65;
    const porchZ = h.depth / 2 + porchD / 2;
    const porchH = h.wallHeight * 0.74;
    const parts: Part[] = [
      // Porch landing deck platform
      { shape: { kind: 'box', size: [porchW, 0.12, porchD] }, position: [0, 0.06, porchZ] },
      // Stairway step 1
      {
        shape: { kind: 'box', size: [porchW + 0.08, 0.05, 0.22] },
        position: [0, 0.025, porchZ + porchD / 2 + 0.32],
      },
      // Stairway step 2
      {
        shape: { kind: 'box', size: [porchW + 0.04, 0.05, 0.22] },
        position: [0, 0.065, porchZ + porchD / 2 + 0.15],
      },
      // Porch front columns supporting the canopy
      {
        shape: { kind: 'box', size: [0.05, porchH, 0.05] },
        position: [-porchW / 2 + 0.04, porchH / 2 + 0.12, porchZ + porchD / 2 - 0.04],
      },
      {
        shape: { kind: 'box', size: [0.05, porchH, 0.05] },
        position: [porchW / 2 - 0.04, porchH / 2 + 0.12, porchZ + porchD / 2 - 0.04],
      },
      // Gabled canopy roof over porch (left & right slopes)
      {
        shape: { kind: 'box', size: [0.48, 0.04, porchD + 0.15] },
        position: [-0.18, porchH + 0.22, porchZ],
        rotation: [0, 0, 0.55],
      },
      {
        shape: { kind: 'box', size: [0.48, 0.04, porchD + 0.15] },
        position: [0.18, porchH + 0.22, porchZ],
        rotation: [0, 0, -0.55],
      },
      // Porch triangular pediment front
      {
        shape: { kind: 'box', size: [porchW * 0.72, 0.22, 0.03] },
        position: [0, porchH + 0.18, porchZ + porchD / 2],
      },
      // Left side railing & balusters
      {
        shape: { kind: 'box', size: [0.03, 0.03, porchD - 0.08] },
        position: [-porchW / 2 + 0.04, 0.32, porchZ],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.2, 0.02] },
        position: [-porchW / 2 + 0.04, 0.22, porchZ - 0.12],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.2, 0.02] },
        position: [-porchW / 2 + 0.04, 0.22, porchZ + 0.12],
      },
      // Right side railing & balusters
      {
        shape: { kind: 'box', size: [0.03, 0.03, porchD - 0.08] },
        position: [porchW / 2 - 0.04, 0.32, porchZ],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.2, 0.02] },
        position: [porchW / 2 - 0.04, 0.22, porchZ - 0.12],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.2, 0.02] },
        position: [porchW / 2 - 0.04, 0.22, porchZ + 0.12],
      },
    ];
    return parts;
  }

  // 2. Modern Eco-Pavilion Raised Timber Deck with Outdoor Picnic Table & Benches
  if (h.deckFurniture) {
    const deckW = h.width + 0.45;
    const deckD = 1.25;
    const deckH = 0.12;
    const deckZ = h.depth / 2 + deckD / 2;
    const parts: Part[] = [
      // Raised solid timber terrace deck platform
      {
        shape: { kind: 'box', size: [deckW, deckH, deckD] },
        position: [0, deckH / 2, deckZ],
      },
      // Low stone retaining curb around the terrace perimeter
      {
        shape: { kind: 'box', size: [deckW + 0.12, 0.14, 0.1] },
        position: [0, 0.07, deckZ + deckD / 2 + 0.05],
      },
      {
        shape: { kind: 'box', size: [0.1, 0.14, deckD] },
        position: [-deckW / 2 - 0.05, 0.07, deckZ],
      },
      {
        shape: { kind: 'box', size: [0.1, 0.14, deckD] },
        position: [deckW / 2 + 0.05, 0.07, deckZ],
      },
    ];

    // Modern solid wood picnic table on the terrace
    const tableX = h.width * 0.22;
    const tableZ = deckZ;
    const tableW = 0.68;
    const tableD = 0.38;
    const tableH = 0.44;
    // Table top
    parts.push({
      shape: { kind: 'box', size: [tableW, 0.035, tableD] },
      position: [tableX, deckH + tableH, tableZ],
    });
    // Table legs
    for (const lx of [-tableW * 0.38, tableW * 0.38]) {
      parts.push({
        shape: { kind: 'box', size: [0.04, tableH, tableD * 0.8] },
        position: [tableX + lx, deckH + tableH / 2, tableZ],
      });
    }

    // Matching wooden bench seats on both sides of the table
    for (const bSign of [-1, 1]) {
      const bZ = tableZ + bSign * 0.28;
      const bH = 0.26;
      // Bench top
      parts.push({
        shape: { kind: 'box', size: [tableW * 0.95, 0.03, 0.16] },
        position: [tableX, deckH + bH, bZ],
      });
      // Bench leg supports
      for (const lx of [-tableW * 0.35, tableW * 0.35]) {
        parts.push({
          shape: { kind: 'box', size: [0.035, bH, 0.12] },
          position: [tableX + lx, deckH + bH / 2, bZ],
        });
      }
    }

    // Front corner veranda post supporting the roof overhang
    parts.push({
      shape: { kind: 'box', size: [0.07, h.wallHeight + 0.15, 0.07] },
      position: [-h.width / 2 + 0.06, (h.wallHeight + 0.15) / 2, deckZ + deckD / 2 - 0.08],
    });

    return parts;
  }

  // 2. Traditional Veranda with Posts
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
    const hasVeranda = Boolean(h.veranda || h.deckFurniture || h.cottage);

    trim.push(mergeParts(trimParts(h)).applyMatrix4(m));
    windows.push(mergeParts(windowParts(h)).applyMatrix4(m));

    const wall = new THREE.BoxGeometry(h.width, h.wallHeight, h.depth).toNonIndexed();
    wall.translate(0, h.wallHeight / 2 + 0.12, 0);
    walls.push(paint(wall, h.wallColor).applyMatrix4(m));

    const roofW = h.width + overhang * 2;
    const roofD = h.depth + overhang * 2 + (h.veranda ? 0.9 : 0);

    let roof: THREE.BufferGeometry;
    if (h.roofStyle === 'gable') {
      const ridgeZ = h.ridgeZOffset ?? (h.veranda ? -0.25 : h.deckFurniture ? -0.15 : 0);
      roof = createGableRoofGeometry(roofW, roofD, h.roofHeight, 0, ridgeZ);
    } else {
      roof = createHipRoofGeometry(roofW, roofD, h.roofHeight);
    }
    roof.translate(0, h.wallHeight + 0.1, h.veranda ? 0.45 : 0);
    roofs.push(paint(roof, h.roofColor).applyMatrix4(m));

    if (hasVeranda) verandas.push(mergeParts(verandaParts(h)).applyMatrix4(m));
  }

  return {
    trim: merge(trim),
    walls: merge(walls),
    roofs: merge(roofs),
    windows: merge(windows),
    verandas: verandas.length ? merge(verandas) : null,
  };
}
