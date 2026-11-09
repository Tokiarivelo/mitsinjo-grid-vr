# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Claude Code · **Branch:** fix/vr-village-xr-shoot-verify

## Current state

- /village VR verified in the IWER emulator (Quest 3) with a fake webcam (sample room): controllers, hands, mouse.
- New (VS-T11): shoot an object **in the webcam video** → it turns into 3D. Before any scan, the shot starts the scan
  and resolves to the object under the shot once detections arrive. 2nd shot connects it to the microgrid.
- `webcam-screen.ts` = single geometry for the curved video screen (bottom edge on the floor); targets are laid on
  their object in the video, models pop out along the line of sight (1.6 m, ≤ 0.9 m).
- `XRBlasterController` is the only input source: `selectstart` only; hands use the system ray + native pinch;
  R3F `onClick` removed from air button, targets and HUD (each click fired twice before).
- Panels moved below eye level at ~1 m (`xr-layout.ts`); hands = cyan spheres, `updateHandMesh` shared with /simulation.
- `make vr-probe` (scripted emulator check, 4 PASS) and `make dev-stop` (kills turbo/pnpm/next group; next-server alone respawns).
- Dev only: `window.__IWER_DEVICE__` exposes IWER's remote API (same as the IWER MCP, which failed: port 8723 busy).

## Next

1. Real Quest: check comfort of panel heights and spawn size; tune `xr-layout.ts` / `spawnDistance`.
2. Pre-existing static text in headset: HUD battery state (« Charge / Décharge / Équilibré ») and webcam pill
   (« 720p LIVE », « STARTING CAMERA… ») → i18n keys.
3. VS-T9 spatial audio; foveation / frame-rate settings in `xr-session.ts` (see `/vr-immersion` skill).

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/`: `webcam-screen.ts` (new), `xr-layout.ts` (new), `spatial-projection.ts`,
  `xr-blaster-controller.tsx`, `village-xr-studio.tsx`, `live-webcam-backdrop.tsx`, `holo-detection-target.tsx`,
  `spatial-air-button.tsx`, `village-spatial-hud.tsx`, `spawned-object-3d.tsx` + tests (`webcam-screen`, `village-xr-studio` new)
- `apps/web/src/features/microgrid-3d/utils/xr-hands.ts`, `dev-xr-emulator.ts` (+ test)
- `apps/web/src/messages/{en,fr,mg}.json` (`vrHudEventMaterialized`, `vrHudEventNoObject`)
- `apps/web/scripts/vr-village-probe.mjs`, `scripts/dev-stop.sh`, `Makefile`, `README.md`
- Docs: `vr-village-spatial-detection.md`, `vr-testing-guide.md`, `performance.md`, `tasks/VR-village-spatial-shoot.md`,
  `.claude/skills/vr-immersion/SKILL.md`

## Decisions

- Targets follow the video, not a free arc: what you aim at in the image is what you hit.
- No `ContactShadows` on spawned models in XR (extra render target breaks FFR/MSAA, Meta guidance).
