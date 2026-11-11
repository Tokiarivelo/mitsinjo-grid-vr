# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q3 (PR to `main`, one commit per task)

## Current state

- **PV-Q Q3 built, ticked on the owner's request** (live Meta checks still pending, like Q2). One commit per task:
  - PQ-T20 `RecipePart.details` (handle, seam, mirror, arch, rim, gutter, vent, foot): `view-assemblies.ts`
    (`detailPartsOf`, `outlineDetails` used by `silhouette-fit`), dropped first past 5 000 triangles. Nothing sets
    `details` yet: builders / Spark opt in.
  - PQ-T21 `partCeiling` (mask-geometry): mask passes reach 32 parts, `source: 'free'` stays at 12.
  - PQ-T22 `farSide` in `hidden-sides.ts` (vehicle, cabinet), `farRoom` up to 32.
  - PQ-T24 rear end of a views-path vehicle mirrored from the front (inferred). « Second side on request » NOT built.
  - PQ-T19 `photo-stages.ts` + `photoStageLoop` (sheet `photo`, stage id `chimney`): runs in `runObjectShape` after
    hidden sides when an outline and `proposeShapeOps` exist; seed wins without a kept change; no checkpoint context.
  - PQ-T23 clean front: `CleanFrontOffer`, route field `cleanFront`, `ShapeTarget.cleanFront`, `markDrawnInferred`.
  - PQ-T10 (forgotten in Q1) region colours on the lit surface (`litMeasure`, `shadow` apart).
- Existing mask tests now use `source: 'free'` fixtures to keep covering the 12 budget.

## Next

1. Merge the Q3 PR once CI is green.
2. With a Meta key: measure T19 (detail score rises, never lowers, on the real photo-path objects), T23 (hidden car
   IoU on the visible region), T22 sheet, T10 on a real shadowed photo. `make shape-report` replays captures: per-part
   colours cannot move offline.
3. T19 left: replay of a recorded loop in `eval-stages`; resume across requests (add a `photo` checkpoint kind).
4. T23 design gate: screenshots (both themes, 390 px) of the clean-front block; no Stitch mockup.
5. Add `details` where the builders know them (fridge handle + seam, car mirrors + arches).

## Files touched

- `lib/object-shape.ts`, `lib/shape-script.ts`, `server/perception/{photo-stages,hidden-sides,mask-*,object-views,object-shape,
shape-stages-spark,view-stages,region-colors,facade-specialist,silhouette-fit,shape-script-prompt}.ts`,
  `features/vision-insert/{ui/clean-front-offer.tsx,ui/object-shape-panel.tsx,utils/view-assemblies.ts,hooks/*}`,
  `app/api/vision/facade/route.ts`, `messages/*.json`, docs (`contracts`, `copilot`, `tasks/PV-vision-quality`).

## Decisions

- Inferred parts never displace measured ones: far-side set is atomic and added last.
- Local scenarios V244–V248 (test-scenarios is gitignored). Hub dataset not republished: no bench / eval output changed.
