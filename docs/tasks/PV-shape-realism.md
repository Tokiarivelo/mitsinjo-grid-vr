# PV-R — 3D realism: a model that looks like the object, not like boxes (plan)

**Why (user, 2026-11-01):** the generated car is a dark-blue box with a pale-grey box on top and four black discs:
« ugly, not conform to the image, no good styling ». PF-T1…T9 (`PV-shape-fidelity.md`) made the numbers right
(colours, roofline, row count, yaw, IoU ≥ 0.9 on the synthetic set), but the **vocabulary** is 5 sharp primitives
under flat lights. Fidelity now needs better shapes, surfaces and light, measured by a loop.
**Status:** ❌ planned. **Decisions (user, 2026-11-01):** Meta models only (Muse Spark / Wonder, Muse Image, SAM 3.1);
never paste the photo on the model, **but small tileable swatches cut from it (≈ 64 px) are allowed** as textures.
**Rules kept:** math pure, seeded, tested; ≤ 5 k triangles per object; whole request ≤ 60 s; shape math ≤ 300 ms.
**Skills:** `/shape-3d` (how to build: files, vocabulary, budgets) · `/shape-loop` (the quality loop below).

## Why the car looks like that (from the code)

| What the user sees                   | Cause                                                                              | Where                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------- |
| A brick, not a car                   | `vehicle` template = 2 boxes + cylinders; the SAM side profile only feeds the IoU  | `object-kit.ts` `TEMPLATES.vehicle` |
| Sharp edges, toy look                | Box primitives, no bevel, no rounding, flat normals                                | `object-geometry.ts` `unitPart`     |
| Grey cabin, no windows               | Cabin takes the `secondary` colour; glass is never placed where the photo shows it | templates, `measureKitColors` roles |
| Wheels too small, at fixed positions | `spread(perSide, 0.6)` × size 0.18, not the photo's wheels                         | `TEMPLATES.vehicle`                 |
| Plastic, flat light                  | 4 directional lights, no environment map, no ambient occlusion, no texture detail  | `object-editor-3d.tsx`              |

## Research (2026-11-01, sources in the session report)

- Feed-forward image→3D (TRELLIS.2, Hunyuan3D 2.1, SAM 3D Objects): not on the Meta API → out (user keeps Meta only).
- Multi-view generation + reconstruction (Zero123++, InstantMesh): Muse Image 1.0 edits with reference images
  (`/v1/images/edits`) → side / top views → SAM masks → visual hull. A bet: generated views may be inconsistent.
- LLM CAD code + visual feedback (CAD-Coder, CAD-Designer): Spark is multimodal → render, show it, correct once.
- Part masks by concept: SAM 3.1 `segmentImage(url, concept)` is already wired → wheels, windows, doors, chimneys.
- Rendering: three.js `RoomEnvironment` + PMREM image-based light, ACES, rounded geometry.
- Archi reconstruction workflow (`docs/setup/example-3D-workflow.md`, 2026-11-01): staged pipeline
  Perception → Segmentation → Spatial reasoning (coords, dims, parent-child graph, depth,
  uncertainties) → Generation (parametric volumes) → Validation (camera render vs photo, silhouette
  - reprojection error, iterative correction) → Export. Main rule, kept: the LLM reasons, the
    geometry engine builds, the validation engine verifies, the renderer visualises — never delegate
    the whole reconstruction to one free-form LLM answer (already our kit rule, PV-T9b).

## Target pipeline & skills (archi workflow, 2026-11-01)

Target stages (orchestrator = `runObjectShape`; chat side = copilot `loop.ts`):

1. **Perception** (Spark + SAM): box → outline, kit, part masks. Done (PV-T9…PR-2.5).
2. **Reasoning**: object graph (parent → child: panel → wall, chimney → roof, wheel → body),
   constraints (windows in walls, chimney on roof, parts inside parents), depth/order. Missing:
   PR-2.14 builds it; PR-2.16 deduces hidden sides from it (pre-S4, rule-based).
3. **Generation**: templates + measured bodies + fits → recipe. Done through PR-2.13.
4. **Validation**: flat render vs crop (IoU + edge + ΔE + landmarks PR-0.8), constraint check,
   Spark critic PR-0.6, `make shape-report`. Panel labels every part and key dim **measured /
   estimated / inferred / unknown** — estimates never shown as measured: PR-2.15.
5. **Viewer**: R3F is the output (no Blender, no GLB export — non-goals). VGGT-style research
   models are out (not on the Meta API); Meta models only, per the user decision.

**Scene description** (archi `ArchitecturalScene`): no separate scene file — the kit (what) +
recipe (parts) + graph (relations, PR-2.14) + validation report (constraints, assumptions,
errors) together ARE the interpretable geometric description. The LLM produces kit + graph
params only, never vertices; the deterministic engine builds all geometry.

**Invariants (archi rules):** (1) no incoherent geometry — openings belong to walls and are
really cut (PR-2.17); (2) no invented dimension shown as real — every dim carries its status
(PR-2.15); (3) edits are parametric — `applyEdit` re-solves constraints, never rebuilds
arbitrarily (PR-2.18).

Skills map (archi 12 → ours; agent skills stay procedures, models/engines stay tools):

| Archi skill                      | Here (code or agent skill)                                   | State    |
| -------------------------------- | ------------------------------------------------------------ | -------- |
| image-analysis, object-detection | `shape.ts` prompt, `detect.ts`, `part-masks.ts`              | done     |
| segmentation                     | SAM 3.1 `segmentImage` + `mask-outline.ts` (not SAM 2)       | done     |
| depth-estimation                 | yaw + box proportions only; true depth via S4                | S4 bet   |
| geometry-reconstruction          | `silhouette-fit`, `profile-body`, `lathe-body`, `part-fit`   | done     |
| roof-reconstruction              | `roofline`, `measuredHouse`, PR-2.10 chimney                 | S2       |
| multiview-reasoning              | mirror + imagined re-renders only                            | PR-2.16  |
| procedural-generation            | `kitToRecipe` + `object-geometry.ts` (Three.js, no Blender)  | done     |
| material-generation              | `surface-look`, `surface-maps`, swatches (viewer PBR-ish)    | done     |
| threejs-scene-generation         | `object-editor-3d.tsx` + `/scene-3d`                         | done     |
| gltf-export                      | — (viewer is the output)                                     | non-goal |
| 3d-validation                    | `/shape-loop`, `scoreModel`, PR-0.8 landmarks, PR-0.6 critic | S0       |

## The loop (how every task is judged) — `/shape-loop`

1. `make shape-report` → for each golden object: photo crop | flat render at the photo view | ¾ render, and the scores.
2. Read the table; pick the **worst metric** on the **worst object**; fix one thing (one small task below, or one bug).
3. Re-run. A metric that drops by > 2 points on any object → fix or revert before going on.
4. Every 3 iterations (or after a Look task): `/designer-3d` reviews the ¾ sheet, ≤ 3 issues, score 1–5.
5. Log one row in « Loop log » (bottom). Stop an issue after 3 rounds without gain and ask the user.
   Autonomous: `/loop /shape-loop` (self-paced) until the stop criteria hold.

**Stop criteria (per object of the real set):** silhouette IoU ≥ 0.85 · edge F1 ≥ 0.6 · region ΔE2000 ≤ 8 ·
part counts exact (wheels, windows, gables) · constraints hold (0 violations: parts inside parents,
chimney on roof) · designer score ≥ 4/5 · shape math ≤ 300 ms · request ≤ 45 s.

## Tasks (small: ≤ ½ day each, one commit each)

