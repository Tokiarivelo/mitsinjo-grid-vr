# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-07 · **By:** Antigravity · **Branch:** feat/vr-village-view (on origin/main ebdf49b)

## Current state

- VR immersion UX DONE: « Voir en VR » direct WebXR activation without gesture collision.
- Full viewport dedicated in XR (`fixed inset-0 z-50 w-screen h-screen min-h-screen`).
- Side drawers (Controls/Copilot) & docks hidden during VR immersion to eliminate visual obstruction.
- Canvas buffer auto-resizes to 100% width/height on fullscreen/XR without freeze.
- Guide `docs/vr-immersion-guide.md` rewritten with complete navigation & immersion controls.
- Dev XR emulation: Meta IWER 2.8.0 + DevUI auto-install (dev-only chunk).
- `make check` / typecheck clean + simulation & 3d test suites passing.

## Next (operator machine, sandbox blocks loopback/fonts/build)

1. Relire + merger la PR VR [#3](https://github.com/Tokiarivelo/mitsinjo-grid-vr/pull/3)
   (poussée via `gh` HTTPS, branche rebasée sur ebdf49b).
2. `make dev-mock` → S119–S123 (`test-scenarios/02-simulation.md`), incl. gate-out shots.
3. Quest Browser HTTPS when a headset is available (S122).
4. Still pending from HF session: HF_TOKEN → `make hf-publish`; verify namespace `Tokiarivelo`.
5. Drop stash `handoff-avant-vr` after.

## Files touched

- New: `microgrid-3d/{utils/xr-session,utils/dev-xr-emulator,hooks/use-webxr}` + 4 test files,
  `simulation/__tests__/{viewport-vr,viewport-vr-session}`, `docs/tasks/VR-village-view.md`.
- Edit: `village-canvas.tsx` (rendererRef/xrActive), `camera-controller.tsx` (XR_VIEWPOINT),
  `village-viewport.tsx` (VRButton), messages EN/FR/MG, package.json/lock (iwer devDeps).

## Decisions

- Plain three.js WebXR over IWSDK (no ECS rewrite) and ssim/xrsim (not for web, verified).
- Button hidden unless `immersive-vr` supported (no fake control); postfx off in XR.
- IWER `forceInstall` only when native immersive-vr unsupported; never clobbers headsets.

## Known limits

- drei `<Html>` labels invisible in-headset (desktop mirror OK); no controller input yet.
- DevUI overlay pulls its own three 0.184 (dev-only chunk, never in prod).
- Env: corepack 0.34 can't run pnpm 12 (`pnpm.cjs` vs `pnpm.mjs`); user fix =
  `npm i -g corepack@latest`. Sandbox workaround: `PATH=/tmp/pnpm-bin:$PATH`.
