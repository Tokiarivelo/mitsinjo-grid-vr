# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** `feat/pq-t55-b-vs-a-eval`
(stacked on T54 `6aee64e`)

## PRIORITY NEXT: PQ-T56+ or Q6 exit

PQ-T55 done (§12.13, commit `feat/pq-t55-b-vs-a-eval`).
First follow-up: clamp guest `generator.seed` into
0–2147483647 in `code-sandbox.ts` (willow B valid
0/3, all parts fail on the seed only), then re-run
`make eval-code IDS=willow` (~$0.5). Then Vercel tour
after merge (see Open).

## Current state (PQ-T55 done)

- B-vs-A eval (`eval-code.ts`, `make eval-code`,
  one yardstick, verdict = gain/$): willow tie 51,
  car A 52→55, house B 48→54, fridge tie 92; mean
  tour 68.4 s (writer ≈ 100 %); A $0.17 + B $2.11.
- Writer v2 opt-in (live stays v1); round timings
  on `CodeRound`; capture budget 600 s / 900 s.
- Report frozen (synth 92, real 53, ΔE 10.1).

## Verify (this session)

- 1141 pass (perception+lib); tsc + lint green;
  goldens 5/5 non-strict; strict-timing +
  view-stages round-tags fail on base too (worktree).
- Live: willow captured (51); 4-id eval to natural
  stop; willow seed cause proven by probe (deleted).
- Push: no push (task said commit only). Unsigned.

## Open

- Vercel tour: merge → main auto-deploys → house
  shape request → SSE `shape_timing{code}` (~$1).
- OVHcloud: no infra in repo (no docs/SSH/CLI).
- Scratch in /tmp: `pq55-*` + prior files.
