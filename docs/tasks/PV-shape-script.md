# PV-G — 3D by script, piece by piece, checked against the 2D elevation (plan)

**Why (user, 2026-11-02):** the facade path (PR-2.23) now gets the silhouette roughly right, but the result is
not faithful to the imagined 2D elevation. Example: « rural thatched house » (8 m × 5.5 m, reed thatch 45°,
2 casement windows 900 × 1200 with 2 × 4 panes, timber double door 1600 × 2100 with glazed top, timber frame,
400 mm stone plinth, 2 brick chimneys, step). The 3D shows one box under a hip roof, **roof and walls with the
same blotchy photo texture**, three dark rectangles for windows and door. Ask: Spark writes a **generation
script**, builds the model **piece by piece**, and an agent loop renders → compares → corrects each piece until
the render matches; same for every kind of object.
**Status:** 🟡 G0 + G1 + G2 done (2026-11-02); live Meta run on the thatched-house drawing: facade path, elevation 87–91/100, IoU 0.98, first model in 48–68 s (chimney accessory score 0.44–0.71: roof hides its foot). G3 done (PG-T13–T18) + PG-T19 + PG-T23. Live loop pass 2026-11-03 (PG-T22, below): a scorer bug fixed, the seed now scores 95/100 on a new thatched drawing. PG-T20/T21 done (offline). Open: PG-T22 designer ≥ 4/5, PG-T20 live run. **Rules kept:** Meta models only (Spark / Wonder, Muse Image, SAM 3.1); the LLM never
writes vertices or runnable code (it writes Zod-checked ops, the engine builds); pure, seeded, tested geometry;
never paste the photo on the model (small tileable swatches OK); ≤ 5 k triangles per object.
**Skills:** `/shape-3d` (vocabulary, files) · `/shape-loop` (scores, log) · `/facade-2d` (target image).

## Why the house looks like that (from the code)

| What the user sees                        | Cause                                                                                                                                                                                                                                                 | Where                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Roof texture = wall texture, blotchy      | Swatches are 64 px **photo** patches. The region of each material is the flat render's part map laid on the photo crop, and the facade recipe (elevation units + yaw) is not registered to the photo. The roof patch then picks walls, sky or shadow. | `photo-swatches.ts` `extractSwatches` / `findBestPatch`       |
| Diagonal diamond pattern on the roof      | Box-projected UVs (`MAP_TILE` 0.25) on sloped hip faces stretch the patch along the slope. High-contrast patches tile visibly.                                                                                                                        | `surface-maps.ts` (box UV), `blendHalfOffset`                 |
| Material not the drawn one (reed thatch)  | Materials come from Spark's kit roles `main` / `secondary` read on the photo. The 2D elevation (hatching, labels « REED THATCH ») is never read for materials.                                                                                        | `facade-house.ts` `role()`, `object-kit.ts` `materials`       |
| Windows and door = dark flat rectangles   | Decals 0.015 thick, glass at metalness 0.4 (dark mirror in the studio light). No frame, no mullions, no sill, no lintel, no recess. Door = one brown box, so the double leaves and the glazed top are lost.                                           | `facade-house.ts` `DECAL`, `glass`; `surface-look.ts` `glass` |
| No plinth, timber frame, step, roof bulge | Vocabulary has no such parts, and `MAX_RECIPE_PARTS = 12` is already filled by walls + roof + doors + chimneys + windows.                                                                                                                             | `object-shape.ts` `MAX_RECIPE_PARTS`, `RECIPE_SHAPES`         |
| Errors never caught against the 2D target | One-shot build. The only loop (Spark critic, PR-0.6) is 1 round of **kit** patches, judged on the **photo crop**, never on the validated elevation.                                                                                                   | `object-shape.ts` facade branch, `spark-critic.ts`            |

## Principle: script → build → render → compare → patch, one stage at a time

