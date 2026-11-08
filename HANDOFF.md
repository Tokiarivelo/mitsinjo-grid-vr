# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Village Sectors Spaced Out (`site-positions.ts`, `landscape.ts`):
  - Spaced out all sectors (households at `[-9, 0, 11]`, market at `[7, 0, 10]`, school at `[2.5, 0, -13]`, clinic at `[12.5, 0, -0.5]`, water at `[-10.5, 0, 0.5]`, industry at `[15.5, 0, -11.5]`, solar at `[-14, 0, -11.5]`).
  - Expanded flat terrain plateau `FLAT_RADIUS` to 25 and `HILL_RADIUS` to 52; rerouted access paths.
- School Roof & Doors Fixed (`school-geometry.ts`):
  - Wing roofs now perched on top of 2nd floor walls (`y = 2.45m` to ridge `3.10m`), completely clear of 2nd floor windows and outer crow-stepped parapets.
  - Entrance porch canopy stops flush with exterior front wall (`z = 1.46m`), removing interior penetration.
  - Staged central and wing red entrance doors proud of yellow walls with wood surrounds, eliminating door z-fighting/flicker.
- Night/Dusk Dynamic Lighting Across All Sectors (`buildings.tsx`, `village-house.tsx`, `school-building.tsx`, `clinic-building.tsx`, `building-bodies.tsx`):
  - Converted cottage and eco-pavilion windows from thin 2D planes to solid 3D glass boxes (`house-geometry.ts`).
  - Lighting triggers only when darkness sets in (`lampGlow > 0.45`, dusk/twilight to night); 0 in broad daylight.
  - Powered sectors (`servedKw > 0.05` and not unserved) glow with soft warm incandescent light and gentle doorstep illumination.
  - Unpowered sectors (cut, délesté, unserved, on fire) remain completely dark.
- Verification: 57 test files / 352 unit tests passing; zero TypeScript errors (`tsc --noEmit`).

## Next

- Visual review with user on dev server `http://localhost:3001`.

## Files touched

- `apps/web/src/features/microgrid-3d/utils/site-positions.ts`
- `apps/web/src/features/microgrid-3d/utils/landscape.ts`
- `apps/web/src/features/microgrid-3d/utils/school-geometry.ts`
- `apps/web/src/features/microgrid-3d/utils/house-geometry.ts`
- `apps/web/src/features/microgrid-3d/ui/buildings.tsx`
- `apps/web/src/features/microgrid-3d/ui/village-house.tsx`
- `apps/web/src/features/microgrid-3d/ui/school-building.tsx`
- `apps/web/src/features/microgrid-3d/ui/clinic-building.tsx`
- `apps/web/src/features/microgrid-3d/ui/building-bodies.tsx`
