# PV-C — Instant capture, elastic grab, hologram, and the 3D Lab with an AI assistant (plan)

**Why (user, 2026-11-10), reworded:**

1. **Capture.** When I pick an object in the view that the vision sees, it must feel instant and fluid, with as
   little waiting as possible.
2. **Grab.** When I take the object and drag it, with the mouse, a controller or my hand, it reacts with an
   elastic feel.
3. **Hologram.** It then appears in front of me as a hologram.
4. **Lab.** From there I can send it to a Lab to refine the 3D model.
5. **Tools.** The Lab has many tools to edit the 3D object.
6. **AI assistant.** In the Lab I can chat with an AI assistant to change parts of the model.

**Status:** ❌ planned. Nothing below is built.
**Read first:** this file · `docs/vr-immersion-guide.md` · `.claude/skills/vr-immersion/SKILL.md` ·
`.claude/skills/shape-3d/SKILL.md` · `docs/design/README.md` (for the Lab screens). Per task: only the files it names.
**Relation to PV-Q** (`PV-vision-quality.md`): PV-Q makes the generated model right; PV-C makes getting it and
editing it feel good. They are independent, except that the Lab's detail tools use the detail kinds of PQ-T20 and
the `painted` material of PQ-T39.
**Rules kept:** Meta models only · Muse never writes geometry or code: it answers ShapeScript ops, the compiler
checks them · every AI edit needs Apply / Reject and can be undone · no energy value · zero static text (EN, FR, MG)
· dark and light · mobile from 320 px · design gate for every screen · no allocation per frame · XR: no post pass.
**Paths** are under `apps/web/src/` unless they start with `docs/`, `scripts/` or a root file.

## What exists today (checked in the code)

| Need         | Already there                                                                                                                                                                                        | Missing                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Capture      | Scan → detections → shoot a box (`xr-blaster-controller.tsx`); shape over SSE with live steps (`use-object-shape.ts`)                                                                                | Anything on screen before the first model (tens of seconds); cache     |
| Grab         | Miniature on a turntable, grab radius 0.16 m, rotate by drag (`turntable.ts`); haptics in the blaster                                                                                                | Moving the object; spring; one input layer for mouse, controller, hand |
| Hologram     | Hologram frames on detections (`holo-detection-target.tsx`); spawn by `lerp` (`spawned-object-3d.tsx`)                                                                                               | A hologram look on the model itself; materialise and solidify          |
| Lab          | Viewer with orbit, scale and tint (`object-editor-3d.tsx`, `object-display-controls.tsx`); parametric edits API (`graph-edits.ts` `applyEdit`); ShapeScript ops and compiler (`lib/shape-script.ts`) | Any tool on screen to edit a part; undo; part list                     |
| AI assistant | `proposeShapeOps` (Spark answers ops from a difference sheet); copilot chat UI; voice transcription                                                                                                  | Ops from a typed or spoken request; preview; approval                  |

Placed models are saved in the browser (`stores/placed-models.store.ts`, `localStorage`), not in Neon: Lab edits
need a storage version bump there, no database migration.

## Research (web, 2026-11-10; sources at the end)

**Waiting.** Three limits from usability research: 0.1 s feels instant, 1 s keeps the flow of thought, 10 s is the
limit of attention and needs progress, a way to cancel, and an estimate. For AI features, practitioners report
that time to the first visible result matters more than total time, that a placeholder shaped like the result
beats a spinner, and that work over 10 s should return at once and continue in the background. An optimistic
display is safe only when being wrong is rare and cheap to undo.

**Frame time in the headset.** WebXR runs at 72 Hz on Quest by default (90 Hz on Quest 2): 13.9 ms or 11.1 ms per
frame. Meta advises a steady 72 Hz over a dropping 90 Hz, one directional light with PBR materials, as little
transparency overdraw as possible, and staggering updates across frames when the CPU is the limit.

**Grab (Meta design specs).** Direct pinch starts when thumb and index tips are 0.016 m apart and always releases
above 0.03 m; hover enters at 0.05 m and leaves at 0.08 m. Distance grab uses a 10° cone held 100 ms to target and
a 20° cone to lose the target, up to 5 m. Controllers: trigger for small objects, grip for large ones. Feedback on
hover goes on the object (glow) or the input, and grows as the grab commits. On release the object inherits the
hand's velocity. Moving 1:1 with the hand suits panels and tools; objects that should feel heavy use physics.