```
validated 2D elevation (front, + side) ──► SAM concepts per stage ──► target masks + Spark reading (labels, counts, materials)
                                                                                   │
Spark writes ShapeScript ops for stage k ──► engine compiles (pure) ──► recipe ──► elevation render (ortho, same frame as the 2D)
        ▲                                                                                          │
        └──── patch ops for stage k only ◄── Spark sees target | render | diff + per-stage scores ◄┘
stage k accepted (score ≥ gate or no gain after N rounds) ──► locked ──► stage k+1   (viewer shows each stage as it lands)
```

- **ShapeScript** = a JSON list of typed ops, not code: `add`, `set`, `remove`, `attach` (parent face + anchor),
  `cut` (opening in a wall), `repeat` (n along an axis), `material`. Zod-validated. Each op targets one named
  component, so a bad op breaks one piece, not the model. Never `eval`.
- **Stages (house):** S1 massing (walls box, plinth) → S2 roof (form, pitch, overhang, eave bulge) →
  S3 openings (cut windows + doors where SAM sees them) → S4 opening details (frame, panes grid, sill, lintel,
  door leaves, hinges skipped) → S5 accessories (chimneys, step, timber frame beams) → S6 materials (per
  component) → S7 hidden sides (side elevation, else graph rules PR-2.16).
- **Locks:** an accepted stage is frozen. Later patches may only touch their own stage, so S4 can't move a wall.
- **Monotone:** a patch is kept only if the stage score rises (as the critic already does). The per-stage cap is
  3 rounds, and the seed is the current `facadeHouseRecipe` output, so the result is never worse than today.

## Tasks

### G0 Measure against the 2D target (first: without it the loop is guesswork)

- [x] **PG-T1 Elevation render.** `renderElevation(recipe, 'front'|'side', frame)` in `flat-render.ts`:
      orthographic, in the 2D image's own frame (the `Elevation` mapping of `facade-house.ts` inverted). It outputs a
      part-id map plus a line-art pass (silhouette and part edges) so it can be compared with a line drawing. Test:
      round-trip box → elevation → `measureElevation` gives back the same eave / walls / windows (± 1 px).
      **Done:** `elevation-score.ts` `renderElevation` (`renderFlat` gained `frameOf`); one scale for both axes, feet on the ground line. **Deviation:** no line-art pass; structure lines = concept borders of the label map.
