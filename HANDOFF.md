# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars` (PQ-T67–T81 not on `main`)

## NEXT: the phase PR (PQ-T67 → T81), or first the cars / trees not tried yet

Cars left: estate, coupe, sport, bus, limo, lorry, motorhome, tractor. Trees left: oak, eucalyptus, mango.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`, tree code in `server/perception/tree/`; never
  edit `house/` or `lib/house-*.ts`; shared `recon/` changes gated on the archetype.
- Go live once per object to get its drawings, then replay: `make car-replay` / `make tree-replay OUT=r13` (free).

## Done this session

- **PQ-T78 cars:** right way round, glass cut on the read windows, a layer per window / tyre / wheel.
- **PQ-T80 wing mirrors:** `car/car-mirrors.ts` measures them on the front's outline, else takes the car
  team's `mirror` details, else `standardMirrors` (never a kind `other`); `carMesh` builds one piece per
  side (slot `mirror`, a Studio layer each, glass on its back) and `mirrorFit` narrows the car (≤ 3 % on
  the bench) so a mirror moved out stays in the box. `make car-replay OUT=r8`: 11 / 11 with mirrors.
- `make dev-fresh` = stop + drop `apps/web/.next` + start: cures a stale module (the `pieceBase` error).
- **PQ-T81:** `sdf` parts were meshed inside out (one saw into every clump): fixed for all. A tree / bush
  draws no other view (`PLANT_FACES`; side = front), `CLUMP_MAX` 0.24: willow 0.63 → 0.75 (`OUT=f2`).
- **PQ-T79 trees:** `tree` / `bush` → `tree/tree-recon.ts` (`fitTree` → `packCrown` → `treeRecipe`), generic
  path when no crown is found or the outline IoU < 0.4. Trunk = one `lathe`, crown = ≤ 36 clumps in 3
  `sdf` tiers, six arched fronds on a palm label. Drawing prompts carry `PLANT_CLEAN`.

## Decisions

- Measured on pixels, models only draw and name. A mirror nobody saw is standard. A tree needs its front.

## Open

- Trees: palm fronds are thick paddles (IoU 0.38–0.43); a weeping curtain is round clumps; a lean is one
  column; leafless drawings fall back to boxes; ≈ 7–8 k triangles (budget 5 k); V373–V381, V392–V395 not played.
- Cars: body = extruded profile (spoilers, bull bars, open cabins solid); profile direction trusts the prompt;
  standard mirrors on a body that fills its box narrow it up to 9 %; no user Mini in the bench.
- Not played: V335–V343 (houses), V382–V391 (cars); phase PR not opened; door snap + views check pending.