**Elasticity.** A damped spring has an exact solution in time, so it moves the same at any frame rate.
Critically damped: `x(t) = ((v0 + ω·x0)·t + x0)·e^(−ω·t)`, fastest with no overshoot. Under-damped (damping ratio
under 1): reaches the target sooner, overshoots and settles, which is the « elastic » feel.

**Hologram look.** The common recipe is a rim glow by view angle (Fresnel), scan lines moving along the height,
light flicker, additive blending, and a progress value in the shader for appear and disappear effects.

**Editor tools.** Web 3D editors share a layout (toolbar on top, part tree on the left, viewport, properties on
the right) and a core set: move / rotate / scale gizmo with snapping and a world / local switch, selection synced
between viewport and tree, undo / redo with a clickable history, and a measure tool. A known trap: dragging a
gizmo must not also orbit the camera.

**AI editing by chat.** CADialogue (2026) turns typed, spoken or image prompts plus a **geometry selection** into
executable edits on a parametric model, refines with the user in the loop, and caches confirmed results.
B-repLer locates and changes specific tokens of a parametric model from a text request. ParSEL shows the limit of
text-only editing: move, turn and resize without new topology. The shared lesson: the model edits a small
program, the selection tells it where, and the user confirms.

## Design decisions

**D1. Three clocks for capture.**

| Clock    | Budget        | What the user sees                                                                                  | Source of the pixels                             |
| -------- | ------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Feedback | ≤ 100 ms      | The picked object lights up, a sound and a haptic pulse                                             | Local only, no network                           |
| Ghost    | ≤ 1 s         | A hologram ghost of the object: its outline extruded, already grabbable                             | Outline fetched at scan time, mesh built locally |
| Model    | as it arrives | The ghost fills in from bottom to top with the real model; later refinements swap in without a jump | `/api/vision/shape` stream, background stages    |

Beyond 10 s the hologram shows the current step and can be cancelled. The ghost is honest: it is drawn as a
hologram, never as a finished object.

**D2. Elastic, without lag in the hand.** In the headset the grab point follows the hand 1:1 (a held object that
trails the hand reads as latency). Elasticity is everything around it: a rubber tether while pulling the object
out of the photo, squash and stretch along the motion (volume kept, at most 15 %), a tilt that trails the motion,
and an overshoot when it lands on its dock. With the mouse there is no hand to compare with, so the whole object
follows on an under-damped spring. Reduced motion: critically damped, no squash.

**D3. One hologram material, three states.** Ghost (outline only, faint) → hologram (model, scan lines, rim glow)
→ solid (studio materials) when the user sends it to the Lab or places it. One draw call per object, no post pass
in XR, depth written first so inner faces do not pile up.

**D4. Every edit is a ShapeScript op.** Tools and the AI assistant write the same ops; the compiler and the
constraint solver (`applyEdit`) check them; undo is the op log. Edited parts carry the status `edited`, so they
are never confused with measured ones and the generation loop never overwrites them.

**D5. The AI assistant proposes, the user applies.** Text or voice, plus the selected part, plus a picture of the
current model → ops → shown as a hologram preview over the model → Apply or Reject → undoable. Unlike the
generation loop, an applied edit is kept even when the match with the photo drops: the user's wish wins, and the
panel shows the change in match.

---

## C0 — Measure first

- [ ] **PC-T1 Latency marks.** `performance.mark` at pick, feedback, ghost, first model, each refinement; one
      pure `lib/latency-marks.ts` (names, budget table, `summarise`); shown in the `?perf=1` overlay and logged
      once per capture. **Test:** `latency-marks.test.ts`. **Done when:** a capture prints its three clocks.
- [ ] **PC-T2 Baseline.** Record the three clocks and the frame time on desktop and in the emulator
      (`make vr-probe` extended with a capture run), on 5 objects. **Done when:** the numbers are in the loop
      log below; every later task is compared with them.

## C1 — Capture that feels instant

