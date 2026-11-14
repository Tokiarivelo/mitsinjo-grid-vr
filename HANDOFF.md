# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T75 not on `main` yet; rebase before the PR)

## NEXT: PQ-T76 (d) — `fitCar`: snap the team reading on the pixels, then `carMesh`

Brief: `docs/tasks/PV-car-generation.md` (§ 4 rules, § 6 findings + done steps). Task: `PV-vision-quality.md` PQ-T76.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`; never edit `house/` or `lib/house-*.ts`;
  shared `recon/` changes gated on `vehicle`. Cars are built by their own specialist team.
- Go live once per car to get a reading, then replay it: `make car-replay OUT=…` (offline, free).

## Done this session (PQ-T76)

- Step 0 findings (three cars live). (a) proportions from the elevations (`car/car-proportions.ts`).
- (b) `CarPlan` (`lib/car-plan.ts`, `recipe.car`), wheels measured on the profile (`car/car-wheels.ts`,
  `car-measure.ts`: Muse ground shadow dropped, symmetric arc fit), track on the front.
- (c) Car team: `car/car-tools.ts` (prompts, schemas, merge), `car/car-specialist.ts` (pilot + 4 specialists,
  retry, deadline), `askCarTool` (backend, client, meta; kinds `carPilot`/`carTool` streamed). Live once on
  the sedan: `c-sedan/car-reading.json` (side stations 0.02–0.05 off: fit must snap them).
- Captures in `~/Téléchargements/generated-view/`: `t76a-sheet.jpg`, `t76b-wheels.jpg`, `c-sedan/t76c-reading.jpg`.

## Decisions

- Wheels are measured, never asked. Reading sets only `CarPlan.kind` until `fitCar` exists.
- Car team orchestration is its own code (not shared with the house team) to leave house code untouched.

## Open

- Sedan front shadow spans the width: no track. SUV black rims: no rim found.
- `recon.test.ts` "time budget" can exceed 900 ms under full parallel load (passes alone).
- Houses: V335–V343 not played; phase PR PQ-T67 → T75 not opened; door snap + views check pending.