- [x] **PG-T2 Elevation score.** `scoreElevation(target, render)`: global IoU, edge F1 against the drawing's
      edges, and **per-concept IoU** (roof, wall, window, door, chimney, plinth), with Hungarian matching of
      openings (count + position + size errors). Per stage it reports the metrics of that stage only. Golden
      tests on synthetic SVG elevations (thatched cottage = the user's sheet redrawn, shop, 2-storey, hut).
      **Done:** `scoreElevation` + `elevationTarget` + `matchOpenings` (greedy minimum-cost pairing, not Hungarian: ≤ 12 openings). **Deviation:** edge F1 on concept borders, not the drawing's pixels (thatch hatching would flood the recall). Golden set `__fixtures__/elevation` (thatched house); more drawings to add.
- [x] **PG-T3 More SAM concepts on the elevation.** `FACADE_CONCEPTS.house` += roof, wall, plinth, chimney,
      window pane, door leaf, beam, step. Same `fetchPartMasks`, parallel, with the existing timeout. Bad or
      empty answers are dropped (logged miss cause, FIX 1 style).
      **Done (partial):** `measureElevationImage` also asks plinth, step, window pane (parallel); `Elevation.plinth/steps/panes/roofRings`. Beam and door leaf: on demand in G2.
- [x] **PG-T4 Report + sheet.** `make shape-report` gains an « elevation » column (target | render | diff per
      stage). `make facade-e2e` writes `stages/` (one PNG per accepted stage) to watch the loop on live Meta.
      **Done:** `make shape-report` → « Elevation » section + `elevation-sheet.png`; live log `[vision] 3D elevation n/100 …`; `make facade-e2e` → `elevation.png` (drawing | render | diff) + `elevation.json`. **Deviation:** no `stages/` folder until the loop exists (G3).

### G1 Fix what is visibly wrong now (no loop needed, biggest gain per hour)

- [x] **PG-T5 Materials from the 2D.** Spark reads the elevation (labels, hatching) → material per component
      (`roof: thatch`, `walls: plaster`, `frame: wood`, `plinth: stone`, `chimney: brick`). The elevation wins
      over the photo for _which_ material, and the photo keeps the _colour_ (measured ΔE).
      **Done:** kit `partMaterials` {roof, walls, frame, plinth, chimney, door} in the Spark schema + prompt line; `facadeHouseRecipe` uses them first; parts carry `kind`. Plinth and step boxes added from the PG-T3 masks (scored as `plinth`).
- [x] **PG-T6 Safe swatches.** A swatch region = SAM concept mask on the photo (`roof`, `wall`), not the
      flat-render part map. The swatch is rejected (back to procedural maps) when (a) the region is under 3 % of the
      crop, (b) the luminance spread is too high (shadows, objects), or (c) it is too close to another material's
      swatch (histogram distance under the threshold: roof ≈ wall). Contrast is clamped before tiling. Test: user
      case with roof and wall patches from the same pixels → rejected.
      **Done:** `vetSwatches` (blotchy / off_colour / same_as_other), `erodeMask` (2 % of the short side), min region 3 %, `limitContrast` to std 0.07. **Deviation:** region = flat-render part map shrunk, not a SAM roof/wall mask on the photo (one SAM call less; revisit if the loop shows misregistration).
- [x] **PG-T7 Slope UVs.** Per-face planar UV for `prism` / `hip`: u along the eave, v along the fall line, so
      thatch strands and slate rows run downhill. Box UV stays for vertical faces. No diagonal stretch.
      **Done:** `planarUvs(…, slopes)` for `prism` / `hip`: u along the eave, v up the fall line; walls, tops and curved parts unchanged.
- [x] **PG-T8 Readable openings.** Openings are **recessed** (inset ≈ 0.04 of wall depth, reveal faces drawn)
      instead of decals. Glass = metalness 0, roughness 0.1, dark-blue tint, light reflection from the env map. The
      frame colour must reach ΔE ≥ 15 against the wall, or it is pushed lighter or darker. Test: frame vs wall
      contrast on the golden set.
      **Done (G1 form):** `features/vision-insert/utils/openings.ts` `expandOpenings`: frame proud, glass / leaf set back, bars from `grid` (SAM panes → `paneGrid`, default cross), window sill, double door when w/h > 0.6; frame dark or light by wall luminance; glass metalness 0. **Deviation:** no wall cut yet (PG-T11), so the opening sits on the wall, not in a reveal; the expansion is viewer-only (flat render scores the plain opening box).
- [x] **PG-T9 Roof/wall contrast guard.** After colours: if ΔE(roof, wall) < 10 and the 2D says different
      materials, nudge the roof toward its procedural material base (thatch straw, slate grey). Logged as `estimated`.
      **Done:** `separateRoofColor` (ΔE < 10 and different materials → quarter steps toward `MATERIAL_BASE`).

### G2 Components instead of parts (lift the 12-part ceiling)

- [x] **PG-T10 Assemblies.** _(beams = wall `timber` → `timber.ts`; plinth / step boxes since G1.)_ New recipe component kinds that the engine expands into boxes:
      `window {cols, rows, frame, sill, lintel}`, `door {leaves, glazedRows, panels}`, `plinth {h}`,
      `beam {from, to}`, `step`, `chimney {cap}`, `roof {kind, pitch, overhang, bulge}`. The budget counts
      **components (≤ 32)**, triangles stay ≤ 5 k (a 2 × 4 window ≈ 10 boxes ≈ 120 tris). The schema keeps v1
      recipes valid, and the viewer and flat render expand both. Update `docs/contracts.md`.
      **Done:** assembly options on `RecipePart` (`leaves`, `glazed`, `panels`, `sill`, `lintel`, `cap`, `bulge`), `MAX_COMPONENTS = 32`; `openings.ts` expands door glazed top + transom + centre stile + raised panels + lintel, `roof-trim.ts` `roofBulge` / `expandChimneyCaps`; `recipeMesh` rebuilds at `detail: 'low'` past `MAX_TRIANGLES`. Facade builder: `doorGlazing` (SAM panes, or « windows » inside a door), wide door → `leaves: 2`, lintels unless timber frame, chimney caps, window sills. **Deviation:** components stay boxes with options, not new kinds; the flat render (score) still sees the plain component.
- [x] **PG-T11 Wall cuts.** Openings really cut the wall mesh (PR-2.17 openings, now in the viewer too): a
      rectangle hole + reveal, no z-fighting decal.
      **Done (viewer):** `holed-wall.ts` `holedBox`: side faces triangulated with rectangular holes + 4 reveal faces; `layoutOpenings` finds the host wall face, the hole = inside the frame, glass / leaf at the bottom of the reveal (1.2 frame widths, ≤ 25 % of the wall). Flat render (score) still sees the plain wall.
- [x] **PG-T12 Thatch roof look.** `roof.bulge` (rounded eave lip, the drawing's curved edge), thickness, ridge
      cap. It uses the `thatch` procedural map with strands along v (PG-T7).
      **Done (viewer):** `roof-trim.ts`: thatch `hip` → 4 eave rolls, thatch `prism` → 2 (past the overhang), radius 8 % of the roof height, roof colour. Thatch strands along the fall line (PG-T7).

### G3 ShapeScript and the staged agent loop

- [x] **PG-T13 ShapeScript schema + compiler.** `lib/shape-script.ts`: ops (`add`, `set`, `remove`, `attach`,
      `cut`, `repeat`, `material`), named components, parent-relative anchors (`wall.front @ u,v`), units
      = elevation fractions. `compileScript(ops) → ObjectRecipe` is pure, with constraints from the object graph
      (PR-2.14: an opening lies inside its wall, a chimney stands on the roof). An invalid op is dropped and
      reported, and the others apply. Tests: every op, every constraint, fuzzed bad ops never throw.
      **Done:** `lib/shape-script.ts` `ShapeOpSchema`, `compileScript` (+ `locked` / `lockedFrom` for PG-T16), `componentsOfKind`; 500 seeded fuzz scripts. **Deviation:** anchors as `attach` / `cut` face shares (u, v) rather than a `wall.front @ u,v` string.
- [x] **PG-T14 Seed = today's builder.** `facadeHouseRecipe` → equivalent ShapeScript (`recipeToScript`). The
      loop starts from it, so the floor is the current result.
      **Done:** `recipeToScript`; the thatched-house builder output round-trips unchanged (no op dropped, nothing moved).
- [x] **PG-T15 Stage prompt.** One Spark call per round: target crop for the stage | render | diff overlay,
      the stage's scores, the locked components (read-only) and the stage's components (editable). It answers
      patch ops for this stage only. Prompt versioned (`SHAPE_SCRIPT_PROMPT_VERSION`). Eval on captures
      (`make eval-shape`), keeping the wording that raises the scores.
      **Done:** `shape-script-prompt.ts` (prompt v1, `ShapeStagePatch` schema, `stageQuestion`, `parseStageOps`: box adds only, ≤ 12 ops), `proposeShapeOps` on Meta / mock / client, `shape-stages-spark.ts` `stageSheet` + `sparkStageProposer`; wired into the facade path within the 60 s budget (≥ 15 s left). Stage replay: `make facade-e2e … ID=` records each Spark answer (`stage-capture.ts`), `make eval-stages` (also run by `make eval-shape`) replays them offline.
- [x] **PG-T16 Loop runner.** `runShapeStages(seed, target, budget)`: S1…S7, ≤ 3 rounds per stage, keep a patch
      only if the stage score rises, stop a stage at its gate. The time budget is shared. Out of time → the rest
      keeps the seed. Deterministic given the same Spark answers (fixtures). Tests with a fake Spark: the score
      never goes down, locks hold, the timeout returns the best so far.
      **Done:** `server/perception/shape-stages.ts` `runShapeStages({ seed, stages, score, propose, budgetMs })`, `HOUSE_STAGES` (massing → roof → openings → accessories, gates 0.95 / 0.9 / 0.9 / 0.8), `houseStageScorer` (elevation `stages` + score / 100). A patch is kept when its stage gains ≥ 0.005 and the overall score does not fall; patch ops creating other kinds are refused. **Deviation:** S4 details, S6 materials, S7 hidden sides wait for metrics that see them (the flat render scores plain components).
- [x] **PG-T17 Progressive build in the UI.** SSE `ShapeStepEvent` gains `stage` + partial recipe. The viewer
      shows each accepted stage (massing → roof → openings → details). The panel names the current stage and its
      score. i18n en/fr/mg, both themes, mobile. Design gate: `/design-check`.
      **Done:** SSE `shape_stage {phase, index, total, stage, state, before?, after?, stop?, recipe?}` (a new event, not a `ShapeStepEvent` field); the hook swaps in each kept background model; the chip (PG-T18) names the stage and its score. **Deviation:** first-answer stages are not drawn one by one (the first model already includes them).
- [x] **PG-T18 Background loop (decided, user 2026-11-02: option b).** The first answer keeps the 60 s budget
      (`SHAPE_TIMEOUT_MS`): seed + every stage done in time. The remaining stages continue on the server in the
      background (job id, same SSE stream, or poll on reconnect), and the viewer swaps in each accepted stage. The
      user can rotate, edit or place the object meanwhile, and a manual edit cancels the stages that would overwrite it.
      **Improvement indicator** (user ask): a visible chip on the 3D viewer and the panel reads « Amélioration :
      étape 3/7 — Ouvertures » with a progress bar, a spinner and the stage score before → after. When the loop
      ends it shows « Modèle finalisé » (or « Amélioration arrêtée : <cause> » on timeout or error), then fades
      out. It is announced to screen readers (`aria-live="polite"`), uses i18n en/fr/mg, theme tokens, and fits at 320 px.
      Tests: the hook follows the stage events, a dropped stream resumes from the last stage, and the chip
      reaches its final state on success and on error.
      **Done:** `shape-jobs.ts` (in-memory job, ordered events with `seq`, 10 min TTL), route streams the job after `shape_result { jobId }`, `GET /api/vision/shape/stages?job&from` resumes, `DELETE` cancels (new request, reselect, new photo); `facadeStageLoop` splits first / background; `ImproveChip`. **Update 2026-11-03:** no background time limit (user: always wait, « Cancel » on the chip); Vercel cuts a request at 300 s, so the background runs in slices that end with a `shape_stages_checkpoint` the browser posts back (`stage-checkpoint.ts`, `stage-slices.ts`). **Deviation:** no manual recipe edit exists in the UI yet, so « an edit cancels the stages » = a new request or reselect cancels the job; jobs live in one server process: after a restart the resume gets 404 and the chip reads « stopped: the server restarted, this model is kept » (cause `lost`, client-side), the last swapped-in model stays.

### G4 Every kind of object

- [x] **PG-T19 2D target for all archetypes.** `ELEVATION_ARCHETYPES` today = house, building. Add vehicle,
      appliance, lamp/pole, tree, solar panel, battery, generic `other`. Muse Image draws a straight-on
      elevation (`/facade-2d`), and the user validates it as for houses.
      **Done:** every archetype now has a straight-on prompt (tree / bush added; vehicle, panel, pole, appliances existed). With a validated view: vehicle, appliances, other and now **solar panel** → hull path (PV-H, side drawn); **tree, bush, lamp post, pole** → `roundViewRecipe` (no side drawn: their side is their front; template body → lathe of the drawn silhouette, `withLatheBody`; trunk / head kept). Houses keep the elevation builder. **Deviation:** battery = `cabinet` archetype (already on the hull path).
- [x] **PG-T20 Stage lists per archetype** (same runner, different stages and concepts):
      vehicle: body profile → cabin + glass → wheels → bumpers + lights → materials;
      appliance: body → doors / panels → handles + display → materials;
      tree: trunk → crown tiers → materials; lamp/pole: lathe profile → head → arm;
      solar panel: frame → cell grid → stand; other: free parts (`free-recipe.ts`) → details → materials.
      **Done:** `view-stages.ts` `VIEW_STAGES` (vehicle body → glass → wheels → details; appliances body → doors → details; panel body → cells; tree / bush trunk → crown; lamp post / pole body → head; other body), per-part metric `scoreViews` (silhouette IoU + greedy box IoU of SAM part boxes vs the rendered parts of the stage's kind), parts tagged by kind in `viewsRecipe` / `roundViewRecipe`, new SAM concepts per archetype, `viewStageLoop` on the shared `stagedLoop` (first answer + background job, chip labels en/fr/mg), Spark views prompt variant (v2). **Deviation:** no materials stage (no colour metric per part on the views yet); the hull body's shape is not editable by ops (Spark moves / resizes / adds box parts, the body stays the measured hull). **Live 2026-11-03** (`make facade-e2e` « purple vintage car », Spark 1.3, prompt v2): run 1 (side drawn) body 0.83 → 0.85 by `set body`, but 3 body rounds ate the background budget → body gate lowered to 0.85 (the plan's silhouette target); run 2 (side unreadable, front only): first answer 97 s, background 158 s: glass 0 → 0.50 (Spark added the windshield), details 0.72 → 0.86 (grille added), wheels 0 → 0 — the front-only build had **no wheels** and Spark may only add boxes → fixed in the builder: with no wheel on a side, a vehicle's 4 wheels come from the front drawing (axles 18 % in from each end, inferred).
- [x] **PG-T21 Assemblies per archetype** (G2 pattern): `wheel {rim, tyre}`, `glass band`, `panel grid`,
      `handle`, `crown tier`, as needed by the scores, not up front.
      **Done:** `features/vision-insert/utils/view-assemblies.ts`: wheel `rim` → metal rim disc on its outer face; solar cells (`kind: 'cell'`, `grid` from the patch aspect, `cellGrid`) → cell lines following the panel tilt (full detail only). Glass band = the side glass skin (PV-H). **Deviation:** no `handle` / `crown tier` assembly (handles are measured boxes, crown tiers come from the lathe); faint line ends at a tilted panel's lower lip.

### G5 Close

- [x] **PG-T22 Loop pass.** `/shape-loop` on the golden set + the user's thatched house. Stop criteria below.
      `/designer-3d` review on the ¾ sheet.
      **Live pass 2026-11-03** (`make facade-e2e … ID=thatched`, Muse Image front « rural thatched house » + ¾ photo, Spark 1.3):
      first model 66 s; massing 0.98, roof 0.95 at the gate; Spark's openings patch (remove `window.3`, `window.4`,
      door glazed 0.5, window grids 4 × 4) kept 0.74 → 0.99, elevation 89 → 95. **Bug found:** `window.3/.4` were the
      side-wall windows; their 0.005 lip showed on the front render as extra openings, so the loop deleted real
      windows. Fixed: `sideFacing` counts them as wall, `houseCanEdit` locks what the front cannot see (regression
      tests in `elevation-score` / `shape-stages`). Replay of the capture after the fix: seed 95, every stage at its
      gate, nothing removed. Goldens mean 93 unchanged. **Designer (¾ sheet) ≈ 3/5:** walls read tan (photo colour
      averaged over plaster + timber + shadow; the drawing and the photo say white plaster), the roof ends are fully
      hipped where the side drawing shows a gable with a small hip, flat render has no thatch / opening detail
      (viewer-only). Chimneys, door, windows and plinth match.
      **Fixed 2026-11-03:** half-hip = `hip` `clip` (vertical gable ends up to that share of the roof height, hip
      above; viewer, flat render, fit, ShapeScript `set`), measured on the **front** roof outline (`gableShare`:
      the outer 4 % columns' skyline; ≥ 0.2 → half-hip) — the outline already shows the vertical ends, so the side
      drawing is not needed (**deviation**). Live front: ridge 0.86 + clip 0.68 (was rounded to a side gable, ridge 1).
      Walls of a half-timbered house (`wallTimber`) take the plaster colour (`measureKitColors` `plaster`: lightest
      big wall group). Rebuilt seed on the capture: elevation 95 → 97 (roof 0.95 → 0.97); goldens mean 93
      unchanged. Fixture fix: the hand-made thatched roof box now bounds its outline (SAM boxes always do).
      Designer (¾ viewer shot) ≈ 4/5: white plaster, half-hip ends, thatch roll, brick chimneys; flat render
      still has no thatch texture (viewer-only).
- [x] **PG-T23 Docs + scenarios.** `docs/contracts.md` (ShapeScript, components, SSE stage), `docs/copilot.md`
      (stage prompt), `/shape-3d` skill (vocabulary), README limits, `test-scenarios/06-village.md` (V96+).
      **Done:** contracts (assemblies, ShapeScript, runner, `proposeShapeOps`, SSE stage events + stages route), copilot (staged loop, round objects), `/shape-3d` map, README feature line, scenarios V109–V118.

## Stop criteria (per object, on the elevation)

Global IoU ≥ 0.9 · edge F1 ≥ 0.75 · every opening matched (count exact, centre error ≤ 3 % of width) · ΔE(roof,
wall) ≥ 10 when the 2D names different materials · frame vs wall ΔE ≥ 15 · designer ≥ 4/5 · ≤ 5 k triangles ·
first answer with no time limit, background stages run until done or cancelled, in ≤ 300 s request slices (PG-T18).
Thatched house acceptance: thatch roof with a rounded eave, clearly different from plastered walls. Two windows
with a 2 × 4 pane grid and sills, a double door with a glazed top, a stone plinth and two brick chimneys.

## Order

G0 (T1–T4, ≈ 1 day) → G1 (T5–T9: what the user sees today, no loop needed) → G2 (T10–T12) → G3 (T13–T18) → G4 one archetype at a time (vehicle next) → G5. Every task ends with a `/shape-loop`
measure and a row in `PV-shape-realism.md` « Loop log ».

## Non-goals

LLM-written JavaScript/Python executed on the server; GLB export; non-Meta image-to-3D models; pasting the
photo or the drawing on the model.

- [x] **PG-T24 Final check by Muse Wonder (user, 2026-11-03).** After the last stage, Wonder checks the whole
      model against the drawing and re-refines it, background only, kept only when the whole-model score rises.
      **Done:** `withFinalStage` (`shape-stages.ts`, gate 1, every earlier kind editable, stage = overall score),
      appended by `facadeStageLoop` and `viewStageLoop`; `stagedLoop` keeps it out of the first answer;
      `proposeShapeOps(…, { refine: true })` → `META_REFINE_MODEL` (default `muse-wonder-1.0`), Spark retry on
      failure; « Final check » line in the stage question; chip label « Vérification finale (Muse Wonder) ».
