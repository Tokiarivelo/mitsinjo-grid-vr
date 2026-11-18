import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The 3D lab room around the studio (VS-T50): a real workshop, after a maker-lab reference — white walls,
 * a long bench of white cabinets with a grey top, a pegboard with tools, shelves with boxes, two resin
 * printers (orange hood), two black machines, a fume-extraction arm, a steel sink. Built once and merged
 * per material, so the whole room costs a handful of draw calls on Quest. Floor at y = 0, the viewer at
 * the origin; nothing stands within `LAB_CLEAR_RADIUS` (the studio panels live there).
 */

export const LAB_ROOM = { halfWidth: 4.2, halfDepth: 4.2, height: 3 } as const;
/** No furniture closer to the viewer than this (m): the desks, carousel and village table stay free. */
export const LAB_CLEAR_RADIUS = 2.4;

export type LabMaterialKey =
  | 'wall'
  | 'floor'
  | 'cabinet'
  | 'counter'
  | 'dark'
  | 'steel'
  | 'orange'
  | 'glass'
  | 'pegboard'
  | 'lamp'
  | 'shadow';

type Parts = Record<LabMaterialKey, THREE.BufferGeometry[]>;

function box(
  parts: Parts,
  key: LabMaterialKey,
  size: [number, number, number],
  at: [number, number, number],
  rotY = 0
) {
  const g = new THREE.BoxGeometry(...size);
  if (rotY) g.rotateY(rotY);
  g.translate(...at);
  parts[key].push(g);
}

function cylinder(
  parts: Parts,
  key: LabMaterialKey,
  radius: number,
  length: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
  segments = 16
) {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments);
  const dir = to.clone().sub(from).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  parts[key].push(g);
}