- [ ] **PC-T3 Outlines at scan time** _(API)_. After a scan, fetch the SAM outline of every detection in
      parallel (bounded, cancelled on a new scan) and keep them with the detections, so a pick needs no call.
      `hooks/use-vision-detection.ts`, `server/perception/outline.ts`. **Test:** hook test (parallel, capped,
      cancelled). **Done when:** a pick finds its outline locally in ≥ 80 % of cases on the tour photos.
- [ ] **PC-T4 Instant ghost.** On pick: feedback in the same frame (highlight, `xr-audio-fx`, haptic pulse),
      then the ghost = `silhouetteMesh` of the cached outline with the hologram material (PC-T13). No outline
      yet → the detection box as a ghost. `ui/xr/spawned-object-3d.tsx`, viewer. **Test:** component test
      (ghost mounted before any network answer). **Done when:** clocks: feedback ≤ 100 ms, ghost ≤ 1 s.
- [ ] **PC-T5 Session cache.** Key = photo hash + box (rounded); client memory for the session and a small
      server LRU: picking the same object again shows its model at once. `hooks/use-object-shape.ts`,
      `server/perception/shape-jobs.ts`. **Test:** second request served without a Meta call.
      **Done when:** re-pick → model in ≤ 1 s.
- [ ] **PC-T6 Speculative first model** _(API, flag)_. `SHAPE_PREFETCH` (default off) in `lib/env.ts` and
      `.env.example`: after a scan, start the shape of the 1–2 largest detections; cancel when the user scans
      again or leaves. Counted by the spend cap. **Test:** route test (flag off → no call; cancel stops the
      job). **Done when:** with the flag on, the first pick of a large object shows its model faster than the
      PC-T2 baseline, and the spend per scan is written in `docs/copilot.md`.
- [ ] **PC-T7 Never block a frame.** Mesh building (`recipeMesh`) and texture maps off the main thread (Web
      Worker with transferable buffers) or sliced over frames; swap the finished geometry in one frame.
      `utils/object-geometry.ts` stays pure; new `utils/mesh-worker.ts`. **Test:** worker round-trip equals the
      direct build. **Done when:** no frame over the 72 Hz budget (13.9 ms) while a model arrives in XR, and
      no long task over 50 ms on desktop.
- [ ] **PC-T8 XR frame hygiene.** Hologram and studio materials compiled at session start (reuse
      `use-shader-warmup`); no allocation in `useFrame` on the grab and hologram paths; one directional light;
      transparent surfaces drawn once. **Test:** existing XR tests + an allocation check on the grab update.
      **Done when:** `make vr-probe` passes and the frame time holds during pick, grab and materialise.

**Exit C1:** the user always has something to hold within a second of picking.

## C2 — Elastic grab (mouse, controller, hand)

- [ ] **PC-T9 Spring maths.** New `lib/spring.ts`, pure: exact damped spring step for scalars, vectors and
      rotations (`stepSpring(state, target, dt, { omega, zeta })`), settle test, volume-keeping squash
      (`squash(velocity, max)`). Mutates a state object, allocates nothing. **Test:** `spring.test.ts`: same
      result at 30, 72 and 120 steps per second (within 1e-4); critical damping never overshoots;
      under-damped overshoots once then stays inside 1 %; squash keeps volume.
- [ ] **PC-T10 One grab layer.** New `ui/xr/grab-input.ts`: mouse ray, controller (trigger or grip) and hand
      (pinch) reduced to one `GrabPose` (point, rotation, strength). Meta thresholds as named constants: pinch
      start 0.016 m, release above 0.03 m, hover 0.05 / 0.08 m, far targeting cone 10° held 100 ms and 20° to
      lose, 5 m range. Hover and grab states with hysteresis. `xr-blaster-controller.tsx` and `turntable.ts`
      consume it (no second implementation). **Test:** `grab-input.test.ts` (thresholds, hysteresis, the
      nearest of two objects wins, pinch → palm switch keeps the hold). **Done when:** the same object can be
      taken with all three inputs in the emulator and with the mouse on desktop.
