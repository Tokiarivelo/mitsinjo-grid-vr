import * as THREE from 'three';

/**
 * Walk collision for the /simulation VR village (VSIM-T2): a top-down occupancy grid of everything
 * solid between knee and head height, built once from the real scene triangles (houses, school,
 * clinic, trunks, panels, vehicles, placed models…). Walking then slides along walls instead of
 * passing through them. Pure data + one O(triangles) build; per-frame checks are a few cell reads.
 */
export interface WalkGrid {
  /** Cell size (m). */
  cell: number;
  /** Cells per side; the grid covers [-half, half]² around the origin. */
  size: number;
  half: number;
  /** 1 = blocked. */
  blocked: Uint8Array;
}

/** Solid band above the local ground: below = steps, kerbs, grass; above = eaves, canopies, wires. */
export const WALK_SLAB_LOW = 0.35;
export const WALK_SLAB_HIGH = 1.8;
/**
 * Scattered instances (bushes, grass clumps, rocks, flowers) shorter than this are walked through;
 * trees (trunks), poles and placed models still block.
 */
export const MIN_INSTANCE_HEIGHT = 1.2;
/** Body radius kept clear of walls (m). */
export const WALK_BODY_RADIUS = 0.28;

export function createWalkGrid(half: number, cell = 0.25): WalkGrid {
  const size = Math.ceil((half * 2) / cell);
  return { cell, size, half, blocked: new Uint8Array(size * size) };
}

function cellIndex(g: WalkGrid, x: number, z: number): number {
  const i = Math.floor((x + g.half) / g.cell);
  const j = Math.floor((z + g.half) / g.cell);
  if (i < 0 || j < 0 || i >= g.size || j >= g.size) return -1;
  return j * g.size + i;
}

export function markBlocked(g: WalkGrid, x: number, z: number): void {
  const k = cellIndex(g, x, z);
  if (k >= 0) g.blocked[k] = 1;
}

export function isCellBlocked(g: WalkGrid, x: number, z: number): boolean {
  const k = cellIndex(g, x, z);
  return k >= 0 && g.blocked[k] === 1;
}

/** True when a body of radius `r` centred on (x, z) touches a blocked cell. */
export function bodyBlocked(g: WalkGrid, x: number, z: number, r = WALK_BODY_RADIUS): boolean {
  if (isCellBlocked(g, x, z)) return true;
  // Ring of 8 points on the body edge: cheap and enough at cell ≤ r.
  for (let a = 0; a < 8; a++) {
    const t = (a * Math.PI) / 4;
    if (isCellBlocked(g, x + Math.cos(t) * r, z + Math.sin(t) * r)) return true;
  }
  return false;
}

/**
 * Where a step from (fx, fz) to (tx, tz) ends: the full step when clear, else along one axis
 * (slide along the wall), else no move. Standing inside a blocked cell (spawned or teleported
 * into one) never traps the walker: any step is allowed until clear again.
 */
export function resolveWalk(
  g: WalkGrid,
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  r = WALK_BODY_RADIUS
): [number, number] {
  if (bodyBlocked(g, fx, fz, r)) return [tx, tz];
  if (!bodyBlocked(g, tx, tz, r)) return [tx, tz];
  if (!bodyBlocked(g, tx, fz, r)) return [tx, fz];
  if (!bodyBlocked(g, fx, tz, r)) return [fx, tz];
  return [fx, fz];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Marks the part of a world-space triangle that lies inside the solid slab above the ground.
 * Samples the triangle at about half a cell; vertical walls project to lines, so only their
 * footprint is marked.
 */
export function rasterizeTriangle(
  g: WalkGrid,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  groundAt: (x: number, z: number) => number
): void {
  const ground = groundAt((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
  const lo = ground + WALK_SLAB_LOW;
  const hi = ground + WALK_SLAB_HIGH;
  if (Math.max(a.y, b.y, c.y) < lo || Math.min(a.y, b.y, c.y) > hi) return;
  const step = g.cell * 0.5;
  const n = Math.min(
    96,
    Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / step))
  );
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      const w = 1 - u - v;
      const y = a.y * w + b.y * u + c.y * v;
      if (y < lo || y > hi) continue;
      markBlocked(g, a.x * w + b.x * u + c.x * v, a.z * w + b.z * u + c.z * v);
    }
  }
}

/** Scene parts walked through (names in `ui/`): ground, sky, effects, labels, wires, XR visuals. */
const WALK_THROUGH =
  /^(terrain|ground|paddy|sky-backdrop|placed-yards|distribution-lines|electron-flow|feeder-tags|fire|weather-.*|immersion-labels-system|appliance-beacons|appliance-selection-ring|appliance-drag-ghost|cut-mark|xr-.*|controller-grip-visual|controller-laser-ray|hand-joints-mesh|sim-xr-.*)$/;

/** True for objects walked through: `userData.noCollide` or a walk-through name. */
export function isWalkThrough(o: THREE.Object3D): boolean {
  if (o.userData?.noCollide) return true;
  return WALK_THROUGH.test(o.name ?? '');
}

function isSolidMaterial(m: THREE.Material | THREE.Material[]): boolean {
  const one = Array.isArray(m) ? m[0] : m;
  if (!one) return false;
  if (one.blending === THREE.AdditiveBlending) return false;
  if (one.transparent && one.opacity < 0.35) return false;
  return true;
}

/**
 * Builds the grid from every solid mesh under `root` (instanced meshes once per instance).
 * Skips walk-through subtrees (`isWalkThrough`), lines, points and glow effects.
 */
export function buildWalkGrid(
  root: THREE.Object3D,
  groundAt: (x: number, z: number) => number,
  half: number,
  cell = 0.25,
  /** Top-level children to leave out (the XR rig). */
  skip?: ReadonlySet<THREE.Object3D>
): WalkGrid {
  const g = createWalkGrid(half, cell);
  root.updateMatrixWorld(true);
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || isWalkThrough(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && isSolidMaterial(mesh.material)) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (pos) {
        const index = mesh.geometry.getIndex();
        const tris = index ? index.count / 3 : pos.count / 3;
        const inst = (mesh as THREE.InstancedMesh).isInstancedMesh
          ? (mesh as THREE.InstancedMesh)
          : null;
        const copies = inst ? inst.count : 1;
        if (inst && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        for (let k = 0; k < copies; k++) {
          if (inst) {
            inst.getMatrixAt(k, instance);
            world.multiplyMatrices(mesh.matrixWorld, instance);
            _box.copy(mesh.geometry.boundingBox!).applyMatrix4(world);
            if (_box.max.y - _box.min.y < MIN_INSTANCE_HEIGHT) continue;
          } else world.copy(mesh.matrixWorld);
          for (let t = 0; t < tris; t++) {
            const i0 = index ? index.getX(t * 3) : t * 3;
            const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
            const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
            _a.fromBufferAttribute(pos, i0).applyMatrix4(world);
            _b.fromBufferAttribute(pos, i1).applyMatrix4(world);
            _c.fromBufferAttribute(pos, i2).applyMatrix4(world);
            rasterizeTriangle(g, _a, _b, _c, groundAt);
          }
        }
      }
    }
    for (const child of o.children) visit(child);
  };
  for (const child of root.children) if (!skip?.has(child)) visit(child);
  return g;
}
