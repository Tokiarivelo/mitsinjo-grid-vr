# Phase plan (10 days, solo)

Critical path: **P3 engine → P4 2D → P6 copilot → P7 3D**. Copilot before 3D: it is the judged
Meta feature and carries external-API risk; 3D is local work and easy to time-box.

| Day | Phase                                                                                 | File                          | Must-have                        |
| --- | ------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------- |
| 1   | P0 Framing & access                                                                   | `P0-framing.md`               | ✅                               |
| 1   | P1 Repo & agent tooling                                                               | `P1-repo.md`                  | ✅                               |
| 2   | P2 Design system (Stitch → tokens → UI kit) — parallel to P3                          | `P2-design.md`                | ✅                               |
| 2–3 | P3 Engine                                                                             | `P3-engine.md`                | ✅                               |
| 4   | P4 2D dashboard + Strategy Lab                                                        | `P4-dashboard.md`             | ✅                               |
| 5   | P5 Controls, scenarios, timeline, export                                              | `P5-controls.md`              | ✅ (timeline = stretch)          |
| 6–7 | P6 Meta copilot                                                                       | `P6-copilot.md`               | ✅                               |
| 7–8 | P7 3D microgrid                                                                       | `P7-3d.md`                    | ✅ simple primitives             |
| 9   | P8 Quality, perf, a11y                                                                | `P8-quality.md`               | ✅                               |
| 10  | P9 Deploy, demo, submission                                                           | `P9-ship.md`                  | ✅                               |
| —   | PX Anomaly signal                                                                     | `PX-anomaly.md`               | ❌ stretch                       |
| —   | PY Sector control proposals (priorities, caps)                                        | `PY-sector-control.md`        | ❌ stretch                       |
| —   | PZ Parametrable Strategy Lab (params, rules, sweep)                                   | `PZ-strategy-params.md`       | phases 1–3 ✅                    |
| —   | PL Lifeline power, dispatch controller, intensity lighting                            | `PL-lifeline-dispatch.md`     | ✅ done (phases 1–4)             |
| —   | PW WebGL context leak (3D flashes white during playback)                              | `PW-webgl-context-leak.md`    | ✅ fixed                         |
| —   | PS Sector socle: live sector load + small factory                                     | `PS-sector-load.md`           | ✅ done                          |
| —   | PH Physical scale model (hardware twin)                                               | `PH-hardware-twin.md`         | ❌ stretch (in progress)         |
| —   | PM All Meta models: voice, vision, image, chat control, fire                          | `PM-meta-models.md`           | ❌ stretch (planned)             |
| —   | PV Vision insert (photo → detection → 3D → simulation)                                | `PV-vision-insert.md`         | ❌ stretch (planned)             |
| —   | PV-P Free placement of inserted objects (position + feeder)                           | `PV-free-placement.md`        | ❌ planned                       |
| —   | PV-F 3D shape fidelity (measured colours, roofline, fit)                              | `PV-shape-fidelity.md`        | ✅ done                          |
| —   | PV-R 3D realism (light, soft shapes, part masks, views)                               | `PV-shape-realism.md`         | ❌ planned                       |
| —   | PV-G 3D by script, piece by piece, loop vs 2D elevation                               | `PV-shape-script.md`          | 🟡 G0–G1 done                    |
| —   | PV-H Any object from its 2D view (hull + AI check)                                    | `PV-any-object.md`            | 🟡 H1–H2 done                    |
| —   | PA AI dispatch (autonomous mode, event log, chat scenarios)                           | `PA-ai-dispatch.md`           | ❌ planned                       |
| —   | PI 3D object in harmony with the village (clearing, red ground, poles to its branch)  | `PI-village-integration.md`   | ❌ planned (after PA)            |
| —   | PT Studio look (ink, softbox light, clearcoat, warm-up) + object tag like buildings   | `PT-studio-look.md`           | 🟡 PT-11 done                    |
| 10  | PD 3-min demo video (rules, capture, voice, edit) — closes P9-T5                      | `PD-demo-video.md`            | ✅ (deadline Nov 4)              |
| —   | VR View the village in VR (WebXR, desktop emulation without a headset)                | `VR-village-view.md`          | ✅ code (live S119–S123 pending) |
| —   | VR-S Village VR spatial shoot (floating button, vision scan, laser blaster, 3D spawn) | `VR-village-spatial-shoot.md` | ✅ done (VS-T1–VS-T8, VS-T10)    |

## Cut order if late

1 PX anomaly · 1b PY sector control · 2 `balanced` strategy · 3 timeline playback · 4 export · 5 mobile polish ·
6 Malagasy · 7 3D camera presets. **Never cut:** engine invariants, 2-strategy comparison,
copilot guardrails + mock fallback, simulated-data labels, reproducible demo.

## Task file format

`ID` · checkbox · task · **Done when**. Each file lists **Read first** (the only docs to load) and
**Exit criteria**. Tick boxes as you go; record progress in `HANDOFF.md`.
