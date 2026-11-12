# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-12 · **By:** Muse Code · **Branch:** feat/pq-t45-sandboxed-code (UNCOMMITTED — review then commit; no push, no network)

## PRIORITY NEXT: PQ-T46 `anatomy` in kit, cards and score (§12.3, §5, E5, E9)

PQ-T45 landed (this session): QuickJS sandbox + Wonder writer + patch loop,
facade-house wiring, capture `code`. Next (§12, Q6): PQ-T46 anatomy, PQ-T47
routing, PQ-T48 detail kinds... Live §8bis measures still need a Meta key.

## Current state (T45 uncommitted; T44/T43/Q4 still local, nothing pushed)

- **PQ-T45** here: `code-sandbox.ts` (api+limits), `shape-code.ts` (prompt v1,
  `META_CODE_MODEL`), `shape-code-loop.ts` (gain ≥0.005, 3 stalls, ≤5 rounds),
  facade wiring (`code` timing), capture `code`, `code` source, contracts, V267.
- **Install note:** `pnpm add` fails in sandbox (native lock, EROFS) → tarballs
  via npm + hand-written lock entries + manual `.pnpm` layout. First online
  `pnpm install` normalizes and verifies the lock (entries follow v9 exactly).
- **Q4 code** still on `feat/pq-q4` (PR #15, reviewed) — merge to land it.
- Push blocked: HTTPS needs auth this session lacks; SSH has no route.

## Verify (this session)

- New: 27 tests pass (sandbox 13 real-WASM, writer 3, loop 7, pipeline 4).
- `tsc` clean · `make lint` 0 errors · i18n 3/3 · prettier clean · goldens 5/5
  (one 5/5 budget fail = load flake, base failed identically) · shape-report
  identical to T44 (synth 93, car 93, cottage 86; real 53, ΔE 10.1) ·
  vision-insert 417/417 · full perception suite: only parallel-load flakes,
  every failing file green focused.

## Open

- V267 manual check needs a Meta key (live-only: build-code logs, `code`
  timing, code-built house). Valid-code rate / gain vs A / tour time unmeasured.
- Deferred (in T45 note): checkpoint resume of code rounds, block patches
  (full body re-sent), richer writer sheet (photo crop only in v1).

## Decisions

- Deadline (2 s), not op counter: a poll costs ≈1.3 ms round-trip (measured).
- `Eval` intrinsic stays (host needs it); guest `eval`/`Function` stripped.
- Stack-overflow disposal aborts QuickJS → drop poisoned module, re-instantiate.
- Mock returns null code (route B skips offline); `code` source skips critic
  and kit-patch replay; full-body patches for v1 (token-cheap at house size).
