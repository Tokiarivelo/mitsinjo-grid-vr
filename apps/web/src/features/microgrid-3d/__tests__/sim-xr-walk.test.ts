import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bodyBlocked,
  buildWalkGrid,
  createWalkGrid,
  isCellBlocked,
  rasterizeTriangle,
  resolveWalk,
} from '../utils/walk-grid';
import {
  clampToInterior,
  doorSpot,
  INTERIOR_ORIGIN,
  INTERIOR_SIZE,
  interiorItems,
  interiorSpawn,
  lampLevel,
  simLegendKeys,
  turnRigAboutHead,
} from '../utils/sim-xr-place';
import { SECTOR_POSITIONS } from '../utils/site-positions';
import { primeXrInputs } from '../utils/xr-hands';
import { SECTOR_IDS } from '@mitsinjo/engine';

const flat = () => 0;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A wall 4 m long along x at z = 0, from the ground to 2.5 m. */
function wallGrid() {
  const g = createWalkGrid(10, 0.25);
  rasterizeTriangle(g, v(-2, 0, 0), v(2, 0, 0), v(2, 2.5, 0), flat);
  rasterizeTriangle(g, v(-2, 0, 0), v(2, 2.5, 0), v(-2, 2.5, 0), flat);
  return g;
}

describe('walk grid (VSIM-T2: no walking through 3D objects)', () => {
  it('marks a wall footprint, not the floor nor a roof above the head', () => {
    const g = wallGrid();
    expect(isCellBlocked(g, 0, 0.05)).toBe(true);
    expect(isCellBlocked(g, 0, 1)).toBe(false);
    // Floor (y = 0.1) and a roof (y = 3) are walked under / over.
    rasterizeTriangle(g, v(-3, 0.1, 3), v(3, 0.1, 3), v(0, 0.1, 6), flat);
    rasterizeTriangle(g, v(-3, 3, -3), v(3, 3, -3), v(0, 3, -6), flat);
    expect(isCellBlocked(g, 0, 4)).toBe(false);
    expect(isCellBlocked(g, 0, -4)).toBe(false);
  });

  it('stops at the wall and slides along it', () => {
    const g = wallGrid();
    // Straight into the wall: no move.
    expect(resolveWalk(g, 0, 1, 0, 0.1)).toEqual([0, 1]);
    // Diagonal into the wall: keeps the x part (slides).
    const [x, z] = resolveWalk(g, 0, 1, 0.3, 0.1);
    expect(x).toBeCloseTo(0.3);
    expect(z).toBeCloseTo(1);
    // Free space: full step.
    expect(resolveWalk(g, 0, 2, 0, 1.5)).toEqual([0, 1.5]);
  });

  it('never traps a walker that starts inside a wall', () => {
    const g = wallGrid();
    expect(bodyBlocked(g, 0, 0)).toBe(true);
    expect(resolveWalk(g, 0, 0, 0, 0.6)).toEqual([0, 0.6]);
  });

  it('builds from scene meshes (instances too) and skips terrain, labels and the rig', () => {
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    box.position.set(5, 1, 0);
    const terrain = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    terrain.name = 'terrain';
    terrain.position.set(-5, 1, 0);
    const trees = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.2, 0.2, 3, 8),
      new THREE.MeshBasicMaterial(),
      2
    );
    trees.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.5, 5));
    trees.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 1.5, -5));
    const rig = new THREE.Group();
    const rigBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    rigBox.position.set(0, 1, 0);
    rig.add(rigBox);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending })
    );
    glow.position.set(-3, 1, -3);
    const bushes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial(),
      1
    );
    bushes.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 0.5, 3));
    scene.add(box, terrain, trees, rig, glow, bushes);
    const g = buildWalkGrid(scene, flat, 10, 0.25, new Set([rig]));
    expect(isCellBlocked(g, 4.05, 0)).toBe(true);
    expect(isCellBlocked(g, -4.05, 0)).toBe(false);
    expect(bodyBlocked(g, 0, 5)).toBe(true);
    expect(bodyBlocked(g, 0, -5)).toBe(true);
    expect(bodyBlocked(g, 0, 0)).toBe(false);
    expect(bodyBlocked(g, -3, -3)).toBe(false);
    // A 1 m bush is walked through (regression: bushes walled off the VR spawn).
    expect(bodyBlocked(g, 3, 3)).toBe(false);
  });
});

