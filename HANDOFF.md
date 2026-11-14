# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T75 not on `main` yet; rebase before the PR)

## NEXT: PQ-T76 — jeep top view on the bonnet (align the plan along z), truck redrawn (ask first: Muse + Spark cost), bench of 10

Brief: `docs/tasks/PV-car-generation.md` (§ 4 rules, § 6 findings + done steps). Task: `PV-vision-quality.md` PQ-T76.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`; never edit `house/` or `lib/house-*.ts`;
  shared `recon/` changes gated on `vehicle`. Cars are built by their own specialist team.
- Go live once per car to get a reading, then replay it: `make car-replay OUT=…` (offline, free).

## Done this session (PQ-T76)

- (a)–(d) proportions, `CarPlan` + measured wheels, car team (`askCarTool`), body fitted (`car-fit.ts`) and
  built (`lib/car-mesh.ts`, 9 slots) in object view, village and Blender export.
- (e) Body without bulges (`carSection` deck/cabin/roof, `stationTaper` ends only, crease normals). A car is
  drawn from its profile (`car/car-views.ts`, `VEHICLE_FACES` front/back/top/bottom, left = profile
  mirrored, underside on atlas tile 6 `faces.underside`); panel « 2D Profile ». Live once: `c-sedan-p`.
- (f) Floor continuous between the wells (`floorLine`), axle tubes, rounded tyres; underside read turned
  (`car/car-underside.ts`). Live SUV (team, 0.935) + jeep (0.908) from their profile; replays `t77`.
- PQ-T77 3D Studio: « Open in 3D Studio » → `object-studio.tsx` (gizmo, views, cameras, undo), Layers +
  box masks (`piece-layers-panel.tsx`); edits in `recipe.pieces`, baked by `withPieceEdits` (village, Blender).

## Decisions

- Wheels and body are measured on pixels; the team only adds windows, kind and where to sample colours.
- Faces turned up are `roof` even without a top drawing (`ROOF_UP` 0.7). `NO_CAR=1` skips the car team.
- `AtlasView` stays 5 views (house code untouched); the underside is `AtlasTile` + `faces.underside`.
- Car team orchestration is its own code (not shared with the house team) to leave house code untouched.
- A studio piece = a geometry group (slot / material), not each window; opacity is studio-only.

## Open

- Truck: old front-first drawings. Jeep: no windows read (`NO_CAR=1` run); bonnet top-view mismatch.
- Flaky under full parallel load only: `recon.test.ts` time budget (passes alone).
- Houses: V335–V343 not played; phase PR PQ-T67 → T75 not opened; door snap + views check pending.
