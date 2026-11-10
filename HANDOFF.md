# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/vr-village-outdoor-tour (on top of feat/vr-village-360-tour, not merged yet)

## Current state

- VS-T14: without a real headset (desktop or IWER emulator), /village VR is a **walkable 360° tour** of real photos.
  VS-T16: **real walking**: grounded photo (floor + wall in the shader, parallax); hold ↑/W/Z/S/A/Q/D or stick,
  walk onto a floor arrow (or shoot it) → cross-fade walk-through. Desktop: drag = look, click = shoot.
- VS-T15: **outdoor walk** from the hall window: terrace (solar panels), street of houses, house front, garden,
  tree-lined road, forest, woods (7 real CC0 sites, `public/tour/outdoor/`, 11 MB). Houses/cars/trees = scenery.
- Scan = gnomonic photo of the aimed view; mock ground truth = hand-labelled boxes (`tour-data.ts`) sent as `expected`.
- Real headset keeps the webcam, on a **flat** screen (`ImageSurface`).
- Emulated immersion hides the page (`data-xr-emulated`); `EmulatedXRExit` keeps « Exit VR » on screen (portal).
- DevUI via `device.installDevUI(DevUI)` (single-flight). The IWE browser extension counts as emulated too
  (`window.__IWE_XR_DEVICE__`; it fakes a Quest UA). `make vr-probe` → 15 PASS.

## Next

1. Real Quest: check the flat webcam keeps shots aligned; wrist button offsets.
2. Tour links/boxes are hand-placed; refine doors if arrows feel off. Outdoor sites are different places (no geography).
3. Static text in headset (HUD « Charge / Décharge », « 720p LIVE ») → i18n keys. VS-T9 spatial audio.

## Files touched

- `features/vision-insert/ui/xr/tour/` (`panorama-tour` walking shader, `tour-nav` walk helpers, `equirect`, `tour-data`, `tour-nav`, `panorama-tour`, `use-panorama-tour`) + tests;
  `webcam-screen`, `xr-blaster-controller`, `village-xr-studio`, `village-xr-viewport` + tests
- `microgrid-3d/ui/emulated-xr-exit.tsx` (new), `utils/dev-xr-emulator.ts`, `hooks/use-webxr.ts`,
  `simulation/ui/village-viewport.tsx`; `lib/vision.ts`, `/api/vision` (`expected`); `app/layout.tsx`, `globals.css`
- `messages/*` (`tourGoTo`, `tourRoom_*`), `scripts/vr-village-probe.mjs`, `public/tour/{studio,outdoor}` + `CREDITS.md`
- Docs: `contracts.md`, `vr-village-spatial-detection.md` (Phase 9), `tasks/VR-village-spatial-shoot.md` (VS-T14/15),
  `vr-immersion-guide.md`, `vr-testing-guide.md`, `performance.md`, `README.md`

## Decisions

- Sphere r 9 m drawn last, no depth write → labels/panels never cut. No mipmaps (u seam).
- Smooth walking asked for by the user (not teleport): constant speed, vignette, no head bob in a real headset;
  arrive facing away from the door. Scan boxes stay where the scan put them while you walk.
- `expected` never overrides Meta answers; perception golden tests time out in the full suite (pre-existing).
