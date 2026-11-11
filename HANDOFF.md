# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q4 (PR to `main`, one commit per task)

## Current state

- **PV-Q Q4 built, ticked on the owner's request** (live Meta / GPU checks pending, like Q2–Q3). One commit per task:
  T25 `withHullTones` (two-tone hull body) · T26 gloss (`gloss-measure.ts`, `ObjectRecipe.gloss`, `surfaceLook`) ·
  T27 `vertex-ao.ts` · T35 2-tile shade map + `surfaceOffset` · T39 `painted` + PBR rules (`pbr-rules.ts`) ·
  T34 glow surfaces `lamp` / `screen` · T32 `buildRecipeMaterials` + village families · T33 N8AO + key shadow ·
  T40 `LOOKDEV=1 make shape-shots`. Details per task in `docs/tasks/PV-vision-quality.md`.
- **T28 cut** (no compare view in the panel; the task allows cutting it). Left unticked.
- Nothing stored in Neon changed (recipe JSON fields only): no migration.

## Next

1. Merge the Q4 PR once CI is green.
2. With a GPU + dev server: `make shape-shots` (and `LOOKDEV=1`), `/designer-3d` on the shots, ΔE of the red car
   body vs baseline (T39), no grid of repeats (T35), vertex AO look (T27), `make scene-audit` (village now ≤ 5
   meshes for placed models, one over the plan) and `make vr-probe` (T32).
3. With a Meta key: T25 on a real two-tone photo, T26 gloss classes on real objects.
4. T28 if a compare view is wanted (new screen, design gate first).

## Files touched

- `lib/{object-shape,object-kit}.ts`, `server/perception/{region-colors,gloss-measure,pbr-rules,object-shape}.ts`,
  `skills/cards.generated.ts`, `features/vision-insert/{utils/{surface-look,surface-maps,surface-textures,vertex-ao,
recipe-materials,studio-env,lookdev,object-geometry}.ts,ui/object-editor-3d.tsx,ui/xr/spawned-object-3d.tsx}`,
  `features/microgrid-3d/{utils/placed-models-geometry.ts,ui/appliance-markers.tsx}`, `scripts/{lookdev-plan.mjs,
object-viewer-shot.mjs}`, docs (`contracts`, `copilot`, `performance`, methodology, muse skills, tasks).

## Decisions

- Gloss is per material on the recipe (the viewer has one material per surface), not per part.
- A named `metal` on a vehicle / cabinet main role becomes `painted`; non-metal base colours clamp to 30–240 sRGB.
- Glow surfaces are internal (`GLOW_SURFACES`), not recipe materials: the AI never names them.
- Local scenarios V253–V261 (test-scenarios is gitignored). Hub dataset not republished: no bench / eval output changed.
