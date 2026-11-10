# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/vr-village-360-tour (on top of feat/vr-village-wrist-menu, not merged yet)

## Current state

- VS-T14 done: without a real headset (desktop, or IWER emulator `isDevXREmulated()`), /village VR is a **walkable
  360° tour** of 6 real rooms (4K CC0 equirect photos, `public/tour/`). Floor arrows (shoot/click), ↑/W/Z, stick
  forward = walk to the arrow nearest the gaze; blink fade between rooms. Desktop: drag = look, click = shoot.
- Scan in the tour = gnomonic photo of the aimed view (`renderView`); a shot at the photo before any scan scans there.
  Mock ground truth: hand-labelled boxes (`tour-data.ts`) sent as `expected` to `/api/vision` (mock answers only).
- Real headset keeps the webcam, now a **flat** screen (`ImageSurface`, ray-plane hit) — no more cylinder look.
- Emulated immersion hides the web page (`data-xr-emulated` on `<html>`, `[data-app-root]` hidden but the canvas).
- `make vr-probe` → 11 PASS (wrist menu, loft fridge scan + miniature, hand pinch, arrow → hall, ↑ → lounge);
  screenshots confirm "MARRY" reads correctly (orientation OK).

## Next

1. Real Quest: check the flat webcam keeps shots aligned; wrist button offsets.
2. Tour links/boxes are approximate (hand-placed); refine doors if arrows feel off.
3. Static text in headset (HUD « Charge / Décharge », « 720p LIVE ») → i18n keys. VS-T9 spatial audio.

## Files touched

- `features/vision-insert/ui/xr/tour/` (new: `equirect`, `tour-data`, `tour-nav`, `panorama-tour`, `use-panorama-tour`)
  - tests; `webcam-screen`, `live-webcam-backdrop`, `spatial-projection`, `xr-blaster-controller`,
    `village-xr-studio`, `village-xr-viewport`, `wrist-menu-texture`, `xr-wrist-menu` + tests
- `lib/vision.ts`, `server/perception/vision-pipeline.ts`, `app/api/vision/route.ts`, `utils/expected-detections.ts`,
  `hooks/use-vision-detection.ts`; `microgrid-3d/utils/dev-xr-emulator.ts`, `hooks/use-webxr.ts`; `app/layout.tsx`, `globals.css`
- `messages/*` (`tourGoTo`, `tourRoom_*`), `scripts/vr-village-probe.mjs`, `public/tour/`
- Docs: `contracts.md`, `vr-village-spatial-detection.md` (Phase 9), `tasks/VR-village-spatial-shoot.md` (VS-T14),
  `vr-immersion-guide.md`, `vr-testing-guide.md`, `performance.md`, `README.md`

## Decisions

- Sphere r 9 m drawn last, no depth write → labels/panels never cut. No mipmaps (u seam).
- Comfort (Meta): teleport with fade, no smooth locomotion; arrive facing away from the door you came through.
- `expected` never overrides Meta answers; perception golden tests still time out in the full suite (pass alone, pre-existing).
