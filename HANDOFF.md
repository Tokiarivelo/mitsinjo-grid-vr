# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-08 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Complete WebXR immersion on `/village` (Village Studio / In-Air Detection & Shoot):
  - In-air interactive 3D beacon `<SpatialAirButton />` triggering real-time vision scan.
  - Holographic target boxes `<HoloDetectionTarget />` with lock-on glow and billboard labels.
  - Blaster raycast `<XRBlasterController />` shooting projectiles and triggering procedural 3D spawn `<SpawnedObject3D />`.
  - In-air grid connect & disconnect (`VS-T7`): shooting materialized 3D models links/unlinks them to `@mitsinjo/engine` microgrid and `usePlacedModelsStore` with `<PowerConnectionBeam />`.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), all unit and integration tests passing (XR suites + `village-editor-page` + engine).

## Next

1. Run `make dev-mock` and test live at `http://localhost:3000/village` with IWER emulator (Play Mode).
2. Review scenarios V196–V201 in `test-scenarios/06-village.md`.

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/*`
- `apps/web/src/features/vision-insert/ui/village-editor-page.tsx`
- `apps/web/src/messages/{en,fr,mg}.json`
- `docs/tasks/VR-village-spatial-shoot.md` & `docs/tasks/README.md`
- `test-scenarios/06-village.md`
