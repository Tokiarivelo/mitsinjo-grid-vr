# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars` (PQ-T67–T82 not on `main`)

## NEXT: plants still open (PQ-T82), then the phase PR (PQ-T67 → T82)

Re-run live with the `leaves` specialist: lemongrass, aloe, bamboo, jacaranda (`make plants-live PLANTS=…`).

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`, tree code in `server/perception/tree/`; never
  edit `house/` or `lib/house-*.ts`; shared `recon/` changes gated on the archetype.
- Go live once per object to get its drawings, then replay: `make car-replay` / `make tree-replay OUT=r13` (free).

## Done this session

- **PQ-T82 plants:** `PlantPlan` / `plantMesh` / `buildPlant` per habit; plant team of five (pilot +
  trunk, branches, foliage, flowers, `leaves` = each big leaf traced); front drawing as skin (holes
  filled). Live v005: coconut 0.14 → 0.61, banana 0.05 → 0.66, agave 0.26 → 0.52. Results to look at:
  `resources/generated-view/plants/` + `VERSIONS.md` (`make plant-gallery`); `house-regress` reads there.

- **PQ-T80 wing mirrors:** `car/car-mirrors.ts` measures them on the front's outline, else takes the car
  team's `mirror` details, else `standardMirrors` (never a kind `other`); `carMesh` builds one piece per
  side (slot `mirror`, a Studio layer each, glass on its back) and `mirrorFit` narrows the car (≤ 3 % on
  the bench) so a mirror moved out stays in the box. `make car-replay OUT=r8`: 11 / 11 with mirrors.
- **PQ-T81:** `sdf` parts were meshed inside out (one saw into every clump): fixed for all. A tree / bush
  draws no other view (`PLANT_FACES`; side = front), `CLUMP_MAX` 0.24: willow 0.63 → 0.75 (`OUT=f2`).

## Decisions

- Measured on pixels, models only draw and name. A mirror nobody saw is standard. A tree needs its front.

## Open

- Plants: agave tips don't curl, pads float apart, conifers are regular tiers, side IoU 0.15–0.3;
  V373–V381, V392–V399 not played.
- Cars: body = extruded profile (spoilers, bull bars, open cabins solid); profile direction trusts the prompt;
  standard mirrors on a body that fills its box narrow it up to 9 %; no user Mini in the bench.
- Not played: V335–V343 (houses), V382–V391 (cars); phase PR not opened; door snap + views check pending.
