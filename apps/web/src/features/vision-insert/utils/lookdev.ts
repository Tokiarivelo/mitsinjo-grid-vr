/**
 * Look-development lights (PQ-T40): the viewer's three lightings for `make shape-shots LOOKDEV=1`. `studio` is
 * the default every user sees; `side` is a low raking light, `back` lights the object from behind. Dev only:
 * the preset comes from `?lookdev=` on the page and is ignored for any other value.
 */
export const LOOKDEV_PRESETS = ['studio', 'side', 'back'] as const;
export type LookdevPreset = (typeof LOOKDEV_PRESETS)[number];

type Vec3 = [number, number, number];
export interface LightSetup {
  key: { position: Vec3; intensity: number };
  rim: { position: Vec3; intensity: number };
}

export const LIGHT_SETUPS: Record<LookdevPreset, LightSetup> = {
  studio: {
    key: { position: [2, 3, 2.5], intensity: 1.2 },
    rim: { position: [-0.5, 1.6, -3], intensity: 1.1 },
  },
  side: {
    key: { position: [3.2, 0.5, 0.4], intensity: 1.6 },
    rim: { position: [-0.5, 1.6, -3], intensity: 0.3 },
  },
  back: {
    key: { position: [0.3, 1.5, -3], intensity: 1.8 },
    rim: { position: [0, 1, 3], intensity: 0.2 },
  },
};

/** The preset named by a query string (`?lookdev=side`); the studio for anything else. */
export function lookdevPreset(search: string): LookdevPreset {
  const v = new URLSearchParams(search).get('lookdev');
  return (LOOKDEV_PRESETS as readonly string[]).includes(v ?? '') ? (v as LookdevPreset) : 'studio';
}