### S0 — Measure first (the loop needs it)

- [x] **PR-0.1 Flat renderer.** Pure TS z-buffer raster of a recipe at the photo view (orthographic + yaw, Lambert
      shade, per-part colour), reusing `silhouette-fit` hulls → `Mask` + RGB buffer. Test: a box renders its colour.
- [x] **PR-0.2 Score.** `scoreModel(render, crop, outline)` → `{ iou, edgeF1, deltaE (masked mean), score 0–100 }`.
      Test on the golden set; the car must score lower than the fridge today. Done: `model-score.ts` (silhouette
      edges count on both sides, Canny-thinned photo edges), `score-shape.ts` `scoreRecipe(photo, target, recipe)`.
- [x] **PR-0.3 Report.** `make shape-report`: golden set → `test-results/shape-report/index.md` (table) + one PNG
      contact sheet (sharp composite). Gitignored output.
- [x] **PR-0.4 Capture.** `make shape-capture PHOTO=… ID=…`: one live run that saves crop, SAM outline, Spark kit and
      part masks as JSON fixtures, so the loop replays offline (no API cost per iteration).
      Machinery done 2026-11-01 (`shape-capture.ts`: kit hook, crop remap, write/read/offline rescore, all tested;
      fixtures in gitignored `__fixtures__/shape/real/`): no live fixture yet — Meta too slow on 2026-11-01
      (SAM aborts, Spark > 150 s, 5 attempts). Re-run the command when Meta is back, then tick this box.
- [x] **PR-0.6 Spark critic** (user, 2026-11-01: the Meta model must help the render match the selected box).
      Crop | `renderFlat` PNG side by side + kit + scores → Spark → kit JSON patch → re-fit, keep if `scoreModel`
      rises. Live: 1 round when score < 70 and ≥ 20 s left; offline on captures: ≤ 3 rounds. Mock: no patch.
      Guide: `/shape-3d` « Meta in the render loop ». Replaces PR-3.5.
- [ ] **PR-0.5 Real set.** 10 user photos (car, motorbike, cottage row, hut, lamp post, fridge, TV, pump, tree, tank)
      captured with PR-0.4 into `__fixtures__/shape/real/` (gitignored if not shareable; the report skips missing ones).
- [x] **PR-0.7 6-angle preview + validation** (user, 2026-11-01: see the imagined 2D angles before the 3D).
      `POST /api/vision/views` renders the archetype template (measured colours, box proportions, no Spark
      call) at the 6 canonical angles; the panel shows them in a carousel and « Validate & Generate 3D »
      runs the full shape; once built, tabs switch between the model and the 6 views (`shape.imaginedViews`).
      Done: `views-generation.ts`, `views/route.ts`, `object-views-carousel.tsx`, `requestViews`, panel tabs.
- [x] **PR-0.8 Landmark term** (archi loss `L = a·silhouette + b·edges + c·landmarks + d·geometry`).
      When part masks exist: mean distance of rendered part centres (wheels, windows, doors) to their
      mask centres, as a fourth `scoreModel` term with rebalanced `SCORE_WEIGHTS`. Goldens stay neutral
      (no masks offline); live-car e2e must not drop. Test: shifted wheel scores lower.
      Done: `Landmark` (part index + mask centre in grid px), `scoreLandmarks` (mean centroid miss,
      0 at ¼ grid width, hidden/unknown skipped), `SCORE_WEIGHTS_LANDMARKS` (0.35/0.3/0.2/0.15);
      `buildLandmarks` (nearest wheel/thin-box part) + `scoreRecipe` masks param; live rescore and
      panels e2e pass masks (landmark 0.95, score 90 → 91). Capture replay stays 3-term (mapping).
      Goldens identical (classic weights, no `landmark` key).

### S1 — Look (every object at once)

- [x] **PR-1.1 Studio light.** `RoomEnvironment` → PMREM `scene.environment` (256², built once), ACES, one soft key +
      contact shadow; drop 2 of the 4 directional lights. Screenshot before / after. Done: Neutral tone mapping
      (not ACES: keeps the measured colours), vertex colours were converted to linear twice (fixed); shots
      `make shape-shots` (stubbed API, dark + light).
- [x] **PR-1.2 Rounded box.** `box` parts become rounded boxes (radius by material: metal 0.04, plastic 0.03,
      stone 0.01), smooth corner normals. Triangle budget test. Done: `roundedBox` (built at size, r ≤ ¼ thinnest
      side, < 0.005 → plain box), `SURFACE_LOOK[*].radius`; 300 triangles per box, 12 boxes ≤ 5 k.
- [x] **PR-1.3 Bevelled prism + smooth round parts.** Gable prisms with a small eave overhang; spheres / cylinders
      smooth-shaded. Done: `ROOF_OVERHANG` 0.03 on every side (no bevel: roof planes stay flat); round parts
      were already smooth (test added); spheres 18 × 12 so 12 round parts ≤ 5 k triangles.
- [x] **PR-1.4 Procedural maps.** Per material a 128² canvas normal + roughness map (stone blocks, brick courses,
      wood grain, thatch, slate rows, brushed metal, tread), tiled by part size, tinted by the measured colour.
      Done: `surface-maps.ts` (seeded tileable patterns → normal / roughness / grey shade, `planarUvs` in object
      units, `MAP_TILE` 0.25), `surface-textures.ts` (lazy, cached); glass / water / plastic / painted smooth.
- [x] **PR-1.5 Photo swatches.** Server: per textured material, the 64 px patch inside its region with the most even
      texture (lowest gradient-variance outlier, no edges), made tileable (mirror + edge blend), sent as
      `recipe.swatches[material]` (data URL ≤ 8 kB). Overrides PR-1.4's colour map; normals stay procedural. Allowed by the user.
      Done: `photo-swatches.ts` (`blendHalfOffset`, `normaliseSwatch`, `findBestPatch`, `extractSwatches`), `object-editor-3d.tsx`
      `swatchTexture`, brightness gain compensation for PR-1.4 shade map and PR-1.5 swatches.
- [x] **PR-1.6 Loop pass** (`/shape-loop` + `/designer-3d`).
      All golden objects meet the stop criteria: mean score 89, mean IoU 0.96, mean edge F1 0.83, mean ΔE 3.5.
      Car score 90 (edge F1 0.90, IoU 0.94), tree score 88 (edge F1 0.72). Shape math ≤ 195 ms (budget 300 ms).

### S2 — Shape from the photo

- [x] **PR-2.1 `extrude` primitive.** Polygon (box fractions, ≤ 64 points, simplified Douglas–Peucker) → slab with
      bevel. Pure builder + raster support in `silhouette-fit`.
      Done: `points` ring in unit space (schema: required iff extrude, server-built only), `unitExtrude`
      (bevelled, ≤ 64 pts < 1 k tris), hull points in `unitPoints`, ray-polygon even-odd clip in `flat-render`
      (non-convex safe, winding independent). Scores unchanged (no template uses it yet).
- [x] **PR-2.2 Profile body.** Side-seen archetypes (vehicle, cabinet, machine) → main body = SAM outline extruded to
      the kit depth (minus wheels band for vehicles). IoU ≈ SAM IoU by construction.
      Done: `withProfileBody` (outline ring → extrude at the ring bbox, plates notch it to the old box
      top so details keep their visibility, each wheel notches its own well, yaw pre-squeeze in world
      units, fit.iou re-scored). Car 92 → 93 (IoU 0.97, edge 0.92, ΔE 3.2); fridge unchanged at 97.
