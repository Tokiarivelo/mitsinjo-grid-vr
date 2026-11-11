# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q3 (PR to `main`, one commit per task)

## Current state

- **PV-Q Q3 built, ticked on the owner's request** (live Meta checks still pending, like Q2). One commit per task:
  T20 `RecipePart.details` (nothing sets them yet) · T21 `partCeiling` (32 measured, 12 imagined) · T22 `farSide` ·
  T24 rear by mirror (« second side on request » NOT built) · T19 `photoStageLoop` (no checkpoint context) ·
  T23 clean front · T10 region colours on the lit surface. Details per task in `docs/tasks/PV-vision-quality.md`.
- Existing mask tests now use `source: 'free'` fixtures to keep covering the 12 budget.
- **PR #14 reviewed** (fix commit): cabinet far side mirrors `frame` only (template handle / door line stayed on
  the back); clean front keeps « Retry with details », stays clean on retry after a remount, `clean` follows the
  request (mock too), house facade route marks drawn parts inferred; wheel arch never under the tyre.
- `make test-shape` strict 300 ms budget fails on this machine on `main` too (302–342 ms): not from Q3.

## Next

1. Merge the Q3 PR once CI is green.
2. With a Meta key: measure T19 (detail score rises, never lowers, on the real photo-path objects), T23 (hidden car
   IoU on the visible region), T22 sheet, T10 on a real shadowed photo. `make shape-report` replays captures: per-part
   colours cannot move offline.
3. T19 left: replay of a recorded loop in `eval-stages`; resume across requests (add a `photo` checkpoint kind).
4. T23 design gate: screenshots (both themes, 390 px) of the clean-front block; no Stitch mockup.
5. `details` in the builders: template car checked on the flat render, mirror lands mid-door (62 % of a low
   body) and arch is dark on dark: fix placement with a viewer pass before opting in.

## Files touched

- `lib/object-shape.ts`, `lib/shape-script.ts`, `server/perception/{photo-stages,hidden-sides,mask-*,object-views,object-shape,
shape-stages-spark,view-stages,region-colors,facade-specialist,silhouette-fit,shape-script-prompt}.ts`,
  `features/vision-insert/{ui/clean-front-offer.tsx,ui/object-shape-panel.tsx,utils/view-assemblies.ts,hooks/*}`,
  `app/api/vision/facade/route.ts`, `messages/*.json`, docs (`contracts`, `copilot`, `tasks/PV-vision-quality`).

## Decisions

- Inferred parts never displace measured ones: far-side set is atomic and added last.
- Local scenarios V244–V252 (test-scenarios is gitignored). Hub dataset not republished: no bench / eval output changed.
