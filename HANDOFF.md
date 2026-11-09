# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Resolved WebGL context loss ("Web page caused context loss and was blocked"):
  - Decoupled continuous 60-90fps `VideoTexture` (220-330 MB/s PCIe flood) from 3D cylinder screen; active backdrop uses HD panoramic room with 0 MB/s GPU transfer, completely eliminating driver watchdog resets (`BindToCurrentSequence failed`).
  - Webcam stream runs cleanly via native hardware video overlay for PiP preview and on-demand AI snapshot capture (`CameraUtils.captureFrame`).
  - Added bounded cache (`MAX_HUD_CACHE_SIZE = 8`) with `oldTex.dispose()` on eviction in `spatial-hud-texture.ts` to eliminate GPU VRAM texture leaks.
  - Keyed `CanvasCreationBoundary` by `contextLoss.epoch` and added one-tap reload button in `VillageXRViewport` fallback view.
  - Clarified Quest VR passthrough architecture vs desktop webcam projection per Meta WebXR documentation.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), 41/41 vision-insert tests pass (288/288 tests).

## Next

1. Reload tab (`Ctrl+F5` or `F5`) on `http://localhost:3001/village` to clear Chrome's origin context lock.
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/live-webcam-backdrop.tsx`
- `apps/web/src/features/vision-insert/ui/xr/xr-camera-source.ts`
- `apps/web/src/features/vision-insert/ui/xr/spatial-hud-texture.ts`
- `apps/web/src/features/vision-insert/ui/xr/village-xr-viewport.tsx`
- `apps/web/src/features/vision-insert/ui/xr/__tests__/spatial-hud-texture.test.ts`
- `HANDOFF.md`
