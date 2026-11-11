# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q4 (PR to `main`, one commit per task)

## Current state

- **PV-Q Q4 built, ticked on the owner's request** (live Meta / GPU checks pending, like Q2–Q3). One commit per task:
  T25 `withHullTones` (two-tone hull body) · T26 gloss (`gloss-measure.ts`, `ObjectRecipe.gloss`, `surfaceLook`) ·
  T27 `vertex-ao.ts` · T35 2-tile shade map + `surfaceOffset` · T39 `painted` + PBR rules (`pbr-rules.ts`) ·
  T34 glow surfaces `lamp` / `screen` · T32 `buildRecipeMaterials` + village families · T33 N8AO + key shadow ·
  T40 `LOOKDEV=1 make shape-shots`. Details per task in `docs/tasks/PV-vision-quality.md`.
- **PR #15 review (2026-11-11, real GPU + dev server + live Meta):** viewer shots and `LOOKDEV=1` (36) fine. Fixed:
  gloss read contrast, not highlights (walls, foliage came out gloss) and was dropped on the photo path; a dark
  `metal` part turned pale silver → now `painted`. New `make gloss-report`; two-tone car in `family-photos.json`.
- **T28 cut** (no compare view in the panel; the task allows cutting it). Left unticked.
- Nothing stored in Neon changed (recipe JSON fields only): no migration.

## Next

1. Merge the Q4 PR once CI is green.
2. T25 on the views path: the `car-two-tone` capture went down the photo path (extruded body), so the hull cut
   did not run. Try it from /village with the 2D view first.
3. `make scene-audit-gpu` fails on the base scene, no placed model involved: low tier 651 k triangles (≤ 150 k),
   167 draw calls (< 150); high tier 2.4 M (≤ 800 k). To check against `main` and fix apart from Q4.
4. Village families with placed models: unit-tested only (≤ 5 meshes); `make vr-probe` not run. T28 if wanted.

## Files touched

- `lib/{object-shape,object-kit}.ts`, `server/perception/{region-colors,gloss-measure,pbr-rules,object-shape}.ts`,
  `features/vision-insert/{utils,ui}` (surfaces, maps, AO, materials, lookdev, viewer, XR), `features/microgrid-3d`
  (placed models), `scripts/{lookdev-plan,object-viewer-shot}.mjs`, `Makefile`, `family-photos.json`, docs.

## Decisions

- Gloss is per material on the recipe (the viewer has one material per surface), not per part.
- A named `metal` on a vehicle / cabinet main role becomes `painted`; non-metal base colours clamp to 30–240 sRGB.
- Gloss: only smooth materials are classed, glass and water never matt, read per part against the 90th
  percentile, as the last pipeline step (`finishLook`). Limits 8 / 14 L\* from the real captures.
- Glow surfaces are internal (`GLOW_SURFACES`), not recipe materials: the AI never names them.
- Local scenarios V253–V262 (test-scenarios is gitignored). Hub dataset not republished: no bench / eval output changed.
