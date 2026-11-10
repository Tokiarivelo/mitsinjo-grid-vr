import type { ApplianceDetection } from '@/lib/vision';

/**
 * Ground truth attached to a scan photo of the 360° test tour (VS-T14), keyed by the photo's
 * data URL: the detection hook sends it as `expected`, the offline mock returns it.
 * Kept small: only the last few scans.
 */
const MAX = 4;
const byPhoto = new Map<string, ApplianceDetection[]>();

export function rememberExpectedDetections(photo: string, detections: ApplianceDetection[]): void {
  byPhoto.delete(photo);
  byPhoto.set(photo, detections);
  while (byPhoto.size > MAX) byPhoto.delete(byPhoto.keys().next().value!);
}

export function expectedDetectionsFor(photo: string): ApplianceDetection[] | undefined {
  return byPhoto.get(photo);
}
