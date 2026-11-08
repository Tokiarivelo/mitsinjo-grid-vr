import * as THREE from 'three';
import { mergeParts, type Part } from './merge-parts';

/**
 * Procedural geometry for the Health Clinic (contemporary medical center).
 * Modeled after the 3-floor high-tech glass, composite panel and timber slat hospital pavilion.
 *
 * Each geometry group merges all static parts into a single BufferGeometry,
 * keeping draw calls minimal (1 call per material layer).
 */
export interface ClinicGeometries {
  /** Off-white / silver composite slabs, columns, parapets, and walls */
  whiteFascia: THREE.BufferGeometry;
  /** Warm horizontal cedar / teak timber slat accent siding */
  woodSlat: THREE.BufferGeometry;
  /** Curtain glass windows (semi-transparent & glowing when powered) */
  curtainGlass: THREE.BufferGeometry;
  /** Charcoal aluminium mullions, window transoms, door frames, handrails */
  charcoalTrim: THREE.BufferGeometry;
  /** Flat roof deck, BIPV solar array, HVAC chiller units */
  roofTop: THREE.BufferGeometry;
  /** Forecourt landscaping (manicured boxwood hedges, planter beds, topiary) */
  landscape: THREE.BufferGeometry;
  /** Red illuminated medical crosses on facade and entrance totem */
  redCross: THREE.BufferGeometry;
}

