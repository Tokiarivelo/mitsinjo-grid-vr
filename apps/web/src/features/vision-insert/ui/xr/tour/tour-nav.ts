import type { ApplianceDetection } from '@/lib/vision';
import {
  dirFromYawPitch,
  equirectYawPitch,
  projectPanoBox,
  type CaptureView,
  type Vec3,
} from './equirect';
import type { TourRoom, TourRoomId } from './tour-data';

/** Centre of the photo sphere = where the 360° camera stood: viewer's eye height. */
export const TOUR_EYE: Vec3 = [0, 1.6, 0];
/** Photo sphere radius (m): beyond every panel, label and target, so nothing is ever cut. */
export const TOUR_SPHERE_RADIUS = 9;
/** Scan photo: 80° wide, 16:9, like a phone camera. */
export const TOUR_CAPTURE_HFOV = (80 * Math.PI) / 180;
export const TOUR_CAPTURE_ASPECT = 16 / 9;
/** Plane the scan photo is laid on for targets (`surfaceFromView`), in front of the sphere. */
export const TOUR_SURFACE_DISTANCE = 3;
/** Floor arrows: distance from the viewer and pick radius (m). */
export const TOUR_ARROW_DISTANCE = 1.7;
export const TOUR_ARROW_RADIUS = 0.38;
/** Thumbstick / key "walk forward": the arrow must be within this angle of the gaze (rad). */
export const TOUR_WALK_ANGLE = (70 * Math.PI) / 180;

export const tourLinkId = (to: TourRoomId) => `tour-link:${to}`;

export interface TourArrow {
  id: string;
  to: TourRoomId;
  yaw: number;
  /** World position on the floor. */
  position: Vec3;
}

/** Floor arrows of a room, given the image column seen straight ahead (`uFront`). */
export function tourArrows(room: TourRoom, uFront: number): TourArrow[] {
  return room.links.map((link) => {
    const { yaw } = equirectYawPitch(link.u, 0.5, uFront);
    return {
      id: tourLinkId(link.to),
      to: link.to,
      yaw,
      position: [
        Number((TOUR_EYE[0] + Math.sin(yaw) * TOUR_ARROW_DISTANCE).toFixed(3)),
        0.03,
        Number((TOUR_EYE[2] - Math.cos(yaw) * TOUR_ARROW_DISTANCE).toFixed(3)),
      ],
    };
  });
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Room the viewer walks to when pushing "forward": the arrow closest to the gaze, if close enough. */
export function walkTarget(arrows: readonly TourArrow[], headYaw: number): TourRoomId | null {
  let best: TourArrow | null = null;
  let bestDiff = TOUR_WALK_ANGLE;
  for (const a of arrows) {
    const diff = Math.abs(wrapPi(a.yaw - headYaw));
    if (diff <= bestDiff) {
      best = a;
      bestDiff = diff;
    }
  }
  return best?.to ?? null;
}

/** Scan photo of the 360° view centred on a heading (head gaze, or a shot direction). */
export function captureViewAt(yaw: number, pitch: number): CaptureView {
  // Keep the photo level-ish: very steep looks would only see floor or ceiling.
  const p = Math.max(-0.6, Math.min(0.6, pitch));
  return { yaw, pitch: p, hfov: TOUR_CAPTURE_HFOV, aspect: TOUR_CAPTURE_ASPECT };
}

/** Labelled objects of the room visible in a scan photo, as detections (offline ground truth). */
export function tourExpectedDetections(
  room: TourRoom,
  uFront: number,
  view: CaptureView
): ApplianceDetection[] {
  const out: ApplianceDetection[] = [];
  for (const o of room.objects) {
    const box = projectPanoBox(o.box, uFront, view);
    if (!box) continue;
    out.push({
      id: o.id,
      label: o.label,
      labels: o.labels,
      category: o.category,
      confidence: 0.9,
      box,
    });
  }
  return out;
}

export { dirFromYawPitch };
