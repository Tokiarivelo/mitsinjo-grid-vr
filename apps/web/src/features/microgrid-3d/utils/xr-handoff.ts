import { create } from 'zustand';

type Vec3 = [number, number, number];

/** How far from the object the viewer stands when the simulation opens in VR next to it. */
export const XR_HANDOFF_STAND = 2.5;

export interface XrHandoff {
  /** Village point (x, z) of the object the viewer arrives next to. */
  at: [number, number];
}

interface XrHandoffState {
  /** A VR entry asked for by another page (the /village lab, VS-T29), not yet taken. */
  pending: XrHandoff | null;
  request: (at: [number, number]) => void;
  clear: () => void;
}

/**
 * Hand-off from the /village VR lab to /simulation (VS-T29): « Go to the simulation » leaves one
 * session and asks the next page to open its own, standing next to the object just added. Lives
 * in memory only (client navigation keeps it; a reload drops it).
 */
export const useXrHandoff = create<XrHandoffState>()((set) => ({
  pending: null,
  request: (at) => set({ pending: { at } }),
  clear: () => set({ pending: null }),
}));

/**
 * Viewer pose next to the object at (x, z): `stand` m away on the village-centre side (the paths
 * and the other buildings are that way), eyes at `eyeY`, looking at the object.
 */
export function standNear(
  x: number,
  z: number,
  eyeY: number,
  stand = XR_HANDOFF_STAND
): { position: Vec3; target: Vec3 } {
  const d = Math.hypot(x, z);
  const [ux, uz] = d < 1e-3 ? [0, 1] : [-x / d, -z / d];
  const round = (n: number) => Number(n.toFixed(3));
  return {
    position: [round(x + ux * stand), eyeY, round(z + uz * stand)],
    target: [x, eyeY, z],
  };
}
