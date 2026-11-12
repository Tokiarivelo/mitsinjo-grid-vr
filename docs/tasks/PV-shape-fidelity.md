# PV-F — 3D shape fidelity: measure the photo, ask Spark less (plan)

**Why (user, 2026-11-01):** for `det-4` « stone cottages row » (Bourton-on-the-Water, box x 0.18 y 0.10 w 0.82 h 0.58),
the 3D model does not look like the photo: one box with a black stepped roof, a grey bar across the front, and the whole
photo (sky, roofs, cars) squashed onto the walls.
**Status:** ✅ done (PF-T1…T10; PF-T8: no SAM 3D on the Meta API, closed). **User change 2026-11-01:** the photo is no longer pasted on the 3D model (PF-T1 projection and `photo-mask.ts` removed); the model is shapes + measured colours only, so PF-T2…T6 measurements carry the likeness. (`perspective.ts`: yaw from the facade vanishing point; **deviation:** no homography per facade — the model is turned by the yaw; PF-T4 not yet rectified; `repetition.ts` + `sampleObjectGray`: units read on the roof band only — window edges on the walls gave false houses —, windows per house on the walls; `roofline.ts`: skyline from the SAM rings, segmented LSQ + BIC, `KitRoof`, `prism` part; `decalWidth`; `color-measure.ts` + `shape-colors.ts`, target `outline`; PF-T6 `silhouette-fit.ts` + `nelder-mead.ts`, **deviation:** `units` is not a fit parameter — a flat outline gained fake gables; h is fixed by the box; PF-T7 `fusion.ts`, **deviation:** the Spark prompt still asks colours, proportions and counts — they are the priors the fusion mixes with, and the only values when there is no photo or outline). PF-T9 golden set = 5 synthetic SVG street photos encoded to JPEG in the test (**deviation:** no real photos in the repo); it found and fixed 3 bugs: thin-object colours (area budget + inner pixels), false vanishing points from copies of one edge (`lineSpread`), gable slopes read as facade lines (houses read below the eave); fit yaw pulled to the measured one.
**Rule kept:** Meta models only. All math is pure, seeded TS and deterministic (same photo → same model), with tests.
It runs on the server on a ≤ 256 px copy of the crop, with no request time limit (target < 300 ms).

## Root causes (from the code)

| What the user sees                              | Cause                                                                                           | Where                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sky and cars painted on the walls               | The **whole box** is UV-mapped onto the front face of **one part** (walls = 60 % of the height) | `object-geometry.ts` `recipeMesh` → `setPhotoUv(front, box, mainPartBounds)` |
| Grey bar across the front                       | 8 windows of width 0.11 spread over 0.76 → they overlap; they are drawn **over** the photo      | `object-kit.ts` `house` template, `spread`                                   |
| Black roof, orange chimney                      | Colours are guessed by the LLM, not measured                                                    | `ObjectKit.colors`                                                           |
| One house instead of a row of 6, shown head-on  | The kit has no « row » count; perspective ignored: box aspect ≠ facade aspect                   | `kitToRecipe`, `fitRecipe(boxAspect)`                                        |
| Box corners that are not the object (sky, road) | The SAM outline is not used for the recipe mode                                                 | `ObjectModel` uses `detection.outline` only for the silhouette               |

## Principle: analysis by synthesis

Spark says **what** it is (archetype + semantics). The pixels say **how it looks** (mask, colours, roofline, repetition,
perspective). A small optimizer picks the template parameters whose rendered silhouette best matches the SAM mask.

```
photo crop ─┬─ SAM mask M(x,y) ──┬─ colours (k-means Lab per band)
            │                    ├─ skyline profile → roof segments (segmented regression + BIC)
            │                    └─ fit score IoU(render(θ), M)
            ├─ gradients ─────── vanishing points (Hough + RANSAC) → yaw, homography H, true facade aspect
            ├─ edge energy ───── autocorrelation → repetition period → units / windows
            └─ Spark kit ─────── archetype + prior counts (weighted by measurement confidence)
```

## Tasks

- [x] **PF-T1 Quick fixes (no new math).**
      (a) Projected photo: map the photo onto **every front-facing face of all parts** by orthographic projection of
      the whole model onto the box (`u = box.x + (x − minX)/W·box.w`, the same for `v`), not just the main part. Roof slabs
      then show the photo's roofs, and walls show the walls.
      (b) Mask the photo with the SAM outline (rasterised polygon → `alphaMap`, `alphaTest`), so sky and road vanish.
      (c) Templates: window width ≤ 0.7 × pitch, and **no decals on a face that carries the photo** (the photo already shows them).
      Test: UV of a roof vertex lands in the box's top band; 8 windows never overlap.
