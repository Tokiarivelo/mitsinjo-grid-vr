# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-07 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Trajectory: Sun starts from side (+X: East, 06:00), climbs overhead above camera (+Y, +Z: 12:00), descends behind camera (+Z: South, 18:00).
- Shadow physics: Key directional light strictly unified with sun/moon direction vector. Morning shadows stretch west (-X), noon shadows fall directly under objects, evening shadows stretch into the village (-Z).
- 60 FPS fluidity: `useFrame` exponential glide glides celestial bodies & shadows without hourly jumps; zero allocations, zero setState in loop; rests in demand mode when stationary.
- Fluffy cumulus clouds (Image 2 parity): 48 banks with 14 organic lobes each; smooth 28x20 spheres with zero polygonal facets; radiant white crests with soft sky-blue ambient undersides (`#82b7eb`), atmospheric Half-Lambert wrap & Mie rim glow (1 InstancedMesh draw call).
- Vibrant midday sky: `MIDDAY` key in `skyPalette` provides rich azure/cyan blue sky with crisp sunlight.
- All 47 3D test files (327 tests), engine tests, typecheck, and i18n parity pass 100%.

## Next

1. Verify live visual experience at `http://localhost:3001/simulation`.
2. Commit and rebase/merge to main.

## Files touched

- Add: `microgrid-3d/utils/celestial.ts`, `microgrid-3d/utils/__tests__/celestial.test.ts`.
- Edit: `microgrid-3d/ui/sky-backdrop.tsx`, `microgrid-3d/ui/village-canvas.tsx`, `microgrid-3d/ui/weather-effects.tsx`, `microgrid-3d/utils/sky-palette.ts`, `microgrid-3d/utils/weather-atmosphere.ts`.

## Decisions

- Single unified direction vector across sun disc, moon disc, key directional light, and shader uniforms.
- Single InstancedMesh for clouds maintains 1 draw call budget while scaling to 48 banks x 14 lobes = 672 smooth puffs.
