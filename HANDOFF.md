# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q1-leftovers (PR open; PR #11 merged)

## Current state

- **PV-Q Q1 leftovers** (real baseline unchanged: mean 53, synthetic 93; `make check`: 2431 tests pass):
  - PQ-T9 ticked: 12/13 real photos with an outline against 6/13 at the PQ-T1 baseline (agreement itself is off).
  - PQ-T10 **unticked again**: 8 real walls in shadow (`make shadow-photos`, then `make shadow-compare`): main
    colour the same with and without `litSurface` (ΔE 13.2 both); gain only on the other roles (shadow handed out
    as secondary / accent 5 → 2). Painted-shadow measure unchanged (ΔE 14.9 vs 20.2).
  - PQ-T11 skill loader: `skills/` (`skillFor`), generated from the doc by `make skills-gen` (checked by `skills.test.ts`).
  - PQ-T12 built but **unticked, prompt 2 off**: `make eval-shape PROMPT=1,2` on 16 real captures: v1 95/117 agree,
    median 22.9 s; v2 (cards + evidence first) 83/121, median 47.3 s. `KIT_PROMPT_VERSION` stays 1.
  - PQ-T37 ticked: `evidence.visibleParts` feeds `notBuilt` / panel coverage through `listedConcept` (prompt 2 only;
    prompt 1 keeps its own JSON schema, `kitJsonSchema`). Panel: card SAM words labelled, the rest « Other parts ».
  - Free-parts call on the cards (`make eval-parts`, 6 captures): v1 6/6, 9.5 parts, 44.5 s; v2 6/6, 8.7 parts, 68.8 s → off.

## Next

1. Merge the PR once CI is green.
2. PQ-T12 follow-up: bring v2 under 30 s (shorter Look card, evidence reduced to `visibleParts`), re-measure with
   `make eval-shape PROMPT=1,2` (≈ 30 min, alone). If dev says `Can't resolve 'three'` → `make install`.
3. PQ-T13 onwards (archetype cards, one family at a time) only after T12's gain is shown.

## Files touched

- New: `skills/{index,extract,cards.generated}.ts`, `__tests__/skills.test.ts`, `__fixtures__/shape/shadow-walls.json`,
  `scripts/fetch-shadow-photos.sh`; Makefile `skills-gen`, `shadow-photos`, `eval-parts`.
- Changed: `lib/object-kit.ts` (`evidence`, `confidence`), `shape.ts` (schema, `parseEvidence`, `kitPrompt(v, hint)`),
  `free-recipe.ts` (`partsPrompt`), `fusion.ts` (`modelDoubts`, `ledByMeasurement`), `object-graph.ts`
  (`listedConcept`), `object-shape.ts` (`promptVersion`), `meta.ts`, `eval-shape.ts` (`evalParts`), messages (part labels).
- Docs: `contracts.md`, `copilot.md`, `design/screens/village.md`, `tasks/PV-vision-quality.md`, README.

## Decisions

- The doc is the source of the cards; the module is generated (no hand copy). Versions = hash of the composed text.
- Prompt 2 is not the default: its eval fails both « done when » (agreement lower, median > 30 s).
- A field the kit lists as unsure (or confidence < ½) is led by the measurement, half-way to full trust.
- Scenario V241 (local). `jiti` is missing (`make gen-evals` fails).
