# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** `feat/pq-t53-sdf`
(stacked on T52 `0f51308`)

## PRIORITY NEXT: PQ-T54 (§12.11, §9.1)

Real set already ≥ 12 (15 + solar-panel unscorable);
remaining: judge re-calibration + turntable sheet.
After it: PQ-T55 B-vs-A eval.

## Current state (PQ-T53 done, commit `feat/pq-t53-sdf`)

- `sdf` shape + 4 blob kinds (1–12, r ≥ 0.04, outer+k ⊆
  ±0.5) + `sdf-field` (smooth-min union) + `sdf-mesh`
  (marching cubes, three.js tables bit-equal vs addon;
  24³ + 16/12/8 ladder past 3000 tris/part) + twins
  (viewer `unitSdf`, judge `marchSdf`, fit samples) +
  `api.sdf` at the cap (writer v2 deferred).
- Gate §12.10: 32³ blows 5 k (6528); 24³ keeps smooth
  bodies (2648/1520/1192, ≤ 40 ms). No builder emits
  blobs yet (no person/animal rows).

## Verify (this session)

- 1552 pass (+33 SDF); tsc + lint + i18n green; report
  frozen (synth 92, real 53, ΔE 10.1); goldens 5/5
  non-strict, sheet unchanged.
- Pre-existing, base-proven: strict-golden timing +
  `view-stages` round-tags (both fail on HEAD too);
  object-views deadline flake (passes alone).
- Push: HTTPS + `gh` token (SSH DNS dead, no rebase
  without user OK). Unsigned (gpg broken).

## Open

- v3 default needs a measured denied-flip or chase gain;
  chase coverage ∅; zone-crop chase needs PQ-T8 eval.
- Scratch in /tmp: `sdf-*` (budget proto, previews,
  oracle) + T52 `zz-critic-ab` driver/logs.

## Decisions

- v1 stays the critic default (unchanged).
- Fixed 24³ + ladder (not pure fixed res): fixed 24³
  provably blows the budget (15 k on 12 slabs).
