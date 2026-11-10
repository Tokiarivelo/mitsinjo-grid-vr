---
name: vr-immersion
description: Build, change, optimize or debug the WebXR immersion for Meta Quest (VR session on /simulation, spatial shoot on /village) — R3F + WebXR + IWER emulator. MCP first (Meta VR docs/APIs/skills, IWER), project docs always read before coding, Meta-verified best practices and perf budgets. Use for any work in features/vision-insert/ui/xr, microgrid-3d WebXR hooks/session, the XR emulator, or Quest comfort/perf.
---

Order is mandatory: **MCP → docs → code → measure → verify**. Never write XR code from memory first.

## 1. MCP before coding (always)

Ask the tools before touching code; cite what they returned in your plan.

- **Meta VR MCP** (`mcp__plugin_meta-vr_metavr__*`, load via ToolSearch):
  - `vr_docs_search` (scope `web` / `design`) → `vr_docs_get_page` for exact wording. Key pages:
    `documentation/web/webxr-perf-workflow.md`, `webxr-perf-bp.md`, `webxr-ffr.md`, `webxr-frames.md`,
    `webxr-layers.md`, `design/hands-best-practices.md`, `design/mr-design-guideline.md`, `design/comfort.md`.
  - `vr_api_search` / `vr_api_details` — exact API names and signatures. No guessed APIs.
  - `vr_skill_search` / `vr_skill_load` (then `vr_skill_used`) — Meta's guidance for the topic.
  - On a headset: `metavr_device`, `device_screenshot`, `device_logcat`, `perf_trace_capture` + `perf_trace_analyze`.
- **IWER MCP** (`iwer` in `.mcp.json`, `@iwer/extension-bridge`, port 8723) — drive the emulated Quest 3
  (pose, controllers, buttons). If it fails with `EADDRINUSE 127.0.0.1:8723`, another bridge (other session)
  holds the port: ask the user before killing it, or set `IWER_MCP_PORT`, then `/mcp` reconnect. Fallback:
  in-app IWER devui (`make dev-mock`).
- **Meta VR skills** when relevant: `meta-vr:hz-quest-verify-first` (any Quest-specific claim),
  `meta-vr:hz-immersive-designer` (comfort, layout, interaction), `meta-vr:hz-iwsdk-webxr`
  (concepts only — this repo uses R3F, not IWSDK), `meta-vr:hz-vr-debug`, `meta-vr:hz-perfetto-debug`.
- Web search only to fill gaps the MCP doesn't cover (three.js/R3F specifics); Meta docs win on conflict.
- Stack stays: R3F + Three + raw WebXR (`microgrid-3d/utils/xr-session.ts`) + `iwer`/`@iwer/devui` 2.8.0.
  No `@react-three/xr` / IWSDK migration — adapt the idea instead.

## 2. Docs before implementing (always, even for small fixes)

Read, in this order, only what the task touches:

1. `HANDOFF.md` and the task file: `docs/tasks/VR-village-view.md` or `docs/tasks/VR-village-spatial-shoot.md`.
2. `docs/vr-village-spatial-detection.md` (/village spatial shoot) or `docs/vr-immersion-guide.md` (controls, navigation).
3. `docs/vr-testing-guide.md` (emulator paths A/B/C, HTTPS rule).
4. `docs/design/3d-scene.md` + `docs/performance.md` for visuals/budgets; `docs/contracts.md` if data shapes change.

If code and doc disagree, ask before "fixing" either (`maintenance` rule).

## 3. Best practices (Meta-verified)

**Session & frame rate**

- Quest Browser defaults to **72 Hz** (Quest 2: 90). Budget: 72 fps = **13.7 ms**, 90 fps = 11.1 ms per frame.
  Missed frames → compositor reprojection (stutter, black edges).
- Session features live in `XR_SESSION_INIT` (`xr-session.ts`); add optional ones only (`hand-tracking`,
  `local-floor`, FFR level) so emulator and older browsers still enter. Enter only from a user gesture.
- Frame rate: read `session.supportedFrameRates`, set with `session.updateTargetFrameRate()`; drop to a lower
  rate if measured frame time exceeds budget, rather than missing frames.

**GPU (Quest is usually fragment/fill-rate bound)**

- **Fixed foveation:** `renderer.xr.setFoveation(0..1)` (or `*-fixed-foveation-level` optional feature).
  Start ~0.5–1 for 3D scenes; lower it where text/high contrast shows artifacts. FFR only helps when rendering
  straight to the eye buffer: **no post-processing to an intermediate target in XR**, and render shadow maps /
  other targets **before** the eye buffer (switching mid-frame kills FFR and MSAA). Disable `@react-three/postprocessing` while presenting.
