/** Bars of the VR voice level meter (VS-T29), on the copilot's log frequency axis. */
export const VOICE_METER_BARS = 28;
/** A bar never drops under this share of the meter height: the meter stays visible in silence. */
export const VOICE_METER_MIN = 0.06;

/**
 * Centre x, centre y and height (m) of bar `i` of `count` in a `width` × `height` meter centred on
 * 0, growing up from the bottom edge with its band `level` (0–1, clamped).
 */
export function voiceBar(
  i: number,
  count: number,
  width: number,
  height: number,
  level: number
): { x: number; y: number; h: number } {
  const h = Math.max(VOICE_METER_MIN, Math.min(1, level || 0)) * height;
  return { x: -width / 2 + (width / count) * (i + 0.5), y: -height / 2 + h / 2, h };
}
