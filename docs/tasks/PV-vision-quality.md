# PV-Q — Strongest photo → 3D with Meta models (checklist)

**Why (user, 2026-11-10):** « I must have the most powerful image to 3D possible »: good detail, good vision,
skills that prepare the Muse models. The audit (`docs/vision-to-3d-methodology.md` §3) found the blocker: the
score passes models that do not look right, so nothing after it could be judged.
**Status:** ❌ planned. Nothing below is built.
**Read first:** `docs/vision-to-3d-methodology.md` (what and why) · `docs/vision-to-3d-muse-skills.md` (card
texts) · `.claude/skills/shape-3d/SKILL.md` · `.claude/skills/shape-loop/SKILL.md`. Per task: only the files it names.
**Rules kept:** Meta models only · never paste the photo on the model (≈ 64 px tileable swatches allowed) · Muse
never writes geometry or code · shape maths pure, seeded, tested, ≤ 300 ms · ≤ 5 000 triangles · first answer
≤ 60 s · no energy value anywhere · mock provider keeps working offline.
**How every task ends:** test added or updated → `make test-shape` → `make shape-report` → one row in the
« Loop log » of `PV-shape-realism.md` → commit and push (`feat(perception): … (PQ-Tn)`).
**Paths** are under `apps/web/src/` unless they start with `docs/`, `scripts/` or a root file.

## Order

Q0 → Q1 → Q2 → Q3 → Q4 → Q5. **Q0 is not optional and comes first:** from Q1 on, every task is accepted or
rejected by the tools Q0 builds. Inside a phase, tasks are in order of expected effect. Tasks marked _(API)_ spend
Meta API calls; all others run offline.

---

## Q0 — Measure the truth first

- [ ] **PQ-T1 Real reference set** _(API)_. Capture ≥ 12 real photos with `make shape-capture PHOTO=… ID=…`:
      car side, car corner, car partly hidden, motorbike, house front, house row, hut, lamp post, utility pole,
      fridge, TV, fan, pump or generator, water tank, solar panel, tree. At least 3 hard ones (hidden ≥ 30 %,
      small < 150 px, backlit). Register them in `server/perception/__fixtures__/shape/index.ts` with
      `kind: 'real' | 'synthetic'`; `shape-report.ts` prints a « Real » table and takes its « Next » from it.
      Photos that cannot be shared stay local (the report skips missing ones, as PR-0.5 planned).
      **Test:** `shape-report.test.ts` (real table, missing capture skipped).
      **Done when:** `make shape-report` shows ≥ 12 real rows and the baseline is logged. Closes PR-0.5.
      _Code done 2026-11-10:_ `REAL_SHAPES` (16 ids, 3 hard) in the fixtures index, `scoreRealSet` + « Real »
      table (missing / not scorable listed), captures now keep `partMasks` and the replay scores them.
      **Open (user):** capture the 13 missing photos; `TV` needs a re-capture (no outline).
- [x] **PQ-T2 Detail score.** _(done 2026-11-10; real rows wait for PQ-T1)_ New `server/perception/detail-score.ts`: part recall, part precision, interior edge
      F1, colour per part (definitions: methodology §6.1). `ModelScore.detail` in `model-score.ts`, filled by
      `score-shape.ts` from the capture's part masks; four columns in the report. Not in the weighted score yet.
      **Test:** `detail-score.test.ts`: a model with one wheel removed loses recall, with one invented window
      loses precision, with a door line added gains interior edge F1; parts marked `inferred` on hidden sides
      are ignored.
      **Done when:** every real row shows the four numbers; goldens unchanged.
- [x] **PQ-T3 The judge sees what the viewer shows.** _(done 2026-11-10)_ `flat-render.ts` draws assembly details (window frames
      and panes, door leaves and panels, handles, wheel rims, chimney caps) that only the viewer expands today.
      **Test:** `flat-render.test.ts`: a framed window renders frame pixels around glass pixels; render time of
      the heaviest golden stays inside the 300 ms budget.
      **Done when:** the elevation sheet shows frames and panes; no golden score down by more than 2.
