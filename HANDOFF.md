# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T78 not on `main` yet; rebase before the PR)

## NEXT: car bench on the photos not tried yet (estate, coupe, sport, bus, limo, lorry, motorhome, tractor), then the phase PR

Brief: `docs/tasks/PV-car-generation.md` (§ 4 rules, § 6 findings, (g) = bench table). Task: `PV-vision-quality.md` PQ-T78.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`; never edit `house/` or `lib/house-*.ts`;
  shared `recon/` changes gated on `vehicle`. Cars are built by their own specialist team.
- Go live once per car to get a reading, then replay it: `make car-replay OUT=…` (offline, free).

## Done this session (PQ-T78)

- Cars were **built backwards** when drawn profile first (profile fed as `right`): fixed in `recon/route.ts`
  (profile = `left` elevation, its mirror = `right`). This was the jeep's bonnet mismatch.
- `lib/car-mesh.ts`: bumpers read the front / back drawing (no floor streaks), glass cut along the read
  windows (`cutTriangle`), raked windscreens glazed (`cabinClimbs`), deck → cabin blended, roof = top of the
  ring only, ≈ 40 ms. `car/car-top.ts` turns a plan drawn across the sheet. Tyre colour = darkest wheel.
- Studio layers: one piece per window / tyre / wheel on a car (`glass-1`…, `splitPieces`); masks baked as a
  real cut (`maskGeometry`) in the village and Blender.
- Check tool: `car-sheet.png` (the car mesh, eight cameras) in every `make views-3d` / `make car-replay`.
- Live: team on the jeep (8 windows); truck, hatchback, minibus, cabrio, beetle drawn from their photo.
  Eleven cars replay offline (`make car-replay OUT=r5`); sheet `resources/refine-3d/t78-bench.jpg`.

## Decisions

- Wheels and body are measured on pixels; the team only adds windows, kind and where to sample colours.
- `AtlasView` stays 5 views (house code untouched); the underside is `AtlasTile` + `faces.underside`.
- A studio piece = a geometry group; on a car, glass / tyre / rim groups split by connected part.

## Open

- Body = extruded profile: spoilers, bull bars, open cabins stay solid. `sedan-p` has no team reading.
- The profile's direction trusts the prompt (front to the right); no pixel check.
- Houses: V335–V343 not played; phase PR PQ-T67 → T78 not opened; door snap + views check pending.
