# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/vr-village-outdoor-tour (on top of feat/vr-village-360-tour, not merged yet)

## Current state

- VS-T14: without a real headset (desktop or IWER emulator), /village VR is a **walkable 360° tour** of real photos.
  Floor arrows (shoot/click), ↑/W/Z, stick forward; blink fade. Desktop: drag = look, click = shoot.
- VS-T15: **outdoor walk** from the hall window: terrace (solar panels), street of houses, house front, garden,
  tree-lined road, forest, woods (7 real CC0 sites, `public/tour/outdoor/`, 11 MB). Houses/cars/trees = scenery.
- Scan = gnomonic photo of the aimed view; mock ground truth = hand-labelled boxes (`tour-data.ts`) sent as `expected`.
- Real headset keeps the webcam, on a **flat** screen (`ImageSurface`).
- Emulated immersion hides the web page (`data-xr-emulated`); `EmulatedXRExit` keeps « Exit VR » on screen
  (portal on <body>, above IWER's z 999 layer), on /village and /simulation.
- Emulator controls fixed: DevUI installed via `device.installDevUI(DevUI)` (with `new DevUI(device)` IWER never
  mounted the Controller panels / gizmos), single-flight install. `make vr-probe` → 14 PASS.
- Immersive Web Emulator **extension** counts as emulated too (`window.__IWE_XR_DEVICE__`; it fakes a Quest UA),
  so the 360° tour shows instead of the webcam fallback room.

## Next

1. Real Quest: check the flat webcam keeps shots aligned; wrist button offsets.
2. Tour links/boxes are hand-placed; refine doors if arrows feel off. Outdoor sites are different places (no geography).
3. Static text in headset (HUD « Charge / Décharge », « 720p LIVE ») → i18n keys. VS-T9 spatial audio.

## Files touched

- `features/vision-insert/ui/xr/tour/` (`equirect`, `tour-data`, `tour-nav`, `panorama-tour`, `use-panorama-tour`) + tests;
  `webcam-screen`, `xr-blaster-controller`, `village-xr-studio`, `village-xr-viewport` + tests
- `microgrid-3d/ui/emulated-xr-exit.tsx` (new), `utils/dev-xr-emulator.ts`, `hooks/use-webxr.ts`,
  `simulation/ui/village-viewport.tsx`; `lib/vision.ts`, `/api/vision` (`expected`); `app/layout.tsx`, `globals.css`
- `messages/*` (`tourGoTo`, `tourRoom_*`), `scripts/vr-village-probe.mjs`, `public/tour/{studio,outdoor}` + `CREDITS.md`
- Docs: `contracts.md`, `vr-village-spatial-detection.md` (Phase 9), `tasks/VR-village-spatial-shoot.md` (VS-T14/15),
  `vr-immersion-guide.md`, `vr-testing-guide.md`, `performance.md`, `README.md`

## Decisions

- Sphere r 9 m drawn last, no depth write → labels/panels never cut. No mipmaps (u seam).
- Comfort (Meta): teleport with fade, no smooth locomotion; arrive facing away from the door you came through.
- `expected` never overrides Meta answers; perception golden tests time out in the full suite (pre-existing).
