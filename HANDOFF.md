# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/vr-village-wrist-menu (stacked on feat/vr-village-mini-turntable, not merged yet)

## Current state

- /village VR verified in the IWER emulator (Quest 3) with a fake webcam (sample room): controllers, hands, mouse.
- VS-T11: shoot an object **in the webcam video** → it turns into 3D; VS-T12: it flies to a spinning 22 cm
  miniature in reach (hold select = rotate, tap = connect).
- New (VS-T13): **wrist menu**. No floating panel on entry. Small "Menu" button on the left wrist (`wrist` joint /
  left grip / bottom-left of view as fallback). Other hand's fingertip, laser, pinch or mouse toggles the menu
  (scan button, guide, HUD), spawned in world space 0.9 m ahead, 0.32 m below the eyes, lazy-following the viewer
  (`wrist-menu.ts`). Scan button dead while closed; wrist button pulses on new events while closed.
- `XRBlasterController` stays the only input source (`menu` prop = shared mutable `WristMenu`).
- `make vr-probe` → 8 PASS (menu closed on entry, opens/closes from the wrist without scanning, shoot flow).
- Dev only: `window.__IWER_DEVICE__` (IWER remote) and `window.__VR_WRIST_MENU__` (probe aims at the wrist button).

## Next

1. Real Quest: check wrist button offset on hands/controllers (`WRIST_OFFSET_*`) and menu height/distance.
2. Optional: Meta palm-up pinch gesture (non-dominant hand) as a second way to open the menu.
3. Static text in headset (HUD « Charge / Décharge », webcam pill « 720p LIVE », air-button badges) → i18n keys.
4. VS-T9 spatial audio; foveation / frame-rate settings in `xr-session.ts`.

## Files touched

- `apps/web/src/features/vision-insert/ui/xr/`: `wrist-menu.ts`, `wrist-menu-texture.ts`, `xr-wrist-menu.tsx` (new),
  `xr-blaster-controller.tsx`, `village-xr-studio.tsx`, `xr-layout.ts`, `spatial-air-button.tsx`,
  `village-spatial-hud.tsx`, `village-xr-viewport.tsx` + tests (`wrist-menu`, `xr-wrist-menu` new)
- `messages/{en,fr,mg}.json` (`vrWristMenuOpen/Close`, `vrInteractionHelpWrist`), `scripts/vr-village-probe.mjs`, `Makefile`
- Docs: `vr-village-spatial-detection.md`, `tasks/VR-village-spatial-shoot.md` (VS-T13)

## Decisions

- Meta hands UI guidance: spawn the menu _from_ the wrist, never anchor it to the wrist; ray UI ≥ 0.8 m → 0.9 m.
- Lazy follow (re-centre after ~35° turn or 35 cm move, eased) instead of head-locked: no jitter, follows the person.
- Menu content is unmounted when closed (three's raycaster ignores `visible`, the HUD would still catch shots).
