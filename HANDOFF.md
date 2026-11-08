# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- WebXR immersion implemented on `/village` (Village Studio):
  - VR button in header launches `immersive-vr` session (auto-emulated with Meta IWER 2.8.0 on desktop).
  - In-air interactive 3D beacon `<SpatialAirButton />` floating at `[0, 1.45, -1.2]` with live scanning radar.
  - Spatial projection algorithm `spatial-projection.ts` converts 2D normalized detection boxes into an ergonomic 3D arc array.
  - Holographic target boxes `<HoloDetectionTarget />` with lock-on glow, billboard labels, and hit detection.
  - Controller blaster raycast `<XRBlasterController />` with laser beam, projectile flash, and impact shockwaves.
  - Procedural 3D model spawn in-situ `<SpawnedObject3D />` with spring scale extrusion and PBR materials (`recipeMesh`).
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), all unit and integration tests passing (`spatial-projection`, `spatial-air-button`, `holo-detection-target`, `village-xr-viewport`, `village-editor-page`).

## Next

1. Run `make dev-mock` and test live at `http://localhost:3000/village` with IWER emulator (Play Mode).
2. Review scenarios V196–V200 in `test-scenarios/06-village.md`.

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/*`
- `apps/web/src/features/vision-insert/ui/village-editor-page.tsx`
- `apps/web/src/features/vision-insert/__tests__/village-editor-page.test.tsx`
- `apps/web/src/messages/{en,fr,mg}.json`
- `docs/tasks/VR-village-spatial-shoot.md`
- `test-scenarios/06-village.md`
