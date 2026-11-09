import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Creates an architectural gable / saltbox roof for modern eco-village pavilions.
 * Ridge runs along X. Supports asymmetric ridge offsets (longer sun-facing slope for BIPV solar panels).
 * Includes roof slopes, triangular gable ends, and perimeter fascia overhang boards.
 * Base rests at y = 0, ridge peaks at y = height.
 */
export function createGableRoofGeometry(
  width: number,
  depth: number,
  height: number,
  overhang = 0.3,
  ridgeZOffset = 0
): THREE.BufferGeometry {
  const xMin = -width / 2 - overhang;
  const xMax = width / 2 + overhang;
  const zFront = depth / 2 + overhang;
  const zBack = -depth / 2 - overhang;
  const zRidge = (zFront + zBack) / 2 + ridgeZOffset;
  const yPeak = height;
  const fasciaDrop = 0.04;
  const yEave = fasciaDrop;
  const yBottom = 0;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uRange: [number, number],
    vRange: [number, number]
  ) {
    const start = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(
      uRange[0],
      vRange[0],
      uRange[1],
      vRange[0],
      uRange[1],
      vRange[1],
      uRange[0],
      vRange[1]
    );
    indices.push(start, start + 1, start + 2);
    indices.push(start, start + 2, start + 3);
  }

  function addTri(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number]
  ) {
    const start = positions.length / 3;
    positions.push(...p0, ...p1, ...p2);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(start, start + 1, start + 2);
  }

  // 1. Front Roof Slope (facing positive Z towards the walkway/sun)
  addQuad(
    [xMin, yEave, zFront],
    [xMax, yEave, zFront],
    [xMax, yPeak, zRidge],
    [xMin, yPeak, zRidge],
    [0, 1],
    [0, 1]
  );

  // 2. Back Roof Slope (facing negative Z)
  addQuad(
    [xMin, yPeak, zRidge],
    [xMax, yPeak, zRidge],
    [xMax, yEave, zBack],
    [xMin, yEave, zBack],
    [0, 1],
    [1, 0]
  );

  // 3. Left Gable End Triangle (facing -X, counter-clockwise viewed from -X)
  addTri([xMin, yEave, zFront], [xMin, yPeak, zRidge], [xMin, yEave, zBack]);

  // 4. Right Gable End Triangle (facing +X, counter-clockwise viewed from +X)
  addTri([xMax, yEave, zBack], [xMax, yPeak, zRidge], [xMax, yEave, zFront]);

  // 5. Front Eave Fascia Board
  addQuad(
    [xMin, yBottom, zFront],
    [xMax, yBottom, zFront],
    [xMax, yEave, zFront],
    [xMin, yEave, zFront],
    [0, 1],
    [0, 1]
  );

  // 6. Back Eave Fascia Board
  addQuad(
    [xMax, yBottom, zBack],
    [xMin, yBottom, zBack],
    [xMin, yEave, zBack],
    [xMax, yEave, zBack],
    [0, 1],
    [0, 1]
  );

  // 7. Underside / Soffit closure (facing -Y)
  addQuad(
    [xMin, yBottom, zBack],
    [xMax, yBottom, zBack],
    [xMax, yBottom, zFront],
    [xMin, yBottom, zFront],
    [0, 1],
    [0, 1]
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const welded = mergeVertices(geo, 0.001);
  geo.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();

  return welded;
}

/**
 * Creates a solid triangular gable wall with thickness to seal the space between
 * the rectangular wall and the sloping roof.
 * Base spans from -width/2 to +width/2 at y = 0.
 * Apex reaches (0, height) at y = height.
 * Extends in Z from -thickness/2 to +thickness/2.
 */
export function createGableWallGeometry(
  width: number,
  height: number,
  thickness = 0.08
): THREE.BufferGeometry {
  const hw = width / 2;
  const hz = thickness / 2;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number]
  ) {
    const start = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(start, start + 1, start + 2);
    indices.push(start, start + 2, start + 3);
  }

  function addTri(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number]
  ) {
    const start = positions.length / 3;
    positions.push(...p0, ...p1, ...p2);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(start, start + 1, start + 2);
  }

  // Front triangular face (+Z normal)
  addTri([-hw, 0, hz], [hw, 0, hz], [0, height, hz]);

  // Back triangular face (-Z normal)
  addTri([hw, 0, -hz], [-hw, 0, -hz], [0, height, -hz]);

  // Left sloping edge (slopes up-right, normal pointing up-left)
  addQuad([-hw, 0, -hz], [-hw, 0, hz], [0, height, hz], [0, height, -hz]);

  // Right sloping edge (slopes up-left, normal pointing up-right)
  addQuad([hw, 0, hz], [hw, 0, -hz], [0, height, -hz], [0, height, hz]);

  // Bottom edge (-Y normal)
  addQuad([-hw, 0, -hz], [0, 0, -hz], [0, 0, hz], [-hw, 0, hz]);
  addQuad([0, 0, -hz], [hw, 0, -hz], [hw, 0, hz], [0, 0, hz]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const welded = mergeVertices(geo, 0.001);
  geo.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();

  return welded;
}

