# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-17 · **By:** Claude Code · **Branch:** `fix/vs-t48-studio-pad-ids` (from `main` 18ab8823, PR #36 merged). Task: VS-T48 in `docs/tasks/VR-village-spatial-shoot.md`.

## Context

Meta VR Start Devpost closes **2026-11-18 12:00 PT** (23:00 Madagascar). Rules read from the Devpost page: hands-first required, video < 3 min on Quest or emulator (YouTube/Vimeo public), text with target launch date, track (Productivity) + division (New Experience, first commit 2026-10-26), app free until ~Dec 11, no edits after the deadline.

## NEXT

1. Transition lab ↔ village **in the same XR session** (user ask): extract `VillageWorld` from `microgrid-3d/ui/village-canvas.tsx`, mount it in the /village session, `lab-dissolve` style hand-over both ways, « Back to the lab » button. Today `holo-village-table.tsx` `goSimulation` ends the session and `router.push`es (Meta docs: no cross-page immersive navigation).
2. Report to the user on the other Devpost points: IWSDK (rules list IWSDK link or engine APK; R3F WebXR sits between → ship Vercel link **and** a bubblewrap PWA APK, skill `hz-store-pwa`), Vercel auto-deploy freeze after submission, tour photos (identifiable people?), CC BY-SA photo / music out of the new video, 60 fps unmeasured (no headset).
3. Screen check V521 / S164–S165, headset later.

## Done this session (VS-T48)

- Hands-first nav pad: `xr-nav-pad.ts` (buttons, queue, layout), `xr-nav-pad-3d.tsx` (studio, tour), `microgrid-3d/ui/sim-xr-nav-pad.tsx` (simulation); `XrControlsDriver` drains the queue → same actions as the sticks.
- `HoloButton` `iconOnly` (studio), `icon` (simulation); icons up / down / turnLeft / turnRight / help; hand legend « legendPad ».
- `make vr-hands-probe`: IWER hand mode only, /simulation + /village, 20/20.
- Fix: studio pad ids carry `holo:` (`navPadPanelId`), like every studio panel.

## Decisions

- Hands = pinch only (Meta « WebXR Hands »): no reliance on thumb microgestures.
- Pad shown only while hands are tracked and no controller is used (user choice; `useHandsOnly`). IWER and the `__VR_*__` probes never load on a real Quest.
- Pad ≈ 20° under the view, centred, between Menu and the studio door; hidden with menu / modal / lab (studio) and with a panel or the big map (simulation).
- PR #36 merged without waiting for CI, at the user's request.

## Open

- `make check`: `recon` / golden-shape / region-colors time-budget tests flake under full-suite load (pass alone).