- **Framebuffer scale:** `renderer.xr.setFramebufferScaleFactor()` must be set **before** the session starts
  (three warns if changed while presenting). 0.8–0.9 is the last-resort lever after FFR.
- Opaque front-to-back; force sky/backdrop domes to draw **last** (`renderOrder`). Minimise transparent overdraw;
  stop rendering fully faded objects (`visible = false` at opacity 0).
- Materials: PBR (`MeshStandardMaterial`) only on hero objects, `MeshLambert/Phong/Basic` elsewhere; fewer texture
  maps, lower resolution, KTX2/Basis compressed textures; avoid heavy anisotropic filtering.
- Lights: one directional (or one point) light with PBR; bake/static (env map, lightmap) otherwise.
  Real-time shadows count as a second scene pass: small static shadow maps, no shadow-casting point lights.
- Clear colour black or white when the background isn't the clear colour (Adreno fast clear).
- WebXR Layers (quad/cylinder for flat HUD or video panels) give sharper text and cheaper composition — check
  support via MCP before using; keep a mesh fallback for IWER.

**CPU / draw calls**

- Target **< 100 draw calls** in XR (web guidance; Meta: 1000 single-triangle draws already miss 72 fps).
  Check `renderer.info.render.calls`. Merge static meshes, `InstancedMesh`/`<Instances>`, share materials, minimise state changes.
- Any app logic > 2 ms/frame is a candidate for optimisation. Stagger non-critical updates (animations at
  30 Hz, far objects less often) across frames.
- `useFrame`: mutate refs only, no `setState`, no allocation (reuse `Vector3`/`Matrix4` scratch objects).
  Canvas textures (HUD, buttons): redraw only on change, never per frame. Video textures: cap at 30 fps source.
- Break up big meshes so frustum culling works; cluster instances spatially.

**Comfort & interaction (design)**

- No forced camera motion or teleport surprises; world-locked content, avoid head-locked HUDs (soft-follow with
  smoothing if needed). Content in view without head turns, about 1 m away, slightly below eye level.
- Panels: ~45 cm for direct touch, ~70 cm when hands + controllers, ~1 m for ray-only; angular scaling with
  min/max for labels read from afar; billboard labels (axis-constrained).
- Fade in large/close objects; dim the scene behind modal dialogs.
- Multimodal: controllers **and** hands (poke close, ray far) **and** mouse in emulator. One core gesture
  (pinch/select) used everywhere; gestures > 10 cm from the HMD; no arms-above-heart or timed reflex tasks.
- Every hover/press gets visual + audio feedback; avoid flashing visuals. Works seated and standing.

**Project rules (still apply in XR)**

- Numbers only from `@mitsinjo/engine`; every action undoable; one-tap exit / take back control.
- In-headset text via `useTranslations` (en/fr/mg); colours from theme tokens or shared texture helpers.
- Non-XR fallback when `navigator.xr` is missing (HTTP non-localhost, no WebGL).
- Search (`rg`) existing helpers in `features/vision-insert/ui/xr/` and `features/microgrid-3d/{hooks,utils}`
  before adding one. Every new hook/util ships a Vitest test.
- /village input: `XRBlasterController` is the only input source (no R3F `onClick` on panels, or one click fires
  twice); shots on `selectstart` only; hands use the system ray `getController(i)`, pinch is native `select`.
  Anything placed over the webcam video goes through `webcam-screen.ts` (`screenPoint` / `screenHitFromRay`).

## 4. Measure (perf work)

Meta workflow: **CPU vs GPU** (skip rendering: no fps change → CPU bound) → if GPU, **vertex vs fragment**
(framebuffer scale 0.01 at session start: faster → fragment bound). Fix the top cost, re-run the loop.
Tools: `renderer.info`, OVR Metrics Tool HUD, `ovrgpuprofiler -t` (FFR stage count), RenderDoc for Oculus,
Meta VR MCP `perf_trace_*`. Record before/after numbers in the PR.

## 5. Verify

1. `/verify` (typecheck, lint, tests) and `make check-i18n`.
2. Emulator: `make dev-mock`, enter VR via IWER (MCP or devui), exercise the changed flow with controllers and hands.
   Scripted: `make vr-probe` (fake webcam + IWER driven through `window.__IWER_DEVICE__.remote.dispatch`, dev only;
   same API as the IWER MCP, works when the MCP is down). `make dev-stop` frees the port for good.
3. Headset when available: Meta VR MCP screenshot + logcat; perf trace if frame-heavy; hold 72 fps.
4. Update the doc you read in step 2 (and `docs/performance.md` for new budgets/techniques), task checkboxes,
   and `test-scenarios/` (`02-simulation.md` or the /village page file) per the `test-scenarios` rule.
