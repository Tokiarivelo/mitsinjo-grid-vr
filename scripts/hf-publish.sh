#!/usr/bin/env bash
# Upload mitsinjo-grid-dispatch-benchmark/ to the Hugging Face Hub as a dataset.
# Run: make hf-publish (needs HF_TOKEN + HF_DATASET_REPO, from root .env or the shell).
# Auth: HF_TOKEN must be a token with write permission (huggingface.co/settings/tokens).
# The repo is created on first upload; later runs update it.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DIR="${HF_DATASET_DIR:-$ROOT/mitsinjo-grid-dispatch-benchmark}"

if [ -z "${HF_TOKEN:-}" ]; then
  echo "HF_TOKEN is not set — create a token with write permission at huggingface.co/settings/tokens," >&2
  echo "add it to the root .env (HF_TOKEN=hf_…) or export it, then retry." >&2
  exit 1
fi
if [ -z "${HF_DATASET_REPO:-}" ]; then
  echo "HF_DATASET_REPO is not set — set it to <namespace>/mitsinjo-grid-dispatch-benchmark" >&2
  echo "in the root .env (see .env.example) or export it, then retry." >&2
  exit 1
fi
if [ ! -f "$DIR/scenarios.jsonl" ] || [ ! -f "$DIR/results.jsonl" ] \
  || [ ! -f "$DIR/copilot_evals.jsonl" ] || [ ! -f "$DIR/README.md" ]; then
  echo "Incomplete $DIR — run make hf-dataset first." >&2
  exit 1
fi

ENGINE_VERSION="$(sed -nE "s/.*ENGINE_VERSION = '([^']+)'.*/\1/p" "$ROOT/packages/engine/src/constants.ts")"
MSG="Mitsinjo Grid dispatch benchmark (engine v${ENGINE_VERSION:-?}, SIMULATED DATA)"

if command -v hf >/dev/null; then
  exec hf upload "$HF_DATASET_REPO" "$DIR" . --repo-type=dataset --commit-message="$MSG"
elif command -v uvx >/dev/null; then
  exec uvx --quiet hf upload "$HF_DATASET_REPO" "$DIR" . --repo-type=dataset --commit-message="$MSG"
elif command -v huggingface-cli >/dev/null; then
  huggingface-cli repo create "$HF_DATASET_REPO" --type dataset --yes 2>/dev/null || true
  exec huggingface-cli upload "$HF_DATASET_REPO" "$DIR" --repo-type dataset --commit-message="$MSG"
else
  echo "No Hugging Face uploader found — install one, then retry:" >&2
  echo "  curl -LsSf https://hf.co/cli/install.sh | bash   # hf CLI (recommended)" >&2
  echo "  pip install -U huggingface_hub                    # or: huggingface-cli" >&2
  exit 1
fi
