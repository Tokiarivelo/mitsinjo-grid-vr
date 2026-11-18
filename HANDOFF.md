# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-18 · **By:** Claude Code · **Branch:** `feat/iwsdk-integration` (from `main` 16c129b5, PR #44 merged), all committed + pushed, no PR yet. Task file: `docs/tasks/VR-iwsdk-integration.md`.

## NEXT (do in this order)

1. **IW-T2 arc not drawn**: in the studio, `aiming` turns true but `xr-teleport-arc` / `-target` stay hidden (probe check fails); the release move likely comes from the fallback step (`studio-walk.tsx` `studioWalkFrame`: `rightRay` → null?). Debug `rightRay` (frame.getPose of the right `targetRaySpace`) in the emulator, then make the probe check pass.
2. Headless studio runs ~1 frame/s (SwiftShader): `make vr-probe` screenshot `3c` times out, also without IWSDK (A/B done). Make the probe skip/lower that shot or the studio cheaper in headless.
3. `/simulation`: check the `make vr-sim-probe` result (`scratchpad/sim.log` run at 22:50) and hands size in VR.
4. Older: screen check V533–V545 / T42 on Vercel; `make gen-evals` needs `jiti`.

## Done (IW-T1, on the branch)

- Deps `@iwsdk/xr-input` 1.1.0, `@iwsdk/locomotor` 1.1.0, `three-mesh-bvh` 0.9.1.
- `microgrid-3d/utils/iwsdk-input.ts`: runtime per renderer, IWSDK pointers off, tick once per XRFrame, rig parent stack, `IWSDK_HAND_OUTLINE` (cyan, 3 mm). Shim `iwsdk-xr-input.{js,d.ts}` (IWSDK typings break three's `Object3D`).
- `xr-input-models.ts` on IWSDK; hand side read from three's `connected` event (IWE extension keeps controllers listed in hand mode); both real hands loaded → stand-ins hidden.
- IW-T2: `studio-locomotion.ts` (IWSDK Locomotor, sync, floor disc), `studio-walk.tsx` slide/steps/teleport, `aim` control (`aimAsStep` for tour and /simulation), legend copy. IW-T3 skipped (double select risk).
- Fix `useImmersionQuery`: dev StrictMode stripped `?immersion=vr` on reload (test added).

## Decisions

- Progressive IWSDK (user choice): standalone packages inside R3F, no IWSDK `World`.
- IWSDK default hand = 1.2 mm white outline, invisible on the white /village room → our cyan, 3 mm.

## Checks

- tsc clean; `xr-input-models` 7/7, `use-immersion-query` 6/6.
- Controllers (IWER MCP, user's Chromium + IWE extension): IWSDK Touch Plus models, no second laser.
- Hands (headless IWER capture): IWSDK cyan outline, our spheres hidden. In the user's tab, `__VR_CONTROLS__.hands()` = real true / spheres false: the joint spheres still seen there are drawn by the **IWE extension itself**, not the app.
- IWER MCP drops often (« Connection closed »): `/mcp` reconnect; `EADDRINUSE 127.0.0.1:8723` → another bridge holds the port (ask before `make iwer-bridge-stop`).
- Scenarios: V546–V550, S-IW1 (`test-scenarios/06-village.md`).
