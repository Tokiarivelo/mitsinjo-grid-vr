# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Fixed Cottage & School Window Illumination (`house-geometry.ts`, `school-geometry.ts`):
  - Identified root cause of dark windows: solid block trim parts (`TRIM_MAT`) previously sealed the window openings, completely occluding the glass.
  - Replaced solid trim boxes with architectural open casing frames (top header, bottom rail, left/right jambs, projecting sills, and cross muntins).
  - Openings now expose the glass panes across front, attic, side, back, and door panels.
- Enhanced Night Window Incandescent Glow (`village-house.tsx`, `school-building.tsx`, `clinic-building.tsx`):
  - Set `toneMapped={!isLit}` and bumped `emissiveIntensity={1.8 * glow}` so glowing window glass bypasses ACESFilmic clamping and shines brightly into the bloom pass at night.
  - Off/unpowered windows remain dark, reflective glass with AA-clean trim frames.
- Verification: 57 test files / 352 unit tests passing in `src/features/microgrid-3d`; zero TypeScript errors (`tsc --noEmit`).

## Next

- Visual review with user on dev server `http://localhost:3001`.

## Files touched

- `apps/web/src/features/microgrid-3d/utils/house-geometry.ts`
- `apps/web/src/features/microgrid-3d/utils/school-geometry.ts`
- `apps/web/src/features/microgrid-3d/ui/village-house.tsx`
- `apps/web/src/features/microgrid-3d/ui/school-building.tsx`
- `apps/web/src/features/microgrid-3d/ui/clinic-building.tsx`
- `apps/web/src/features/microgrid-3d/utils/__tests__/house-geometry.test.ts`