- [ ] **PQ-T4 Rubric judge (Muse Wonder)** _(API)_. New `server/perception/rubric-judge.ts` (sheet photo |
      front | ¾, question, JSON schema, parser, `damage(recipe)` for calibration) with the Judge card (skills
      §11); `judgeShape` on `meta.ts`, `client.ts`, `mock.ts`; `META_JUDGE_MODEL` (default `muse-wonder-1.0`) in
      `lib/env.ts` and `.env.example`; `scripts/shape-judge.mjs` + `make shape-judge`; answers stored beside
      the captures for offline replay.
      **Test:** `rubric-judge.test.ts` (parser clamps grades to 1–5, bad JSON → null, `damage` removes two
      non-body parts, mock answers a fixed grade).
      **Done when:** calibration is run and written in the loop log: damaged models graded lower in ≥ 90 % of
      pairs → the judge may be used by the loop; under 90 % → it stays a developer note, and that is logged.
- [ ] **PQ-T5 A version on every prompt.** `KIT_PROMPT_VERSION`, `CRITIC_PROMPT_VERSION`,
      `VIEWS_CHECK_PROMPT_VERSION`, `SIDE_VIEW_PROMPT_VERSION` next to their prompts; logged by `visionJson`
      (`params.promptVersion`), stored in captures (`shape-capture.ts`, `stage-capture.ts`); `eval-shape.ts`
      groups its table by version; `make eval-shape` accepts `PROMPT=`.
      **Test:** `eval-shape.test.ts` (rows grouped by version), `shape-capture.test.ts` (version round-trips;
      old captures without one still load).
      **Done when:** two prompt versions can be compared in one eval table.
- [ ] **PQ-T6 Stop criteria on the real set.** From the PQ-T2 baseline, fix the gates for interior edge F1 and
      colour per part (rule: a value at least half of the real objects miss today, never one chosen so that a
      given object passes). Add `SCORE_WEIGHTS_DETAIL` (silhouette, outline edge, colour, parts) used when part
      masks exist; `STOP` in `shape-report.ts` gains recall ≥ 0.8, precision ≥ 0.8 and the two new gates.
      **Test:** `model-score.test.ts` (weights sum to 1; without masks the classic weights apply and goldens
      keep their scores).
      **Done when:** methodology §9 and `/shape-loop` quote the same gates as the code.

- [ ] **PQ-T36 Inside the outline, and from other angles.** `detail-score.ts`: (a) interior difference:
      SSIM and mean colour difference between photo and render inside the outline, in 8 height bands, the
      worst band reported (methodology §12.2); (b) `degenerateView(recipe)`: render the silhouette at 0°, 45°
      and 90°; fail when the 90° silhouette area is under 15 % of the 0° one for an archetype that is not flat
      (not `screen`, `panel`, `water`), or when the 45° view shows a part detached from the body.
      **Test:** `detail-score.test.ts` (a model with its windows deleted drops in the window band while IoU
      stays; a paper-thin car fails, a TV does not).
      **Done when:** both show in the report; no real object passes with a blank band or a degenerate view.
- [ ] **PQ-T37 Part coverage gate.** After the build, compare `evidence.visibleParts` (PQ-T12) and the SAM
      parts with the recipe: every listed part is built, or reported as « seen, not built » in the log and
      the panel's part list. Hard checks in `object-graph.ts`: no part floating (each touches its parent or
      the ground), no two parts of the same kind fused at one place. Hard failures go back to the builder
      without asking a model.
      **Test:** `object-graph.test.ts` (floating wheel caught and pulled in; duplicate window merged; a listed
      mirror with no geometry is reported).
      **Done when:** the report has a « Not built » column and it is empty or explained for every real object.

**Exit Q0:** the report ranks real photos by a score that drops when a recognisable part is missing.

---

## Q1 — Better pixels and steadier measurements

