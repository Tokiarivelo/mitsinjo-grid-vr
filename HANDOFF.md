# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/vision-no-timeout (from local `main`; rebase onto `origin/main` before PR)

## PRIORITY NEXT: implement `docs/vision-to-3d-universal-pipeline.md`

Decided 2026-11-11: **Muse Wonder writes build code per object (sandboxed), for ALL objects, never a fixed
template as the final model.** Read that file first (§1.2, §7.4, §8bis, §12 order). Start with:

1. Stage durations in logs + SSE (E12) — the slowness is not yet located.
2. Template fixes: car glass, roof overhang + fascia, houses with openings on all 4 faces, gable in wall material.
3. **Sandbox (2ter): `api` + QuickJS WASM (one variant, ~<1 MB) + `build()` by Wonder** (`META_CODE_MODEL`), template =
   instant draft replaced on score gain, patch loop, code stored with the capture. First case: the house.
4. Then `anatomy` checklist, generators (`sweep/branch/scatter/drape/loft/inset`), SDF, real photo set.
   Reuse `stage-slices.ts` / `stage-checkpoint.ts` (browser-carried checkpoint, add `code`): no Neon, no migration.

## Current state (committed this session)

- **No code-imposed generation timeouts** (SAM, Spark, vision, masks, views await Meta; explicit budgets kept for
  evals; only the host `maxDuration` 300 s slices background stages). Docs aligned (performance, PV-*, methodology).
- **Live 3D print:** server streams the seed (`shape_stage` first/running + recipe), hook `preview`, viewer wipes it
  in bottom-up (`PrintWipe`, instant under reduced motion). V263 manual check pending.
- **Docs:** `vision-to-3d-universal-pipeline.md` (merged spec: diagnosis, modeller method, code sandbox, generators,
  houses §7.4) replaces the short-lived fidelity plan. The « Muse never writes code » rule is REMOVED (methodology §2,
  PV-capture-lab, PV-vision-quality aligned); still forbidden: energy values from a model, photo pasted on the model.

## Verify

- `make check` green (typecheck 4/4, lint, 337 test files / 2555 tests, i18n parity). No code written for the new
  pipeline yet: it is a spec.

## Open (measure at implementation)

- Wonder's code validity rate vs the template draft (task 13); QuickJS cold start + function memory on Vercel;
  checkpoint size with code; an API model bigger than `muse-wonder-1.0` for `META_CODE_MODEL`.
- Known: `golden-shape/fridge` flakes under load; `make test-shape` 300 ms budget is slow here.

## Decisions

- Sandbox = QuickJS WASM (never `eval` / Node `vm`); limits on generated code only, never a clock on Meta.
- Kept: `reason: 'timeout'`, explicit budgets, Vercel slices (OVH: `limitMs = Infinity`), copilot chat budgets.
