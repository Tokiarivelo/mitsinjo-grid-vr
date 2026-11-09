# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Complete WebXR immersion on `/village` (Village Studio / In-Air Detection & Shoot):
  - Fixed WebXR camera stream & backdrop visual:
    - Replaced 2D canvas bridge with zero-copy `THREE.VideoTexture` to eliminate 111 MB/s PCIe bus flooding.
    - Guaranteed zero-black-screen via instant HD sample room texture (`/samples/vision-room.jpg`) preloaded from frame 0.
    - Fixed Chromium video throttling by styling camera preview element with 0.85 opacity (exceeding 0.05 power-saver threshold).
  - Fixed IWER emulator crash loop (`TypeError: Cannot read properties of null (reading '0')` at `iwe.min.js:onDeviceFrame`):
    - Added `installWebGLContextSafetyPolyfill()` to return safe fallback clear vectors on lost context.
    - Wired `useContextLoss` to `VillageXRViewport` with epoch canvas remounting.
  - MultiPointer & in-air targeting: tracks controllers 0 & 1, desktop pointer, `<SpatialAirButton />`, and telemetry HUD.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), 41/41 vision-insert tests pass, 60/60 microgrid-3d tests pass.

## Next

1. Test live at `http://localhost:3001/village` with Meta IWER DevUI emulator.
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/live-webcam-backdrop.tsx`
- `apps/web/src/features/vision-insert/ui/xr/xr-camera-source.ts`
- `apps/web/src/features/vision-insert/ui/xr/village-xr-viewport.tsx`
- `apps/web/src/features/vision-insert/ui/xr/__tests__/village-xr-viewport.test.tsx`
- `apps/web/src/features/microgrid-3d/utils/webgl.ts`
- `apps/web/src/features/microgrid-3d/index.tsx`
- `HANDOFF.md`
