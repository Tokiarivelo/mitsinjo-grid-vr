# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-07 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Volumetric Fluffy Clouds (Image 2 parity): 60 banks x 16 puffs = 960 organic lobes in 1 InstancedMesh draw call. Procedural 3D vertex billow deformation creates cauliflower cumulus contours with zero polygonal facets.
- Cloud Shading: Radiant pure white sunlit tops, luminous azure/sky-blue undersides (`#82b7eb`), Half-Lambert wrapped diffuse (wrap 0.65), subsurface scattering forward glow, and guaranteed daytime luminance floor (zero dark rock artifacts).
- 360° Sky Distribution: 4 concentric shells (low horizon cloud deck, mid-sky valley, high overhead canopy, intermediate fill) wrap the entire dome without empty wedges.
- Celestial Mechanics: Sun starts from side (+X: East, 06:00), climbs overhead above camera (+Y, +Z: 12:00), descends behind camera (+Z: South, 18:00). Shadows strictly follow physical light direction at all hours.
- 60 FPS Fluidity: Constant angular velocity during playback ($v = \text{speed} \times 2.0\text{ h/s}$) and exponential ease-out during scrubbing; zero allocations per frame, demand-mode idle when stationary.
- Verification: All 47 3D test suites (327 tests), 27 engine test suites (353 tests), typecheck, and i18n parity pass 100%.

## Next

1. Verify visual experience live at `http://localhost:3001/simulation`.
2. Commit and rebase/merge to main.

## Files touched

- `apps/web/src/features/microgrid-3d/ui/sky-backdrop.tsx`
- `apps/web/src/features/microgrid-3d/ui/village-canvas.tsx`
- `apps/web/src/features/microgrid-3d/ui/weather-effects.tsx`
- `apps/web/src/features/microgrid-3d/utils/weather-atmosphere.ts`
- `apps/web/src/features/microgrid-3d/utils/__tests__/weather-atmosphere.test.ts`
