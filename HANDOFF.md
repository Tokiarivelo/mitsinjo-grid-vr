# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q2-muse-skills (stacked on feat/pq-q1-leftovers, PR #12 open)

## Current state

- **PV-Q Q2 code built, one commit per task, all unticked** (their « done when » needs live Meta calls; nothing
  new is on by default, so the demo path and the real baseline are unchanged):
  - PQ-T38 stage stops `repeat` / `back_and_forth` (`shape-stages.ts`, always on) + « no change » line in the
    critic / stage ops / final cards. Replay has 1 loop recorded: no change seen.
  - PQ-T18 `SHAPE_KIT_SAMPLES=2` (`kit-vote.ts`): family split → better flat render; differing counts → unsure.
  - PQ-T14 critic v2 (`criticPromptVersion` 2): 2 × 2 sheet, `criticFires`, 4-field patch, `reasons`, ≤ 3 rounds
    (live, not yet background through `shape-jobs`).
  - PQ-T15 `SHAPE_LOOP_CARDS=true`: stage prompt v4, views check v2, Final check card in the question.
  - PQ-T16 `SHAPE_SIDE_V2=true` (`view-candidates.ts`): Side card + family line, 2 candidates scored vs the front.
  - PQ-T17 `effort.ts`: per call kind, all `high`; accepted `reasoning_effort` values NOT confirmed on Meta.
  - PQ-T41 `ObjectShape.ask` + `FamilyQuestion` + `chooseFamily`: asks on a kit split (confidence needs prompt 2).
- PQ-T13 built, unticked: prompt 3 (family card only) per family via `SHAPE_KIT_CARD_FAMILIES`; live run left:
  `make eval-shape PROMPT=1,3` (≈ 30 min, alone), then set the families marked `on` in `.env`, log the rest as off.
- PQ-T12 follow-up (v2 under 30 s) still open.

## Next

1. Merge PR #12, rebase this branch on `main`, open the Q2 PR (one PR per phase).
2. With a Meta key, measure each flag against its « done when » (alone, one at a time), tick or leave off with the
   reason in the loop log: T18 (agreement over 2 runs), T14 (critic on real set), T15/T16 (record `make facade-e2e`
   loops under both settings first: only 1 recorded), T17 (probe accepted effort values), T41 (hard photos).
3. Run the PQ-T13 eval, then the PQ-T12 follow-up.

## Files touched

- New: `server/perception/{kit-vote,kit-ask,view-candidates,effort}.ts`, `features/vision-insert/ui/family-question.tsx`,
  tests beside each (`loop-cards.test.ts` too).
- Changed: `shape-stages.ts`, `spark-critic.ts` (`criticSheet`, `criticFires`, rounds), `shape.ts` (`criticPrompt`,
  `capPatchFields`), `object-shape.ts` (samples, ask, `archetypeOf`), `object-views.ts`, `facade-views.ts`, `meta.ts`,
  `score-shape.ts` (`outline`), `lib/{env,object-kit,object-shape}.ts`, `use-object-shape.ts`, messages (family names).
- Env: `SHAPE_KIT_SAMPLES`, `SHAPE_LOOP_CARDS`, `SHAPE_SIDE_V2` (`.env.example`). Docs: copilot, contracts, village, task file.

## Decisions

- Every new Muse behaviour is opt-in (env or option) until its eval is shown, like prompt 2 of PQ-T12.
- T41 shows the question beside the first model, not before the build (no hidden model for one tap).
- Scenario V242 (local). `make skills-gen` regenerated the cards after the « no change » lines.
