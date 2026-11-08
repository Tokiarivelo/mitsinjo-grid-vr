import * as THREE from 'three';
import { mergeParts, type Part } from './merge-parts';

/**
 * Procedural geometry for the Primary School.
 * Modeled after the iconic elementary schoolhouse:
 * - Central 2-story pavilion with a bell tower (belfry) & brass bell, "PRIMARY SCHOOL" sign,
 *   arched round attic window, entrance portico with steps & double red doors.
 * - Symmetrical left and right wings with sunny yellow ground story, sky blue upper story,
 *   red divider belt, multi-pane framed windows, and gabled corrugated roofs.
 * - Brick red chimney on the left roof.
 * - Front schoolyard & playground: slide with canopy, swing set, school benches,
 *   raised vegetable/flower bed, stone walkway, and miniature yellow school bus.
 */
export interface SchoolGeometries {
  yellowWalls: THREE.BufferGeometry;
  blueWalls: THREE.BufferGeometry;
  redTrim: THREE.BufferGeometry;
  woodTrim: THREE.BufferGeometry;
  roofs: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  playground: THREE.BufferGeometry;
  brassBell: THREE.BufferGeometry;
}

export function createSchoolGeometry(): SchoolGeometries {
  const yellowParts: Part[] = [];
  const blueParts: Part[] = [];
  const redParts: Part[] = [];
  const woodParts: Part[] = [];
  const roofParts: Part[] = [];
  const glassParts: Part[] = [];
  const yardParts: Part[] = [];
  const bellParts: Part[] = [];

  // =========================================================================
  // 1. CENTRAL 2-STOREY PAVILION
  // =========================================================================
  const CW = 2.6; // Central width
  const CD = 2.8; // Central depth
  const H1 = 1.25; // Lower story height
  const H2 = 1.1; // Upper story height

  // Lower story (Yellow)
  yellowParts.push(
    // Front wall
    { shape: { kind: 'box', size: [CW, H1, 0.12] }, position: [0, H1 / 2, CD / 2] },
    // Back wall
    { shape: { kind: 'box', size: [CW, H1, 0.12] }, position: [0, H1 / 2, -CD / 2] },
    // Side walls
    { shape: { kind: 'box', size: [0.12, H1, CD] }, position: [-CW / 2, H1 / 2, 0] },
    { shape: { kind: 'box', size: [0.12, H1, CD] }, position: [CW / 2, H1 / 2, 0] },
    // Base foundation plinth
    { shape: { kind: 'box', size: [CW + 0.1, 0.08, CD + 0.1] }, position: [0, 0.04, 0] }
  );

  // Red horizontal divider belt
  const beltY = H1 + 0.05;
  redParts.push({
    shape: { kind: 'box', size: [CW + 0.14, 0.1, CD + 0.14] },
    position: [0, beltY, 0],
  });

  // Upper story (Sky Blue)
  const upCenterY = H1 + 0.1 + H2 / 2;
  blueParts.push(
    // Front wall
    { shape: { kind: 'box', size: [CW, H2, 0.12] }, position: [0, upCenterY, CD / 2] },
    // Back wall
    { shape: { kind: 'box', size: [CW, H2, 0.12] }, position: [0, upCenterY, -CD / 2] },
    // Side walls
    { shape: { kind: 'box', size: [0.12, H2, CD] }, position: [-CW / 2, upCenterY, 0] },
    { shape: { kind: 'box', size: [0.12, H2, CD] }, position: [CW / 2, upCenterY, 0] }
  );

  // Central Front Gable Pediment (Peak at y ~ 3.35m)
  // Approximate triangle face using stepped horizontal slices for perfect geometry stability
  const pedBaseY = H1 + 0.1 + H2;
  const pedHeight = 0.95;
  const slices = 6;
  for (let i = 0; i < slices; i++) {
    const t = i / slices;
    const w = CW * (1 - t);
    const sh = pedHeight / slices;
    const sy = pedBaseY + t * pedHeight + sh / 2;
    blueParts.push({
      shape: { kind: 'box', size: [w, sh, 0.12] },
      position: [0, sy, CD / 2],
    });
    // And rear gable face
    blueParts.push({
      shape: { kind: 'box', size: [w, sh, 0.12] },
      position: [0, sy, -CD / 2],
    });
  }

  // Central Gable Roof (Ribbed / corrugated pitch)
  const ridgeY = pedBaseY + pedHeight + 0.05;
  const roofSlopeLen = Math.hypot(CW / 2 + 0.25, pedHeight);
  const roofAngle = Math.atan2(pedHeight, CW / 2 + 0.25);
  // Left slope
  roofParts.push({
    shape: { kind: 'box', size: [roofSlopeLen, 0.08, CD + 0.4] },
    position: [-(CW / 4 + 0.05), pedBaseY + pedHeight / 2 + 0.04, 0],
    rotation: [0, 0, roofAngle],
  });
  // Right slope
  roofParts.push({
    shape: { kind: 'box', size: [roofSlopeLen, 0.08, CD + 0.4] },
    position: [CW / 4 + 0.05, pedBaseY + pedHeight / 2 + 0.04, 0],
    rotation: [0, 0, -roofAngle],
  });

  // Round / Arched Attic Window on Central Pediment (staged cleanly to prevent z-fighting)
  blueParts.push({
    shape: { kind: 'cylinder', radiusTop: 0.22, radiusBottom: 0.22, height: 0.04, segments: 12 },
    position: [0, pedBaseY + 0.48, CD / 2 + 0.09],
    rotation: [Math.PI / 2, 0, 0],
  });
  glassParts.push({
    shape: { kind: 'cylinder', radiusTop: 0.18, radiusBottom: 0.18, height: 0.01, segments: 12 },
    position: [0, pedBaseY + 0.48, CD / 2 + 0.08],
    rotation: [Math.PI / 2, 0, 0],
  });
  woodParts.push(
    // Cross muntins on round window
    {
      shape: { kind: 'box', size: [0.36, 0.025, 0.02] },
      position: [0, pedBaseY + 0.48, CD / 2 + 0.095],
    },
    {
      shape: { kind: 'box', size: [0.025, 0.36, 0.02] },
      position: [0, pedBaseY + 0.48, CD / 2 + 0.095],
    }
  );

  // "PRIMARY SCHOOL" sign board
  woodParts.push({
    shape: { kind: 'box', size: [1.7, 0.36, 0.04] },
    position: [0, pedBaseY + 0.06, CD / 2 + 0.08],
  });
  yardParts.push(
    // White lettering plate
    {
      shape: { kind: 'box', size: [1.55, 0.28, 0.02] },
      position: [0, pedBaseY + 0.06, CD / 2 + 0.11],
    },
    // "WELCOME" banner below
    {
      shape: { kind: 'box', size: [1.1, 0.14, 0.02] },
      position: [0, pedBaseY - 0.16, CD / 2 + 0.08],
    }
  );

  // =========================================================================
  // 2. BELL TOWER (BELFRY) & BRASS SCHOOL BELL
  // =========================================================================
  const belfryY = ridgeY;
  const belfrySize = 0.85;
  // Belfry Base
  blueParts.push({
    shape: { kind: 'box', size: [belfrySize, 0.16, belfrySize] },
    position: [0, belfryY + 0.08, 0.2],
  });
  // 4 Belfry Corner Posts
  const postH = 0.75;
  const halfB = belfrySize / 2 - 0.06;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      woodParts.push({
        shape: { kind: 'box', size: [0.08, postH, 0.08] },
        position: [sx * halfB, belfryY + 0.16 + postH / 2, 0.2 + sz * halfB],
      });
    }
  }
  // Belfry Arched Lintels / Cap
  blueParts.push({
    shape: { kind: 'box', size: [belfrySize + 0.08, 0.1, belfrySize + 0.08] },
    position: [0, belfryY + 0.16 + postH + 0.05, 0.2],
  });
  // Belfry Gabled Roof
  const belfryRoofY = belfryY + 0.16 + postH + 0.1;
  const belfrySlopeLen = Math.hypot(belfrySize / 2 + 0.1, 0.35);
  const belfryAngle = Math.atan2(0.35, belfrySize / 2 + 0.1);
  roofParts.push(
    {
      shape: { kind: 'box', size: [belfrySlopeLen, 0.06, belfrySize + 0.2] },
      position: [-(belfrySize / 4 + 0.02), belfryRoofY + 0.18, 0.2],
      rotation: [0, 0, belfryAngle],
    },
    {
      shape: { kind: 'box', size: [belfrySlopeLen, 0.06, belfrySize + 0.2] },
      position: [belfrySize / 4 + 0.02, belfryRoofY + 0.18, 0.2],
      rotation: [0, 0, -belfryAngle],
    }
  );

  // Brass School Bell inside belfry
  const bellY = belfryY + 0.16 + postH * 0.48;
  bellParts.push(
    // Bell body (tapered cone)
    {
      shape: { kind: 'cylinder', radiusTop: 0.04, radiusBottom: 0.14, height: 0.22, segments: 12 },
      position: [0, bellY, 0.2],
    },
    // Top yoke / crown
    {
      shape: { kind: 'cylinder', radiusTop: 0.03, radiusBottom: 0.03, height: 0.08, segments: 8 },
      position: [0, bellY + 0.13, 0.2],
    },
    // Clapper sphere
    { shape: { kind: 'sphere', radius: 0.03, segments: 8 }, position: [0, bellY - 0.11, 0.2] }
  );

  // =========================================================================
  // 3. MAIN ENTRANCE PORTICO & STEPS
  // =========================================================================
  const porchW = 1.35;
  const porchD = 0.9;
  const porchZ = CD / 2 + porchD / 2;

  // Front Entry Steps (3 tiers)
  yellowParts.push(
    {
      shape: { kind: 'box', size: [porchW + 0.3, 0.08, 0.3] },
      position: [0, 0.04, CD / 2 + porchD + 0.2],
    },
    {
      shape: { kind: 'box', size: [porchW + 0.2, 0.08, 0.3] },
      position: [0, 0.12, CD / 2 + porchD + 0.05],
    },
    { shape: { kind: 'box', size: [porchW + 0.1, 0.08, porchD] }, position: [0, 0.2, porchZ] }
  );

  // Porch Columns (2 square architectural pillars)
  yellowParts.push(
    {
      shape: { kind: 'box', size: [0.12, 1.05, 0.12] },
      position: [-porchW / 2 + 0.08, 0.72, CD / 2 + porchD - 0.08],
    },
    {
      shape: { kind: 'box', size: [0.12, 1.05, 0.12] },
      position: [porchW / 2 - 0.08, 0.72, CD / 2 + porchD - 0.08],
    }
  );

  // Porch Gabled Roof Canopy (flush to front wall at CD/2 + 0.06, overhanging porch front)
  const porchRoofY = 1.25;
  const porchSlopeLen = Math.hypot(porchW / 2 + 0.15, 0.35);
  const porchAngle = Math.atan2(0.35, porchW / 2 + 0.15);
  const porchCanopyD = porchD + 0.04;
  const porchCanopyZ = CD / 2 + 0.06 + porchCanopyD / 2;
  roofParts.push(
    {
      shape: { kind: 'box', size: [porchSlopeLen, 0.06, porchCanopyD] },
      position: [-(porchW / 4), porchRoofY + 0.18, porchCanopyZ],
      rotation: [0, 0, porchAngle],
    },
    {
      shape: { kind: 'box', size: [porchSlopeLen, 0.06, porchCanopyD] },
      position: [porchW / 4, porchRoofY + 0.18, porchCanopyZ],
      rotation: [0, 0, -porchAngle],
    }
  );

  // Double Red Entry Doors (proudly staged in front of yellow wall at CD/2 + 0.06 to eliminate z-fighting)
  const mainDoorZ = CD / 2 + 0.075;
  redParts.push(
    { shape: { kind: 'box', size: [0.44, 0.9, 0.03] }, position: [-0.23, 0.65, mainDoorZ] },
    { shape: { kind: 'box', size: [0.44, 0.9, 0.03] }, position: [0.23, 0.65, mainDoorZ] }
  );
  woodParts.push(
    // Door surround frame
    { shape: { kind: 'box', size: [1.02, 0.98, 0.04] }, position: [0, 0.66, CD / 2 + 0.068] },
    // Center divider
    { shape: { kind: 'box', size: [0.04, 0.92, 0.04] }, position: [0, 0.65, mainDoorZ + 0.015] }
  );
  // Brass handles
  bellParts.push(
    {
      shape: { kind: 'sphere', radius: 0.02, segments: 6 },
      position: [-0.06, 0.62, mainDoorZ + 0.025],
    },
    {
      shape: { kind: 'sphere', radius: 0.02, segments: 6 },
      position: [0.06, 0.62, mainDoorZ + 0.025],
    }
  );

  // =========================================================================
  // 4. LEFT AND RIGHT FLANKING WINGS
  // =========================================================================
  const WW = 2.4; // Wing width
  const WD = 2.2; // Wing depth

  for (const side of [-1, 1]) {
    const wx = side * (CW / 2 + WW / 2);

    // Lower story (Yellow)
    yellowParts.push(
      // Front wall
      { shape: { kind: 'box', size: [WW, H1, 0.12] }, position: [wx, H1 / 2, WD / 2] },
      // Back wall
      { shape: { kind: 'box', size: [WW, H1, 0.12] }, position: [wx, H1 / 2, -WD / 2] },
      // Outer side wall
      { shape: { kind: 'box', size: [0.12, H1, WD] }, position: [wx + (side * WW) / 2, H1 / 2, 0] },
      // Foundation plinth
      { shape: { kind: 'box', size: [WW + 0.1, 0.08, WD + 0.1] }, position: [wx, 0.04, 0] }
    );

    // Red divider belt
    redParts.push({
      shape: { kind: 'box', size: [WW + 0.14, 0.1, WD + 0.14] },
      position: [wx, beltY, 0],
    });

    // Upper story (Sky Blue)
    blueParts.push(
      // Front wall
      { shape: { kind: 'box', size: [WW, H2, 0.12] }, position: [wx, upCenterY, WD / 2] },
      // Back wall
      { shape: { kind: 'box', size: [WW, H2, 0.12] }, position: [wx, upCenterY, -WD / 2] },
      // Outer side wall
      {
        shape: { kind: 'box', size: [0.12, H2, WD] },
        position: [wx + (side * WW) / 2, upCenterY, 0],
      }
    );

    // Wing Gabled Roof (Ridge along X, perched on top of blue walls at y = 2.45m; does not intersect windows or walls)
    const wingRoofH = 0.65;
    const wallTopY = pedBaseY; // 2.45m (top of 2nd floor walls, comfortably above 2nd floor windows at y <= 2.19m)
    const roofHalfD = WD / 2 + 0.1; // 1.20m (slight architectural overhang beyond front and back wall faces)
    const wingSlopeLen = Math.hypot(roofHalfD, wingRoofH);
    const wingRoofAngle = Math.atan2(wingRoofH, roofHalfD);
    const roofW = WW - 0.06; // 2.34m (sits snugly between central pavilion and outer stepped parapet)
    const roofX = side * (CW / 2 + roofW / 2 + 0.01);

    // Front slope (slopes from ridge down to eaves at y = 2.45m, z = 1.20m)
    roofParts.push({
      shape: { kind: 'box', size: [roofW, 0.06, wingSlopeLen] },
      position: [roofX, wallTopY + wingRoofH / 2, roofHalfD / 2],
      rotation: [wingRoofAngle, 0, 0],
    });
    // Back slope (slopes from ridge down to eaves at y = 2.45m, z = -1.20m)
    roofParts.push({
      shape: { kind: 'box', size: [roofW, 0.06, wingSlopeLen] },
      position: [roofX, wallTopY + wingRoofH / 2, -roofHalfD / 2],
      rotation: [-wingRoofAngle, 0, 0],
    });

    // Outer crow-stepped gable parapet (Sky blue, neatly framing the gabled roof)
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      const d = (WD + 0.22) * (1 - t * 0.85);
      const sh = wingRoofH / 5;
      const sy = wallTopY + t * wingRoofH + sh / 2;
      blueParts.push({
        shape: { kind: 'box', size: [0.12, sh, d] },
        position: [wx + (side * WW) / 2, sy, 0],
      });
    }

    // Secondary Red Entrance Door on each wing (proudly staged in front of yellow wall at WD/2 + 0.06 to eliminate z-fighting)
    const secDoorZ = WD / 2 + 0.076;
    redParts.push({
      shape: { kind: 'box', size: [0.42, 0.86, 0.03] },
      position: [wx - side * 0.5, 0.55, secDoorZ],
    });
    woodParts.push({
      shape: { kind: 'box', size: [0.5, 0.92, 0.04] },
      position: [wx - side * 0.5, 0.55, WD / 2 + 0.07],
    });
    // Brass door knob
    bellParts.push({
      shape: { kind: 'sphere', radius: 0.02, segments: 6 },
      position: [wx - side * 0.5 + (side > 0 ? -0.14 : 0.14), 0.55, secDoorZ + 0.02],
    });
    // Secondary steps
    yellowParts.push({
      shape: { kind: 'box', size: [0.65, 0.1, 0.3] },
      position: [wx - side * 0.5, 0.05, WD / 2 + 0.2],
    });

    // Multi-pane Windows on Upper Story (3 windows per wing front; staged in front of wall at WD/2 + 0.06)
    const winX = [wx - 0.7, wx, wx + 0.7];
    const upWallZ = WD / 2 + 0.06;
    for (const x of winX) {
      // Window glass pane (0.015m proud of wall, 0.01m thickness)
      glassParts.push({
        shape: { kind: 'box', size: [0.38, 0.52, 0.01] },
        position: [x, upCenterY, upWallZ + 0.015],
      });
      woodParts.push(
        // Window outer frame (flush to wall, framing the glass)
        {
          shape: { kind: 'box', size: [0.44, 0.58, 0.04] },
          position: [x, upCenterY, upWallZ + 0.02],
        },
        // Window cross muntins
        {
          shape: { kind: 'box', size: [0.38, 0.02, 0.015] },
          position: [x, upCenterY, upWallZ + 0.022],
        },
        {
          shape: { kind: 'box', size: [0.02, 0.52, 0.015] },
          position: [x, upCenterY, upWallZ + 0.022],
        }
      );
    }

    // Multi-pane Windows on Lower Story (2 windows per wing front)
    const lowWinX = [wx + side * 0.45, wx + side * 0.95];
    const lowWallZ = WD / 2 + 0.06;
    for (const x of lowWinX) {
      glassParts.push({
        shape: { kind: 'box', size: [0.36, 0.48, 0.01] },
        position: [x, H1 / 2, lowWallZ + 0.015],
      });
      woodParts.push(
        {
          shape: { kind: 'box', size: [0.42, 0.54, 0.04] },
          position: [x, H1 / 2, lowWallZ + 0.02],
        },
        {
          shape: { kind: 'box', size: [0.36, 0.02, 0.015] },
          position: [x, H1 / 2, lowWallZ + 0.022],
        },
        {
          shape: { kind: 'box', size: [0.02, 0.48, 0.015] },
          position: [x, H1 / 2, lowWallZ + 0.022],
        }
      );
    }
  }

  // Windows on Central Pavilion Upper Story (wall front at CD/2 + 0.07)
  const cWinX = [-0.65, 0.65];
  const cWallZ = CD / 2 + 0.07;
  for (const x of cWinX) {
    glassParts.push({
      shape: { kind: 'box', size: [0.4, 0.55, 0.01] },
      position: [x, upCenterY, cWallZ + 0.015],
    });
    woodParts.push(
      { shape: { kind: 'box', size: [0.46, 0.62, 0.04] }, position: [x, upCenterY, cWallZ + 0.02] },
      {
        shape: { kind: 'box', size: [0.4, 0.02, 0.015] },
        position: [x, upCenterY, cWallZ + 0.022],
      },
      {
        shape: { kind: 'box', size: [0.02, 0.55, 0.015] },
        position: [x, upCenterY, cWallZ + 0.022],
      }
    );
  }

  // Brick Red Chimney on Left Roof
  redParts.push(
    // Chimney shaft
    { shape: { kind: 'box', size: [0.36, 1.05, 0.36] }, position: [-2.6, 3.15, -0.4] },
    // Chimney decorative cap
    { shape: { kind: 'box', size: [0.44, 0.08, 0.44] }, position: [-2.6, 3.7, -0.4] }
  );

  // =========================================================================
  // 5. FRONT SCHOOLYARD PLAYGROUND (COUR DE RÉCRÉATION)
  // =========================================================================

  // Central Stone Paver Pathway leading to steps
  yardParts.push({
    shape: { kind: 'box', size: [1.2, 0.02, 1.8] },
    position: [0, 0.01, CD / 2 + porchD + 1.1],
  });

  // Playground Slide (on left side of schoolyard at x = -2.6, z = 2.6)
  const slideX = -2.6;
  const slideZ = 2.4;
  // Slide platform tower posts & floor
  woodParts.push(
    {
      shape: { kind: 'box', size: [0.06, 1.25, 0.06] },
      position: [slideX - 0.25, 0.62, slideZ - 0.25],
    },
    {
      shape: { kind: 'box', size: [0.06, 1.25, 0.06] },
      position: [slideX + 0.25, 0.62, slideZ - 0.25],
    },
    {
      shape: { kind: 'box', size: [0.06, 1.25, 0.06] },
      position: [slideX - 0.25, 0.62, slideZ + 0.25],
    },
    {
      shape: { kind: 'box', size: [0.06, 1.25, 0.06] },
      position: [slideX + 0.25, 0.62, slideZ + 0.25],
    },
    // Platform floor
    { shape: { kind: 'box', size: [0.6, 0.04, 0.6] }, position: [slideX, 0.72, slideZ] },
    // Steps ladder
    { shape: { kind: 'box', size: [0.35, 0.02, 0.12] }, position: [slideX - 0.35, 0.22, slideZ] },
    { shape: { kind: 'box', size: [0.35, 0.02, 0.12] }, position: [slideX - 0.35, 0.44, slideZ] }
  );
  // Slide Blue Gabled Roof Canopy
  blueParts.push(
    {
      shape: { kind: 'box', size: [0.45, 0.04, 0.65] },
      position: [slideX - 0.15, 1.4, slideZ],
      rotation: [0, 0, 0.45],
    },
    {
      shape: { kind: 'box', size: [0.45, 0.04, 0.65] },
      position: [slideX + 0.15, 1.4, slideZ],
      rotation: [0, 0, -0.45],
    }
  );
  // Curved / Inclined Slide Chute (Cyan blue)
  yardParts.push({
    shape: { kind: 'box', size: [0.36, 0.04, 1.3] },
    position: [slideX, 0.38, slideZ + 0.8],
    rotation: [0.55, 0, 0],
  });

  // A-Frame Swing Set (on right side at x = 1.9, z = 2.5)
  const swingX = 1.9;
  const swingZ = 2.5;
  const swingW = 1.4;
  const swingH = 1.35;
  // Red A-Frame Legs & Top Bar
  for (const side of [-1, 1]) {
    const lx = swingX + (side * swingW) / 2;
    redParts.push(
      {
        shape: { kind: 'box', size: [0.06, swingH, 0.06] },
        position: [lx, swingH / 2, swingZ - 0.3],
        rotation: [-0.22, 0, 0],
      },
      {
        shape: { kind: 'box', size: [0.06, swingH, 0.06] },
        position: [lx, swingH / 2, swingZ + 0.3],
        rotation: [0.22, 0, 0],
      }
    );
  }
  // Top horizontal crossbar
  redParts.push({
    shape: { kind: 'box', size: [swingW + 0.25, 0.06, 0.06] },
    position: [swingX, swingH - 0.03, swingZ],
  });
  // 2 Swings (Ropes & Seats)
  for (const sx of [swingX - 0.35, swingX + 0.35]) {
    woodParts.push(
      // Left rope
      { shape: { kind: 'box', size: [0.015, 0.9, 0.015] }, position: [sx - 0.12, 0.72, swingZ] },
      // Right rope
      { shape: { kind: 'box', size: [0.015, 0.9, 0.015] }, position: [sx + 0.12, 0.72, swingZ] },
      // Swing seat
      { shape: { kind: 'box', size: [0.28, 0.03, 0.12] }, position: [sx, 0.28, swingZ] }
    );
  }

  // Schoolyard Wooden Benches
  const benchPositions: [number, number, number, number][] = [
    [-1.0, 0.18, CD / 2 + 1.2, 0],
    [0.9, 0.18, CD / 2 + 1.4, -0.2],
  ];
  for (const [bx, by, bz, rot] of benchPositions) {
    woodParts.push(
      // Seat plank
      {
        shape: { kind: 'box', size: [0.75, 0.04, 0.22] },
        position: [bx, by, bz],
        rotation: [0, rot, 0],
      },
      // Backrest plank
      {
        shape: { kind: 'box', size: [0.75, 0.18, 0.03] },
        position: [bx, by + 0.14, bz - 0.09],
        rotation: [0, rot, 0],
      },
      // Legs
      {
        shape: { kind: 'box', size: [0.04, 0.22, 0.18] },
        position: [bx - 0.3, by - 0.09, bz],
        rotation: [0, rot, 0],
      },
      {
        shape: { kind: 'box', size: [0.04, 0.22, 0.18] },
        position: [bx + 0.3, by - 0.09, bz],
        rotation: [0, rot, 0],
      }
    );
  }

  // Raised Vegetable / Flower Bed
  const bedX = 3.1;
  const bedZ = 2.6;
  woodParts.push(
    // Planter box wooden frame
    { shape: { kind: 'box', size: [1.1, 0.2, 0.55] }, position: [bedX, 0.1, bedZ] }
  );
  yardParts.push(
    // Soil bed
    { shape: { kind: 'box', size: [1.0, 0.04, 0.45] }, position: [bedX, 0.19, bedZ] },
    // Miniature colorful flower shoots (yellow, red, orange, green)
    {
      shape: { kind: 'sphere', radius: 0.06, segments: 6 },
      position: [bedX - 0.3, 0.24, bedZ - 0.1],
    },
    { shape: { kind: 'sphere', radius: 0.07, segments: 6 }, position: [bedX, 0.25, bedZ] },
    {
      shape: { kind: 'sphere', radius: 0.06, segments: 6 },
      position: [bedX + 0.3, 0.24, bedZ + 0.1],
    },
    {
      shape: { kind: 'sphere', radius: 0.05, segments: 6 },
      position: [bedX - 0.15, 0.23, bedZ + 0.1],
    },
    {
      shape: { kind: 'sphere', radius: 0.05, segments: 6 },
      position: [bedX + 0.15, 0.23, bedZ - 0.1],
    }
  );

  // Miniature Yellow School Bus (parked on the far right drive at x = 3.9, z = 0.6)
  const busX = 3.9;
  const busZ = 0.6;
  yellowParts.push(
    // Bus main body
    { shape: { kind: 'box', size: [0.75, 0.55, 1.4] }, position: [busX, 0.42, busZ] },
    // Engine hood front
    { shape: { kind: 'box', size: [0.7, 0.32, 0.4] }, position: [busX, 0.28, busZ + 0.85] }
  );
  glassParts.push(
    // Windshield
    { shape: { kind: 'box', size: [0.68, 0.25, 0.04] }, position: [busX, 0.55, busZ + 0.71] },
    // Side windows strip
    { shape: { kind: 'box', size: [0.77, 0.2, 1.1] }, position: [busX, 0.55, busZ] }
  );
  redParts.push(
    // Flashing red stop sign
    { shape: { kind: 'box', size: [0.04, 0.14, 0.14] }, position: [busX - 0.4, 0.48, busZ + 0.2] }
  );
  yardParts.push(
    // 4 Wheels
    {
      shape: { kind: 'cylinder', radiusTop: 0.12, radiusBottom: 0.12, height: 0.08, segments: 8 },
      position: [busX - 0.38, 0.12, busZ - 0.4],
      rotation: [0, 0, Math.PI / 2],
    },
    {
      shape: { kind: 'cylinder', radiusTop: 0.12, radiusBottom: 0.12, height: 0.08, segments: 8 },
      position: [busX + 0.38, 0.12, busZ - 0.4],
      rotation: [0, 0, Math.PI / 2],
    },
    {
      shape: { kind: 'cylinder', radiusTop: 0.12, radiusBottom: 0.12, height: 0.08, segments: 8 },
      position: [busX - 0.38, 0.12, busZ + 0.45],
      rotation: [0, 0, Math.PI / 2],
    },
    {
      shape: { kind: 'cylinder', radiusTop: 0.12, radiusBottom: 0.12, height: 0.08, segments: 8 },
      position: [busX + 0.38, 0.12, busZ + 0.45],
      rotation: [0, 0, Math.PI / 2],
    }
  );

  return {
    yellowWalls: mergeParts(yellowParts),
    blueWalls: mergeParts(blueParts),
    redTrim: mergeParts(redParts),
    woodTrim: mergeParts(woodParts),
    roofs: mergeParts(roofParts),
    glass: mergeParts(glassParts),
    playground: mergeParts(yardParts),
    brassBell: mergeParts(bellParts),
  };
}
