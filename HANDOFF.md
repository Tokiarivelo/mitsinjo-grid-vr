# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** feat/pq-t44-houses-2d (`0e0491a` committed, unpushed — no network)

## PRIORITY NEXT: PQ-T45 sandboxed build code (2ter), start of the §8bis era

PQ-T44 landed (this session): default facade route, oblique side measures, wall
tints + UV offsets. Next (§12, Q6): PQ-T45 sandbox (house first: overhang,
4-face openings, roof/wall joint from code), PQ-T46 anatomy, PQ-T47 routing...

## Current state (all committed, nothing pushed — network down)

- **PQ-T44** `0e0491a` here (stacked on pq-t43 — rebase onto `origin/main` after
  PQ-T43 merges). PQ-T43 `6c9fc1e` + ticks `a3fd8c3` also local.
- **Q4 code** still on `feat/pq-q4` (PR #15, reviewed) — merge to land it.
- Push blocked: HTTPS needs auth this session lacks; SSH has no route. Push
  `feat/docs-tick-q4`, `feat/pq-t43-template-fixes`, this branch when online.

## Verify (this session)

- `make typecheck` 4/4 · `make lint` 0 errors · web suite green focused (full
  parallel runs add timeout/RPC infra flakes, zero assertion failures) ·
  goldens car 93 / cottage 86 · real rows identical · `test-shape` budget
  flakes environmental (untouched fridge/tree fail identically).

## Open

- V266 manual check needs a Meta key (live-only features: remedy-1 route,
  measured sides/tints on real photos). PQ-T16 side eval still unmeasured.
- Per-face pattern groups → PQ-T45 (needs mesh groups). Q4 merge will touch
  surface-maps (surfaceOffset) next to uvOffsetFor — additive, both keep.

## Decisions

- Remedy-1 automatic (code gate, no operator tap); mock-safe via key gate.
- Mirror whole-or-nothing pushed downstream: sides-first keeps symmetric ends.
- Fascia/tints/conservative gates: never trim or tint unidentified geometry.
- Tint/offset rules shared lib+both renders (judge grades what viewer shows).