describe('VR places: door, room, snap turn (VSIM-T1/T3/T4)', () => {
  it('the door spot is outside the building, facing it, and moves out of blocked cells', () => {
    for (const id of SECTOR_IDS) {
      const spot = doorSpot(id);
      const [bx, , bz] = SECTOR_POSITIONS[id];
      const d = Math.hypot(spot.position[0] - bx, spot.position[2] - bz);
      expect(d).toBeGreaterThan(1.5);
      const fx = -Math.sin(spot.yaw);
      const fz = -Math.cos(spot.yaw);
      expect(fx * (bx - spot.position[0]) + fz * (bz - spot.position[2])).toBeCloseTo(d, 5);
    }
    const free = doorSpot('market');
    const pushed = doorSpot('market', (x, z) => Math.hypot(x - 7, z - 10) < 5);
    expect(Math.hypot(pushed.position[0] - 7, pushed.position[2] - 10)).toBeGreaterThanOrEqual(5);
    expect(pushed.position).not.toEqual(free.position);
  });

  it('turning the rig about the head keeps the head in place (+ = left)', () => {
    const rig = new THREE.Group();
    rig.position.set(2.5, 1.6, -1.4);
    rig.rotation.y = 0.3;
    const head = new THREE.Object3D();
    head.position.set(0.5, 0, -0.6);
    rig.add(head);
    rig.updateMatrixWorld(true);
    const before = head.getWorldPosition(new THREE.Vector3());
    const t = turnRigAboutHead(
      rig.position.x,
      rig.position.z,
      rig.rotation.y,
      before.x,
      before.z,
      Math.PI / 6
    );
    rig.position.x = t.x;
    rig.position.z = t.z;
    rig.rotation.y = t.yaw;
    rig.updateMatrixWorld(true);
    const after = head.getWorldPosition(new THREE.Vector3());
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    expect(t.yaw).toBeCloseTo(0.3 + Math.PI / 6);
  });

  it('the room keeps you inside, has things to see, and lamps follow the engine coverage', () => {
    const [ox, , oz] = INTERIOR_ORIGIN;
    const [x, z] = clampToInterior(ox + 50, oz - 50);
    expect(x).toBeLessThan(ox + INTERIOR_SIZE.width / 2);
    expect(z).toBeGreaterThan(oz - INTERIOR_SIZE.depth / 2);
    const spawn = interiorSpawn().position;
    expect(clampToInterior(spawn[0], spawn[2])).toEqual([spawn[0], spawn[2]]);
    for (const id of SECTOR_IDS) {
      const items = interiorItems(id);
      expect(items.length).toBeGreaterThan(1);
      expect(items.some((i) => i.powered)).toBe(true);
    }
    expect(lampLevel(100, 2)).toBe(1);
    expect(lampLevel(50, 1)).toBe(0.5);
    expect(lampLevel(80, 0)).toBe(0);
    expect(lampLevel(null, 1)).toBeGreaterThan(0);
  });

  it('legends: A/X show labels, B/Y go back on /simulation', () => {
    expect(simLegendKeys('controller', 'right')).toContain('legendA');
    expect(simLegendKeys('controller', 'left')).toContain('legendStickWalk');
    expect(simLegendKeys('hand', 'left')).toEqual(simLegendKeys('hand', 'right'));
  });
});

describe('primeXrInputs (regression: hidden controllers in /simulation VR)', () => {
  it('creates both controllers, grips and hands before the session', () => {
    const calls: string[] = [];
    const gl = {
      xr: {
        getController: (i: number) => calls.push(`ray${i}`),
        getControllerGrip: (i: number) => calls.push(`grip${i}`),
        getHand: (i: number) => calls.push(`hand${i}`),
      },
    } as unknown as THREE.WebGLRenderer;
    primeXrInputs(gl);
    expect(calls.sort()).toEqual(['grip0', 'grip1', 'hand0', 'hand1', 'ray0', 'ray1']);
    expect(() => primeXrInputs({} as THREE.WebGLRenderer)).not.toThrow();
  });
});