- [x] **PF-T2 Measured colours.** Server: pixels inside the mask, in CIELAB. **k-means** (k = 4, k-means++ init with a
      seeded PRNG, 10 iterations), then assign roles by vertical position: the top-band cluster = `secondary` (roof), the
      largest middle cluster = `main` (walls), the darkest small cluster = `accent` (glass). The LLM colours become a
      fallback only when the mask covers fewer than 2 % of pixels. Metric: ΔE2000 to a hand-picked colour < 10 on the golden set.
- [x] **PF-T3 Roofline from the mask.** Skyline `s(x)` = first mask row per column (upper envelope), smoothed (median 5).
      **Segmented least squares** (dynamic programming, O(n²) on 128 columns), with the number of segments chosen by **BIC**,
      gives the slopes and breakpoints. Rising/falling pairs = gables → pitch angle, ridge height, gable count. The
      template gets `roofHeight`, `pitch` and `gables[]` instead of 3 fixed slabs (new part: `prism` = extruded triangle).
- [x] **PF-T4 Repetition (rows, windows).** Vertical-edge energy `e(x) = Σ_y |∂I/∂x|` inside the mask (rectified by PF-T5
      when available). **Normalised autocorrelation** `R(τ)` → the first strong peak (> 0.35) gives the period `P`. Then
      `units = round(W / P)` (row of cottages) and windows per unit come from the same analysis on the wall band. A Spark
      count is used only when `R(P)` is weak. Kit: new `details.units` (1–8), and the template repeats the house along x.
- [x] **PF-T5 Perspective.** Sobel gradients → line segments (Hough, ≥ 20 px) → **vanishing points by RANSAC** on line
      intersections (2 horizontal VPs + vertical). From the horizontal VP: model **yaw** and a **homography H** that rectifies
      the facade; true aspect `w/h` = rectified width / height (replaces the box aspect in `fitRecipe`). Two VPs → two
      visible facades, split at the corner column, and each gets its own projective UV (`H₁`, `H₂`). No reliable VP
      (< 8 inliers) → today's front view.
- [x] **PF-T6 Fit by optimization.** Parameters θ = {w, h, d, roofHeight, yaw, units}. Render the model's silhouette at
      128 px (pure rasteriser, orthographic + yaw), score `J(θ) = 1 − IoU(render, M) + λ·chamfer(edges)`, minimise with
      **Nelder–Mead** (≤ 150 evaluations, seeded start = PF-T3…T5 estimates). Stop when ΔJ < 1e-3. Report the IoU in the
      shape result (`fit.iou`) and show « match 82 % » in the panel (computed, not AI).
- [x] **PF-T7 Fusion and Spark role.** The kit prompt asks only archetype + semantics (has chimney, material, roof type),
      ~40 tokens. Each measured value carries a confidence in [0, 1] (mask coverage, `R(P)`, VP inliers, IoU); the final
      value = confidence-weighted mix of measurement and Spark prior. Log `[vision] 3D fit iou=… units=… yaw=…`.
- [x] **PF-T8 Explore (optional): Meta SAM 3D Objects.** Check if the Meta Model API exposes single-image 3D reconstruction.
      If it does: request it behind a flag, convert to a decimated mesh (≤ 5k triangles), and keep PF-T1…T7 as the fast
      path and fallback. If it does not: write one line in `docs/copilot.md` and close the task.
- [x] **PF-T9 Golden set and budget.** `apps/web/src/server/perception/__fixtures__/shape/`: cottage row, lamp post,
      fridge, car, tree (small JPEGs + expected mask). Vitest: IoU ≥ 0.75, ΔE < 10, units / gables exact for the cottage,
      math < 300 ms. `make test-shape` target.
- [x] **PF-T10 Docs and scenarios.** `docs/contracts.md` (`fit`, `details.units`, `prism`), `docs/copilot.md` (Spark = semantics
      only), `docs/performance.md` (math budget); scenarios in `test-scenarios/06-village.md` (cottage row → 6 units, stone
      colour, no sky on the walls; lamp post unchanged; mock unchanged).
      _(Done 2026-11-02: contracts (`fit.iou`, `details.units`, `prism`, fusion), performance (math ≤ 300 ms) and
      scenarios (V55–V63) were already written with the implementations; added the missing copilot.md sentence
      (measured yaw/fit, Spark = semantic prior) and pinned V58 to 6 units for the Bourton row.)_

## Order and size

PF-T1 + PF-T2 fix most of what the screenshot shows (½ day). PF-T3 + PF-T4 give the row and the roofs (1 day).
PF-T5 + PF-T6 give the ¾ view and the match score (1–1.5 days). PF-T7…T10: ½ day. PF-T8 is time-boxed to 1 h.

## Out of scope

Full photogrammetry or multi-view, textures on hidden faces (back and sides stay plain colours), and any energy value:
geometry and colours only.
