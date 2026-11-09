import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface WindTurbineGeometries {
  tower: THREE.BufferGeometry;
  nacelle: THREE.BufferGeometry;
  rotor: THREE.BufferGeometry;
}

/**
 * Procedural geometry generator for modern utility wind turbines.
 * As seen in sustainable eco-villages on surrounding hilltops.
 *
 * @param height - Tower height in meters (default ~14m)
 * @param bladeRadius - Rotor blade radius in meters (default ~5m)
 */
export function createWindTurbineGeometry(height = 14, bladeRadius = 5): WindTurbineGeometries {
  // 1. Tower: tapered steel mast with foundation flange
  const mast = new THREE.CylinderGeometry(0.14, 0.26, height, 20);
  mast.translate(0, height / 2, 0);

  const foundation = new THREE.CylinderGeometry(0.38, 0.44, 0.25, 20);
  foundation.translate(0, 0.125, 0);

  const topFlange = new THREE.CylinderGeometry(0.18, 0.16, 0.15, 16);
  topFlange.translate(0, height - 0.075, 0);

  const tower = mergeGeometries([mast, foundation, topFlange]);

  // 2. Nacelle: streamlined generator pod mounted at tower top
  const nacelleBody = new THREE.CylinderGeometry(0.24, 0.2, 0.95, 16);
  nacelleBody.rotateX(Math.PI / 2);
  nacelleBody.translate(0, 0, -0.15);

  const nacelleTail = new THREE.ConeGeometry(0.2, 0.45, 16);
  nacelleTail.rotateX(-Math.PI / 2);
  nacelleTail.translate(0, 0, -0.8);

  const nacelle = mergeGeometries([nacelleBody, nacelleTail]);

  // 3. Rotor: aerodynamic spinner nosecone + 3 swept blades
  const hubSpinner = new THREE.ConeGeometry(0.2, 0.45, 16);
  hubSpinner.rotateX(Math.PI / 2);
  hubSpinner.translate(0, 0, 0.22);

  const bladeGeoms: THREE.BufferGeometry[] = [];
  const bladeSegments = 6;
  const rootWidth = 0.22;
  const tipWidth = 0.06;
  const rootThickness = 0.07;
  const tipThickness = 0.015;

  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3; // 0, 120°, 240°
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    for (let s = 0; s <= bladeSegments; s++) {
      const t = s / bladeSegments;
      const r = 0.2 + t * (bladeRadius - 0.2);
      const w = rootWidth * (1 - t) + tipWidth * t;
      const th = rootThickness * (1 - t) + tipThickness * t;
      // Slight aerodynamic twist along the blade length
      const twist = (1 - t) * 0.18;
      const cosTwist = Math.cos(twist);
      const sinTwist = Math.sin(twist);

      // Local blade cross-section points (leading edge, trailing edge, upper, lower)
      const pLeft: [number, number, number] = [-w * 0.45 * cosTwist, 0, -w * 0.45 * sinTwist];
      const pRight: [number, number, number] = [w * 0.55 * cosTwist, 0, w * 0.55 * sinTwist];
      const pTop: [number, number, number] = [0, th * 0.5, 0];
      const pBottom: [number, number, number] = [0, -th * 0.5, 0];

      positions.push(
        r + pLeft[0] * 0.1,
        pLeft[1],
        pLeft[2],
        r + pRight[0] * 0.1,
        pRight[1],
        pRight[2],
        r + pTop[0] * 0.1,
        pTop[1],
        pTop[2],
        r + pBottom[0] * 0.1,
        pBottom[1],
        pBottom[2]
      );

      uvs.push(0, t, 1, t, 0.5, t, 0.5, t);

      if (s < bladeSegments) {
        const b = s * 4;
        const nb = (s + 1) * 4;
        // Upper surface
        indices.push(b, nb, nb + 2);
        indices.push(b, nb + 2, b + 2);
        indices.push(b + 2, nb + 2, nb + 1);
        indices.push(b + 2, nb + 1, b + 1);
        // Lower surface
        indices.push(b, b + 3, nb + 3);
        indices.push(b, nb + 3, nb);
        indices.push(b + 3, b + 1, nb + 1);
        indices.push(b + 3, nb + 1, nb + 3);
      }
    }

    const singleBlade = new THREE.BufferGeometry();
    singleBlade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    singleBlade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    singleBlade.setIndex(indices);
    singleBlade.computeVertexNormals();

    // Rotate blade around Z into radial position
    singleBlade.rotateZ(angle);
    bladeGeoms.push(singleBlade);
  }

  const rotor = mergeGeometries([hubSpinner, ...bladeGeoms]);

  return { tower, nacelle, rotor };
}
