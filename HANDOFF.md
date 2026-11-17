# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-17 · **By:** Claude Code · **Branch:** `feat/pq-t91-evals-docs` (from `main` db309ed4). Phase PV-T specialist teams (`docs/tasks/PV-specialist-teams.md`), PQ-T89–T91 done.

## NEXT

1. Screen check of the end of phase on `/village`, live Meta (contributor model): photos of a sofa, a chair, a curtain, a fence and a rock → models with named parts (scenarios V533–V538 in `test-scenarios/06-village.md`). Then tick the first « Fin de phase » box.
2. Repair `make gen-evals` / `make hf-dataset`: `jiti` is not installed in the workspace (`Command "jiti" not found`).
3. Back to the Devpost points of VS-T49 (IWSDK / PWA APK, video, deploy freeze) if the deadline still allows.

## Done (PQ-T89 → PQ-T91, PRs #39, #40 merged)

- Furniture teams (seat, table, storage, bed) faithful on the tour: 25/28 at IoU ≥ 0.85 front and side, plus a fit pass on measured proportions.
- New teams, registered in `team/registry.ts` and built through `FURNITURE_TEAMS`:
  - textile (on the SAM outline): 9/10;
  - fixture: 14/14;
  - structure: 6/6;
  - terrain: 8/9;
  - appliance (cabinet / screen / fan / machine / tank): 5/7;
  - light (lamp_post): 10/13.
- Builders promoted from the tour mock to `server/perception/furniture/` and reused by the tour: silhouette, soft (rug, rods, backdrop), structure (gate), terrain, appliance, lights.
- `ownSpec` helper (`team/teams/furniture.ts`) for each team's own specialist. `APPLIANCE_LABELS` en / fr / mg.
- PQ-T91: per-class eval test « eval cases per class » (≥ 3 replayed tour objects per team, 2 for the bed; any floor below 0.85 has a written limit). README features/limits, tasks README status.

## Decisions

- Limits written in the fixtures rather than tuning builders to one object:
  - loft-rug, side view under one grid cell;
  - forest-rock, an SDF sculpture;
  - fireplaces 0.84, one body depth;
  - house-wall-lamp-2 0.79;
  - softboxes and marquee letters, which are not one fitting.
- A flush fitting or a frame gets its absolute size from its fixed thickness (disc 7.5 cm, frame depth).
- `gen-evals` makes only the copilot evals (unchanged) and the HF dataset holds no perception data, so nothing was republished.

## Checks

- `make house-regress` green.
- Car and plant tests green.
- `make check`: 0 lint errors.
- The recon time-budget and roof tests flake under the full run but pass on their own (27/27).
