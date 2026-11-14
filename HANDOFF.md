# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T75 not on `main` yet; rebase before the PR)

## NEXT: PQ-T76 (b) — wheels measured on the profile (dark circles, `mask-wheels.ts`), then `CarPlan`

## PQ-T76 (a) — vehicle proportions from the elevations (done 2026-11-14)

- `recon/views.ts`: `AlignedViews.aspects` (w, d per unit height, before the grid clamp),
  `profileProportions`, `bodyWidthShare` (widest row of the lower half: mirrors out), `vehicleAspects`.
  `recon/route.ts`: a `vehicle` takes them; `depthFromPlan` no longer applies to it.
- Replays w/d · h/d: sedan 0.42 · 0.35, SUV 0.39 · 0.35, truck 0.40 · 0.41 (were 0.55 · 0.46, 0.57 · 0.46,
  0.49 · 0.50). Outputs `c-*/t76a/`, captures `c-*/voiture-3d-t76a.jpg`, `t76a-sheet.jpg`.
- Houses: bungalow replay = `house-pq-t72.json`; bungalow + school `recipe.json` identical before / after.
- Full-run flake: `recon.test.ts` "stays in the time budget" can exceed 900 ms under parallel load (passes alone).

Brief: `docs/tasks/PV-car-generation.md` § 6 (step 0 findings + proposed order). Task: `PV-vision-quality.md` PQ-T76.
Offline replay: `make views-3d FRONT=…/view-front.png RIGHT=… BACK=… LEFT=… TOP=… OUT=… LABEL=car OFFLINE=1 MATERIALS=metal,glass,…`
(drawings in `~/Téléchargements/generated-view/c-{sedan,suv,truck-side}/`).

## PQ-T76 step 0 — three cars live, no code change (2026-11-14)

- Muse views are good and consistent (front-first prompt is **not** the problem). Truck top view drawn
  lengthwise → rejected by `alignTop` (correct).
- Model 25–40 % too short: `GRID_COLS_MAX` 256 / `GRID_ROWS` 128 caps depth at 2 × height (h/d floor 0.50);
  `depthFromPlan` lets a too-wide Muse top view (w/d 0.54–0.57) override the profile (0.43–0.47).
- No part roles, wheels absent or flat (sedan 2 thin cylinders on one axle, SUV/truck 0), boxy body.
- Colour classes: dark roof falls into glass (sedan), body ≈ glass on the black SUV; materials mislabelled.
- Captures: `c-*/views-sheet.jpg`, `c-*/viewer/`, `c-*/voiture-3d-t76.jpg` (photo | viewer | hull).

## Decisions

- Step 1 of the brief (profile-first prompt) deprioritised: the drawings are fine, the recon is not.
- Order: (a) done; (b) wheels measured on the profile (`mask-wheels.ts`) then `CarPlan`, (c) glazing / body split.
- Any change to `views.ts` must leave houses identical (it is shared): check `house-mesh.test.ts` hashes and
  the bungalow replay (`cmp` with `house-pq-t72.json`).

## Open (houses, unchanged)

- V335–V343 not played on `/village`; phase PR PQ-T67 → T75 not opened.
- Pending user calls: door snap fix (moves the bungalow reference), views check + redraw.
