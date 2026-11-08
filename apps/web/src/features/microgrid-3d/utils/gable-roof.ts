import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Creates an architectural gable / saltbox roof for modern eco-village pavilions.
 * Supports asymmetric ridge offsets (longer sun-facing slope for BIPV solar panels).
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

  // 3. Left Gable End Triangle (facing -X)
  addTri([xMin, yEave, zBack], [xMin, yPeak, zRidge], [xMin, yEave, zFront]);

  // 4. Right Gable End Triangle (facing +X)
  addTri([xMax, yEave, zFront], [xMax, yPeak, zRidge], [xMax, yEave, zBack]);

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
