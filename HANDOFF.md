# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-06 · **By:** Muse Code · **Branch:** feat/hf-dataset-benchmark (from origin/main, uncommitted)

## Current state

- HF dataset export done, uncommitted: `make hf-dataset` builds
  `mitsinjo-grid-dispatch-benchmark/` (8 scenarios.jsonl, 576 results.jsonl rows,
  12 copilot_evals.jsonl, README card CC-BY-4.0 + SIMULATED DATA). Deterministic (md5 stable).
- `make hf-publish` uploads via `hf` / `uvx hf` / `huggingface-cli` (auto-detect, repo auto-created).
- `make test-integration` green (16 tests, incl. 6 new hf-dataset checks incl. hourly sums ≈
  benchmarks/engine.json); tests typecheck green; changed files Prettier-clean
  (14 pre-existing video/ format warnings untouched).
- Real upload NOT tested (no HF token in this session).

## Next

1. User: HF account + token (write) → root `.env` (`HF_TOKEN`, `HF_DATASET_REPO`, see .env.example).
2. Verify the HF namespace is really `Tokiarivelo` (assumed from GitHub); else update
   .env.example + README.md + benchmarks/README.md + export default.
3. Commit on feat/hf-dataset-benchmark, open PR, then `make hf-publish`.

## Files touched

- `scripts/export-hf-dataset.ts` (new), `scripts/hf-publish.sh` (new, +x)
- `tests/integration/hf-dataset.test.ts` (new)
- `Makefile` (§ Data: hf-dataset, hf-publish, .PHONY), `.env.example` (§ HF), `.gitignore` (dataset dir)
- `README.md` + `benchmarks/README.md` (HF dataset links)
- `.claude/rules/maintenance.md` (§ HF dataset: republish on change)

## Decisions

- Export script at repo root (spans engine + web evals), run via engine's jiti like gen-scenarios.ts.
- results.jsonl = hourly rows only (day metrics derivable); evals keep source keys (id/prompt/expectTool/expectEvidence).
- Publish depends on hf-dataset (rebuilds before upload); token via env, never CLI arg.

## Known limits

- PT-studio-look chain (previous HANDOFF) untouched on its own branches; this branch is separate.
