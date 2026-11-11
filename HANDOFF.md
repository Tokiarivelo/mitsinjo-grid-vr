# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q1-leftovers (PR open; PR #11 merged)

## Current state

- **PV-Q Q1 is closed.** The leftovers are done on this branch:
  - PQ-T9 ticked: 12/13 real photos with an outline against 6/13 at the PQ-T1 baseline (agreement itself is off).
  - PQ-T10 ticked on the painted-shadow measure (ΔE 14.9 vs 20.2); neutral on the real set. A real shadowed wall
    is still missing from the set.
  - PQ-T11 skill loader: `server/perception/skills/` (`skillFor`), cards generated from
    `docs/vision-to-3d-muse-skills.md` by `make skills-gen`; `skills.test.ts` fails when the module is behind.
  - PQ-T12 built but **unticked, prompt 2 off**: `make eval-shape PROMPT=1,2` on 16 real captures: v1 95/117 agree,
    median 22.9 s; v2 (cards + evidence first) 83/121, median 47.3 s. `KIT_PROMPT_VERSION` stays 1.
  - PQ-T37 ticked: `evidence.visibleParts` feeds `notBuilt` / panel coverage through `listedConcept` (prompt 2 only:
    review fix, prompt 1 now keeps its own JSON schema, `kitJsonSchema`). A listed part without a panel label is log-only.
- Real baseline unchanged: mean 53 (synthetic 93). Full `make check`: 2429 tests pass; vitest reported one worker RPC timeout (`onTaskUpdate`) under load, no failing test.
- Machine: if dev says `Can't resolve 'three'` → stop dev, `make install`.

## Next

1. Merge the PR once CI is green.
2. PQ-T12 follow-up: bring v2 under 30 s (shorter Look card, evidence reduced to `visibleParts`), re-measure with
   `make eval-shape PROMPT=1,2` (≈ 30 min, run it alone: the median is CPU-sensitive).
3. PQ-T13 onwards (archetype cards, one family at a time) only after T12's gain is shown.

## Files touched

- New: `skills/{index,extract,cards.generated}.ts`, `__tests__/skills.test.ts`; Makefile `skills-gen`.
- Changed: `lib/object-kit.ts` (`evidence`, `confidence`), `shape.ts` (schema, `parseEvidence`, `kitPrompt(v, hint)`),
  `free-recipe.ts` (`partsPrompt`), `fusion.ts` (`modelDoubts`, `ledByMeasurement`), `object-graph.ts`
  (`listed` in `notBuilt` / `partCoverage`), `object-shape.ts`, `meta.ts`, `eval-shape.ts` (per-row log, timeout per prompt).
- Docs: `contracts.md`, `copilot.md`, `tasks/PV-vision-quality.md`, loop log row in `PV-shape-realism.md`.

## Decisions

- The doc is the source of the cards; the module is generated (no hand copy). Versions = hash of the composed text.
- Prompt 2 is not the default: its eval fails both « done when » (agreement lower, median > 30 s).
- A field the kit lists as unsure (or confidence < ½) is led by the measurement, half-way to full trust.
- Scenarios: none added (no visible change under the default prompt). `jiti` is missing (`make gen-evals` fails).