- [ ] **PC-T11 Pull-out and secondary motion.** Pulling a picked object out of the photo stretches a tether
      from its place in the picture; past a threshold it snaps free with a haptic pulse and a sound. While
      held: 1:1 at the grab point in XR, spring follow with the mouse (design D2); squash, stretch and trailing
      tilt from `lib/spring.ts`. `ui/xr/elastic-grab.tsx`, tether as one line mesh. **Test:** component test
      (tether length, snap threshold, squash clamp ≤ 15 %, reduced motion → none).
      **Done when:** `/designer-3d` and the user judge the feel on a recorded clip; frame time unchanged.
- [ ] **PC-T12 Release and dock.** On release the object keeps the hand's velocity (short sampling window),
      then a spring brings it to its dock in front of the user with one overshoot; a hover glow and haptic
      strength that grow as the grab commits. **Test:** release velocity from sampled poses; settles at the
      dock within 1.5 s. **Done when:** a thrown object always comes back to the dock, never leaves reach.

**Exit C2:** taking and moving an object feels the same with mouse, controller and hand.

## C3 — Hologram in front of you

- [ ] **PC-T13 Hologram material.** New `utils/holo-material.ts`: one `ShaderMaterial` (rim glow by view
      angle, scan lines along the height, slow flicker, additive, depth pre-pass), uniforms `progress`, `time`,
      `tint`. Tint from a theme token (`--color-holo`, new, both themes; not a data colour), read as the ink
      colour is. Shader rules of `/designer-3d` (clamp every `pow` base, `smoothstep` edges in order).
      **Test:** `holo-material.test.ts` (uniforms, token update on theme change, compiles on SwiftShader in
      the shots run). **Done when:** readable on the dark and the light backdrop, 320 px to desktop, and in XR.
- [ ] **PC-T14 Materialise and solidify.** `progress` 0 → 1 reveals the model from the ground up with a
      noisy edge when a model replaces the ghost; « solidify » cross-fades hologram → studio materials when
      the object goes to the Lab or is placed. A refinement arriving later re-plays a short partial sweep on
      the changed parts only. Reduced motion: instant swap. **Test:** state machine test (ghost → hologram →
      solid, no state skipped back). **Done when:** no pop and no blank frame between states.
- [ ] **PC-T15 Dock in front of the user.** Position from `xr-layout.ts` (within reach, below eye line),
      re-centred when the user turns away; the existing turntable spins it; a small holographic label shows
      the name and the current step (i18n). Desktop: the hologram sits in the viewer with the same states.
      **Test:** layout test (dock inside reach for seated and standing heights).
      **Done when:** `make vr-probe` shows the hologram in front after a pick, grabbable, with its label.

**Exit C3:** a picked object is a hologram in front of the user within a second, and becomes solid on demand.

## C4 — The Lab (editing tools)

Design gate first for the whole Lab: spec in `docs/design/screens/` + Stitch mockup (`/design-check`).

- [ ] **PC-T16 Lab shell.** Feature slice `features/shape-lab/{ui,hooks,utils,__tests__}`, opened from the
      object panel and from the hologram (« Open in Lab »). Layout: toolbar on top, part list on the left,
      viewport, properties on the right; on mobile the lists become bottom sheets, touch targets ≥ 44 px.
      Reuses `ObjectEditor3d` (no second viewer). **Test:** page test (opens with the object, both themes,
      320 px). **Done when:** the design check passes on desktop and mobile.
- [ ] **PC-T17 Edit core.** `hooks/use-lab-session.ts`: the model as a ShapeScript, an op log, `apply(op)`
      through the compiler and `applyEdit`, undo / redo, a clickable history, status `edited` on touched
      parts (`lib/object-shape.ts` `DimStatusSchema` + `docs/contracts.md`). **Test:** apply → undo → redo
      returns the same recipe; an op the compiler refuses changes nothing and reports why.
- [ ] **PC-T18 Select and part list.** Click a part in the viewport (raycast on the merged mesh → part id by
      vertex range), list synced both ways, hover and selection highlight, hide / isolate a part, names from
      the part kind (i18n). **Test:** pick → id mapping; list and viewport stay in sync.
