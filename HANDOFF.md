# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Complete WebXR immersion on `/village` (Village Studio / In-Air Detection & Shoot):
  - Fixed VR Exit loop: added `isStartingRef` concurrency lock in `useWebXR`, removed duplicate `xr.enter()` calls so exiting via DevUI exit door `[->]` or HUD cleanly unmounts without re-entering.
  - Meta IWSDK Chapter 13 camera access: `XRCameraSource` and `CameraUtils` with `CameraFacing.Unknown` (desktop & headset support).
  - Fixed black screen: preloaded `/samples/vision-room.jpg` baseline renders immediately; video element placed within viewport so Chrome Linux hardware decoder never pauses; seamless transition to live stream only when real frames decode.
  - Eliminated crashes: throttled WebGL texture updates to video frame changes (~30fps) via `source.updateTexture()`, preventing GPU bus saturation and context loss.
  - Full-height immersive wrap: 8.5m high panoramic cylinder (270° arc, unmirrored interior scale) and 360° studio dome covering entire visual field of view.
  - MultiPointer & in-air targeting: tracks controllers 0 & 1 with blaster rays, desktop pointer forwarding, aimable `<SpatialAirButton />`, and holographic telemetry HUD.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), 21/21 XR tests pass, 27/27 engine test suites pass (353 tests).

## Next

1. Test live at `http://localhost:3001/village` with Meta IWER DevUI emulator.
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/*` (`xr-camera-source.ts`, `live-webcam-backdrop.tsx`, `village-xr-viewport.tsx`)
- `apps/web/src/features/microgrid-3d/hooks/use-webxr.ts`
- `apps/web/src/features/vision-insert/ui/village-editor-page.tsx`
- `HANDOFF.md`
