# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- In immersion mode (WebXR VR session, Fullscreen, or camera preset "Immersion"):
  - Interactive in-air holographic beacon (`AirOptionBeacon` at `[0, 3.6, 9.5]`) suspended in front of the viewer.
  - Clicking beacon or WebXR controller trigger toggles 3D tagged labels of all 11 village types.
  - 11 village types: 6 sectors (Households, School, Water, Market, Clinic, Workshop) + 5 infrastructure/landmarks (Solar Array, BESS Battery, EMS Dispatch Hub, Wind Turbines, Lake Promenade).
  - Each tag renders vertical laser stalk, base anchor dot and glow ring, and facing billboard card with category pill, title, and live metrics.
  - WebXR controller raycast click support in `xr-hands.ts`.
  - In-scene 2D DOM HTML overlays cleanly suppressed in immersion mode (`htmlPortal === null`).
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - Verification: 60 test files / 361 tests passing in `src/features/microgrid-3d`; 14 test files / 76 tests passing in `src/features/simulation`; zero TypeScript errors (`tsc --noEmit`).

## Next

- Ready for user testing and visual review on dev server `http://localhost:3001`.

## Files touched

- `apps/web/src/features/microgrid-3d/ui/immersion-labels.tsx`
- `apps/web/src/features/microgrid-3d/utils/immersion-labels-texture.ts`
- `apps/web/src/features/microgrid-3d/ui/village-canvas.tsx`
- `apps/web/src/features/microgrid-3d/ui/camera-controller.tsx`
- `apps/web/src/features/simulation/ui/village-viewport.tsx`
- `apps/web/src/features/microgrid-3d/utils/xr-hands.ts`
- `apps/web/src/messages/{en,fr,mg}.json`