export function createClinicGeometry(): ClinicGeometries {
  const whiteParts: Part[] = [];
  const woodParts: Part[] = [];
  const glassParts: Part[] = [];
  const trimParts: Part[] = [];
  const roofParts: Part[] = [];
  const landscapeParts: Part[] = [];
  const crossParts: Part[] = [];

  // =========================================================================
  // 1. WHITE COMPOSITE FASCIAS, SLABS, PARAPETS & CORE WALLS
  // =========================================================================

  // Ground plinths & foundations
  whiteParts.push(
    // Right wing foundation
    { shape: { kind: 'box', size: [3.1, 0.12, 3.1] }, position: [1.2, 0.06, 0.0] },
    // Left wing foundation
    { shape: { kind: 'box', size: [2.5, 0.12, 2.7] }, position: [-1.5, 0.06, -0.2] },
    // Entrance porch landing
    { shape: { kind: 'box', size: [2.3, 0.08, 1.2] }, position: [-1.5, 0.04, 1.65] }
  );

  // Right wing horizontal floor slabs & cantilevered fascia bands
  whiteParts.push(
    // Band 1 (L0-L1 slab)
    { shape: { kind: 'box', size: [3.16, 0.14, 3.16] }, position: [1.2, 1.22, 0.0] },
    // Band 2 (L1-L2 slab)
    { shape: { kind: 'box', size: [3.16, 0.14, 3.16] }, position: [1.2, 2.42, 0.0] },
    // Band 3 (Cantilevered roof cornice / fascia)
    { shape: { kind: 'box', size: [3.34, 0.2, 3.34] }, position: [1.2, 3.65, 0.0] },
    // Parapet lips on right wing roof
    { shape: { kind: 'box', size: [3.34, 0.14, 0.1] }, position: [1.2, 3.8, 1.62] },
    { shape: { kind: 'box', size: [3.34, 0.14, 0.1] }, position: [1.2, 3.8, -1.62] },
    { shape: { kind: 'box', size: [0.1, 0.14, 3.34] }, position: [2.82, 3.8, 0.0] },
    // Right wing rear wall
    { shape: { kind: 'box', size: [3.1, 3.6, 0.12] }, position: [1.2, 1.8, -1.5] },
    // Internal party / shear wall
    { shape: { kind: 'box', size: [0.12, 3.6, 2.8] }, position: [-0.32, 1.8, 0.0] }
  );

  // Left wing volumes, rear walls & west facade
  whiteParts.push(
    // Rear wall
    { shape: { kind: 'box', size: [2.5, 3.6, 0.14] }, position: [-1.5, 1.8, -1.5] },
    // Far-left west facade (composite panels)
    { shape: { kind: 'box', size: [0.14, 3.6, 2.7] }, position: [-2.7, 1.8, -0.2] },
    // Left wing roof cornice
    { shape: { kind: 'box', size: [2.65, 0.2, 2.85] }, position: [-1.5, 3.65, -0.2] },
    // Parapet lips on left wing roof
    { shape: { kind: 'box', size: [2.65, 0.14, 0.1] }, position: [-1.5, 3.8, 1.18] },
    { shape: { kind: 'box', size: [0.1, 0.14, 2.85] }, position: [-2.78, 3.8, -0.2] },
    // Left wing interior floors
    { shape: { kind: 'box', size: [2.4, 0.12, 2.6] }, position: [-1.5, 1.22, -0.2] },
    { shape: { kind: 'box', size: [2.4, 0.12, 2.6] }, position: [-1.5, 2.42, -0.2] }
  );

  // Entrance Portico / Canopy
  whiteParts.push(
    // Projecting canopy roof slab
    { shape: { kind: 'box', size: [2.35, 0.14, 1.25] }, position: [-1.5, 1.22, 1.68] },
    // Canopy underside recessed ceiling
    { shape: { kind: 'box', size: [2.22, 0.04, 1.15] }, position: [-1.5, 1.13, 1.68] },
    // Left architectural square column
    { shape: { kind: 'box', size: [0.16, 1.14, 0.16] }, position: [-2.45, 0.59, 2.15] },
    // Right architectural square column
    { shape: { kind: 'box', size: [0.16, 1.14, 0.16] }, position: [-0.55, 0.59, 2.15] },
    // Entrance door frame lintel
    { shape: { kind: 'box', size: [1.4, 0.1, 0.12] }, position: [-1.5, 1.08, 1.1] },
    // Balcony curbs around 1st floor terrace
    { shape: { kind: 'box', size: [2.35, 0.06, 0.08] }, position: [-1.5, 1.32, 2.26] },
    { shape: { kind: 'box', size: [0.08, 0.06, 1.2] }, position: [-2.64, 1.32, 1.68] },
    { shape: { kind: 'box', size: [0.08, 0.06, 1.2] }, position: [-0.36, 1.32, 1.68] }
  );

  // Modern entrance totem sign
  whiteParts.push(
    { shape: { kind: 'box', size: [0.44, 0.1, 0.2] }, position: [-2.6, 0.05, 2.9] },
    { shape: { kind: 'box', size: [0.36, 1.15, 0.12] }, position: [-2.6, 0.68, 2.9] },
    { shape: { kind: 'box', size: [0.4, 0.06, 0.16] }, position: [-2.6, 1.28, 2.9] }
  );

  // =========================================================================
  // 2. TIMBER SLATS (WARM CEDAR ACCENT WALL & BALCONY PLANTERS)
  // =========================================================================

  // Main cedar accent panel behind the terrace on Floors 1 & 2
  woodParts.push({
    shape: { kind: 'box', size: [2.15, 2.22, 0.06] },
    position: [-1.5, 2.42, 1.07],
  });

  // 9 horizontal 3D timber slats for realistic architectural depth
  const slatY = [1.45, 1.7, 1.95, 2.2, 2.45, 2.7, 2.95, 3.2, 3.45];
  for (const y of slatY) {
    woodParts.push({
      shape: { kind: 'box', size: [2.15, 0.04, 0.03] },
      position: [-1.5, y, 1.11],
    });
  }

  // Terrace planter trough front cladding
  woodParts.push({
    shape: { kind: 'box', size: [1.8, 0.22, 0.18] },
    position: [-1.5, 1.44, 2.18],
  });

  // =========================================================================
  // 3. CURTAIN WALL GLASS & WINDOW PANES
  // =========================================================================

  // Right wing front glass (3 floors)
  glassParts.push(
    { shape: { kind: 'box', size: [2.9, 1.05, 0.04] }, position: [1.2, 0.62, 1.52] },
    { shape: { kind: 'box', size: [2.9, 1.05, 0.04] }, position: [1.2, 1.82, 1.52] },
    { shape: { kind: 'box', size: [2.9, 1.05, 0.04] }, position: [1.2, 3.02, 1.52] }
  );

  // Right wing wrap-around side glass (East facade, 3 floors)
  glassParts.push(
    { shape: { kind: 'box', size: [0.04, 1.05, 2.9] }, position: [2.7, 0.62, 0.0] },
    { shape: { kind: 'box', size: [0.04, 1.05, 2.9] }, position: [2.7, 1.82, 0.0] },
    { shape: { kind: 'box', size: [0.04, 1.05, 2.9] }, position: [2.7, 3.02, 0.0] }
  );

  // Left wing entrance doors & ribbon windows
  glassParts.push(
    // Entrance sliding glass doors
    { shape: { kind: 'box', size: [1.2, 0.95, 0.04] }, position: [-1.5, 0.55, 1.09] },
    // Ribbon windows on the timber facade
    { shape: { kind: 'box', size: [0.85, 0.65, 0.04] }, position: [-2.0, 1.85, 1.12] },
    { shape: { kind: 'box', size: [0.85, 0.65, 0.04] }, position: [-2.0, 3.05, 1.12] },
    // Ribbon windows on west facade
    { shape: { kind: 'box', size: [0.04, 0.55, 1.8] }, position: [-2.71, 0.62, -0.2] },
    { shape: { kind: 'box', size: [0.04, 0.55, 1.8] }, position: [-2.71, 1.82, -0.2] },
    { shape: { kind: 'box', size: [0.04, 0.55, 1.8] }, position: [-2.71, 3.02, -0.2] },
    // Terrace tempered glass balustrades
    { shape: { kind: 'box', size: [2.2, 0.38, 0.02] }, position: [-1.5, 1.51, 2.26] },
    { shape: { kind: 'box', size: [0.02, 0.38, 1.12] }, position: [-0.37, 1.51, 1.7] }
  );

  // =========================================================================
  // 4. CHARCOAL ALUMINIUM MULLIONS, TRANSOMS & FRAMES
  // =========================================================================

  // Vertical curtain wall mullions on front facade
  const frontMullionX = [-0.15, 0.52, 1.2, 1.88, 2.55];
  for (const x of frontMullionX) {
    trimParts.push(
      { shape: { kind: 'box', size: [0.04, 1.05, 0.06] }, position: [x, 0.62, 1.53] },
      { shape: { kind: 'box', size: [0.04, 1.05, 0.06] }, position: [x, 1.82, 1.53] },
      { shape: { kind: 'box', size: [0.04, 1.05, 0.06] }, position: [x, 3.02, 1.53] }
    );
  }

  // Vertical curtain wall mullions on east side facade
  const sideMullionZ = [-1.35, -0.68, 0.0, 0.68, 1.35];
  for (const z of sideMullionZ) {
    trimParts.push(
      { shape: { kind: 'box', size: [0.06, 1.05, 0.04] }, position: [2.71, 0.62, z] },
      { shape: { kind: 'box', size: [0.06, 1.05, 0.04] }, position: [2.71, 1.82, z] },
      { shape: { kind: 'box', size: [0.06, 1.05, 0.04] }, position: [2.71, 3.02, z] }
    );
  }

  // Horizontal transoms on front and east facades
  trimParts.push(
    // Front transoms
    { shape: { kind: 'box', size: [2.9, 0.03, 0.05] }, position: [1.2, 0.85, 1.53] },
    { shape: { kind: 'box', size: [2.9, 0.03, 0.05] }, position: [1.2, 2.05, 1.53] },
    { shape: { kind: 'box', size: [2.9, 0.03, 0.05] }, position: [1.2, 3.25, 1.53] },
    // Side transoms
    { shape: { kind: 'box', size: [0.05, 0.03, 2.9] }, position: [2.71, 0.85, 0.0] },
    { shape: { kind: 'box', size: [0.05, 0.03, 2.9] }, position: [2.71, 2.05, 0.0] },
    { shape: { kind: 'box', size: [0.05, 0.03, 2.9] }, position: [2.71, 3.25, 0.0] },
    // Entrance door frame and center divider
    { shape: { kind: 'box', size: [1.24, 0.98, 0.05] }, position: [-1.5, 0.55, 1.08] },
    { shape: { kind: 'box', size: [0.04, 0.98, 0.06] }, position: [-1.5, 0.55, 1.1] },
    // Terrace handrails and posts
    { shape: { kind: 'box', size: [2.28, 0.04, 0.04] }, position: [-1.5, 1.71, 2.26] },
    { shape: { kind: 'box', size: [0.04, 0.04, 1.16] }, position: [-0.37, 1.71, 1.7] },
    { shape: { kind: 'box', size: [0.03, 0.38, 0.03] }, position: [-2.62, 1.51, 2.26] },
    { shape: { kind: 'box', size: [0.03, 0.38, 0.03] }, position: [-1.5, 1.51, 2.26] },
    { shape: { kind: 'box', size: [0.03, 0.38, 0.03] }, position: [-0.37, 1.51, 2.26] },
    { shape: { kind: 'box', size: [0.03, 0.38, 0.03] }, position: [-0.37, 1.51, 1.12] },
    // Wood facade ribbon window frames
    { shape: { kind: 'box', size: [0.89, 0.69, 0.05] }, position: [-2.0, 1.85, 1.11] },
    { shape: { kind: 'box', size: [0.89, 0.69, 0.05] }, position: [-2.0, 3.05, 1.11] }
  );

  // =========================================================================
  // 5. ROOFTOP GRAVEL DECK, SOLAR ARRAYS & HVAC
  // =========================================================================

  roofParts.push(
    // Gravel roof surfaces
    { shape: { kind: 'box', size: [3.1, 0.04, 3.1] }, position: [1.2, 3.7, 0.0] },
    { shape: { kind: 'box', size: [2.45, 0.04, 2.65] }, position: [-1.5, 3.7, -0.2] },
    // HVAC chiller unit and louvers
    { shape: { kind: 'box', size: [0.9, 0.45, 0.7] }, position: [-1.4, 3.95, -0.5] },
    { shape: { kind: 'box', size: [0.92, 0.35, 0.04] }, position: [-1.4, 3.95, -0.15] }
  );

  // Rooftop solar PV modules (2 rows of 3 modules angled ~15°)
  const pvCols = [0.6, 1.3, 2.0];
  const pvRows = [-0.6, 0.6];
  for (const x of pvCols) {
    for (const z of pvRows) {
      roofParts.push({
        shape: { kind: 'box', size: [0.62, 0.04, 0.88] },
        position: [x, 3.82, z],
        rotation: [-0.22, 0, 0],
      });
    }
  }

  // =========================================================================
  // 6. FORECOURT LANDSCAPING (MANICURED HEDGES, PLANTERS & TOPIARY)
  // =========================================================================

  // Large front-right manicured boxwood hedge parterre
  landscapeParts.push(
    // Front hedge
    { shape: { kind: 'box', size: [1.9, 0.24, 0.24] }, position: [1.4, 0.12, 2.65] },
    // Back hedge
    { shape: { kind: 'box', size: [1.9, 0.24, 0.24] }, position: [1.4, 0.12, 1.85] },
    // Right hedge
    { shape: { kind: 'box', size: [0.24, 0.24, 0.8] }, position: [2.33, 0.12, 2.25] },
    // Left hedge
    { shape: { kind: 'box', size: [0.24, 0.24, 0.8] }, position: [0.47, 0.12, 2.25] },
    // Planter soil bed
    { shape: { kind: 'box', size: [1.7, 0.04, 0.7] }, position: [1.4, 0.02, 2.25] },
    // Ornamental slender trunk & lush crown
    {
      shape: { kind: 'cylinder', radiusTop: 0.03, radiusBottom: 0.04, height: 0.65, segments: 8 },
      position: [1.4, 0.35, 2.25],
    },
    { shape: { kind: 'sphere', radius: 0.34, segments: 10 }, position: [1.4, 0.85, 2.25] },
    // Purple & burgundy ornamental shrubs
    { shape: { kind: 'sphere', radius: 0.16, segments: 8 }, position: [0.95, 0.18, 2.25] },
    { shape: { kind: 'sphere', radius: 0.14, segments: 8 }, position: [1.85, 0.16, 2.25] },
    // Entrance walkway pathway & side hedge
    { shape: { kind: 'box', size: [1.5, 0.02, 1.4] }, position: [-1.5, 0.02, 2.45] },
    { shape: { kind: 'box', size: [0.22, 0.22, 1.2] }, position: [-0.25, 0.11, 2.25] },
    // Terrace planter box topiary balls
    { shape: { kind: 'sphere', radius: 0.11, segments: 8 }, position: [-1.9, 1.55, 2.18] },
    { shape: { kind: 'sphere', radius: 0.11, segments: 8 }, position: [-1.5, 1.55, 2.18] },
    { shape: { kind: 'sphere', radius: 0.11, segments: 8 }, position: [-1.1, 1.55, 2.18] }
  );

  // =========================================================================
  // 7. RED ILLUMINATED MEDICAL CROSSES
  // =========================================================================

  // Facade cross mounted on canopy fascia band
  crossParts.push(
    { shape: { kind: 'box', size: [0.44, 0.13, 0.04] }, position: [-1.5, 1.34, 1.76] },
    { shape: { kind: 'box', size: [0.13, 0.44, 0.04] }, position: [-1.5, 1.34, 1.76] }
  );

  // Totem sign cross
  crossParts.push(
    { shape: { kind: 'box', size: [0.22, 0.06, 0.03] }, position: [-2.6, 0.88, 2.97] },
    { shape: { kind: 'box', size: [0.06, 0.22, 0.03] }, position: [-2.6, 0.88, 2.97] }
  );

  return {
    whiteFascia: mergeParts(whiteParts),
    woodSlat: mergeParts(woodParts),
    curtainGlass: mergeParts(glassParts),
    charcoalTrim: mergeParts(trimParts),
    roofTop: mergeParts(roofParts),
    landscape: mergeParts(landscapeParts),
    redCross: mergeParts(crossParts),
  };
}