- [ ] **PQ-T7 Photo conditions.** New `server/perception/photo-conditions.ts`, pure: object size in pixels,
      sharpness (variance of the Laplacian inside the box, classed low / medium / high), exposure (share of
      clipped pixels), hidden share (outline area against the box and the archetype's usual fill), view class
      from the measured yaw. Used three ways: the « Measured: » line of the question (skills §14), confidences
      in `fusion.ts`, and a hint in `object-shape-panel.tsx` when the photo is too small or too blurred
      (`messages/{en,fr,mg}.json`, design gate).
      **Test:** `photo-conditions.test.ts` (blurred copy of a fixture classed lower; half-covered outline →
      hidden ≈ 0.5), panel test for the hint.
      **Done when:** the log prints one conditions line per object and the facts line reaches Spark.
- [ ] **PQ-T8 Two images for the kit** _(API to evaluate)_. `shape-crop.ts`: keep the context crop; add a tight
      crop of the object alone (outline when there is one, background set to neutral grey), long side up to the
      size `compactDataUrl` allows. `describeShape` sends context, then tight; the question says which is which.
      **Test:** `shape-crop.test.ts` (tight crop bounds, grey outside the outline, no outline → one image as today).
      **Done when:** `make eval-shape` agreement is not lower and counts (windows, wheels) are not worse on the
      real set; else revert and log why.
- [ ] **PQ-T9 SAM agreement.** New `server/perception/sam-consensus.ts` (methodology §6.5), used by
      `outline.ts` (`fetchOutlineForBox`) and for the parts whose first answer is empty in `part-masks.ts`;
      `PART_MASKS_TIMEOUT_MS` becomes a share of the time left instead of a fixed 5 s.
      **Test:** `sam-consensus.test.ts`: two phrasings agree → kept; they disagree → the mask inside the box
      wins; the Toy-Mini case (one answer merges car and hedge) → the tight one wins; all miss → the cause is
      reported once.
      **Done when:** on the hard real photos, « no outline » happens less often than at the PQ-T1 baseline.
- [ ] **PQ-T10 Colour of the lit surface.** `color-measure.ts`, `region-colors.ts`: read each region's colour
      on its brighter 60 % of pixels (median, as today), report the shadow share apart. First check what
      `measureKitColors` already does for `plaster`, and extend that logic instead of adding a second one.
      **Test:** `color-measure.test.ts`: a wall half in shadow reads the lit colour within ΔE 5 (before: the mix).
      **Done when:** mean colour-per-part ΔE on the real set is lower than at baseline.

**Exit Q1:** fewer cascades from a missed outline; kit calls see the object large and alone.

---

## Q2 — Muse skills (prompts that prepare the model)

- [ ] **PQ-T11 Skill loader.** New `server/perception/skills/` (`index.ts` with `skillFor(call, archetype)`,
      `base.ts`, `archetypes.ts`, `critic.ts`, `stages.ts`, `views.ts`, `judge.ts`): the cards of
      `docs/vision-to-3d-muse-skills.md` as versioned string arrays. No call uses them yet.
      **Test:** `skills.test.ts`: every archetype of `KIT_ARCHETYPES` resolves (`other` → no card); composed
      prompt ≤ 1 200 words; no card contains « watt », « kW » or « metre »; every material named is in
      `RECIPE_MATERIALS`; every SAM word list is 1–3 words per item.
      **Done when:** the doc and the module carry the same text (the test compares a hash written in the doc
      header, or the doc is generated: pick one and say which in the commit).
- [ ] **PQ-T12 Kit: look first, then answer** _(API)_. `shape.ts`: `SHAPE_JSON_SCHEMA` gains `evidence` (first)
      and `confidence`; system prompt = Base + Look + Kit + archetype card; « Answer fast and short » removed;
      `parseKit` reads the new fields leniently (old answers still parse). `lib/object-kit.ts`: schema.
      `fusion.ts`: `evidence.unsure` and `confidence` lower the weight of the named fields.
      `free-recipe.ts`: same Base + Look, Free parts card. `mock.ts`: fixed evidence.
      **Test:** `shape.test.ts` (evidence parsed, capped at 12, unknown view dropped; answer without evidence
      still valid), `fusion.test.ts` (an unsure field is led by the measurement).
      **Done when:** `make eval-shape PROMPT=<new>` against the current version: agreement not lower, median
      ≤ 30 s; detail score on the real set not lower. Bump `KIT_PROMPT_VERSION`.
- [ ] **PQ-T13 Archetype cards, one family at a time** _(API)_. Enable the cards in this order, each with its
      own eval and loop row: vehicle → house → cabinet → screen → lamp post / pole → machine → tank → panel →
      tree / bush → fan → building → person / animal → water. A card that does not help its family on the
      real set is left off and the reason is written in the loop log.
      **Test:** per family, one captured answer replayed through `parseKit` and the pipeline.
      **Done when:** every family is either on with a logged gain or off with a logged reason.
- [ ] **PQ-T14 Critic v2** _(API)_. `spark-critic.ts`: 2 × 2 sheet (photo | model same view | difference |
      model ¾), tiles ≥ 512 px; runs when the detail score is under its gate or the score under 70, with
      ≥ 20 s left; up to 2 more rounds in the background through `shape-jobs.ts`. `shape.ts`:
      `CRITIC_SYSTEM_PROMPT` = Base + Critic card + archetype card; patch schema gains `reasons` and the new
      details; ≤ 4 fields per patch.
      **Test:** `spark-critic.test.ts` (sheet layout and size, gate on detail, a patch with 6 fields cut to 4,
      background round kept only on gain).
      **Done when:** on the real set the critic fires on the objects missing parts and the kept patches raise
      the detail score.
- [ ] **PQ-T15 Cards for the loop calls** _(API to evaluate)_. Stage ops card into
      `shapeScriptSystemPrompt`, Views check card into `VIEWS_CHECK_SYSTEM_PROMPT`, Final check card into the
      `final` stage question; versions bumped.
      **Test:** `shape-script-prompt.test.ts`, `views-check.test.ts` (prompt contains the card, version changed).
      **Done when:** `make eval-stages` on the recorded loops: accepted ops per round not lower, no stage lower.
- [ ] **PQ-T16 View cards and candidate pick** _(API)_. `object-views.ts`, `facade-views.ts`: side prompts
      built from the Side view card and its family line. New `server/perception/view-candidates.ts`: score a
      generated side against the front (same height within 5 %, top line correlation, colour ΔE per material,
      depth plausible); two candidates requested in parallel when time allows, the better one kept, both
      dropped under the gate.
      **Test:** `view-candidates.test.ts` (a copy of the front scores as « not a side »; a taller drawing is
      rejected; the better of two is chosen).
      **Done when:** on the same fronts, kept side views per attempt are not fewer than before.
- [ ] **PQ-T17 Reasoning effort per call** _(API)_. `meta.ts` `visionJson`: effort is a parameter. First
      confirm on the Meta API which values `reasoning_effort` accepts. Measure, per call kind, accept rate and
      latency at each value on the captures; write the chosen table in `docs/copilot.md`.
      **Test:** `meta.test.ts` (each call sends its configured effort).
      **Done when:** the table is measured, not assumed; no call is slower without being more accurate.
- [ ] **PQ-T18 Two kit samples vote** _(API)_. `SHAPE_KIT_SAMPLES` (default 1) in `lib/env.ts` and
      `.env.example`. With 2 and ≥ 40 s left: two kit calls in parallel; archetype and subtype must agree, else
      the one whose flat render scores higher wins; counts that differ are marked unsure.
      **Test:** `object-shape.test.ts` (agreeing samples → one kit; split archetype → the better-scoring one;
      one sample late → the other is used alone).
      **Done when:** on the real set, kit field agreement across two runs of the same photo is higher than with 1.

- [ ] **PQ-T38 A critic that prefers « no fix », and a loop that knows when to stop.** Critic, stage ops
      and final check cards gain: « when the model is good enough, answer no change; a needless fix can break a
      correct model ». `shape-stages.ts`: besides gate, no gain, rounds and timeout, stop a stage on a repeated
      defect (same op proposed twice with no gain) and on a back-and-forth (an op that undoes the previous
      kept op). Soft signals only may be rescued by a model's answer; hard geometry checks never.
      **Test:** `shape-stages.test.ts` (repeat and back-and-forth stop the stage with their own stop reason).
      **Done when:** `make eval-stages`: fewer wasted rounds on the recorded loops, no stage score lower.
- [ ] **PQ-T41 Ask instead of guessing.** When the kit's archetype confidence (PQ-T12) is under 0.5, or two
      samples disagree (PQ-T18), the panel asks the operator to pick between the two best families before the
      build (one tap, three languages, both themes, mobile; design gate).
      **Test:** panel test (question shown only under the gate; the choice becomes the hint of the next call).
      **Done when:** on the hard real photos, no model is built from a family the operator would reject.

**Exit Q2:** each Muse call starts with the knowledge of its object family, and every prompt change is a measured choice.

---

## Q3 — Geometry that carries detail

- [ ] **PQ-T19 Step-by-step loop on the photo path** _(API)_. New `server/perception/photo-stages.ts`: target
      (tight crop, outline, part masks, measured yaw) and stage scorer (methodology §6.4);
      `shape-stages-spark.ts` gains `photoStageLoop`; `object-shape.ts` starts it after the first answer when
      an outline exists; parts the photo cannot see are locked; `view-stages.ts` gives the stages per archetype.
      **Test:** `photo-stages.test.ts` (a model with a misplaced wheel scores lower on the wheels stage; far
      side parts are not editable), replay of one recorded loop in `eval-stages`.
      **Done when:** on the real photo-path objects, the background loop raises the detail score and never
      lowers the score (by construction, checked on the captures).
- [ ] **PQ-T20 Detail assemblies.** `lib/object-shape.ts`, `lib/shape-script.ts`: detail kinds `handle`,
      `seam`, `mirror`, `arch` (wheel arch), `rim`, `gutter`, `vent`, `foot`.
      `features/vision-insert/utils/view-assemblies.ts` and `object-geometry.ts` expand them; `flat-render.ts`
      draws them (PQ-T3); `silhouette-fit.ts` `unitPoints` for the ones that change the outline. They cost
      components, not template parts, and are dropped first past 5 000 triangles.
      **Test:** `view-assemblies.test.ts`, `object-geometry.test.ts` (vertex counts, bounds, triangle budget
      with every detail on the heaviest object).
      **Done when:** the fridge has its handle and door line, the car its mirrors and wheel arches, in the
      viewer and on the flat render.
- [ ] **PQ-T21 More components when they are measured.** Photo-path recipes may hold up to `MAX_COMPONENTS`
      (32) when the extra parts come from SAM masks or kept loop ops; Spark-imagined part lists stay at 12.
      **Test:** `object-shape.test.ts` (a measured 14th part is kept; an imagined one is not).
      **Done when:** no real object loses a measured part to the budget.
- [ ] **PQ-T22 Hidden sides by symmetry.** `hidden-sides.ts`: mirror the measured side's parts to the hidden
      side for families that are symmetric (vehicle, cabinet, house ends), status `inferred`; never mirror
      what is one-sided (a door, a handle, a chimney).
      **Test:** `hidden-sides.test.ts` (car: far-side wheels, windows and mirror appear; fridge: the handle
      does not).
      **Done when:** the ¾ sheet shows no blank far side on the real vehicles and houses; violations stay 0.
- [ ] **PQ-T23 Clean front for hidden objects** _(API)_. When the hidden share (PQ-T7) is ≥ 30 %, the panel
      offers « draw a clean front »: Muse Image with the Clean front card (skills §12.2), the operator validates
      the drawing as on the facade route, then the 2D path builds from it. Every part that exists only on the
      drawing is `inferred`. UI: `object-shape-panel.tsx`, three languages, both themes, mobile (design gate).
      **Test:** panel test (the action shows only above the gate), `object-views.test.ts` (parts from a clean
      front are inferred).
      **Done when:** the hidden-car photo of the real set yields a whole car whose visible half still matches
      the photo (IoU on the visible region not lower).
- [ ] **PQ-T24 Back by mirror, extra side on request.** The back of a views-path object is the front mirrored
      with the family's rear parts (tail lights, rear door), never generated. A second side is drawn only when
      the views check asks for it. Closes PH-T9.
      **Test:** `object-views.test.ts` (back parts present and inferred; no Muse Image call for the back).
      **Done when:** vehicles on the 2D path have a rear end in the viewer.

**Exit Q3:** the recognisable small parts exist in the model, on every path.

---

## Q4 — Surfaces and light

- [ ] **PQ-T25 Colour per region on hull bodies.** `object-views.ts`, `region-colors.ts`: two-tone cars, trunk
      against crown, from SAM masks. Closes PH-T8.
      **Test:** `region-colors.test.ts` (two-tone body keeps both colours, each within ΔE 5).
      **Done when:** colour-per-part ΔE is lower on the two-tone real objects.
- [ ] **PQ-T26 Gloss from the photo.** New `server/perception/gloss-measure.ts`: per region, the gap between
      the brightest 1 % and the median luminance, classed matt / satin / gloss. `surface-look.ts` shifts
      roughness and clearcoat within ± 0.2 of the material's entry; status `measured`.
      **Test:** `gloss-measure.test.ts` (a region with a sharp highlight classed gloss, a flat one matt),
      `surface-look.test.ts` (shift clamped; metal never under roughness 0.45, per `/designer-3d`).
      **Done when:** `/designer-3d` on `make shape-shots` does not lower its grade on any object, dark and light.
- [ ] **PQ-T27 Shadow where parts meet.** New `features/vision-insert/utils/vertex-ao.ts`: darken vertex
      colours near part joints and near the ground at merge time (pure, once per recipe, both quality tiers).
      **Test:** `vertex-ao.test.ts` (vertices at a joint darker than free ones; factor never under 0.6, so no
      part falls to black; cost inside the geometry budget).
      **Done when:** viewer shots show parts sitting on each other instead of floating; `/designer-3d` ≥ 4 / 5.
- [ ] **PQ-T28 Light from the photo side (optional, last).** In the panel's compare view only: turn the studio
      key light to the side the photo is lit from (left or right, from the luminance gradient across the body
      mask). The default studio light stays for every other view.
      **Test:** `photo-conditions.test.ts` (lit side read on a fixture), viewer test (key light angle changes
      only in compare view).
      **Done when:** the operator reads photo and model more alike in compare view; cut first if time is short.

- [ ] **PQ-T32 Same look in the three views.** Today the village draws every placed object with one material
      (`appliance-markers.tsx`: roughness 0.7, metalness 0.2; `mergeGeometries` drops the groups) and VR builds
      materials without maps or swatches (`spawned-object-3d.tsx`). Extract one `recipeMaterials(recipe, opts)`
      from `object-editor-3d.tsx` (no copy). VR: maps and swatches, a small baked environment, no post pass.
      Village (`placed-models-geometry.ts`): merge per surface family (matt, gloss, glass, metal: ≤ 4 meshes)
      with the viewer's look values; no maps on the low tier; dimmed and fire tints kept.
      **Test:** shared builder unit test; `placed-models-geometry.test.ts` (families, tints, low-tier budget);
      `make vr-probe`; `make scene-audit` (≤ + 3 draw calls, inside both tier budgets).
      **Done when:** the same object reads alike in the viewer, the village and VR (three shots side by side),
      and glass and metal no longer look like matt paint in the village.
- [ ] **PQ-T33 Parts shade each other in the viewer.** `object-editor-3d.tsx`: N8AO in the existing composer
      and one soft shadow map on the key light (cast and receive on the object). Drawn on demand, so no cost
      at rest. Colours must stay as measured.
      **Test:** viewer test (pass present, shadow flags set); `make shape-shots` before / after.
      **Done when:** `/designer-3d` grade not lower on any object, dark and light, 320 px and desktop; ΔE of the
      lit faces against the measured colours not higher by more than 2.
- [ ] **PQ-T34 Lamps and screens glow.** `surface-look.ts`: emissive for part kinds lamp, display, headlight.
      Village: on only when the engine says the appliance runs (data-driven, bloom rule of `/designer-3d`);
      viewer: fixed low glow under 1.
      **Test:** `surface-look.test.ts` (emissive only on those kinds, under 1 in the viewer).
      **Done when:** a lamp post reads as a lamp in the viewer and lights up in the village when powered.
- [ ] **PQ-T35 Break texture repetition.** `planarUvs` maps object position ÷ 0.25 with no variation, so a
      tile repeats four times across the object. `surface-maps.ts`: a second, larger noise layer in the shade
      map and a seeded UV offset per material; patterns stay continuous across the parts of one wall.
      **Test:** `surface-maps.test.ts` (shade map has energy below the tile frequency; same seed → same result;
      mean brightness unchanged so the gain still holds).
      **Done when:** no visible grid of repeats on walls and roofs in `make shape-shots`.

- [ ] **PQ-T39 Physical material rules.** `lib/object-shape.ts`: add `painted` to `RECIPE_MATERIALS`
      (contract change → `docs/contracts.md`; not stored in Neon as a new field, so no migration: say so in
      the commit). `surface-look.ts`: `metal` = bare metal, metalness 1, base colour lifted into 180–255 sRGB;
      `painted` = metalness 0 with clearcoat; `water` metalness 0. New `server/perception/pbr-rules.ts`: clamp
      non-metal base colours into 30–240 sRGB and report each clamp. Kit card: « metal = bare metal only
      (galvanised sheet, chrome, aluminium); a painted car body, fridge or gate is painted ». Templates in
      `object-kit.ts`: vehicle body and cabinet default to `painted`.
      **Test:** `pbr-rules.test.ts` (black #000000 → 30, white → 240, metal lifted, clamp logged),
      `surface-look.test.ts` (metalness is 0 or 1 for every surface).
      **Done when:** the red car body renders at its measured colour (ΔE lower than at baseline) and bare
      metal reads as metal in `make shape-shots`.
- [ ] **PQ-T40 Look-development sheet.** `make shape-shots` gains `LOOKDEV=1`: each object under three lights
      (the studio, a low side light, a back light), dark and light theme, one sheet per object.
      **Test:** script smoke test in mock mode (three shots per object written).
      **Done when:** `/designer-3d` reviews the sheet and no material turns black, blown out or plastic-looking
      under any of the three lights.

**Exit Q4:** surfaces differ by measured colour and gloss, and parts read as assembled.

---

## Q5 — Loop pass and close

- [ ] **PQ-T29 Loop pass on the real set.** `/shape-loop` until every real object meets methodology §9, or
      three rounds on the same object without gain. One loop-log row per round, with the judge and designer grades.
      **Done when:** the final report and contact sheet are in the loop log, with what is still below target and why.
- [ ] **PQ-T30 Docs, skills, scenarios.** `docs/contracts.md` (evidence, detail score, judge result, detail
      kinds), `docs/copilot.md` (prompt versions, effort table, judge model, loader), `docs/performance.md`
      (time per call, background rounds), `README.md` (features, limits), `.claude/skills/shape-3d/SKILL.md`
      and `shape-loop/SKILL.md` (real set first, detail score, judge, cards), `PV-any-object.md` (PH-T8, PH-T9
      ticked), methodology: move each landed item from « Target » to « As built »; `test-scenarios/06-village.md`:
      one scenario per visible change (photo hint, clean front, details on the fridge and the car, background
      rounds chip), then `make scenarios-publish`.
      **Done when:** `make check` and `make check-i18n` are green and no doc states a plan as a fact.
- [ ] **PQ-T31 Budgets.** Check on the real set: first answer ≤ 60 s, shape maths ≤ 300 ms, ≤ 5 000 triangles,
      API calls per object within the spend cap (count them per path and write the table in `docs/copilot.md`).
      **Done when:** every budget holds, or the task that broke one is reverted.

## Exit criteria

Every real object meets methodology §9 · every prompt has a version and an eval behind it · the report, the
loop log and the docs agree · mock mode and the offline tests need no API key.

## Non-goals

Non-Meta image-to-3D models · Muse-written code run on the server · dense meshes or GLB export · projecting the
photo on the model · generated top-down or back views · tuning a threshold so that one object passes.
