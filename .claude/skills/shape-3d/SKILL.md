---
name: shape-3d
description: Build or change the 3D model of one detected object (photo → kit → parts → mesh) on /village — templates, primitives, measurements on the photo, materials, the server shape pipeline and the 3D editor viewer. Use for work in lib/object-*, server/perception shape files, or features/vision-insert 3D geometry.
---

Implementer for the object 3D model. Plans: `docs/tasks/PV-vision-quality.md` (PV-Q, next: real set and detail
score before any other change), `PV-shape-realism.md` (loop log), `PV-shape-fidelity.md` (done).
Method and the as-built pipeline: `docs/vision-to-3d-methodology.md`. Any change to a Muse prompt starts from its
card in `docs/vision-to-3d-muse-skills.md` and is kept only on a measured eval (that file, § 1.3).
Judge every change with `/shape-loop`.
**Code first (PQ-T57/58).** The final model of any object is the `build(api, params)` code Wonder writes (route B,
`shape-code.ts` prompt v3 « modeler », `shape-code-loop.ts`, sandbox `code-sandbox.ts`); the template is only the draft and
the fallback. Work like a modeller: look → volumes → secondary forms → details → check. Debug a run with
`make code-dump` (`debug/shape-code/`: build() per round, Blender `.py`, question, score).

**Hard rules**

1. Meta models only (Muse Spark / Wonder, Muse Image, SAM 3.1). No other AI vendor.
2. Never paste or project the photo on the model. Allowed: colours measured on it, and small tileable swatches
   (≈ 64 px) cut from it as material textures.
3. Spark says **what** (archetype, sub-type, materials, counts); pixels say **how it looks** (outline, colours, roof,
   repetition, yaw, part masks). Measurements win by confidence (`fusion.ts`).
4. Shape math is pure, seeded TS in `server/perception/` (no `Math.random`), ≤ 300 ms per object; every function has
   a Vitest test; a fixed bug gets a regression test (« before: … »).
5. ≤ 5 k triangles and ≤ 12 parts per object (Spark template draft; the code path allows ≤ 32 parts; server-built facade / views recipes ≤ 32 components `MAX_COMPONENTS`, assemblies expanded in the viewer, PG-T10); one merged geometry, groups per material.
6. No energy value anywhere in this pipeline.

**Map (read barrels first, then only what the task names)**

| Layer                       | File                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kit schema, templates       | `apps/web/src/lib/object-kit.ts` (`TEMPLATES`, `facade`, `kitToRecipe`)                                                                                                                                                                                                                                                                                                                                                                                  |
| Recipe schema, fit to box   | `apps/web/src/lib/object-shape.ts` (`RecipePart`, `fitRecipe`, materials)                                                                                                                                                                                                                                                                                                                                                                                |
| Spark prompt / parse        | `server/perception/shape.ts` (`SHAPE_SYSTEM_PROMPT`, `SHAPE_JSON_SCHEMA`, `parseKit`)                                                                                                                                                                                                                                                                                                                                                                    |
| Free parts (PV-T9c)         | `server/perception/free-recipe.ts`: template-less archetypes get imagined parts (`source: 'free'`)                                                                                                                                                                                                                                                                                                                                                       |
| Pipeline                    | `server/perception/object-shape.ts` (`runObjectShape`, logs `[vision] 3D …`)                                                                                                                                                                                                                                                                                                                                                                             |
| ShapeScript + loop (PV-G)   | `lib/shape-script.ts` (ops, `compileScript`, `recipeToScript`), `server/perception/shape-stages.ts` (`runShapeStages`, `houseCanEdit`), `stage-capture.ts` (record / replay, `make eval-stages`), `view-stages.ts` (stages per archetype, `scoreViews`), `features/vision-insert/utils/view-assemblies.ts` (wheel rims, cell lines), `shape-stages-spark.ts` (Spark proposer, `facadeStageLoop`), `shape-script-prompt.ts`, `shape-jobs.ts` (background) |
| Assemblies (PG-T10)         | part options `leaves glazed panels sill lintel cap bulge`; `utils/assembly-parts.ts` `expandAssemblies` (viewer **and** flat render, PQ-T3), `utils/openings.ts`, `utils/roof-trim.ts`                                                                                                                                                                                                                                                                   |
| From the 2D view            | houses `facade-house.ts`; hull `object-views.ts` `viewsRecipe`; round (tree, bush, pole, lamp) `roundViewRecipe`                                                                                                                                                                                                                                                                                                                                         |
| Score (judge)               | `model-score.ts` (weighted score), `detail-score.ts` (PQ-T2: part recall / precision, interior edge F1, part ΔE; beside the score), `score-shape.ts` `scoreRecipe`, `shape-report.ts`                                                                                                                                                                                                                                                                    |
| Measurements                | `color-measure`, `shape-colors`, `roofline`, `repetition`, `perspective`, `silhouette-fit`, `fusion`                                                                                                                                                                                                                                                                                                                                                     |
| Viewer geometry / materials | `features/vision-insert/utils/object-geometry.ts`, `utils/surface-look.ts`, `ui/object-editor-3d.tsx`                                                                                                                                                                                                                                                                                                                                                    |
| Golden set                  | `server/perception/__fixtures__/shape/`, `__tests__/golden-shape.test.ts`, `make test-shape`                                                                                                                                                                                                                                                                                                                                                             |

**Meta in the render loop (Spark as visual critic)**

Meta models do not render 3D; we render, Spark judges. The flat render (`server/perception/flat-render.ts`
`renderFlat`, same frame as the photo box) is what makes the selected box and the model comparable.

1. Render the fitted recipe at the photo view (`renderFlat(recipe, boxW/boxH, 256, …)`) → PNG with `sharp`
   (white background, same size as the crop).
2. Send Spark **one image**: crop (left) | flat render (right), side by side, plus the current kit JSON and the
   `scoreModel` numbers. Prompt: « Left is the photo of the selected object, right is our 3D model seen from the
   same view. List what differs (shape, sub-type, counts, proportions, colours of each part) and answer only a
   JSON patch of the kit. » Schema = a partial `ObjectKit` (strict JSON schema, same parser as `parseKit`).
3. Apply the patch → re-fit → re-render → re-score. **Keep it only if the score rises**; otherwise drop it.
4. At most 1 round in the live request (only when score < 70 and ≥ 20 s remain); offline (captured fixtures,
   `make eval-shape`) up to 3 rounds to learn which prompt lines help, then fold them into `SHAPE_SYSTEM_PROMPT`.
5. Spark never sends geometry numbers it cannot see (metres, watts); counts, sub-type, proportions and part
   colour roles only. Measurements still win over its patch by confidence (`fusion.ts`).

**Adding things**

- A primitive: unit builder in `object-geometry.ts` (non-indexed, uv + normal like the others) **and** its outline
  points in `silhouette-fit.ts` `unitPoints`, plus `RECIPE_SHAPES`. Test vertex count and bounds.
- A template / sub-type: role colours only (`c.main/secondary/accent`), main body first, ≤ 12 parts; golden case.
- A measurement: pure function + confidence in `fusion.ts` + one log field; never trust it below its confidence.
- Contract change → `docs/contracts.md`; prompt / model change → `docs/copilot.md`; visible change → scenario in
  `test-scenarios/06-village.md`.

**Done =** `make test-shape` green, `/shape-loop` row logged with no metric regressed, typecheck + lint + i18n.
