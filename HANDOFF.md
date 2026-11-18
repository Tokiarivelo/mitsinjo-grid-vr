# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-18 · **By:** Claude Code · **Branch:** `feat/iwsdk-integration` (from `main` 16c129b5, PR #44 merged). Task file: `docs/tasks/VR-iwsdk-integration.md`.

## NEXT (do in this order)

1. **IW-T1 verify**: dev server on :3001 (`make dev-mock` if down). In Chromium, reload the `/village` tab and accept IWE, then IWER MCP: `xr_get_session_status` → `xr_accept_session` → `browser_screenshot` in controller mode and in hand mode (`xr_set_input_mode`). Check IWSDK hands and controllers show, **no second IWSDK laser / cursor**, one select per press. Also run `make vr-probe` (result of the last run below, if any).
2. Same check on `/simulation` (scaled rig, VS-T33): hands at the right size.
3. Commit IW-T1 (`feat(vr): IWSDK hands and controllers (IW-T1)`), push, PR, merge when green.
4. **IW-T2**: `@iwsdk/locomotor` (slide + arc teleport) replacing `studio-walk.tsx` / tour steps — plan in the task file.
5. Then IW-T3 (pointers, evaluate only) and the « Fin » items of the task file (skill rule, architecture doc, scenarios).
6. Older items: screen check V533–V545 / T42 on Vercel; `make gen-evals` needs `jiti`.

## Done (uncommitted on the branch, typecheck clean, tests green)

- Deps `@iwsdk/xr-input` 1.1.0, `@iwsdk/locomotor` 1.1.0, `three-mesh-bvh` 0.9.1 (`apps/web/package.json`, lockfile).
- `microgrid-3d/utils/iwsdk-input.ts` (runtime per renderer, pointers off, tick once per XRFrame, rig parent stack) + shim `iwsdk-xr-input.{js,d.ts}` (IWSDK typings pull `@pmndrs/pointer-events`, which breaks three's `Object3D` types).
- `xr-input-models.ts` rewritten on IWSDK (`attachInputModels(gl, i, slots, { scene, camera, parent? })` → `tick/handLoaded/gripLoaded/dispose`); callers `xr-hands.ts` and `xr-blaster-controller.tsx` tick it each frame. Removed `three-xr-factories.*`, the custom hand skin and their tests; new `xr-input-models.test.ts`.

## Decisions

- Progressive IWSDK (user choice): standalone packages inside R3F, no IWSDK `World`. Our `readControls` stays (pure, tested): `StatefulGamepad` adds nothing.
- IWSDK hand look (Quest outline) replaces our skin + rim.
- The `vr-immersion` skill still says « no IWSDK migration »: update it (task file, « Fin »).

## Checks

- tsc clean; XR tests 243/243 (`microgrid-3d/utils`, `vision-insert/ui/xr`).
- `make vr-probe` (2026-11-18, IWSDK code live on :3001): 13 PASS (menu, tour, scan, « Extract to 3D? », studio, 2D slides), then `page.screenshot: Timeout 30000ms` at `scripts/vr-village-probe.mjs:282` (2D views step) — the controllers + hands checks after it never ran. Rerun alone; if it times out again, check whether IWSDK slows the frame (GPU) before blaming the probe.
- IWER MCP check (2026-11-18): controller mode OK — IWSDK Touch Plus models, **no second IWSDK laser/cursor**. Hand mode in the user's tab showed only the joint spheres, but a fresh headless page (`scratchpad hand-diag`, same IWER) gives `__VR_CONTROLS__.hands()` = real true / spheres false for both hands, `generic-hand/{left,right}.glb` 200 → stale HMR tab suspected: redo the hand screenshot after a full reload.
- IWER MCP earlier: once connected it saw the session (Quest 3, `immersive-vr`, `hand-tracking` on), then dropped (« Connection closed »). Reconnect with `/mcp`; if `EADDRINUSE 127.0.0.1:8723`, another bridge holds the port (`make iwer-bridge-stop`, ask first).