- [x] **PR-2.3 `lathe` primitive.** Profile (radius per height) → solid of revolution, ≤ 24 segments.
      Done: `profile` ([r, y], 2–32 pts, non-decreasing y, schema iff), `unitLathe` (16 radial segs),
      hull rings in `unitPoints`, frustum-stack ray clip in `flat-render` (tube==cylinder and
      cone-profile==cone pixel for pixel). Tank body + lamp head use static profiles. Lamp 86 → 87
      (IoU 0.95, edge 0.91); lamp ΔE steady at 7.3 (glass measures #f2d78a vs truth #f2d68a — the
      ΔE sits in thin-pole pixels, not the glass).
- [x] **PR-2.4 Lathe body.** Round archetypes (tree crown, lamp head, tank, bush, person) → profile = outline
      half-width per row.
      Done: `withLatheBody` — 24 scanline rows in the main-part band (furthest extent from the
      outline centre, poles close both ends), part resized round (depth = width), same-look
      filler inside dropped (tree canopy spheres). Tree 89 → 99 (IoU 0.99, edge 0.99); lamp
      87 → 89 (IoU 0.97, edge 0.93, ΔE 7.3 → 7.4 on re-sampled head pixels); mean 90 → 93.
      Fixed mid-loop: the 26-row render blew the 300 ms budget (tree 390 ms) → `clipLathe`
      hot loop allocation-free (inline slab scalars, reused span, winner-only normal) plus
      sort-free quadric roots; render 132 → 32 ms, pixel tests unchanged, tree 251 ms.
- [x] **PR-2.5 Part masks.** Server: `segmentImage(crop, concept)` for the archetype's concepts in parallel
      (vehicle: wheel, window; house: window, door, chimney; lamp_post: lamp), ≤ 5 s total, failures ignored.
      Done: `fetchPartMasks` — shared-deadline batch (stragglers dropped, never throws), meta-only
      (mock boxes belong to another image), pixel boxes → crop fractions via `samBoxToNorm`, ≤ 8 per
      concept by confidence. Wired after the kit settles (skipped without photo / segmenting client),
      logged (`3D masks for …: wheel×2, window×4`) and attached as `ObjectShape.partMasks`.
- [x] **PR-2.6 Wheels from masks.** Centre + radius per wheel mask (circle fit), tyre + rim parts; count = masks.
      Done: `withMaskWheels` — Kasa circle fit on the mask outline in photo pixels (box fallback when
      ragged, ≤ 3 masks), crop → box → object mapping via `cropRectForShape`, yaw un-projection ≤ 0.3
      rad. Tyre (template rubber) + alloy rim (camera side) per mask, mirrored far side (single set at
      z ≈ 0 for motorbikes); template wheels replaced so count = masks; 12-part budget drops smallest
      decals first (headlights on the sedan), never the body. Golden car e2e: IoU 0.97 → 0.97, 12 → 12
      parts. Golden set score-neutral (no segmenting client there).
- [x] **PR-2.7 Windows / doors from masks.** Rectangles (min-area box per mask) → inset glass / door panels at
      their place; replaces `spread()`.
      Done: `withMaskPanels` — min-area rect (rotating calipers) per window/door mask, tilt ≤ 20°,
      colours captured from the replaced parts (vehicle shell lends its glass, house doors the tall
      cluster / gable). Vehicle cabin shell recolored body behind measured glass (mirrored); house
      spread facade replaced front-only. Panels clamp into the face span, never float; both sides
      while fundable decals cover both else near-only else prefix; wheels/roof protected. Chimney
      masks fetched but not consumed (needs a stack part — PR-2.9 candidate). Shared `mask-geometry`
      (mapping, `enforcePartBudget`, `isWheelPart`; mask-wheels refactored onto it, tests green).
      Live-car e2e IoU 0.97 → 0.97, 12 → 12 parts; goldens identical (no masks offline).
- [x] **PR-2.8 Region colours.** Each part coloured from its own mask's pixels (glass from windows, tyre from
      wheels, body from the rest).
      Done: `measureRegionColors` — 96² box grid, cells to first containing mask (outline-tested,
      box-only eroded 20% for wheel corners) or the rest pool (outline cells outside masks; skipped
      without outline). `withRegionColors` — thin panels ← window/door regions, biggest wheel per
      site ← tyre region (rims keep alloy), front + unified shell ← rest; linear-space median per
      region, mixed by pixel confidence (untrusted below 64 px). No rescore (colours don't move
      IoU). Lamp/rims stay role colours (no suitable mask/part split yet). Live-car e2e: glass +
      body remeasured, IoU 0.97 → 0.97; goldens identical (no masks offline).
- [x] **PR-2.9 Fit v2.** Per-part parameters (wheel radius, cabin box, eave) by coordinate descent on `scoreModel`,
      multi-start Nelder–Mead (3 seeded starts), still ≤ 300 ms.
      Done: `part-fit.ts` — one pass over the archetype's groups (vehicle: wheels 1D + cabin 2D;
      house: eave 1D), 3 seeded starts × 8 evals on the raw score at a 48-col grid with cached
      photo terms (`photoTerms` + `scoreRender`, `scoreModel` identical), kept iff +0.05. Others:
      no groups, no cost. Live-car e2e: wheels +0.9, cabin +0.5 (coarse pts), fine score steady 93.
- [x] **PR-2.10 Chimney from masks** (investigation rank 1). PR-2.5 fetches the chimney concept but nothing
      places it (template chimney is a static boolean at fixed x = 0.3). Min-area rect per chimney mask →
      stack box on the roof at the mask's x (house only, eave to eave + height, tilt/limits like panels),
      funded by the part-budget backstop. Test: mask → stack on the roof plane; goldens unchanged (no
      chimney there), live e2e IoU stable, math ≤ 300 ms.
      Done: `withMaskChimney` — min-area rect per chimney mask (tilt ≤ 20°, yaw ≤ 0.3, ≤ 2
      masks), feet buried at the eave, top follows the mask (at least peeking above the ridge),
      off-house masks skipped, template stack replaced, decals fund the room. Golden cottage e2e:
      IoU 0.98 → 0.96 (no chimney in the golden outline: above-ridge pixels are false positives
      by construction), parts 9 → 10. Goldens identical; mean 93.
- [x] **PR-2.11 Asymmetric vehicle rears** (investigation rank 2). Templates put headlights at +x only, so
      backs read as front copies (grep: no taillight in `object-kit.ts`). Red lens cylinders at −x plus a
      distinct rear bumper/trunk per vehicle subtype (sedan, van, pickup, motorbike: none), funded by the
      budget backstop (structure protected). Test: rear parts per subtype; ¾ sheet shows red rears; no
      golden metric down > 2.
      Done: `TAIL_LIGHT_COLOR` fixed signal red (kitToRecipe passes non-token colours through);
      sedan −2 coplanar invisible bumpers +2 red lenses (trunk slope kept), van −front bumper
      (rear bumper kept), pickup −front bumper (bed kept), bike none; all ≤ 12, 6-wheel van drops
      lenses before wheels. Mask funding tests updated (lights fund panels/wheels). Goldens
      identical (car 93); rear renders show the lenses (136 px straight, 37 px ¾).
- [x] **PR-2.12 House backs + yaw gates** (investigation rank 3). Measured house panels are front-only: mirror
      them to the back like vehicle glass when the budget allows. Unify the yaw gates (profile 0.26,
      mirror 0.3) into one shared constant with defined 17–60° behaviour (panels near-only, no mirror,
      template kept). Test: yawed-house fixture renders backs; gates documented in a code comment.
      Done: `MASK_YAW_MAX = 0.3` + `MASK_YAW_HARD_MAX = 1.05` in `mask-geometry.ts` (ladder in a
      comment); profile/wheels/chimney on the shared gate (profile 0.26 → 0.3); panels ≤ 17° mirror
      both archetypes, 17–60° near-only, past 60° template. House e2e counts updated (backs).
      Goldens identical.