/**
 * Creates a classic cottage gable roof (Image 1 reference):
 * - Ridge runs longitudinally along Z (from -depth/2 - overhang to +depth/2 + overhang).
 * - Two steep slopes tilt down to the left (-X) and to the right (+X).
 * - Full solid volume with top tile slopes, soffit undersides, front/back rake fascias,
 *   and left/right eave fascias.
 * - Sits at y = 0 at the wall plate level, ridge peaks at y = height.
 */
export function createCottageRoofGeometry(
  width: number,
  depth: number,
  height: number,
  overhang = 0.28
): THREE.BufferGeometry {
  const hw = width / 2;
  const hz = depth / 2;
  const xMin = -hw - overhang;
  const xMax = hw + overhang;
  const zFront = hz + overhang;
  const zBack = -hz - overhang;

  // Slope drops past wall plate (y = 0) so eaves overhang and conceal wall tops:
  const slope = height / hw;
  const eaveDrop = overhang * slope * 0.4;
  const yEaveBottom = -eaveDrop;
  const roofThick = 0.055;
  const yEaveTop = yEaveBottom + roofThick;
  const yRidgeBottom = height;
  const yRidgeTop = height + roofThick;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uRange: [number, number] = [0, 1],
    vRange: [number, number] = [0, 1]
  ) {
    const start = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(
      uRange[0],
      vRange[0],
      uRange[1],
      vRange[0],
      uRange[1],
      vRange[1],
      uRange[0],
      vRange[1]
    );
    indices.push(start, start + 1, start + 2);
    indices.push(start, start + 2, start + 3);
  }

  // 1. Left Roof Slope (Top face, normal pointing up-left)
  addQuad(
    [xMin, yEaveTop, zFront],
    [0, yRidgeTop, zFront],
    [0, yRidgeTop, zBack],
    [xMin, yEaveTop, zBack],
    [0, 1],
    [0, 1]
  );

  // 2. Right Roof Slope (Top face, normal pointing up-right)
  addQuad(
    [0, yRidgeTop, zFront],
    [xMax, yEaveTop, zFront],
    [xMax, yEaveTop, zBack],
    [0, yRidgeTop, zBack],
    [0, 1],
    [0, 1]
  );

  // 3. Left Soffit / Underside (facing -Y)
  addQuad(
    [xMin, yEaveBottom, zFront],
    [xMin, yEaveBottom, zBack],
    [0, yRidgeBottom, zBack],
    [0, yRidgeBottom, zFront],
    [0, 1],
    [0, 1]
  );

  // 4. Right Soffit / Underside (facing -Y)
  addQuad(
    [0, yRidgeBottom, zFront],
    [0, yRidgeBottom, zBack],
    [xMax, yEaveBottom, zBack],
    [xMax, yEaveBottom, zFront],
    [0, 1],
    [0, 1]
  );

  // 5. Left Eave Fascia Board (at xMin, facing -X)
  addQuad(
    [xMin, yEaveBottom, zFront],
    [xMin, yEaveBottom, zBack],
    [xMin, yEaveTop, zBack],
    [xMin, yEaveTop, zFront],
    [0, 1],
    [0, 1]
  );

  // 6. Right Eave Fascia Board (at xMax, facing +X)
  addQuad(
    [xMax, yEaveBottom, zBack],
    [xMax, yEaveBottom, zFront],
    [xMax, yEaveTop, zFront],
    [xMax, yEaveTop, zBack],
    [0, 1],
    [0, 1]
  );

  // 7. Front Rake Fascia Board (at zFront, facing +Z)
  // Left rake strip
  addQuad(
    [xMin, yEaveBottom, zFront],
    [0, yRidgeBottom, zFront],
    [0, yRidgeTop, zFront],
    [xMin, yEaveTop, zFront],
    [0, 1],
    [0, 1]
  );
  // Right rake strip
  addQuad(
    [0, yRidgeBottom, zFront],
    [xMax, yEaveBottom, zFront],
    [xMax, yEaveTop, zFront],
    [0, yRidgeTop, zFront],
    [0, 1],
    [0, 1]
  );

  // 8. Back Rake Fascia Board (at zBack, facing -Z)
  // Left rake strip
  addQuad(
    [0, yRidgeBottom, zBack],
    [xMin, yEaveBottom, zBack],
    [xMin, yEaveTop, zBack],
    [0, yRidgeTop, zBack],
    [0, 1],
    [0, 1]
  );
  // Right rake strip
  addQuad(
    [xMax, yEaveBottom, zBack],
    [0, yRidgeBottom, zBack],
    [0, yRidgeTop, zBack],
    [xMax, yEaveTop, zBack],
    [0, 1],
    [0, 1]
  );

  // 9. Ridge Cap Board (subtle protective cap along ridge)
  const capW = 0.06;
  const capH = 0.02;
  addQuad(
    [-capW, yRidgeTop + capH, zFront],
    [capW, yRidgeTop + capH, zFront],
    [capW, yRidgeTop + capH, zBack],
    [-capW, yRidgeTop + capH, zBack],
    [0, 1],
    [0, 1]
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const welded = mergeVertices(geo, 0.001);
  geo.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();

  return welded;
}
