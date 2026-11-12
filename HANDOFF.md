# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Muse Code · **Branch:** feat/vision-no-timeout (PQ-T42 built, uncommitted; rebase onto `origin/main` before PR)

## PRIORITY NEXT: `docs/vision-to-3d-universal-pipeline.md` §12 — PQ-T43 next

PQ-T42 landed (this session, §12.1). Next in order (§12, registered as PQ-T43…PQ-T55 in
`docs/tasks/PV-vision-quality.md` Q6):

1. **PQ-T43 Template fixes:** car glass, roof overhang + fascia, houses with openings on all 4 faces,
   gable in wall material (§7.1, §7.4 remedy 2).
2. PQ-T44 houses via 2D path by default; **PQ-T45 sandbox** (2ter): `api` + QuickJS WASM + Wonder
   `build()` (`META_CODE_MODEL`), template = instant draft replaced on score gain, house first.
3. Then PQ-T46 `anatomy`, PQ-T47 routing, PQ-T48 details, PQ-T49 parallel/cache, PQ-T50/51 generators,
   PQ-T52 critic, PQ-T53 SDF, PQ-T54 real set, PQ-T55 eval B vs A.

## Current state (uncommitted this session)

- **PQ-T42 stage durations (E12):** every run phase logs `[vision] 3D <phase> …` and emits SSE
  `shape_timing { phase, ms }` (`SHAPE_TIMING_PHASES`: crop/kit/sam/masks/fit/views/stages/score/
  critic); `vision_detections` carries `ms`. Skipped phases stay silent. `onTiming` on
  `ObjectShapeOptions`, `formatDuration`, route wiring, contracts.md, V264 scenario.
- **Also:** Q6 series PQ-T43…PQ-T55 registered in PV-vision-quality.md; stale Non-goals line narrowed
  to code outside the §8bis sandbox. Earlier (committed): no generation timeouts; live 3D print; spec.

## Verify

- `make typecheck` 4/4 · `make lint` 0 errors · web suite green on rerun (337 files / 2559 tests;
  first run: 2 load flakes) · `make test-shape` budget flakes environmentally (cottage row 301 vs
  300 ms; untouched tree fails 2/5 — slow machine, not a regression).

## Open (measure at implementation)

- Wonder's code validity rate vs template draft; QuickJS cold start + function memory on Vercel;
  checkpoint size with code; a model bigger than `muse-wonder-1.0` for `META_CODE_MODEL`.
- V264 manual check pending (needs a Meta key). `fetch origin main` fails here (no remote access).

## Decisions

- Critic timing covers the scoring pass too (a held score still reports `critic`).
- Sandbox = QuickJS WASM (never `eval` / Node `vm`); limits on generated code only, never a clock on Meta; kept: `reason: 'timeout'`, explicit budgets, Vercel slices (OVH: `limitMs = Infinity`).