- [x] **PR-2.13 Loop pass** (covers PR-2.10…2.12).
      Done 2026-11-01: report re-run — every object meets the stop criteria (mean 93, IoU 0.98,
      edge 0.91, ΔE 3.4, math ≤ 267 ms); no metric regressed across the three PRs; no designer
      review (no Look task). Lowest score cottage row (86), all ✓.
- [x] **PR-2.14 Object graph + constraints** (archi reasoning). Parent → child graph per recipe
      (panel → wall, chimney → roof, wheel → body, gable → wall) built once after the masks; a
      constraint pass after every reshape (panels/wheels/fit): parts clamped into their parent span,
      chimney feet on a roof plane, no incoherent intersections. Generalises the panels clamp.
      Each node param carries a dimension status (measured / estimated / inferred / unknown).
      Test: floating panel pulled into the wall; violation count in the report; no golden −2.
      Done: `object-graph.ts` — `buildGraph` (parents + 4 statuses: mask-matched/outline bodies
      measured, far twins inferred, template estimated/unknown by evidence), `applyConstraints`
      (panel clamp into parent span, stack feet onto roofTop, same-ref when clean),
      `checkConstraints` (count); wired after wheels/panels/chimney/fit with rescore on fix;
      report gains a Viol column (0 everywhere). `roofTopAbove` shared with mask-chimney.
      Goldens identical. Also: region-colour rings now use the fetched outline (fix-2 gap).
- [x] **PR-2.15 Dimension status** (archi rule 2). Every part and key dim (eave, depth, yaw, scale)
      carries measured / estimated / inferred / unknown (unified vocabulary; estimates never shown
      as measured). Stored on the recipe, shown in the panel next to each part and dim (extends the
      AI-vs-computed distinction), counted in the report. Test: golden car wheels measured-with-masks
      / inferred-without, depth estimated; i18n keys + parity.
- [x] **PR-2.16 Hidden-side deduction** (archi multiview, pre-S4, rule-based). From the graph + yaw +
      archetype symmetry rules, derive the hidden-side part list (rear door opposite front door,
      back windows, roof far slope) as **inferred** parts (feeds PR-2.15), without generative views.
      Gated like mirrors (low yaw only). Test: sedan gains an inferred rear door; backs stop being
      empty on the ¾ sheet; budget held.
  - [x] **PR-2.17 Real openings** (archi rule 1). Windows/doors stop being decal boxes ON walls:
        walls with observed openings are segmented around each hole (strips between/above/below, no
        CSG dependency), glass inset in the hole; template-only walls keep decals. Openings belong to
        their wall node (PR-2.14 graph). Budget via the backstop (decals fund segments, structure
        protected). Test: wall rect tiled minus openings; inset glass, no overlay z-fight; no golden −2.
- [x] **PR-2.18 Parametric edits** (archi rule 3). Engine API `applyEdit(graph, { node, param, value })`:
      resize/move an opening, chimney or part → constraints re-solve (PR-2.14), recipe rebuilt
      deterministically, never arbitrarily. Metric values via the estimated scale (status estimated).
      UI/copilot wiring explicitly out. Test: enlarge window 20 % → glass + hole grow, wall bounds
      kept, 0 violations.
      (PR-2.14…2.18 each follow the loop: measure → log a row; the next loop pass covers them.)
- [x] **Loop pass** (covers PR-2.14…2.18). Report identical through the pass; worst = cottage edge 0.77 (holds ≥ 0.6); visual review: 3 issues, score 4/5 (car glass/doors the known gap — needs parts, budget full).
- [x] **PR-2.19 Cap box-only colour confidence** (green-Mini fix 1, inserted 2026-11-01).
      Without an outline every box pixel counts, and pixel-count confidence hit 1.0, so hedge
      pixels fully overwrote Spark's car colour. `confidence.colors` takes `hasOutline`: box-only
      mixes cap at 0.3 (Spark leads, measurement nudges). Test: fusion cap + box-only e2e keeps
      mostly the guess.
      Done: `BOX_COLOR_CONFIDENCE_MAX = 0.3`, call site passes `!!outline`; region mixes keep
      the full curve (masks are trusted). Goldens identical (all outlined).
- [x] **PR-2.20 Segment on demand at shape time** (green-Mini fix 2, inserted 2026-11-01).
      Outline-less targets (drawn boxes, > 8 concepts, SAM skipped) get one SAM call on the full
      photo with the normalized concept while Spark thinks; best IoU ≥ 0.3 match lends its outline
      (box always kept), focusing sampling + profile + fit + swatches. Test: unit (match / no
      match / mock / throw) + e2e (fetched outline → stone walls + fit).
      Done: `fetchOutlineForBox` in `outline.ts`, launched before Spark, sampling awaits it
      (usually free). Part-mask call test updated (leading concept call).
- [x] **PR-2.21 Normalize SAM concepts** (green-Mini fix 3, inserted 2026-11-01).
      `conceptOf` sent raw labels ("mini vintage") to SAM. Now: first known object noun wins
      (EN + FR, phrases first, guarded plurals), else the raw label. `Pick<…, 'label'>` so shape
      targets reuse it. Test: wordings → nouns, guard cases, grouping by normalized concept.
      Done: `CONCEPT_NOUNS` table in `outline.ts`. Existing refine tests unaffected.
