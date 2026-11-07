/**
 * Pure celestial mechanics: computes smooth arcs for the Sun (0° to 180°) during daytime
 * and the Moon (0° to 180°) during nighttime, plus night sky / star visibility factors.
 *
 * Visual only (no energy math). Pure: same input -> same output.
 */

export interface CelestialCoordinates {
  /** Celestial progress along the 180° sky arc [0, 1]. */
  progress: number;
  /** Angle along the arc in degrees: 0° (rising horizon) -> 90° (zenith) -> 180° (setting horizon). */
  angleDeg: number;
  /** Angle along the arc in radians [0, π]. */
  angleRad: number;
  /** Direction unit vector [x, y, z] for sky dome disc / mesh rendering. */
  displayDirection: [number, number, number];
  /** Direction unit vector [x, y, z] for directional key light / shadow casting. */
  keyDirection: [number, number, number];
  /** Display elevation angle above horizon in degrees. */
  displayAltitudeDeg: number;
  /** Key light elevation angle above horizon in degrees. */
  keyAltitudeDeg: number;
  /** Azimuth angle in radians (East positive, West negative). */
  azimuthRad: number;
}

/**
 * Default horizontal spread across the northern sky dome visible from the village camera.
 * 0.75 rad (~43°) keeps the celestial body beautifully framed above the mountain skyline.
 */
export const DEFAULT_AZIMUTH_SPAN_RAD = 0.75;

/** Converts an elevation in degrees and an azimuth in radians into a Three.js unit vector. */
export function sphericalToDirection(
  altitudeDeg: number,
  azimuthRad: number
): [number, number, number] {
  const altRad = (altitudeDeg * Math.PI) / 180;
  const cosAlt = Math.cos(altRad);
  return [cosAlt * Math.sin(azimuthRad), Math.sin(altRad), -cosAlt * Math.cos(azimuthRad)];
}

/**
 * Calculates direction along a 0° to 180° celestial arc.
 * At 0°: on the East horizon (azimuth +span, altitude baseAlt).
 * At 90°: at zenith meridian (azimuth 0, altitude maxAlt).
 * At 180°: on the West horizon (azimuth -span, altitude baseAlt).
 */
export function celestialArcDirection(
  angleDeg: number,
  maxAltDeg: number,
  baseAltDeg: number = 3,
  azimuthSpanRad: number = DEFAULT_AZIMUTH_SPAN_RAD
): { direction: [number, number, number]; altitudeDeg: number; azimuthRad: number } {
  const clampedAngle = Math.max(0, Math.min(180, angleDeg));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const azimuthRad = Math.cos(angleRad) * azimuthSpanRad;
  const altitudeDeg = baseAltDeg + Math.sin(angleRad) * (maxAltDeg - baseAltDeg);
  return {
    direction: sphericalToDirection(altitudeDeg, azimuthRad),
    altitudeDeg,
    azimuthRad,
  };
}

/**
 * Sun trajectory from 06:00 (0°) to 18:00 (180°).
 */
export function sunCoordinates(
  timeHour: number,
  azimuthSpanRad: number = DEFAULT_AZIMUTH_SPAN_RAD
): CelestialCoordinates {
  const progress = Math.max(0, Math.min(1, (timeHour - 6) / 12));
  const angleDeg = progress * 180;
  const angleRad = (angleDeg * Math.PI) / 180;

  const display = celestialArcDirection(angleDeg, 7.5, 2.5, azimuthSpanRad);
  const key = celestialArcDirection(angleDeg, 42, 6, azimuthSpanRad);

  return {
    progress,
    angleDeg,
    angleRad,
    displayDirection: display.direction,
    keyDirection: key.direction,
    displayAltitudeDeg: display.altitudeDeg,
    keyAltitudeDeg: key.altitudeDeg,
    azimuthRad: display.azimuthRad,
  };
}

/**
 * Moon trajectory from 18:00 (0°) through midnight 00:00 (90°) to 06:00 (180°).
 */
export function moonCoordinates(
  timeHour: number,
  azimuthSpanRad: number = DEFAULT_AZIMUTH_SPAN_RAD
): CelestialCoordinates {
  const normHour = ((timeHour % 24) + 24) % 24;
  let progress: number;
  if (normHour >= 18) {
    progress = (normHour - 18) / 12;
  } else if (normHour <= 6) {
    progress = (normHour + 6) / 12;
  } else {
    // Daytime: moon sits below horizon or at setting edge
    progress = normHour < 12 ? 1 : 0;
  }
  progress = Math.max(0, Math.min(1, progress));
  const angleDeg = progress * 180;
  const angleRad = (angleDeg * Math.PI) / 180;

  const display = celestialArcDirection(angleDeg, 7.0, 2.5, azimuthSpanRad);
  const key = celestialArcDirection(angleDeg, 36, 6, azimuthSpanRad);

  return {
    progress,
    angleDeg,
    angleRad,
    displayDirection: display.direction,
    keyDirection: key.direction,
    displayAltitudeDeg: display.altitudeDeg,
    keyAltitudeDeg: key.altitudeDeg,
    azimuthRad: display.azimuthRad,
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
