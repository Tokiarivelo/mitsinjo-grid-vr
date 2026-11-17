# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-17 · **By:** Claude Code · **Branch:** `feat/vs-t49-lab-to-village-xr` (from `main` 67853d1d). Task: VS-T49 in `docs/tasks/VR-village-spatial-shoot.md`.

## Context

Meta VR Start Devpost closes **2026-11-18 12:00 PT** (23:00 Madagascar). Hands-first required, video < 3 min (Quest or emulator, YouTube/Vimeo public), launch date in the text, track Productivity, division New Experience, app free until ~Dec 11, no edits after the deadline.

## NEXT

1. Report to the user on the other Devpost points: IWSDK (rules list IWSDK link or engine APK; R3F WebXR sits between → ship Vercel link **and** a bubblewrap PWA APK, skill `hz-store-pwa`), Vercel auto-deploy freeze after submission, tour photos (identifiable people?), CC BY-SA photo / music out of the new video, 60 fps unmeasured (no headset).
2. Screen check V524–V528 (village), headset later.

## Done this session (VS-T49)

- Lab ↔ simulation village in ONE XR session on /village: `xr-world-switch.ts` (store `useXrWorld`, cover / reveal), shell `xr-world-transition.tsx`, `village-xr-world.tsx`.
- `VillageWorld` extracted from `microgrid-3d/ui/village-canvas.tsx` (VillageCanvas wraps it); `useSceneModelFor` / `useStoreSceneModel` shared with /simulation.
- « Back to the lab » `sim-xr-back-to-lab.tsx`: low left at minimap height, in the lazy-follow dead zone (< 34°), hide / show chip.
- Lab suspended, not unmounted: state kept; inputs (blaster, driver, legends, pad, wrist menu) unmounted; walk / tour loops gated (`labSuspended`); village pointers skip it (`traverseLive`, `userData.xrSuspended`).
- `CameraController` gives the camera back when unmounted mid-session.
- `make vr-world-probe` 24/24; `make vr-hands-probe` 22/22; checked live through the IWER MCP (left controller on 5 buttons, round trip keeps the fridge placed).

## Decisions

- No cross-page immersive navigation (Meta docs): one canvas swaps worlds. Off-headset, « Go to the simulation » still opens /simulation.
- Village in /village forced to `quality="low"` (Quest budget: no shadows / post FX).
- A HUD item beside the view must stay inside `FOLLOW_ANGLE` or looking at it re-centres it away (the 38.7° first placement did).

## Open

- One left-controller press on « Valider et construire la 3D » did nothing right as the button turned active; not reproduced (left worked on 5 other buttons).
- `make check`: engine autonomy timing and perception time-budget tests flake under heavy load (pass alone).
