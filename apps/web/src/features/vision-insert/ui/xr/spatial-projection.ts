import type { ApplianceDetection } from '@/lib/vision';

export interface SpatialTarget {
  id: string;
  detection: ApplianceDetection;
  /** Center coordinates in 3D world space [x, y, z] */
  position: [number, number, number];
  /** Approximate bounding box dimensions [width, height, depth] in meters */
  dimensions: [number, number, number];
  /** Hit radius for raycasting / projectile collision */
  hitRadius: number;
}

export interface SpatialProjectionOptions {
  /** Distance from the observer (radius of the viewing arc). Default: 2.2m */
  radius?: number;
  /** Horizontal angular field of view for distribution (in radians). Default: ~75 deg (1.3 rad) */
  horizontalSpanRad?: number;
  /** Minimum target elevation above ground (y). Default: 0.6m */
  minY?: number;
  /** Maximum target elevation above ground (y). Default: 1.8m */
  maxY?: number;
}

/**
 * Projects 2D normalized detection boxes ({ x, y, w, h } in [0, 1])
 * into an ergonomic 3D arc array directly in front of the viewer facing -Z.
 */
export function projectDetectionsTo3D(
  detections: ApplianceDetection[],
  options: SpatialProjectionOptions = {}
): SpatialTarget[] {
  const { radius = 2.2, horizontalSpanRad = 1.3, minY = 0.6, maxY = 1.8 } = options;

  if (!detections || detections.length === 0) return [];

  return detections.map((det, index) => {
    const { x: bx, y: by, w: bw, h: bh } = det.box;
    const xCenter = THREE_CLAMP(bx + bw / 2, 0, 1);
    const yCenter = THREE_CLAMP(by + bh / 2, 0, 1);

    // If multiple items share similar centers, distribute them slightly to avoid overlap
    const angleOffset = detections.length > 1 ? (xCenter - 0.5) * horizontalSpanRad : 0;

    const x = radius * Math.sin(angleOffset);
    const z = -radius * Math.cos(angleOffset);
    // Invert yCenter so top of image (by ~ 0) maps to higher elevation
    const y = minY + (1 - yCenter) * (maxY - minY);

    // Estimate physical dimensions from 2D relative span
    const spanX = Math.max(0.15, bw * 1.4);
    const spanY = Math.max(0.15, bh * 1.4);
    const spanZ = Math.min(0.8, Math.max(0.2, (spanX + spanY) / 2.5));

    const hitRadius = Math.max(0.25, Math.hypot(spanX, spanY, spanZ) / 2);

    return {
      id: det.id || `target-${index}`,
      detection: det,
      position: [Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3))],
      dimensions: [Number(spanX.toFixed(3)), Number(spanY.toFixed(3)), Number(spanZ.toFixed(3))],
      hitRadius: Number(hitRadius.toFixed(3)),
    };
  });
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
