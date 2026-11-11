# PV-H — Any object from its validated 2D view (hull + AI check)

**Why (user 2026-11-02):** a front-view « purple vintage car » came out as a truncated block: the photo
path reads every vehicle outline as a side profile, and only houses had a facade path. « Le LLM peut
générer n'importe quel objet », then « après rendu, ajoutez une vérification de l'IA … il devrait
l'auto corriger ».
**Status:** 🟡 H1 + H2 done (2026-11-02). Live: front-view car → full car in 67 s, 17 parts, IoU front 0.88 / side 0.79.
**Rules kept:** Meta models only (Spark, Muse Image, SAM 3.1); the LLM never gives coordinates; houses keep PV-G.

## H1 — Hull from the views

- [x] **PH-T1** `hull` shape: front ring `points` along z ∩ side ring `section` along x (`lib/hull.ts`,
      schema, server ray-cast `flat-render.ts`, silhouette-fit points, viewer `unitHull` ≈ 1.6 k tris).
- [x] **PH-T2** `object-views.ts`: SAM outline + parts on the 2D view, Muse Image side (front to the left,
      redrawn once when it repeats the front), SAM on the side → `viewsRecipe` (`source: 'views'`):
      hull body, wheels notched in, side glass / windshield / grille as skin patches, lights, bumper.
      Front only → front extruded to Spark's depth.
- [x] **PH-T3** Silhouette IoU per view (`viewIou`), logged; `make facade-e2e … LABEL= SCENERY=`.
- [x] **PH-T4** Fix: a ray entering a ring through its edge rendered nothing (extrude side views were empty).
- [x] **PH-T4b** Fix (2026-11-04): a drawn side whose depth is more than × 2 off Spark's estimate is dropped
      (`sideDepthPlausible` / `keepPlausibleSide`, also after the AI check) → Spark's depth. Was: a fridge drawn
      3.44 × deeper than wide was kept (IoU side 0.995 on the bad drawing), w:h:d 0.29:0.69:1.00.

## H2 — AI check and self-correction

- [x] **PH-T5** `checkViews` (Meta / mock / client): 2 × 2 sheet (drawing | model, front and side) →
      missing parts per view, colour, material, or « redraw the side » (`views-check.ts`).
- [x] **PH-T6** Fixes: SAM measures each named part on its view; known parts follow the rules, others become
      patches (rear / tail parts on the back face); rebuild, keep when the silhouette holds; ≤ 2 rounds,
      35 s per round inside a 90 s budget; `shape_step: check` shown in the panel.
- [x] **PH-T7** Budget: server-built recipes up to 24 parts (`MAX_BUILT_PARTS`), groups ranked
      (glass → AI asks → lights / bumper → grille), mirrored pairs whole.

## Next

- [x] **PH-T8** Colour per region of the hull body (two-tone cars, tree trunk vs canopy) from SAM masks. _(PQ-T25)_
- [ ] **PH-T9** Top / back views when the AI check asks for them; trees, bushes, poles on the hull path.
- [ ] **PH-T10** Background improvement after the first answer with the stage indicator (PG-T13–T18).