/** One merged geometry per material (empty materials left out). */
export function buildLabRoom(): Partial<Record<LabMaterialKey, THREE.BufferGeometry>> {
  const parts: Parts = {
    wall: [],
    floor: [],
    cabinet: [],
    counter: [],
    dark: [],
    steel: [],
    orange: [],
    glass: [],
    pegboard: [],
    lamp: [],
    shadow: [],
  };
  const { halfWidth: hw, halfDepth: hd, height: h } = LAB_ROOM;

  // Shell: floor, ceiling, four walls (thin boxes so both faces light the same).
  box(parts, 'floor', [hw * 2, 0.02, hd * 2], [0, -0.01, 0]);
  box(parts, 'wall', [hw * 2, 0.02, hd * 2], [0, h + 0.01, 0]);
  box(parts, 'wall', [hw * 2, h, 0.05], [0, h / 2, -hd]);
  box(parts, 'wall', [hw * 2, h, 0.05], [0, h / 2, hd]);
  box(parts, 'wall', [0.05, h, hd * 2], [-hw, h / 2, 0]);
  box(parts, 'wall', [0.05, h, hd * 2], [hw, h / 2, 0]);
  // Ceiling spots.
  for (const x of [-2.4, 0, 2.4])
    for (const z of [-2.4, 0, 2.4]) {
      const g = new THREE.CylinderGeometry(0.09, 0.09, 0.01, 20);
      g.translate(x, h - 0.006, z);
      parts.lamp.push(g);
    }

  // Back wall (ahead of the viewer): the long bench, its cabinets, the printers and machines.
  const zb = -hd + 0.32;
  box(parts, 'cabinet', [5.6, 0.86, 0.6], [-0.6, 0.43, zb]);
  for (let i = 0; i < 7; i++)
    box(parts, 'dark', [0.36, 0.012, 0.01], [-3.0 + i * 0.8, 0.8, zb + 0.305]);
  box(parts, 'counter', [5.7, 0.04, 0.64], [-0.6, 0.88, zb]);
  // Resin printer: black base, orange hood (left), then a second one.
  for (const x of [-3.0, -2.2]) {
    box(parts, 'dark', [0.42, 0.22, 0.42], [x, 1.01, zb]);
    box(parts, 'orange', [0.4, 0.4, 0.4], [x, 1.32, zb]);
    box(parts, 'dark', [0.14, 0.06, 0.01], [x + 0.08, 1.02, zb + 0.215]);
  }
  // Two black post-cure machines.
  for (const x of [-1.4, -0.85]) box(parts, 'dark', [0.36, 0.48, 0.38], [x, 1.14, zb]);
  // Bench tools: a press stand and a small station.
  box(parts, 'steel', [0.08, 0.6, 0.08], [-0.1, 1.2, zb - 0.1]);
  box(parts, 'dark', [0.3, 0.1, 0.24], [0.15, 0.95, zb]);
  box(parts, 'dark', [0.4, 0.22, 0.3], [1.3, 1.01, zb]);
  // Fume-extraction arm from the wall over the printers: three white segments and a clear hood.
  const a0 = new THREE.Vector3(-1.6, 2.6, -hd + 0.05);
  const a1 = new THREE.Vector3(-1.9, 2.3, -hd + 0.55);
  const a2 = new THREE.Vector3(-2.4, 2.45, -hd + 0.85);
  const a3 = new THREE.Vector3(-2.7, 1.95, -hd + 0.75);
  cylinder(parts, 'cabinet', 0.05, a0.distanceTo(a1), a0, a1);
  cylinder(parts, 'cabinet', 0.05, a1.distanceTo(a2), a1, a2);
  cylinder(parts, 'cabinet', 0.045, a2.distanceTo(a3), a2, a3);
  for (const p of [a1, a2]) {
    const j = new THREE.SphereGeometry(0.075, 16, 12);
    j.translate(p.x, p.y, p.z);
    parts.cabinet.push(j);
  }
  const hood = new THREE.CylinderGeometry(0.06, 0.26, 0.16, 28, 1, true);
  hood.translate(a3.x, a3.y - 0.1, a3.z);
  parts.glass.push(hood);
  // Pegboard and shelves above the right part of the bench.
  box(parts, 'pegboard', [2.4, 1.1, 0.03], [1.9, 1.62, -hd + 0.04]);
  box(parts, 'cabinet', [2.6, 0.03, 0.32], [1.9, 2.3, -hd + 0.17]);
  box(parts, 'cabinet', [2.6, 0.03, 0.32], [-2.2, 2.3, -hd + 0.17]);
  for (const x of [1.1, 1.7, 2.4]) box(parts, 'cabinet', [0.42, 0.24, 0.28], [x, 2.44, -hd + 0.17]);
  for (const x of [-2.9, -2.3, -1.6])
    box(parts, 'cabinet', [0.4, 0.2, 0.26], [x, 2.42, -hd + 0.17]);
  // Tools on the pegboard: hanging plates, a black lightning bolt plate, pliers handles.
  for (const x of [1.0, 1.35, 1.7])
    box(parts, 'cabinet', [0.26, 0.34, 0.02], [x, 1.72, -hd + 0.07]);
  box(parts, 'dark', [0.05, 0.3, 0.02], [2.1, 1.72, -hd + 0.07]);
  for (const x of [2.5, 2.62, 2.9]) box(parts, 'dark', [0.025, 0.22, 0.02], [x, 1.42, -hd + 0.07]);

  // Right wall: a steel counter with a sink and a tap.
  const xr = hw - 0.35;
  box(parts, 'cabinet', [0.62, 0.86, 2.6], [xr, 0.43, -1.6]);
  box(parts, 'steel', [0.66, 0.04, 2.66], [xr, 0.88, -1.6]);
  box(parts, 'dark', [0.48, 0.02, 0.5], [xr, 0.89, -2.4]);
  cylinder(
    parts,
    'steel',
    0.018,
    0.3,
    new THREE.Vector3(xr + 0.22, 0.9, -2.4),
    new THREE.Vector3(xr + 0.22, 1.2, -2.4)
  );
  cylinder(
    parts,
    'steel',
    0.016,
    0.2,
    new THREE.Vector3(xr + 0.22, 1.2, -2.4),
    new THREE.Vector3(xr + 0.04, 1.16, -2.4)
  );
  box(parts, 'dark', [0.4, 0.26, 0.34], [xr, 1.03, -1.2]);

  // Behind the viewer: a door, a whiteboard, low cabinets and a small robot arm on a stand (360° room).
  const zf = hd - 0.04;
  box(parts, 'dark', [1.0, 2.15, 0.05], [2.6, 1.075, zf]);
  box(parts, 'steel', [0.04, 0.04, 0.08], [2.25, 1.05, zf - 0.05]);
  box(parts, 'counter', [2.2, 1.2, 0.03], [-0.4, 1.55, zf]);
  box(parts, 'pegboard', [2.1, 1.1, 0.01], [-0.4, 1.55, zf - 0.02]);
  box(parts, 'cabinet', [3.2, 0.9, 0.5], [-0.4, 0.45, hd - 0.27]);
  box(parts, 'counter', [3.24, 0.04, 0.54], [-0.4, 0.92, hd - 0.27]);
  box(parts, 'dark', [0.3, 0.06, 0.3], [-1.4, 0.97, hd - 0.3]);
  const r0 = new THREE.Vector3(-1.4, 1.0, hd - 0.3);
  const r1 = new THREE.Vector3(-1.4, 1.35, hd - 0.3);
  const r2 = new THREE.Vector3(-1.15, 1.55, hd - 0.45);
  const r3 = new THREE.Vector3(-0.95, 1.4, hd - 0.55);
  cylinder(parts, 'orange', 0.05, r0.distanceTo(r1), r0, r1);
  cylinder(parts, 'orange', 0.04, r1.distanceTo(r2), r1, r2);
  cylinder(parts, 'dark', 0.03, r2.distanceTo(r3), r2, r3);
  for (const p of [r1, r2]) {
    const j = new THREE.SphereGeometry(0.06, 14, 10);
    j.translate(p.x, p.y, p.z);
    parts.dark.push(j);
  }
  for (const x of [0.4, 0.9]) box(parts, 'cabinet', [0.38, 0.3, 0.32], [x, 1.09, hd - 0.3]);
  // Skirting along every wall: grounds the room.
  box(parts, 'counter', [hw * 2, 0.08, 0.02], [0, 0.04, -hd + 0.035]);
  box(parts, 'counter', [hw * 2, 0.08, 0.02], [0, 0.04, hd - 0.035]);
  box(parts, 'counter', [0.02, 0.08, hd * 2], [-hw + 0.035, 0.04, 0]);
  box(parts, 'counter', [0.02, 0.08, hd * 2], [hw - 0.035, 0.04, 0]);

  // Left wall: tall white storage and a second bench.
  const xl = -hw + 0.3;
  box(parts, 'cabinet', [0.56, 2.2, 1.6], [xl, 1.1, 1.6]);
  box(parts, 'cabinet', [0.6, 0.86, 2.2], [xl, 0.43, -1.0]);
  box(parts, 'counter', [0.64, 0.04, 2.26], [xl, 0.88, -1.0]);
  box(parts, 'dark', [0.4, 0.3, 0.4], [xl, 1.05, -1.4]);

  // Soft contact shadows on the floor under every bench and cabinet (one transparent gradient material).
  const shade = (w: number, d: number, x: number, z: number) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.004, z);
    parts.shadow.push(g);
  };
  shade(5.9, 0.7, -0.6, zb + 0.1);
  shade(0.7, 2.9, xr - 0.05, -1.6);
  shade(0.7, 1.9, xl + 0.05, 1.6);
  shade(0.7, 2.5, xl + 0.05, -1.0);
  shade(3.5, 0.6, -0.4, hd - 0.35);

  const out: Partial<Record<LabMaterialKey, THREE.BufferGeometry>> = {};
  for (const key of Object.keys(parts) as LabMaterialKey[]) {
    const list = parts[key];
    if (!list.length) continue;
    const merged = mergeGeometries(
      list.map((g) => (g.index ? g.toNonIndexed() : g)),
      false
    );
    list.forEach((g) => g.dispose());
    if (merged) out[key] = merged;
  }
  return out;
}

/** Contact-shadow look: dark in the middle, fading to nothing at the edges (alpha texture). */
export function drawContactShadow(ctx: CanvasRenderingContext2D, size: number): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** Pegboard look (white board, regular holes) drawn on a canvas once. */
export function drawPegboard(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#f2f2f0';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#c9cbcd';
  const step = size / 16;
  for (let y = step / 2; y < size; y += step)
    for (let x = step / 2; x < size; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, step * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
}

/** Room colours (3D materials): white lab, light grey tops, black machines, brushed steel, orange resin hoods. */
export const LAB_COLORS: Record<LabMaterialKey, string> = {
  wall: '#c3c9ce',
  floor: '#5f666c',
  cabinet: '#dfe2e4',
  counter: '#868c92',
  dark: '#1d1f22',
  steel: '#9ea4aa',
  orange: '#e8661c',
  glass: '#dfe9f0',
  pegboard: '#ffffff',
  lamp: '#fff6e6',
  shadow: '#000000',
};
/** Soft relief shadow of the wall sign (white on white, like a routed sign). */
export const LAB_SIGN_SHADOW = 'rgba(0,0,0,0.12)';
