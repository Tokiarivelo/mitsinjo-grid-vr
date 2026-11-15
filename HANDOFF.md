# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** `feat/pq-t54-turntable-judge`
(stacked on T53 `fea456b`)

## PRIORITY NEXT: PQ-T55 (§12.13)

Scored B-vs-A eval (willow, car, house, one appliance) +
tour duration on Vercel and OVHcloud. Needs live Meta
calls + the route-B loop to 3 stalls (PQ-T46 note: the
300 s capture cap stops round 2).

## Current state (PQ-T54 done, commit `feat/pq-t54-turntable-judge`)

- Judge replay fingerprinted (`recipeFingerprint` sha256
  - `judgeReplayUsable`): stored `<id>.judge.json` replays
    only on prompt + model + recipe match; turntable sheet
    (`TURNTABLE_YAWS`, `turntableSheet`, `turntable-sheet.png`
    in `make shape-report`, real rows only).
- §9.1 complete: anatomy (T46), real set (15 + solar
  unscorable), turntable, calibration, prompt eval (T5).
- Calibration re-run live (26 Wonder calls): damaged
  lower in 69 % of 13 (was 77 %) → judge stays a
  developer note, not used by the loop.

## Verify (this session)

- 915 pass (perception+lib); tsc + lint green; report
  frozen (synth 92, real 53, ΔE 10.1); turntable sheet
  checked on pixels (15 rows × photo + 4 views).
- Pre-existing, base-proven: strict-golden timing (fails
  on HEAD worktree too), `view-stages` round-tags,
  object-views deadline flake (37/37 alone).
- Push: HTTPS + `gh` token (SSH DNS dead, no rebase
  without user OK). Unsigned (gpg broken).

## Open

- Judge floor grades 1–2: re-run after the real mean rises.
- Scratch in /tmp: `pq54-*` + prior `sdf-*`, `zz-critic-ab`.
