# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `feat/pq-t76-cars`
(from `feat/pq-t74-house-quality`; PQ-T67–T80 not on `main` yet; rebase before the PR)

## NEXT: the phase PR (PQ-T67 → T80), or first the cars / trees not tried yet

Cars left: estate, coupe, sport, bus, limo, lorry, motorhome, tractor. Trees left: oak, eucalyptus, mango, banana.

## Rules set by the user (2026-11-14)

- Live Meta calls cost money: house non-regression is **offline only**, `make house-regress` (~30 s, free).
- Car code lives in `server/perception/car/` + `lib/car-*.ts`, tree code in `server/perception/tree/`; never
  edit `house/` or `lib/house-*.ts`; shared `recon/` changes gated on the archetype.
- Go live once per object to get its drawings, then replay: `make car-replay` / `make tree-replay` (free).

## Done this session

- **PQ-T78 cars:** right way round, glass cut on the read windows, a layer per window / tyre / wheel.
- **PQ-T80 wing mirrors:** `car/car-mirrors.ts` measures them on the front's outline, the section reads the
  body across their rows (no more ledge along the car), `carMesh` builds one piece per side (slot `mirror`,
  a Studio layer each, glass on its back). The car team's `mirror` details give their place along the car
  and, when the front shows none, their outline (plain colour). `make car-replay OUT=r7`: 11 / 11 with mirrors.
- **PQ-T79 trees** (Sonnet subagent, then refined): `tree` / `bush` no longer carved into boxes.
  `recon/route.ts` → `tree/tree-recon.ts` (`fitTree` → `packCrown` → `treeRecipe`), generic path when no
  crown is found or the outline IoU < 0.4. Trunk = one `lathe`, crown = ≤ 36 clumps in 3 `sdf` tiers,
  six arched fronds on a palm label. Drawing prompts carry `PLANT_CLEAN`.
- Six trees replay offline: `make tree-replay OUT=r13`.

## Decisions

- Wheels, body, trunk and crown are measured on pixels; models only draw and name (windows, kind).
- A palm is told by its label, its size by the drawings; fronds are judged on the packed outline.

## Open

- Trees: palm fronds are six thick paddles (IoU 0.38–0.43); a fork or lean is one column; the baobab's
  trunk tip shows from above; leafless drawings fall back to boxes; ≈ 7–8 k triangles (budget 5 k);
  village import and Blender export of a generated tree not run; V373–V381 not played.
- Cars: body = extruded profile (spoilers, bull bars, open cabins solid); profile direction trusts the prompt;
  a mirror moved out with a wide flank may pass the box's side; no user Mini in the bench; V382–V388 not played.
- Houses: V335–V343 not played; phase PR not opened; door snap + views check pending.
