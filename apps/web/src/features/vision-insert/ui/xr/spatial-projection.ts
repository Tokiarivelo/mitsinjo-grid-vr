import { boxPath, pathToRings, type ApplianceDetection } from '@/lib/vision';
import { groundedPoint } from './tour/grounded';
import { screenPoint, WEBCAM_SCREEN, type ImageSurface } from './webcam-screen';

type Vec3 = [number, number, number];

export interface SpatialTarget {
  id: string;
  detection: ApplianceDetection;
  /** Centre of the hologram frame, laid over the object as seen in the webcam video. */
  position: Vec3;
  /** Hologram frame size [width, height, depth] in metres. */
  dimensions: Vec3;
  /** Hit radius (m) around the frame centre. */
  hitRadius: number;
  /** Where the 3D model pops out of the video, between the viewer and the screen. */
  spawnPosition: Vec3;
  /** Size of the popped-out 3D model [width, height, depth] in metres. */
  spawnDimensions: Vec3;
  /**
   * Outline of the object as seen from the eye (SAM outline, else its box), in world points on the
   * frame plane: one ring per outlined part, largest first (VS-T18).
   */
  outline: Vec3[][];
  /** Same rings in image coords (u, v), for the fill triangulation. */
  outlineUv: Array<Array<[number, number]>>;
  /** Top centre of the object's box on the frame plane: its label sits just above. */
  labelAnchor: Vec3;
}

/** Rings kept per outline, and points per ring (sampled evenly beyond). */
export const OUTLINE_MAX_RINGS = 3;
export const OUTLINE_MAX_POINTS = 96;

/** Outline rings (u, v) of a detection, largest first, each at most `OUTLINE_MAX_POINTS`. */
export function outlineRings(det: Pick<ApplianceDetection, 'outline' | 'box'>) {
  let rings = det.outline ? pathToRings(det.outline) : [];
  rings = rings.filter((r) => r.length >= 3);
  if (rings.length === 0) rings = pathToRings(boxPath(det.box));
  const area = (r: ReadonlyArray<readonly [number, number]>) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i]!;
      const [x1, y1] = r[(i + 1) % r.length]!;
      a += x0 * y1 - x1 * y0;
    }
    return Math.abs(a / 2);
  };
  return [...rings]
    .sort((a, b) => area(b) - area(a))
    .slice(0, OUTLINE_MAX_RINGS)
    .map((r) => {
      const step = Math.max(1, r.length / OUTLINE_MAX_POINTS);
      const out: Array<[number, number]> = [];
      for (let k = 0; k < r.length && out.length < OUTLINE_MAX_POINTS; k += step) {
        const p = r[Math.floor(k)]!;
        out.push([clamp01(p[0]), clamp01(p[1])]);
      }
      return out;
    });
}

export interface SpatialProjectionOptions {
  /** Viewer eye position the frames are aligned for. Default: standing head [0, 1.6, 0]. */
  eye?: Vec3;
  /** Gap between the frame and the screen surface (m). Default: 0.25. */
  frameOffset?: number;
  /** Distance from the eye where the 3D model appears (m). Default: 1.6. */
  spawnDistance?: number;
  /** Largest side of a spawned model (m). Default: 0.9. */
  maxSpawnSize?: number;
  /** Surface the scanned image sits on: webcam wall, or a 360° tour scan plane. */
  screen?: ImageSurface;
  /**
   * 360° tour: the photo is drawn on walls `wall` m and a floor `floor` m from the eye (grounded
   * panorama). Outline, label and target centre are laid there, on the photo itself, so they stay
   * on the object while the viewer walks (the studio moves them with the photo).
   */
  ground?: { wall: number; floor: number };
}

const round = (n: number) => Number(n.toFixed(3));
/** Outline drawn this fraction of the way to the grounded photo (never behind it). */
const GROUND_INSET = 0.985;

