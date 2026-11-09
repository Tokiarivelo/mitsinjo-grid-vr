import type { ApplianceDetection } from '@/lib/vision';
import { screenArc, screenPoint, WEBCAM_SCREEN, type WebcamScreenGeometry } from './webcam-screen';

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
  screen?: WebcamScreenGeometry;
}

const round = (n: number) => Number(n.toFixed(3));

/**
 * Projects normalized detection boxes ({ x, y, w, h } in [0, 1] of the scanned webcam frame)
 * onto the curved webcam screen, so each hologram frame covers its object in the video
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
  } = options;
  if (!detections || detections.length === 0) return [];

  const arcWidth = screenArc(screen).thetaLength * screen.radius;

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

    return {
      id: det.id || `target-${index}`,
      detection: det,
      position: along(frameDist).map(round) as Vec3,
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
