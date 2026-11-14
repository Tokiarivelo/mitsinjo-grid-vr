# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T75 not on `main` yet; rebase before the PR)

## NEXT: PQ-T76 — team readings for SUV + truck (5 Spark calls each, ask first), then bench of 10

Brief: `docs/tasks/PV-car-generation.md` (§ 4 rules, § 6 findings + done steps). Task: `PV-vision-quality.md` PQ-T76.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`; never edit `house/` or `lib/house-*.ts`;
  shared `recon/` changes gated on `vehicle`. Cars are built by their own specialist team.
- Go live once per car to get a reading, then replay it: `make car-replay OUT=…` (offline, free).

## Done this session (PQ-T76)

- Step 0 findings; (a) proportions from the elevations; (b) `CarPlan` + wheels measured on the profile;
  (c) car team (`car-tools.ts`, `car-specialist.ts`, `askCarTool`), live once on the sedan.
- (d) `car/car-fit.ts`: body fitted on the silhouettes (profile, arches, section without mirrors, taper),
  reading applied (windows in model frame, paint/glass colours). `lib/car-mesh.ts`: lofted body ≈ 6 k
  triangles, 9 slots, wheel cylinders. `car-projection.ts` materials; wired in object view, village
  (`placed-drawn-model`, `placed-models-geometry`) and Blender export. Front shadow dropped (sedan track read).
- Captures in `~/Téléchargements/generated-view/`: `t76a-sheet.jpg`, `t76b-wheels.jpg`,
  `c-sedan/t76c-reading.jpg`, `t76d-viewer.jpg`.

## Decisions

- Wheels and body are measured on pixels; the team only adds windows, kind and where to sample colours.
- Faces turned up are `roof` even without a top drawing (`ROOF_UP` 0.7).
- Car team orchestration is its own code (not shared with the house team) to leave house code untouched.

## Open

- SUV/truck: no windows (no team reading yet). SUV black rims: no rim found.
- `recon.test.ts` "time budget" can exceed 900 ms under full parallel load (passes alone).
- Houses: V335–V343 not played; phase PR PQ-T67 → T75 not opened; door snap + views check pending.
