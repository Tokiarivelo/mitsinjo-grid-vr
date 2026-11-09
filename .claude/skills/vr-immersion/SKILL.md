---
name: vr-immersion
description: Build, change or debug the WebXR immersion for Meta Quest (VR session on /simulation, spatial shoot on /village) — R3F + WebXR + IWER emulator. MCP first (Meta VR docs/APIs/skills, IWER), project docs always read before coding. Use for any work in features/vision-insert/ui/xr, microgrid-3d WebXR hooks, the XR emulator, or Quest comfort/perf.
---

Order is mandatory: **MCP → docs → code → verify**. Never write XR code from memory first.

## 1. MCP before coding (always)

Ask the tools before touching code; cite what they returned in your plan.

- **Meta VR MCP** (`mcp__plugin_meta-vr_metavr__*`, load via ToolSearch):
  - `vr_docs_search` / `vr_docs_get_page` — Quest Browser, WebXR, comfort, input, passthrough facts.
  - `vr_api_search` / `vr_api_details` — exact API names and signatures (WebXR, IWSDK). No guessed APIs.
  - `vr_skill_search` / `vr_skill_load` (then `vr_skill_used`) — Meta's guidance for the topic.
  - On a headset: `metavr_device`, `device_screenshot`, `device_logcat`, `perf_trace_capture` + `perf_trace_analyze`.
- **IWER MCP** (`iwer` in `.mcp.json`) — drive the emulated Quest 3 (pose, controllers, buttons) to reproduce
  and check behaviour. If it fails to connect, say so and fall back to the in-app IWER devui (`make dev-mock`).
- **Meta VR skills** when relevant: `meta-vr:hz-quest-verify-first` (any Quest-specific claim),
  `meta-vr:hz-immersive-designer` (comfort, spatial layout, interaction), `meta-vr:hz-iwsdk-webxr`
  (concepts only — this repo uses R3F, not IWSDK), `meta-vr:hz-vr-debug`, `meta-vr:hz-perfetto-debug`.
- Stack choices stay: R3F + Three + WebXR + `iwer`/`@iwer/devui` 2.8.0. MCP advice that implies another stack →
  adapt the idea, don't migrate.

## 2. Docs before implementing (always, even for small fixes)

Read, in this order, only what the task touches:

1. `HANDOFF.md` and the task file: `docs/tasks/VR-village-view.md` or `docs/tasks/VR-village-spatial-shoot.md`.
2. `docs/vr-village-spatial-detection.md` (/village spatial shoot) or `docs/vr-immersion-guide.md` (controls, navigation).
3. `docs/vr-testing-guide.md` (emulator paths A/B/C, HTTPS rule).
4. `docs/design/3d-scene.md` + `docs/performance.md` for visuals/budgets; `docs/contracts.md` if data shapes change.

If code and doc disagree, ask before "fixing" either (`maintenance` rule).

## 3. Code

- Code lives in `apps/web/src/features/vision-insert/ui/xr/` and `features/microgrid-3d/{hooks/use-webxr.ts,utils/dev-xr-emulator.ts}`.
  Search (`rg`) for an existing helper/texture/hook before adding one.
- Numbers only from `@mitsinjo/engine`; XR never computes energy. Every action undoable; one-tap exit/take-back control.
- No per-frame allocation or `setState` in `useFrame`; mutate refs. Target 72 fps on Quest.
- Comfort: no forced camera motion, UI at 1–3 m, readable text size, hand + controller + mouse input paths.
- In-headset text is i18n (`useTranslations`, keys in en/fr/mg); colours from theme tokens or shared texture helpers.
- Non-XR fallback: page works when `navigator.xr` is missing (HTTP non-localhost, no WebGL).
- Every new hook/util ships a Vitest test (`__tests__/`).

## 4. Verify

1. `/verify` (typecheck, lint, tests) and `make check-i18n`.
2. Emulator: `make dev-mock`, enter VR via IWER (MCP or devui), exercise the changed flow.
3. Headset when available: Meta VR MCP screenshot + logcat; perf trace if frame-heavy.
4. Update the doc you read in step 2 if behaviour changed, the task checkboxes, and `test-scenarios/`
   (`02-simulation.md` or the /village page file) per the `test-scenarios` rule.
