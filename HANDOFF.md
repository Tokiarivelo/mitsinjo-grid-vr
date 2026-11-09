# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Resolved in-air button clickability and mouse raycasting in WebXR/DevUI emulator on `/village`:
  - Removed `gl.xr.isPresenting` block on `pointerdown`/`pointermove` in `XRBlasterController`: mouse aiming & clicking now works directly on desktop even when WebXR emulator is active.
  - Increased `AIR_BUTTON_RADIUS` to 0.55m and added dual `userData.onSelect`/`onClick` handlers on `SpatialAirButton`.
  - Mutually excluded controller grip models when Hand Tracking is active or when not presenting in VR.
  - Documented Meta IWER DevUI controller activation (`Alt`/`Shift`) and Linux GNOME OS shortcut conflict resolution.
- 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
- 0 TypeScript errors (`tsc --noEmit`), 42/42 vision-insert tests pass (289/289 tests).

## Next

1. Hard-refresh browser (`Ctrl+F5`) on `http://localhost:3001/village` and directly click "Scanner la pièce et détecter".
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/xr-blaster-controller.tsx`
- `apps/web/src/features/vision-insert/ui/xr/spatial-air-button.tsx`
- `docs/vr-immersion-guide.md`
- `docs/vr-village-spatial-detection.md`
- `HANDOFF.md`
