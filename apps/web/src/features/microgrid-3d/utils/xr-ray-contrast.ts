import * as THREE from 'three';

/**
 * Laser colours that adapt to what is around them (VS-T30): every immersion samples the colour of
 * the surface the pointer ray meets (material colour × its texture at the hit's uv, or the sky)
 * and draws the beam and cursor light on dark surroundings, dark on bright ones, each with a halo
 * of the opposite tone so it stays visible on mid tones too.
 */
export const RAY_CONTRAST = {
  /** Light palette (on dark surroundings). */
  light: { core: '#ffffff', select: '#7dd3fc' },
  /** Dark palette (on bright surroundings: sky, sand, white walls). */
  dark: { core: '#0b1530', select: '#001e78' },
  /** Linear luminance band where the palette swaps (smoothly). ≈ sRGB 0.45 → 0.6. */
  swapFrom: 0.17,
  swapTo: 0.32,
  /** Seconds to settle on a new surrounding (no flicker when sweeping across edges). */
  settle: 0.2,
  /** Probe range (m) and how often each pointer probes (frames). */
  range: 40,
  everyFrames: 4,
  /** Luminance assumed when nothing is met and the scene has no plain background colour. */
  sky: 0.45,
} as const;

/** Relative luminance (0–1) of a colour in three's linear working space. */
export function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** 0 = use the light palette, 1 = the dark one, for a surrounding of linear luminance `lum`. */
export function darkness(lum: number): number {
  const t = (lum - RAY_CONTRAST.swapFrom) / (RAY_CONTRAST.swapTo - RAY_CONTRAST.swapFrom);
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

const _light = new THREE.Color();
const _dark = new THREE.Color();

/** Beam / ring colour, its halo (opposite tone) and the pressed colour, for a `darkness` 0–1. */
export function rayColors(
  dark: number,
  out: { core: THREE.Color; halo: THREE.Color; select: THREE.Color }
): void {
  _light.set(RAY_CONTRAST.light.core);
  _dark.set(RAY_CONTRAST.dark.core);
  out.core.copy(_light).lerp(_dark, dark);
  out.halo.copy(_dark).lerp(_light, dark);
  out.select.set(RAY_CONTRAST.light.select).lerp(_dark.set(RAY_CONTRAST.dark.select), dark);
}

/** Small copies of textures read once (per texture version) to sample their colour at a uv. */
const SAMPLE = 16;
const samples = new WeakMap<THREE.Texture, { version: number; data: Uint8ClampedArray | null }>();
let sampleCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

function textureData(tex: THREE.Texture): Uint8ClampedArray | null {
  const cached = samples.get(tex);
  if (cached && cached.version === tex.version) return cached.data;
  let data: Uint8ClampedArray | null = null;
  try {
    const img = tex.image as CanvasImageSource | undefined;
    if (img && typeof document !== 'undefined') {
      sampleCanvas ??=
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(SAMPLE, SAMPLE)
          : Object.assign(document.createElement('canvas'), { width: SAMPLE, height: SAMPLE });
      const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true }) as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (ctx) {
        ctx.clearRect(0, 0, SAMPLE, SAMPLE);
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
      }
    }
  } catch {
    data = null; // Cross-origin, closed bitmap, data texture: the material colour alone.
  }
  samples.set(tex, { version: tex.version, data });
  return data;
}

const _tex = new THREE.Color();

/**
 * Colour (linear) of `material` at `uv`: its colour, times its map's colour there when the map can
 * be read, plus its emissive. Returns false when the material has no usable colour.
 */
export function materialColorAt(
  material: THREE.Material,
  uv: THREE.Vector2 | undefined,
  out: THREE.Color
): boolean {
  const m = material as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  if (!m.color) return false;
  out.copy(m.color);
  const data = m.map && uv ? textureData(m.map) : null;
  if (data && uv) {
    const t = m.map!;
    const u = (((uv.x * t.repeat.x + t.offset.x) % 1) + 1) % 1;
    let v = (((uv.y * t.repeat.y + t.offset.y) % 1) + 1) % 1;
    if (t.flipY) v = 1 - v;
    const i =
      (Math.min(SAMPLE - 1, Math.floor(v * SAMPLE)) * SAMPLE +
        Math.min(SAMPLE - 1, Math.floor(u * SAMPLE))) *
      4;
    const a = data[i + 3]! / 255;
    // Transparent texels show what is behind: treat them as mid grey rather than black.
    _tex.setRGB(
      (data[i]! / 255) * a + 0.5 * (1 - a),
      (data[i + 1]! / 255) * a + 0.5 * (1 - a),
      (data[i + 2]! / 255) * a + 0.5 * (1 - a),
      THREE.SRGBColorSpace
    );
    out.multiply(_tex);
  }
  if (m.emissive) {
    const k = m.emissiveIntensity ?? 1;
    out.setRGB(out.r + m.emissive.r * k, out.g + m.emissive.g * k, out.b + m.emissive.b * k);
  }
  return true;
}

const _rc = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];
const _c = new THREE.Color();

function walk(o: THREE.Object3D) {
  if (!o.visible || o.userData.noRayProbe) return;
  if (o.layers.test(_rc.layers)) o.raycast(_rc, _hits);
  for (const child of o.children) walk(child);
}

/** Luminance of the scene's plain background or fog, else the default sky. */
function skyLuminance(scene: THREE.Scene): number {
  const bg = scene.background as THREE.Color | null;
  if (bg && (bg as THREE.Color).isColor) return luminance(bg);
  const fog = scene.fog as { color?: THREE.Color } | null;
  if (fog?.color) return luminance(fog.color);
  return RAY_CONTRAST.sky;
}

/**
 * Luminance (linear 0–1) of what a ray from `origin` along `direction` (world, unit) meets in
 * `scene`: the first visible surface on layer 0 within `RAY_CONTRAST.range`, else the sky. Hand
 * and controller models (own layer) and the lasers (`userData.noRayProbe`) are skipped.
 */
export function surroundingLuminance(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  camera?: THREE.Camera
): number {
  _rc.set(origin, direction);
  _rc.near = 0.05;
  _rc.far = RAY_CONTRAST.range;
  if (camera) _rc.camera = camera;
  _hits.length = 0;
  try {
    for (const child of scene.children) walk(child);
  } catch {
    _hits.length = 0;
  }
  _hits.sort((a, b) => a.distance - b.distance);
  for (const hit of _hits) {
    const mat = (hit.object as THREE.Mesh).material;
    const material = Array.isArray(mat)
      ? mat[hit.face?.materialIndex ?? 0]
      : (mat as THREE.Material | undefined);
    if (!material || !material.visible) continue;
    if (material.transparent && material.opacity < 0.25) continue;
    if (materialColorAt(material, hit.uv, _c)) return Math.min(1, luminance(_c));
  }
  return skyLuminance(scene);
}

/**
 * Per-pointer probe: re-samples every `RAY_CONTRAST.everyFrames` frames (lasers move little in
 * between), returns the last luminance in between.
 */
export function createSurroundingProbe() {
  const last: [number, number] = [RAY_CONTRAST.sky, RAY_CONTRAST.sky];
  const frame: [number, number] = [0, Math.floor(RAY_CONTRAST.everyFrames / 2)];
  return (
    index: 0 | 1,
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    camera?: THREE.Camera
  ): number => {
    if (frame[index]++ % RAY_CONTRAST.everyFrames === 0)
      last[index] = surroundingLuminance(scene, origin, direction, camera);
    return last[index];
  };
}
