import { CAR_SLOTS, type CarMesh, type CarSlot } from '@/lib/car-mesh';

/**
 * Offline picture of a car mesh (PQ-T78), for the replays (`make car-replay` → `car-sheet.png`):
 * the triangles of `carMesh` drawn orthographically with a z-buffer, each one wearing the atlas
 * (the validated drawings) or its slot's colour, Lambert shaded. Pure and deterministic; a check
 * tool, the app renders the same mesh with three.js.
 */

export interface RasterAtlas {
  /** sRGB, 3 bytes per pixel, row-major, top row first. */
  rgb: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CarRasterOptions {
  /** Camera turn round the vertical axis (0 = the front, + = toward the car's right side). */
  yaw: number;
  /** Camera height angle (+ = from above). */
  pitch: number;
  /** Picture side, pixels. */
  size: number;
  /** The drawings; without them every slot takes its colour. */
  atlas?: RasterAtlas | null;
  /** Colour per slot (`#rrggbb`): used without an atlas, on undrawn slots, or when `flat`. */
  colors: Readonly<Record<CarSlot, string>>;
  /** Slots that wear the atlas. */
  drawn?: ReadonlySet<CarSlot>;
  /** Slot colours only (the pieces, not the drawings). */
  flat?: boolean;
}

/** Light in view space: upper left, in front. */
const LIGHT = [-0.35, 0.6, 0.72] as const;
const AMBIENT = 0.45;
const BACKGROUND = 255;

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The mesh as an sRGB picture (`size` × `size`, 3 bytes per pixel, white paper). */
export function rasterCar(mesh: CarMesh, options: CarRasterOptions): Uint8Array {
  const { yaw, pitch, size, atlas = null, colors, drawn, flat = false } = options;
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  /** Model → view: x right, y up, z toward the camera. */
  const turn = (x: number, y: number, z: number): [number, number, number] => {
    const [x1, z1] = [x * cy - z * sy, x * sy + z * cy];
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const count = mesh.position.length / 3;
  const view = new Float32Array(count * 3);
  let reach = 1e-6;
  for (let i = 0; i < count; i++) {
    const p = turn(mesh.position[i * 3]!, mesh.position[i * 3 + 1]!, mesh.position[i * 3 + 2]!);
    view.set(p, i * 3);
    reach = Math.max(reach, Math.abs(p[0]), Math.abs(p[1]));
  }
  const scale = (size * 0.47) / reach;
  const out = new Uint8Array(size * size * 3).fill(BACKGROUND);
  const depth = new Float32Array(size * size).fill(-Infinity);
  const ll = Math.hypot(...LIGHT);
  const palette = CAR_SLOTS.map((s) => rgbOf(colors[s]));
  for (let t = 0; t < count / 3; t++) {
    const slot = CAR_SLOTS[mesh.slot[t]!]!;
    const useAtlas = !flat && atlas && (drawn ? drawn.has(slot) : true);
    const base = palette[mesh.slot[t]!]!;
    const v = [0, 1, 2].map((k) => {
      const i = t * 3 + k;
      const n = turn(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!);
      return {
        x: size / 2 + view[i * 3]! * scale,
        y: size / 2 - view[i * 3 + 1]! * scale,
        z: view[i * 3 + 2]!,
        n,
        u: mesh.uv[i * 2]!,
        v: mesh.uv[i * 2 + 1]!,
      };
    }) as [Vertex, Vertex, Vertex];
    const area = (v[1].x - v[0].x) * (v[2].y - v[0].y) - (v[2].x - v[0].x) * (v[1].y - v[0].y);
    if (Math.abs(area) < 1e-9) continue;
    const [x0, x1] = [
      Math.max(0, Math.floor(Math.min(v[0].x, v[1].x, v[2].x))),
      Math.min(size - 1, Math.ceil(Math.max(v[0].x, v[1].x, v[2].x))),
    ];
    const [y0, y1] = [
      Math.max(0, Math.floor(Math.min(v[0].y, v[1].y, v[2].y))),
      Math.min(size - 1, Math.ceil(Math.max(v[0].y, v[1].y, v[2].y))),
    ];
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const [fx, fy] = [px + 0.5, py + 0.5];
        const a = ((v[1].x - fx) * (v[2].y - fy) - (v[2].x - fx) * (v[1].y - fy)) / area;
        const b = ((v[2].x - fx) * (v[0].y - fy) - (v[0].x - fx) * (v[2].y - fy)) / area;
        const c = 1 - a - b;
        if (a < 0 || b < 0 || c < 0) continue;
        const z = a * v[0].z + b * v[1].z + c * v[2].z;
        const at = py * size + px;
        if (z <= depth[at]!) continue;
        depth[at] = z;
        const n = [0, 1, 2].map((k) => a * v[0].n[k]! + b * v[1].n[k]! + c * v[2].n[k]!);
        const nl = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
        const lambert = Math.max(
          0,
          (n[0]! * LIGHT[0] + n[1]! * LIGHT[1] + n[2]! * LIGHT[2]) / (nl * ll)
        );
        const shade = AMBIENT + (1 - AMBIENT) * lambert;
        let color = base;
        if (useAtlas) {
          const tu = a * v[0].u + b * v[1].u + c * v[2].u;
          const tv = a * v[0].v + b * v[1].v + c * v[2].v;
          const ax = Math.min(atlas.width - 1, Math.max(0, Math.floor(tu * atlas.width)));
          const ay = Math.min(atlas.height - 1, Math.max(0, Math.floor((1 - tv) * atlas.height)));
          const k = (ay * atlas.width + ax) * 3;
          color = [atlas.rgb[k]!, atlas.rgb[k + 1]!, atlas.rgb[k + 2]!];
        }
        out[at * 3] = Math.min(255, color[0] * shade);
        out[at * 3 + 1] = Math.min(255, color[1] * shade);
        out[at * 3 + 2] = Math.min(255, color[2] * shade);
      }
  }
  return out;
}

interface Vertex {
  x: number;
  y: number;
  z: number;
  n: [number, number, number];
  u: number;
  v: number;
}