- [ ] **PC-T19 Move, turn, resize.** Gizmo on the selected part (drei `TransformControls` or
      `PivotControls`; orbit off while dragging), snapping (grid step, 15° angles, to parent faces), world /
      local switch, and the same values as number fields (fractions of the object, plus estimated millimetres
      marked « estimated »). Each drag ends as one op. **Test:** drag → one op; snap rounding; a window
      cannot leave its wall (constraint).
- [ ] **PC-T20 Materials and colours.** Material picker (the recipe materials), colour picker, and an
      eyedropper that reads the measured colour on the photo. **Test:** picker → `material` op; eyedropper
      returns the region's measured colour.
- [ ] **PC-T21 Build tools.** Add a part from a palette (plain solids and assemblies: window, door, wheel,
      handle…), duplicate, mirror across the object's symmetry plane, delete, repeat along an axis, cut an
      opening in a wall, edge roundness. **Test:** one test per tool → expected ops; budgets (32 components,
      5 000 triangles) refused with a clear message.
- [ ] **PC-T22 View tools.** Photo beside the model and a difference overlay (the flat render against the
      photo, via the score route), exploded view (parts moved apart along their offset from the centre),
      wireframe, ink on / off, three light presets (PQ-T40), measure between two points, match % refreshed
      after each edit. **Test:** explode offsets; measure distance; overlay request debounced.
- [ ] **PC-T23 Versions and saving.** Named snapshots, « back to the AI version », save to the village
      (`placed-models.store.ts`, storage version bump with a reader for the old shape). **Test:** store
      migration test; reset restores the first recipe exactly.
- [ ] **PC-T24 From the headset.** Wrist menu action « Open in Lab » on the held hologram: the object is
      queued and the Lab opens on it when the session ends (the Lab itself is a 2D screen; in-headset editing
      is not in this plan). **Test:** wrist menu test; queue survives the session end.

**Exit C4:** a user can fix any part of a generated model by hand, undo anything, and save the result.

## C5 — AI assistant in the Lab

- [ ] **PC-T25 Edit by request (server)** _(API)_. New `server/perception/lab-edit.ts`: system prompt = Base
      card + Lab edit card (`docs/vision-to-3d-muse-skills.md` § 16) + archetype card; user turn = the request,
      the selected component ids, the component list, one image (model front | model ¾, the selection
      outlined; the photo when there is one). Answer schema: `{ say, ask?, ops[] }` with the ShapeScript op
      schema of `shape-script-prompt.ts` (≤ 12 ops). `client.ts`, `meta.ts` (`proposeLabEdit`), `mock.ts`
      (fixed answers for the eval set), route `app/api/vision/shape/edit/route.ts` (streams `say` first, then
      the ops; spend cap key). **Test:** `lab-edit.test.ts` (parser, cap, refused op kinds, no energy words),
      route test.
- [ ] **PC-T26 Chat panel.** `features/shape-lab/ui/lab-assistant.tsx`, reusing the copilot chat components
      (no duplicate markup): the request, the assistant's sentence within about a second, then the proposed
      change as a hologram preview over the model with a list of ops in plain words; Apply / Reject; applied
      edits are one undo step; AI text styled as AI. **Test:** panel test (preview before apply, reject
      leaves the model untouched, apply is one history entry).
- [ ] **PC-T27 Ask when unclear.** When the request can mean several parts (« the window »), the answer
      carries `ask` and candidate ids: the parts glow and the user taps one. A request outside the vocabulary
      (« make it fly ») gets a plain answer and no ops. **Test:** ambiguous fixture → question and candidates;
      out-of-scope fixture → no ops.
- [ ] **PC-T28 Voice.** The existing transcription (Muse Voice Transcribe) feeds the same request field, with
      the push-to-talk control of the copilot. **Test:** transcript → request; nothing is sent while recording.
- [ ] **PC-T29 Eval set** _(API to run live)_. 20 requests on 4 objects (« make the roof steeper », « add a
      window on the left », « paint the door red », « remove the chimney », « make the wheels bigger »,
      « mirror this handle to the other side »…) with the expected op kinds and targets;
      `scripts/eval-lab.mjs` + `make eval-lab` (mock offline; `MODEL=` live). **Done when:** the live score is
      written in `docs/copilot.md` and prompt changes are judged by it.