/**
 * Projects normalized detection boxes ({ x, y, w, h } in [0, 1] of the scanned webcam frame)
 * onto the flat image surface (webcam wall or tour scan plane), so each hologram frame covers its object in the video
 * from the viewer's eye, and the spawned 3D model pops out along the same line of sight.
 */
export function projectDetectionsTo3D(
  detections: ApplianceDetection[],
  options: SpatialProjectionOptions = {}
): SpatialTarget[] {
  const {
    eye = [0, 1.6, 0],
    frameOffset = 0.25,
    spawnDistance = 1.6,
    maxSpawnSize = 0.9,
    screen = WEBCAM_SCREEN,
    ground,
  } = options;
  if (!detections || detections.length === 0) return [];

  const arcWidth = screen.width;

  return detections.map((det, index) => {
    const { x, y, w, h } = det.box;
    const u = clamp01(x + w / 2);
    const v = clamp01(y + h / 2);
    const onScreen = screenPoint(u, v, screen);

    const dx = onScreen[0] - eye[0];
    const dy = onScreen[1] - eye[1];
    const dz = onScreen[2] - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    const along = (d: number): Vec3 => [
      eye[0] + (dx * d) / dist,
      eye[1] + (dy * d) / dist,
      eye[2] + (dz * d) / dist,
    ];

    // Frame: same angular size as the object in the video, slightly in front of the screen.
    const frameDist = Math.max(0.5, dist - frameOffset);
    const frameScale = frameDist / dist;
    const frameW = Math.max(0.12, w * arcWidth * frameScale);
    const frameH = Math.max(0.12, h * screen.height * frameScale);
    const frameD = Math.min(0.4, Math.max(0.1, Math.min(frameW, frameH) * 0.4));

    // Spawned model: keeps the object's proportions, capped to a comfortable size.
    const spawnScale = Math.min(spawnDistance, dist) / dist;
    let sw = w * arcWidth * spawnScale;
    let sh = h * screen.height * spawnScale;
    const fit = Math.min(1, maxSpawnSize / Math.max(sw, sh, 1e-6));
    sw = Math.max(0.15, sw * fit);
    sh = Math.max(0.15, sh * fit);
    const sd = Math.max(0.15, Math.min(sw, sh) * 0.8);

    // Image point → frame plane, on the eye's line of sight (same angular size as in the photo);
    // in the tour, onto the grounded photo itself (just in front of it).
    const onFrame = (pu: number, pv: number): Vec3 => {
      const p = screenPoint(pu, pv, screen);
      const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
      if (ground) {
        const dir: Vec3 = [(p[0] - eye[0]) / d, (p[1] - eye[1]) / d, (p[2] - eye[2]) / d];
        const g = groundedPoint(dir, ground.wall, ground.floor);
        return [
          round(eye[0] + g[0] * GROUND_INSET),
          round(eye[1] + g[1] * GROUND_INSET),
          round(eye[2] + g[2] * GROUND_INSET),
        ];
      }
      const k = Math.max(0.5, d - frameOffset);
      return [
        round(eye[0] + ((p[0] - eye[0]) * k) / d),
        round(eye[1] + ((p[1] - eye[1]) * k) / d),
        round(eye[2] + ((p[2] - eye[2]) * k) / d),
      ];
    };
    const outlineUv = outlineRings(det);

    return {
      id: det.id || `target-${index}`,
      outline: outlineUv.map((r) => r.map(([pu, pv]) => onFrame(pu, pv))),
      outlineUv,
      labelAnchor: onFrame(u, clamp01(y)),
      detection: det,
      position: ground ? onFrame(u, v) : (along(frameDist).map(round) as Vec3),
      dimensions: [round(frameW), round(frameH), round(frameD)],
      hitRadius: round(Math.max(0.2, Math.hypot(frameW, frameH) / 2)),
      spawnPosition: along(Math.min(spawnDistance, dist)).map(round) as Vec3,
      spawnDimensions: [round(sw), round(sh), round(sd)],
    };
  });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
