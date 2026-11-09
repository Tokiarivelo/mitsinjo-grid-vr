# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Complete WebXR immersion on `/village` (Village Studio / In-Air Detection & Shoot):
  - Fixed WebGL context failure on dual-GPU / NVIDIA Optimus (`BindToCurrentSequence failed`):
    - Removed forced `powerPreference: 'high-performance'` in `VillageXRViewport` & `VillageCanvas`, using safe `powerPreference: 'default'` with `failIfMajorPerformanceCaveat: false`.
    - Plumbed fallback renderer factory in `<Canvas gl={(defaults) => ...}>` that handles driver constraints gracefully.
    - Added `CanvasCreationBoundary` fallback and `useWebGLAvailable()` guard in `VillageXRViewport` with clear notice and exit button.
  - MultiPointer & in-air targeting: tracks controllers 0 & 1 with blaster rays, desktop pointer forwarding, aimable `<SpatialAirButton />`, and holographic telemetry HUD.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), 41/41 vision-insert tests pass, 60/60 microgrid-3d tests pass.

## Next

1. Test live at `http://localhost:3001/village` with Meta IWER DevUI emulator.
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/village-xr-viewport.tsx`
- `apps/web/src/features/vision-insert/ui/village-editor-page.tsx`
- `apps/web/src/features/microgrid-3d/ui/canvas-creation-boundary.tsx`
- `apps/web/src/features/microgrid-3d/ui/village-canvas.tsx`
- `apps/web/src/features/vision-insert/ui/xr/__tests__/village-xr-viewport.test.tsx`
- `apps/web/src/messages/{en,fr,mg}.json`
- `HANDOFF.md`
