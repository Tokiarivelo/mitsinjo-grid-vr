# Maintenance rules (always on): keep Makefile, docs and branches in sync with the code

## Task branching (always first)

- Always create a new branch from latest `main` before beginning any task (`git fetch origin main && git checkout -b feat/<task-id>-<slug> origin/main`). Never start work directly on `main` or an un-rebased stale branch.

## Makefile

- When you add or use a command someone will run again (script, test filter, generator, tool, deploy step),
  add a Makefile target in the matching `##@` section with a `## short description`. Check `make help` shows it.
- When a `package.json` script is added, renamed or removed, update the target that wraps it in the same commit.
- Targets that need the workspace start with `$(need_ws)`. Keep recipes short; put long logic in `scripts/*.sh`.
- Don't add one-off or destructive targets without a clear name (`clean-*`, `deploy`).

## .env.example (always in sync)

- `.env.example` lists **every** env var the project reads: app (`src/lib/env.ts`), tooling and MCP
  (`.mcp.json`), scripts, CI, deploy. Add, rename or remove a var → update `.env.example` in the same commit.
- Group by section with a one-line comment: what reads it, where to get the value, and allowed values.
- Placeholders or safe defaults only (`LLM_PROVIDER=mock`), never real values. Secrets go in `.env` / `.env.local` (gitignored).
- Also update what loads env (`scripts/env.sh`, Makefile `env` / `claude` / `env-export`) and the README run
  section when the setup steps change.

## Neon database (always migrate)

- A change to anything stored in Neon (a new table or column, a new persisted field of a stored type such as
  `ChatMessageData`, a new JSONB block) **appends a migration** to `apps/web/src/server/db/migrations.ts`
  in the same commit: next `NNNN_snake_case` id, idempotent SQL (`IF NOT EXISTS`). Never edit, rename or
  reorder a migration that has shipped; fix forward with a new one.
- Migrations apply **automatically**: on the app's first database call, and with `make db-migrate`. After adding
  one, run `make db-migrate` (applies to the Neon DB in `.env`) and report the result.
- Engine-only Zod schemas (not stored) need no migration; say so when unsure.

## Hugging Face dataset (republish on change)

- The published copy of the benchmark lives on the Hub
  ([dataset](https://huggingface.co/datasets/Tokiarivelo/mitsinjo-grid-dispatch-benchmark)), not in git
  (`mitsinjo-grid-dispatch-benchmark/` is gitignored): whenever `make bench` or `make gen-evals` output
  changes (engine results, scenarios, copilot evals), rebuild and republish in the same session:
  `make hf-dataset && make hf-publish`.
- Publishing needs `HF_TOKEN` + `HF_DATASET_REPO` (root `.env`, see `.env.example`): if the token is
  missing, report the publish as pending instead of silently skipping it.

## Documentation (same commit as the code, update only what changed, keep it terse)

| You changed…                                                       | Update                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Types, schemas, tool I/O, SSE events, store shape                  | `docs/contracts.md`                                                               |
| Energy model, strategy, metric, warning, scenario, default numbers | `docs/engine-spec.md`                                                             |
| Folders, data flow, new package or route                           | `docs/architecture.md`                                                            |
| Copilot tool, prompt, provider, eval case                          | `docs/copilot.md`                                                                 |
| Screen layout, component API, tokens, copy, states                 | matching `docs/design/*.md`; mockup deviation → `docs/design/stitch-map.md` Notes |
| Perf technique or budget                                           | `docs/performance.md`                                                             |
| Code/test/commit convention                                        | `docs/conventions.md`                                                             |
| New command or env var                                             | `Makefile`, `.env.example`, `README.md` (run section)                             |
| Stored (Neon) shape                                                | new migration in `server/db/migrations.ts` + `docs/copilot.md` (persistence)      |
| New user-visible feature or limit                                  | `README.md` (features / limits), `docs/tasks/Pn-*.md` (tick or add task)          |
| Engine results, scenario or copilot eval (dataset content)         | `make hf-dataset && make hf-publish` (Hub holds the published copy)               |
| New skill or rule                                                  | `CLAUDE.md` skills & rules list                                                   |
| Any of the above at session end                                    | `HANDOFF.md` "Files touched" + "Decisions"                                        |

- Docs describe what the code does now: no plans written as facts, no copied code blocks longer than a type signature.
- If code and doc disagree and you can't tell which is right, ask; don't silently "fix" either.
