# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** feat/pq-t43-template-fixes (`6c9fc1e` committed, unpushed — no network)

## PRIORITY NEXT: PQ-T44 Houses through the 2D path by default (§12.2bis)

PQ-T43 landed (this session). Next (§12, Q6 in `PV-vision-quality.md`):

1. **PQ-T44:** clean facade drawing when none exists (PQ-T23 action), real opening
   measures, per-face measured materials (§7.4 remedies 1, 3, 4).
2. Then PQ-T45 sandbox (2ter), PQ-T46 anatomy, PQ-T47 routing, PQ-T48 details,
   PQ-T49 parallel/cache, PQ-T50/51 generators, PQ-T52 critic, PQ-T53 SDF,
   PQ-T54 real set, PQ-T55 eval B vs A.

## Current state (all committed, nothing pushed — network down)

- **PQ-T43** `6c9fc1e` here: glazing (recolor in 12, owner call), dark wheels,
  overhang option + bounds, fascia (known non-thatch only), hip eave, 4-face
  houses whole-or-nothing, wall gables, vehicle accent swap, V265 (local).
- **Docs ticks** `a3fd8c3` on `feat/docs-tick-q4` (Q4+PH-T8+PR-0.5).
- **Q4 code** still on `feat/pq-q4` (PR #15, reviewed) — merge to land it.

## Verify (this session)

- `make typecheck` 4/4 · `make lint` 0 errors · web 2576/2576 (2 shards; full
  runs add a vitest RPC-timeout infra flake, no test failures) · goldens car 93
  (ΔE 3.4), cottage 86 (edge +0.02) · real rows all identical (frozen).

## Open

- Push `feat/docs-tick-q4` + this branch when online; open PRs (ticks, PQ-T43);
  merge PR #15 first (Q4 code: gloss/AO/PBR/fascia interplay unreviewed).
- V265 manual check needs a Meta key. `make scenarios-publish` untouched (stale).

## Decisions

- Glazing = recolor, not proud parts (12-cap; owner chose). Hip bevel kept sharp
  (R9). Mirror whole-or-nothing (lopsided rears + starved ends are worse).
- Fascia needs a known material (else elevation drawings mismatch). Photo
  outline-vs-wall → PQ-T45 (template lacks wall extent). Ceiling still §14.3.
