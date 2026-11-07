# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-07 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Varied Cloud Sizes & Morphotypes: Natural 4-tier distribution from tiny wispy cotton puffs (scale 2.4 - 4.6) up to grand towering cumulus (scale 13.0 - 16.5) with >3x scale variety.
- Overhead Openness: High-zenith canopy ($R = 15 - 75$) prioritized with light, airy puffs (55% tiny, 33% small, 12% medium) preventing the camera view from being obstructed by gigantic masses.
- Volumetric Shading & Geometry: 60 banks x 16 puffs = 960 lobes in 1 InstancedMesh draw call. Procedural 3D vertex billow deformation, wrapped diffuse, subsurface scatter, and bright sky-blue ambient undersides (`#82b7eb`).
- Celestial Mechanics & 60 FPS Fluidity: Trajectory 0° to 180° with real-time shadowMap updates, zero allocations, demand-mode idle when stationary.
- Verification: All 47 3D test suites (327 tests), 27 engine test suites (353 tests), typecheck, and i18n parity pass 100%.

## Next

1. Verify visual variety live at `http://localhost:3001/simulation`.
2. Commit and rebase/merge to main.

## Files touched

- `apps/web/src/features/microgrid-3d/utils/weather-atmosphere.ts`
- `apps/web/src/features/microgrid-3d/utils/__tests__/weather-atmosphere.test.ts`
- `apps/web/src/features/microgrid-3d/ui/weather-effects.tsx`
- `apps/web/src/features/microgrid-3d/ui/village-canvas.tsx`
- `apps/web/src/features/microgrid-3d/ui/sky-backdrop.tsx`