**Exit C5:** a spoken or typed request changes the right part, shows the change before applying it, and can be undone.

## C6 — Close

- [ ] **PC-T30 Docs and scenarios.** `docs/contracts.md` (status `edited`, lab edit request and answer, new
      SSE fields), `docs/copilot.md` (lab edit prompt, prefetch flag, spend), `docs/performance.md` (three
      clocks, XR frame budget), `docs/vr-immersion-guide.md` (grab thresholds, hologram), `docs/design/`
      (Lab screens), `README.md`, `test-scenarios/06-village.md` (capture clocks, grab with each input,
      hologram states, each Lab tool, assistant apply / reject / ask), `make scenarios-publish`.
- [ ] **PC-T31 Final measure.** The three clocks and frame times against the PC-T2 baseline; `make check`,
      `make check-i18n`, `make vr-probe`, `make scene-audit`. **Done when:** every budget of D1 holds.

## Exit criteria

Feedback ≤ 100 ms · ghost ≤ 1 s · no frame over budget during capture, grab and materialise · same grab with
mouse, controller and hand · hologram readable in both themes and in XR · every Lab tool and every AI edit is one
undoable op · AI edits never apply without the user · EN / FR / MG, 320 px to desktop.

## Not verified

- On a real Quest: frame times, hand-tracking pinch distances and haptics. The emulator checks logic only.
- The Meta VR MCP server did not connect in the planning session, so Meta's guidance comes from its public
  design pages, not from the MCP documentation tools. Re-check with `/vr-immersion` before coding C2.
- Hologram and editor sources are tutorials and product manuals, read as search summaries.

## Non-goals

Editing inside the headset · free sculpting or vertex editing · AI-written code or geometry · physics simulation
of the held object · exporting files.

## Loop log

| Date | Task | Feedback ms | Ghost ms | First model s | XR frame ms | Note |
| ---- | ---- | ----------- | -------- | ------------- | ----------- | ---- |

## Sources

- [Response times: the 3 important limits (Nielsen Norman Group)](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [The latency perception gap in AI interfaces](https://tianpan.co/blog/2026-04-20-latency-perception-gap-ai-interfaces) and [Non-blocking AI: async UX patterns](https://tianpan.co/blog/2026-05-05-non-blocking-ai-async-ux-patterns-agents)
- [WebXR frames (Meta)](https://developers.meta.com/horizon/documentation/web/webxr-frames/), [WebXR performance best practices (Meta)](https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/), [WebXR performance workflow (Meta)](https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/)
- [Grab: usage (Meta design)](https://developers.meta.com/horizon/design/grab_usage/), [Grab: specs (Meta design)](https://developers.meta.com/horizon/design/grab_specs/), [Hands: interaction types (Meta design)](https://developers.meta.com/horizon/design/hands-interaction-types/), [Ray casting: usage (Meta design)](https://developers.meta.com/horizon/design/raycasting_usage/)
- [Damped springs (Ryan Juckett)](https://www.ryanjuckett.com/damped-springs/), [Critically damped smoothing (Unreal Engine API)](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FMath/CriticallyDampedSmoothing)
- [Hologram shader (Three.js Journey)](https://www.threejs-journey.com/lessons/hologram-shader), [threejs-holographic-material](https://github.com/ektogamat/threejs-holographic-material)
- [Handles (pmndrs/xr docs)](https://pmndrs.github.io/xr/docs/handles/introduction), [Three.js TransformControls for 3D editors](https://salivity.github.io/three.js/article/three-js-transformcontrols-for-3d-editors), [PlayCanvas editor toolbar](https://developer.playcanvas.com/user-manual/editor/interface/toolbar/), [SuperSplat editor interface](https://developer.playcanvas.com/user-manual/supersplat/editor/interface/)
- [CADialogue: conversational assistant for parametric CAD](https://www.sciencedirect.com/science/article/abs/pii/S0010448525001678) ([code](https://github.com/Hiram31/CADialogue)), [B-repLer: language-guided editing of CAD models (arXiv 2508.10201)](https://arxiv.org/pdf/2508.10201), [CAD-Llama (arXiv 2505.04481)](https://arxiv.org/pdf/2505.04481)
