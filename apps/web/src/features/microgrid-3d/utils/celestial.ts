/**
 * Pure celestial mechanics: computes smooth physical 3D trajectories for the Sun
 * and the Moon, plus night sky / star visibility factors.
 *
 * Trajectory logic:
 * - Starts from the side (+X, East horizon) at 06:00 (angle 0°)
 * - Climbs high to pass directly above the camera (+Y, +Z) at 12:00 (angle 90°)
 * - Descends behind the camera (+Z, South horizon) at 18:00 (angle 180°)
 * - Shadows logically and physically follow the exact light direction at all hours:
 *   morning shadows cast to the side (-X), noon shadows directly under objects,
 *   evening shadows cast forward (-Z) deep into the village.
 *
 * Visual only (no energy math). Pure: same input -> same output.
 */

export interface CelestialCoordinates {
  /** Celestial progress along the 180° sky arc [0, 1]. */
  progress: number;
  /** Angle along the arc in degrees: 0° -> 90° -> 180°. */
  angleDeg: number;
  /** Angle along the arc in radians [0, π]. */
  angleRad: number;
  /** Unified 3D direction unit vector [x, y, z] for celestial body and directional key light. */
  direction: [number, number, number];
  /** Display direction vector for sky backdrop (identical to direction for 100% shadow parity). */
  displayDirection: [number, number, number];
  /** Key light direction vector (identical to direction for 100% shadow parity). */
  keyDirection: [number, number, number];
  /** Elevation angle above horizon in degrees. */
  altitudeDeg: number;
}

/**
 * Calculates a smooth 3D celestial direction unit vector that:
 * 1. Starts from the side (+X) at angle 0°
 * 2. Climbs to zenith directly above the camera (+Y, +Z) at angle 90°
 * 3. Descends behind the camera (+Z) at angle 180°
 */
export function sideToOverheadToBehindDirection(
  angleDeg: number,
  maxAltDeg: number = 74,
  baseAltDeg: number = 3.5
): { direction: [number, number, number]; altitudeDeg: number } {
  const clampedAngle = Math.max(0, Math.min(180, angleDeg));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const altDeg = baseAltDeg + Math.sin(angleRad) * (maxAltDeg - baseAltDeg);
  const altRad = (altDeg * Math.PI) / 180;
  const cosAlt = Math.cos(altRad);
  const sinAlt = Math.sin(altRad);

  // Horizontal sweep: 0° (side +X) -> 45° (overhead slant) -> 90° (behind +Z)
  const phi = angleRad * 0.5;
  const dirX = cosAlt * Math.cos(phi);
  const dirY = sinAlt;
  const dirZ = cosAlt * Math.sin(phi);

  return {
    direction: [dirX, dirY, dirZ],
    altitudeDeg: altDeg,
  };
}

/**
 * Moon arc across the night sky:
 * 1. Rises at dusk behind the camera (angle 0°)
 * 2. Climbs to zenith directly above the camera at midnight (angle 90°)
 * 3. Sets on the western horizon opposite sunrise at dawn (angle 180°)
 */
export function moonNocturnalDirection(
  angleDeg: number,
  maxAltDeg: number = 70,
  baseAltDeg: number = 3.5
): { direction: [number, number, number]; altitudeDeg: number } {
  const clampedAngle = Math.max(0, Math.min(180, angleDeg));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const altDeg = baseAltDeg + Math.sin(angleRad) * (maxAltDeg - baseAltDeg);
  const altRad = (altDeg * Math.PI) / 180;
  const cosAlt = Math.cos(altRad);
  const sinAlt = Math.sin(altRad);

  const phi = angleRad * 0.5;
  const dirX = -cosAlt * Math.sin(phi);
  const dirY = sinAlt;
  const dirZ = cosAlt * Math.cos(phi);

  return {
    direction: [dirX, dirY, dirZ],
    altitudeDeg: altDeg,
  };
}

/**
 * Sun trajectory from 06:00 (0°) through noon 12:00 (90°) to 18:00 (180°).
 */
export function sunCoordinates(timeHour: number): CelestialCoordinates {
  const progress = Math.max(0, Math.min(1, (timeHour - 6) / 12));
  const angleDeg = progress * 180;
  const angleRad = (angleDeg * Math.PI) / 180;

  const { direction, altitudeDeg } = sideToOverheadToBehindDirection(angleDeg, 74, 3.5);

  return {
    progress,
    angleDeg,
    angleRad,
    direction,
    displayDirection: direction,
    keyDirection: direction,
    altitudeDeg,
  };
}

/**
 * Moon trajectory from 18:00 (0°) through midnight 00:00 (90°) to 06:00 (180°).
 */
export function moonCoordinates(timeHour: number): CelestialCoordinates {
  const normHour = ((timeHour % 24) + 24) % 24;
  let progress: number;
  if (normHour >= 18) {
    progress = (normHour - 18) / 12;
  } else if (normHour <= 6) {
    progress = (normHour + 6) / 12;
  } else {
    // Daytime: moon rests below horizon
    progress = normHour < 12 ? 1 : 0;
  }
  progress = Math.max(0, Math.min(1, progress));
  const angleDeg = progress * 180;
  const angleRad = (angleDeg * Math.PI) / 180;

  const { direction, altitudeDeg } = moonNocturnalDirection(angleDeg, 70, 3.5);

  return {
    progress,
    angleDeg,
    angleRad,
    direction,
    displayDirection: direction,
    keyDirection: direction,
    altitudeDeg,
  };
}

/**
 * Smooth night factor (0.0 full daytime -> 1.0 deep night):
 * Fades in stars and lunar glow during dusk (17:30 to 19:30),
 * fades out during dawn (04:30 to 06:30).
 */
export function nightFactor(timeHour: number): number {
  const h = ((timeHour % 24) + 24) % 24;
  if (h >= 19.5 || h <= 4.5) return 1.0;
  if (h >= 6.5 && h <= 17.5) return 0.0;
  if (h > 17.5 && h < 19.5) {
    // Dusk transition (17:30 -> 19:30)
    const t = (h - 17.5) / 2.0;
    return t * t * (3 - 2 * t);
  }
  // Dawn transition (04:30 -> 06:30)
  const t = (6.5 - h) / 2.0;
  return t * t * (3 - 2 * t);
}

/**
 * Computes shortest hour difference considering 24-hour clock wrap (e.g. 23.8 -> 0.2).
 */
export function shortestHourDelta(from: number, to: number): number {
  let diff = to - from;
  while (diff > 12) diff -= 24;
  while (diff < -12) diff += 24;
  return diff;
}