- [x] **PR-2.22 Facade-measured openings** (user, 2026-11-02). The validated 2D facade (Muse
      Image elevation, `facadeUrl`) goes to Spark as a second image and to SAM: object + window +
      door on the facade (`facade-masks.ts`), in parallel with the photo masks. House panels use
      the facade masks first (`withMaskPanels(…, { frontal: true })`: front-face fractions of the
      object's facade box, no yaw un-turn, no yaw gate), photo masks as fallback; chimney, wheels,
      colours and scoring stay on the photo. Vehicles keep the photo (their facade is the nose).
      Test: `facade-masks.test.ts` (box pick, mapping, yaw regression, fetch cases, cottage e2e).
- [x] **PR-2.23 House rebuilt from its elevations** (user, 2026-11-02: tall tower, chimneys read as
      crenellated gables, door in roof tiles). With a validated facade on a house / building, SAM reads
      house, roof, wall, window, door, chimney on it (`facade-views.ts`, 25 s per call); its roof
      tells Muse Image what the side must show, Muse Image redraws the RIGHT side from the front
      (reference image), SAM reads the side; a side copied from the front or at another storey height
      is drawn once more, then dropped (`sideConsistent`). `facade-house.ts` (pure) builds the recipe:
      walls to the eave, `hip` roof (ridge share from the roof outline, chimneys left out) or front
      `prism`, chimneys from the eave, wood door, glass windows, side windows when the 12-part budget
      allows; proportions from the facade, depth = Spark's when the side drawing disagrees > ×1.3
      (live: Muse draws sides « fit to frame »), else their geometric mean. Photo gives colours,
      materials, swatches and yaw only; `source: 'facade'` skips the photo critic. New primitive `hip`
      (viewer, flat render, outline fit). Live: `make facade-e2e` (rural 2-storey: hip ridge 0.60,
      7 windows, 2 chimneys, w:h 1 : 0.69, d 0.66; cottage: front gable, copied side rejected).
      Tests: `facade-house`, `facade-views`, `facade-masks` (pipeline + critic skip), `flat-render`,
      `object-geometry`.

### S3 — Smarter Spark (model optimisation)

- [x] **PR-3.1 Eval harness.** `make eval-shape`: replays the captured crops on live Spark, scores archetype /
      sub-type / counts / materials vs truth, latency. Costs API calls: run on demand.
- [x] **PR-3.2 Sub-types.** Kit `subtype`: vehicle sedan · hatchback · vintage · pickup · van · bus · motorbike · cart; house gable · hip ·
      round thatch hut · terrace; tree round · conifer · palm. One template per sub-type.
- [x] **PR-3.3 Prompt v2.** 3D mental interpolation & occlusion reconstruction prompt, vehicle anatomy (hood, windshield, cabin, trunk, 4 wheels, bumpers, lights), recognition boost (aliases, hints).
- [x] **PR-3.4 Model choice.** muse-spark-1.3 vs muse-wonder-1.0 vs muse-spark-1.2 on accuracy and latency; keep the
      best under 30 s median.
- [x] **PR-3.5 Feedback round.** Moved to PR-0.6 (Spark critic).
- [x] **PR-3.6 Loop pass.**

### S4 — Generated views (bet, behind `SHAPE_VIEWS=1`)

- [x] **PR-4.1 Spike (1 h).** Muse Image img2img via `/responses` + image input on 4 probes (fridge side/top, fan side, text baseline).
      Latency 9–26.5 s (one over 20 s); views unreliable (top-down returned a front view, side kept the front once).
      **Verdict 2026-11-02: S4 STOPPED** — a hull needs every view right, and 2/3 generated views were wrong.
      PR-4.2…4.6 intentionally not built (boxes below left open as the record).
- [ ] **PR-4.2 View masks (stopped with S4).** SAM on each generated view; scale views to the photo height.
- [ ] **PR-4.3 Voxel hull (stopped with S4).** 64³ carving from front + side + top masks. Test on synthetic cube / cylinder / car.
- [ ] **PR-4.4 Mesh (stopped with S4).** Marching cubes → Taubin smoothing → decimation ≤ 5 k triangles; region colours per vertex
      from the nearest view (swatches allowed).
- [ ] **PR-4.5 Best candidate (stopped with S4).** Template, profile body or hull: keep the best `scoreModel`; panel says which.
- [x] **PR-4.6 Loop pass** (the spike verdict above is the pass).

### Close

- [x] **PR-5.1 Docs** (absorbs PF-T10): contracts (primitives, `texture`, part masks, `subtype`, views flag, graph, part status, openings, edits), copilot
      (prompt v2, model choice), performance (render + math budgets).
- [x] **PR-5.2 Scenarios** in `test-scenarios/06-village.md` for each visible step (car, hut, tree, mock unchanged).

### Toy-Mini investigation (user-ordered, 2026-11-02)

Live Mini (Bibury photo, 21:47): olive-green toy car — box-only hedge colours, no SAM outline, no part
masks, 12 parts estimated/inferred, fit/profile/panels all skipped. Probed live SAM on pixels extracted
from the user screenshot (full photo + true crop): SAM answers swing with the pixels (same car: tight
0.73 on one overlay variant, merged car+hedge 0.54 on another, empty text for missing concepts); the
no-outline miss cascades through fit → profile → measured colours → wheels/panels. Imagined 2D/3D
(6 mirror+re-render views) is faithful — the toy views come from the toy recipe, no fix there. Skills
and prompts audited: kit prompt + critic prompt worked on the Mini (vehicle/vintage/purple correct);
no prompt change proven (the « topiary → full vehicle anatomy » line is a latent toy-maker for the
neighbouring hedge-sculpture, left for a topiary fixture).

- [x] **FIX 1 Miss-cause logs.** `fetchOutlineForBox` + `fetchPartMasks` warn why (timeout ms / call
      failed / mock ignored / empty / best IoU / unreadable masks, per concept for parts); hits stay
      silent. 5 new tests.
- [x] **FIX 2 Crop fallback for the outline.** Full-photo miss → SAM retries on the shape crop (object
      fills the frame; probe: crop-`car` 0.81 tight where full merged) and the winner is remapped to
      photo fractions (`remapOutlineToPhoto`); full hit skips the crop (no added spend/latency on hit);
      double miss warns once with both causes. 4 new tests.
- [x] **FIX 3 Wheel filter-then-cap.** `withMaskWheels` filtered after slicing 3, so out-of-span false
      positives spent the budget before the real wheels; cap moved after the span filter. 1 new test.

## Order

S0 first (½–1 day): without the score the loop is guesswork. Then S1 (biggest visible change for every object),
S2 (shape), S3 (Spark), S4 last (a bet). Archi-workflow additions slot in: PR-0.8 with S0, PR-2.14…2.18
after PR-2.13 in rank order (graph → status → hidden sides → openings → edits), each judged by the loop.
Expect the car to stop looking like a brick after PR-1.1…1.3 + PR-2.2 + PR-2.6.

## Loop log

| Date       | Task / fix                                                                                                                                                                                                                                                                                                                                                                                              | Mean IoU    | Edge F1     | Mean ΔE     | Designer | Note                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-01 | PR-0.2 baseline (synthetic golden set)                                                                                                                                                                                                                                                                                                                                                                  | 0.95        | 0.76        | 3.6         | —        | scores: cottage 86 · lamp 86 · fridge 97 · car 83 · tree 80; worst = tree edge F1 0.54                                                                                                                                                                    |
| 2026-11-01 | PR-0.3 report; renderer fix: flush parts z-fought (comb on car wheels)                                                                                                                                                                                                                                                                                                                                  | 0.95        | 0.76        | 3.7         | —        | car 83 → 82 (wheels now drawn whole, misfit visible); next: tree edge F1 0.54                                                                                                                                                                             |
| 2026-11-01 | PR-1.1 studio light + vertex colour fix (viewer only)                                                                                                                                                                                                                                                                                                                                                   | 0.95        | 0.76        | 3.7         | —        | flat-render scores unchanged (viewer-only change); viewer colours now match the measured ones (before: darker, saturated)                                                                                                                                 |
| 2026-11-01 | PR-1.2 rounded boxes (viewer only)                                                                                                                                                                                                                                                                                                                                                                      | 0.95        | 0.76        | 3.7         | —        | scores unchanged (score renderer keeps sharp boxes); edges catch the studio light                                                                                                                                                                         |
| 2026-11-01 | PR-1.3 roof overhang, sphere budget (viewer only)                                                                                                                                                                                                                                                                                                                                                       | 0.95        | 0.76        | 3.7         | —        | scores unchanged; cottage roofs read as roofs                                                                                                                                                                                                             |
| 2026-11-01 | PR-1.4 procedural maps; golden priors name materials                                                                                                                                                                                                                                                                                                                                                    | 0.95        | 0.76        | 3.7         | —        | scores unchanged; issue for the loop: metal parts (metalness 0.6) render darker than the measured colour                                                                                                                                                  |
| 2026-11-01 | PR-1.5 photo swatches; shade map brightness gain compensation                                                                                                                                                                                                                                                                                                                                           | 0.95        | 0.76        | 3.7         | —        | scores unchanged; textured surfaces no longer darken by 20%; tileable swatches cut per material                                                                                                                                                           |
| 2026-11-01 | PR-3.2/3.3 Vehicle subtypes + 3D imagination & interpolation boost                                                                                                                                                                                                                                                                                                                                      | 0.95        | 0.79        | 3.8         | —        | car score 82 → 85, car edge F1 0.72 → 0.84 (12 parts: sloped windshield/rear, separate L/R wheels, bumpers, headlights)                                                                                                                                   |
| 2026-11-01 | PR-1.6 Loop pass: tree crown y=0.16 + car alignment + user car test                                                                                                                                                                                                                                                                                                                                     | 0.96        | 0.83        | 3.5         | 4/5      | all objects meet criteria! car score 85 → 90 (edge F1 0.90), tree 80 → 88 (edge F1 0.72), mean score 89; triangles ≤ 5k, math ≤ 195 ms                                                                                                                    |
| 2026-11-01 | Vehicle glass roles + metal bumpers + anti-brick archetype fallback                                                                                                                                                                                                                                                                                                                                     | 0.96        | 0.83        | 3.3         | 5/5      | car ΔE 3.8 → 2.5, car score 90 → 92, mean score 90; windshield & headlights glass, bumpers metal; anti-brick fallback on unsegmented box                                                                                                                  |
| 2026-11-01 | PR-0.7 6-angle preview + tree multi-tier canopy (5 spheres)                                                                                                                                                                                                                                                                                                                                             | 0.96        | 0.84        | 3.3         | —        | tree 88 → 89 (edge F1 0.75), car steady 92, mean 90; no regression; views are score-neutral (rendered from the recipe)                                                                                                                                    |
| 2026-11-01 | PR-2.1 `extrude` primitive (ring + bevel + ray clip)                                                                                                                                                                                                                                                                                                                                                    | 0.96        | 0.84        | 3.3         | —        | scores identical (unused by templates yet); L-notch renders 768 px, square == box mask, 64-gon < 1 k tris                                                                                                                                                 |
| 2026-11-01 | PR-2.2 profile body (outline extrude + wells + notches)                                                                                                                                                                                                                                                                                                                                                 | 0.97        | 0.84        | 3.4         | —        | car 92 → 93 (IoU 0.97, edge 0.92, ΔE 3.2); fridge steady 97; fixed mid-loop: global band cut → per-wheel wells, yaw squeeze in world units                                                                                                                |
| 2026-11-01 | PR-2.3 `lathe` primitive (profile + frustum ray clip)                                                                                                                                                                                                                                                                                                                                                   | 0.97        | 0.85        | 3.4         | —        | lamp 86 → 87 (IoU 0.95, edge 0.91, ΔE steady 7.3); tank unmeasured (not golden); fixed mid-loop: flat annuli, cap normals, eased (not round) lamp bowl                                                                                                    |
| 2026-11-01 | PR-2.4 lathe body (outline half-width rows + render fix)                                                                                                                                                                                                                                                                                                                                                | 0.98        | 0.91        | 3.4         | —        | tree 89 → 99 (IoU 0.99, edge 0.99), lamp 87 → 89 (ΔE 7.3 → 7.4); hot-loop rewrite after budget blow (render 132 → 32 ms, pixels identical)                                                                                                                |
| 2026-11-01 | PR-2.5 part masks (concept batch + attach)                                                                                                                                                                                                                                                                                                                                                              | 0.98        | 0.91        | 3.4         | —        | scores identical (no consumer yet — PR-2.6…2.8); 6 unit + 1 pipeline test, contract entry                                                                                                                                                                 |
| 2026-11-01 | PR-2.6 wheels from masks (Kasa fit + mirror + budget)                                                                                                                                                                                                                                                                                                                                                   | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); live-car e2e IoU 0.97 → 0.97, parts 12 → 12 (headlights fund the rims)                                                                                                                                              |
| 2026-11-01 | PR-2.7 panels from masks (calipers + shell + room)                                                                                                                                                                                                                                                                                                                                                      | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); live-car e2e IoU 0.97 → 0.97; fixed mid-PR: wheels/roof protected, sides decided before dropping                                                                                                                    |
| 2026-11-01 | PR-2.8 region colours (median per mask + rest)                                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); live-car e2e stable; fixed mid-PR: median not mean (rest-mean went mauve #a0545c, median reads pure #b0302f)                                                                                                        |
| 2026-11-01 | PR-2.9 Fit v2 (coordinate descent on the raw score)                                                                                                                                                                                                                                                                                                                                                     | 0.98        | 0.91        | 3.4         | —        | car 93 → 93 (edge +0.01, IoU −0.01; coarse +1.4); cottage eave no gain; car math 174 → 257 ms; panels e2e fixed                                                                                                                                           |
| 2026-11-01 | PR-2.10 chimney from masks (min-area rect → stack on the roof)                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); cottage e2e IoU 0.98 → 0.96, parts 9 → 10; fixed mid-PR: e2e mask shrunk (golden outline has no chimney)                                                                                                            |
| 2026-11-01 | PR-2.11 asymmetric vehicle rears (red lenses + rear bumper/trunk)                                                                                                                                                                                                                                                                                                                                       | 0.98        | 0.91        | 3.4         | —        | goldens identical (bumpers were coplanar-invisible); masks funding tests re-pointed at the lights; probe: rear 136 px, ¾ 37 px red (deleted after)                                                                                                        |
| 2026-11-01 | PR-2.19 box-only colour cap (0.3, guess leads)                                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | goldens identical (all outlined); box-only e2e keeps mostly the guess; fixed mid-PR: linear-space closeness (sRGB gamma fooled the first assertion)                                                                                                       |
| 2026-11-01 | PR-2.21 SAM concept normalization (noun table)                                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | goldens identical; refine + grouping tests green; fixed mid-PR: guarded regexes (street→tree, power plant→bush, bare mini dropped)                                                                                                                        |
| 2026-11-01 | PR-2.20 on-demand outline at shape time                                                                                                                                                                                                                                                                                                                                                                 | 0.98        | 0.91        | 3.4         | —        | goldens identical (all outlined); e2e fetched outline → stone walls + fit; region concept test re-pointed (water pump → pump                                                                                                                              |
| 2026-11-01 | PR-2.12 house backs + shared yaw gates (0.3 / 1.05)                                                                                                                                                                                                                                                                                                                                                     | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); house e2e 6 → 8 parts (backs); profile gate 0.26 → 0.3, no golden in the sliver                                                                                                                                     |
| 2026-11-01 | PR-0.8 landmark term (part centres vs mask centres)                                                                                                                                                                                                                                                                                                                                                     | 0.98        | 0.91        | 3.4         | —        | goldens identical (classic weights); live-car e2e landmark 0.95, score 90 → 91; shifted wheel scores lower; capture replay left 3-term                                                                                                                    |
| 2026-11-01 | PR-2.14 object graph + constraints + Viol column                                                                                                                                                                                                                                                                                                                                                        | 0.98        | 0.91        | 3.4         | —        | goldens identical, Viol 0 everywhere; floating panel/stack pulled in (unit); fixed mid-PR: tuple types, lint _dropped warnings                                                                                                                            |
| 2026-11-01 | PR-2.15 dimension statuses on recipe + panel + report Status col                                                                                                                                                                                                                                                                                                                                        | 0.98        | 0.91        | 3.4         | —        | goldens identical + Status col (car M1 I11, cottage I9); wheels inferred-without-masks, glass measured-with; fixed mid-PR: tuple types, lint _dropped warnings                                                                                            |
| 2026-11-01 | PR-2.16 hidden-side deduction (back facade, end windows, rear door)                                                                                                                                                                                                                                                                                                                                     | 0.98        | 0.91        | 3.4         | —        | cottage 9 → 11 (end pair, back set waits on room), scores identical, Viol 0; sedan rule unit-tested (golden car gated at side yaw); roof far slope already full-depth, no rule needed                                                                     |
| 2026-11-01 | PR-2.17 real openings (segmentWall + house wire + panel class)                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | goldens identical (no masks offline); cottage e2e 86 → 90, IoU 0.98, leaf measured, Viol 0; vehicles keep overlays (sedan cannot fund strips); fixed mid-PR: test arithmetic (union/clamp), strip re-tint ΔE                                              |
| 2026-11-01 | PR-2.18 parametric edits (applyEdit: openings/chimney/parts)                                                                                                                                                                                                                                                                                                                                            | 0.98        | 0.91        | 3.4         | —        | API-only, goldens identical; window +20% re-tiles, bounds kept, Viol 0; metric via scale; fixed mid-PR: wall membership (slabs absorbed), chimney boolean                                                                                                 |
| 2026-11-01 | Loop pass over PR-2.14…2.18                                                                                                                                                                                                                                                                                                                                                                             | 0.98        | 0.91        | 3.4         | 4/5      | all stop criteria hold (Viol 0, ms ≤ 300); visual: cottage ends filled, car rear lensed; issues: car slab cabin (no side glass/doors, budget full), row backs wait on room, end-window sliver minimal                                                     |
| 2026-11-01 | PR-0.4 live capture (Meta back: SAM 1.9s, Spark 11s)                                                                                                                                                                                                                                                                                                                                                    | 0.98        | 0.91        | 3.4         | —        | refrigerator fixture (31s live); offline replay IoU 1.0, score 92; goldens untouched                                                                                                                                                                      |
| 2026-11-02 | PR-0.6 Spark critic (patch API + live round + replay)                                                                                                                                                                                                                                                                                                                                                   | 0.98        | 0.91        | 3.4         | —        | goldens identical; live rescue 33 → 92 kept, 92 judged no-patch; no prompt lines to fold yet; fixed mid-PR: in-pipe IoU gate never fires (profiles nail silhouettes) → score-gated wrapper                                                                |
| 2026-11-02 | PR-3.1 kit eval harness + 4 captures                                                                                                                                                                                                                                                                                                                                                                    | 0.98        | 0.91        | 3.4         | —        | fridge/TV/fan/lamp captures; Spark-1.3 eval 23/26 agree, 8–19s; finding: TV-crop subtype flips tv↔tv_table                                                                                                                                                |
| 2026-11-02 | PR-3.4 model choice (eval × 3) + PR-3.6 pass                                                                                                                                                                                                                                                                                                                                                            | 0.98        | 0.91        | 3.4         | —        | 1.3: 23/26, 13.8s kept; 1.2: 22/26, 5.8s fallback; wonder: 21/28, 17s dropped; S3 pass: no drops                                                                                                                                                          |
| 2026-11-02 | PR-4.1 S4 spike: STOP                                                                                                                                                                                                                                                                                                                                                                                   | 0.98        | 0.91        | 3.4         | —        | img2img 9–26.5s; 2/3 views wrong (top→front, side→front); hull needs every view right → PR-4.2…4.5 not built                                                                                                                                              |
| 2026-11-02 | PR-5.1/5.2 docs + scenarios (V75…V77)                                                                                                                                                                                                                                                                                                                                                                   | 0.98        | 0.91        | 3.4         | —        | contracts (subtype, withViews, kit/outline), copilot (prompt v2, model choice), perf budgets; `texture` superseded by swatches/material                                                                                                                   |
| 2026-11-02 | Toy-Mini investigation FIX 1–3                                                                                                                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | miss-cause logs + crop outline fallback + wheel filter-then-cap; goldens identical (mean 93); 10 new tests; + header « run detection again » button (V78)                                                                                                 |
| 2026-11-02 | PR-2.22 facade-measured openings (SAM on the validated 2D facade)                                                                                                                                                                                                                                                                                                                                       | 0.98        | 0.91        | 3.4         | —        | goldens identical (no facade offline); cottage e2e: window from the facade with no photo window (\"from the facade\" log); 300 ms budget missed by every golden under load avg 16 (other agents), not facade-related                                      |
| 2026-11-02 | PR-2.23 house rebuilt from its elevations (front + Muse side)                                                                                                                                                                                                                                                                                                                                           | 0.98        | 0.91        | 3.4         | —        | goldens identical (no facade offline); live rural: hip roof, 2 chimneys, 7 windows, w:h 1:0.69 (was a tower); cottage: front gable kept, copied side dropped; 300 ms budget missed under load avg 8.9 only                                                |
| 2026-11-02 | PV-G G0+G1: elevation score, drawn materials, safe swatches, slope UVs, framed openings, roof/wall guard                                                                                                                                                                                                                                                                                                | 0.98        | 0.91        | 3.4         | —        | golden mean 93 (no regression); thatched elevation 89/100 (IoU 0.92, edge 0.86, openings 3/3, chimneys 0.67 = hidden by the roof slope)                                                                                                                   |
| 2026-11-02 | PG-T10 assemblies (door glazing / leaves / panels, lintels, chimney caps, roof bulge, 32 components)                                                                                                                                                                                                                                                                                                    | 0.98        | 0.91        | 3.4         | —        | golden mean 93 (no regression); thatched elevation 89/100 unchanged (flat render scores plain components); viewer drops details past 5 k triangles                                                                                                        |
| 2026-11-02 | PG-T13…T19: ShapeScript, staged loop (live + background, chip), round objects from their 2D view, panels on the hull path                                                                                                                                                                                                                                                                               | 0.98        | 0.91        | 3.4         | —        | golden mean 93 unchanged (photo path untouched offline); thatched elevation 89/100 = seed (mock proposer: no patch); loop never lowers the score by construction                                                                                          |
| 2026-11-03 | PG-T22 live loop pass: side-wall openings ignored by the front score and locked (`sideFacing`, `houseCanEdit`); stage capture + replay                                                                                                                                                                                                                                                                  | 0.98        | 0.91        | 3.4         | 3/5      | golden mean 93 unchanged; live thatched house: seed 95/100 after the fix (was 89 → 95 by deleting side windows)                                                                                                                                           |
| 2026-11-03 | PG-T22 close: half-hip roof (`hip` `clip`, read on the front outline), plaster wall colour on half-timbered houses                                                                                                                                                                                                                                                                                      | 0.98        | 0.91        | 3.4         | 4/5      | golden mean 93 unchanged, thatched golden 99; live capture seed rebuilt 95 → 97 (roof 0.95 → 0.97)                                                                                                                                                        |
| 2026-11-10 | PQ-T2 detail score (part recall / precision, interior edge F1, part ΔE), four report columns, not weighted                                                                                                                                                                                                                                                                                              | 0.98        | 0.91        | 3.4         | —        | golden mean 93 unchanged; no golden has SAM part masks (recall / precision / part ΔE « — »); interior edge F1: car 0.81, lamp 0.31, cottage 0.17, fridge 0, tree 0 — the ruler now sees the missing handle                                                |
| 2026-11-10 | PQ-T1 (code): « Real » table from local captures, missing ids listed, part masks kept in captures                                                                                                                                                                                                                                                                                                       | 0.63 (real) | 0.48 (real) | 7.3 (real)  | —        | first real baseline, 3 captures: lamp 32, fan 55, fridge 92 → real mean 60 vs synthetic 93; TV capture has no outline (not scorable); 13 of 16 ids missing; Next = lamp (edge F1)                                                                         |
| 2026-11-10 | PQ-T3 flat render draws assemblies (shared `expandAssemblies` with the viewer, exact part origin, holes, framing on recipe parts)                                                                                                                                                                                                                                                                       | 0.98        | 0.91        | 3.4         | —        | golden mean 93 unchanged; thatched elevation 99 → 97 (chimney caps 1 → 0.88, roof roll 0.99 → 0.96: the drawing has neither); car shape math 255 → 296 ms (budget 300)                                                                                    |
| 2026-11-10 | PQ-T5 prompt versions (kit, critic, views check, side view) logged, stored in captures, eval grouped by version (`PROMPT=1,2`)                                                                                                                                                                                                                                                                          | 0.98        | 0.91        | 3.4         | —        | no geometry change; goldens unchanged                                                                                                                                                                                                                     |
| 2026-11-10 | PQ-T36 worst height band (SSIM, ΔE, blank bands) and degenerate view (0° / 45° / 90°) in the report                                                                                                                                                                                                                                                                                                     | 0.98        | 0.91        | 3.4         | —        | goldens unchanged, all views ✓; real: fan ✗ 2 pieces at 45°, lamp ✗ 4 blank bands (worst SSIM −0.28), fridge ✓                                                                                                                                            |
| 2026-11-10 | PQ-T37 (partial) hard gates: floating parts pulled in, fused twins merged, « seen, not built » log and report column                                                                                                                                                                                                                                                                                    | 0.98        | 0.91        | 3.4         | —        | no golden or real model changed by the repair; Not built « — » everywhere (no capture has part masks yet)                                                                                                                                                 |
| 2026-11-10 | PQ-T4 (code) rubric judge: Judge card, `judgeShape` (Wonder), damage + calibration, `make shape-judge` with stored answers                                                                                                                                                                                                                                                                              | 0.98        | 0.91        | 3.4         | —        | offline only, nothing changes in the live path; calibration pending (API)                                                                                                                                                                                 |
| 2026-11-10 | PQ-T1 real baseline: 12 real captures (Wikimedia Commons photos, local only) + fixes found on the way (clamp, on-demand outline kept, SAM head noun + label retry)                                                                                                                                                                                                                                      | 0.72 (real) | 0.38 (real) | 9.9 (real)  | —        | real mean 55 vs synthetic 93; worst lamp 32, car-hidden 38, motorbike 40; best fridge 92. Not scorable: pump (SAM knows no pump word), solar street light (SAM returns a part), utility pole (re-capture after the label fix pending); car-corner missing |
| 2026-11-10 | PQ-T6 gates and weights: `STOP_DETAIL` (recall ≥ 0.8, precision ≥ 0.8, interior edge F1 ≥ 0.12, part ΔE ≤ 7), `SCORE_WEIGHTS_DETAIL` with part masks                                                                                                                                                                                                                                                    | 0.72 (real) | 0.38 (real) | 9.9 (real)  | —        | goldens unchanged (no masks); real rows with masks re-weighted: motorbike 52 → 40 (recall 0), car-side 51 → 50                                                                                                                                            |
| 2026-11-10 | PQ-T4 judge calibration (Muse Wonder, prompt v1) on 11 real pairs; fixes: fallback answers never counted/stored, undamageable captures skipped; pole re-captured (label retry: outline found), pump lookalike outline found live                                                                                                                                                                        | 0.72 (real) | 0.38 (real) | 9.9 (real)  | —        | damaged lower in 73 % < 90 % → developer note only. Judge grades most models 1–2 (floor). Pole score 33. Pump and car-corner captures blocked by Meta ETIMEDOUT on image calls                                                                            |
| 2026-11-10 | PQ-T1 complete: pump (full-label retry found the outline) and car-corner captured; judge re-run on 13 pairs                                                                                                                                                                                                                                                                                             | 0.69 (real) | 0.37 (real) | 10.1 (real) | —        | 15 of 16 real ids scored, mean 54; car-corner 70, pump 45, pole 33; only solar street light unscorable (PQ-T9). Judge 77 % < 90 % → developer note only                                                                                                   |
| 2026-11-10 | PQ-T37 « Not built » explained; `masksOnObject` drops SAM part masks outside the object's outline (notBuilt, recall, precision, landmarks)                                                                                                                                                                                                                                                              | 0.69 (real) | 0.37 (real) | 10.1 (real) | —        | real mean 53 (house-front 65 → 48: its only matched « window » was below the house). Left: car-side window ×3 (yaw 53° on a side view), car-corner window ×1, house-row chimney ×2 (46° > 17° by design), hut door ×1 (no template door)                  |
| 2026-11-10 | Q1: PQ-T7 photo conditions (in). PQ-T8 tight crop **reverted** (eval-shape 98/118 vs 99/116, median 28.9 vs 24.5 s, windows worse). PQ-T9 SAM agreement 12/13 = plain 12/13, **off**. PQ-T10 lit colours: report identical with and without (real set has no shadowed wall), kept on unit proof. shape-report real mean 53, synthetic 93                                                                |
| 2026-11-11 | PQ-T11 skill loader (cards generated from the doc, `make skills-gen`). PQ-T12 kit prompt 2 (cards + evidence first) **measured, off**: eval-shape v1 95/117 agree, median 22.9 s; v2 83/121, median 47.3 s (windows, units, materials worse; every call about twice as slow). `KIT_PROMPT_VERSION` stays 1. PQ-T37 wired: `evidence.visibleParts` → `notBuilt` / panel coverage (inert under prompt 1). |
| 2026-11-11 | PQ-T25 two-tone hull body (`withHullTones`): unit proof only, no live capture of a two-tone object yet                                                                                                                                                                                                                                                                                                  | —           | —           | —           | —        | colour-per-part ΔE on real two-tone objects pending a Meta key                                                                                                                                                                                            |
| 2026-11-11 | PQ-T26 gloss from the photo (`gloss-measure.ts`, `surfaceLook`): unit proof only                                                                                                                                                                                                                                                                                                                        | —           | —           | —           | —        | viewer-only change, scores unchanged; `/designer-3d` on `make shape-shots` pending a live run                                                                                                                                                             |
| 2026-11-11 | PQ-T27 vertex AO (`vertex-ao.ts`, viewer geometry only): unit proof                                                                                                                                                                                                                                                                                                                                     | —           | —           | —           | —        | scores unchanged (flat render ignores vertex colours); `/designer-3d` ≥ 4 pending a live run                                                                                                                                                              |
| 2026-11-11 | PQ-T35 shade map over 2 tiles + seeded UV offset per surface (`surface-maps.ts`): unit proof                                                                                                                                                                                                                                                                                                            | —           | —           | —           | —        | viewer-only, scores unchanged; the grid-of-repeats check on `make shape-shots` pending                                                                                                                                                                    |
| 2026-11-11 | PQ-T39 physical material rules (`painted`, metal 1, `pbr-rules.ts`): unit proof                                                                                                                                                                                                                                                                                                                         | —           | —           | —           | —        | flat render uses part colours (clamped 30–240 sRGB, small shifts on black / white parts); ΔE of the red car body vs baseline pending `make shape-shots`                                                                                                   |
| 2026-11-11 | PQ-T32 shared materials + village families, PQ-T34 glow: unit proof                                                                                                                                                                                                                                                                                                                                     | —           | —           | —           | —        | viewer / village / VR only, scores unchanged; shots and scene-audit pending                                                                                                                                                                               |
| 2026-11-11 | PQ-T33 N8AO + key-light shadow in the viewer: unit proof                                                                                                                                                                                                                                                                                                                                                | —           | —           | —           | —        | viewer only, scores unchanged; designer grade and lit-face ΔE pending a GPU run of `make shape-shots`                                                                                                                                                     |
