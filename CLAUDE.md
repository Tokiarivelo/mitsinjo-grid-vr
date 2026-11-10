# Mitsinjo Grid — Agent entry point

AI copilot for a **simulated** rural solar microgrid (Meta AI Hackathon, solo, 10 days).
Demo path that must always work: **solar drop → strategy comparison → AI explanation → computed evidence**.

## Start here (token budget rule)

1. **Branch first, always:** create a new branch from latest `main` before starting any task (`git fetch origin main && git checkout -b feat/<task-id>-<slug> origin/main`). Never commit directly on `main` or a stale branch.
2. Read `HANDOFF.md` (current state, next task). Always.
3. Read the task file it points to: `docs/tasks/Pn-*.md`. Only that one.
4. Load other docs **only** when the task's "Read first" list names them.
5. Never load `Mitsinjo_Grid_*.md` at repo root — long human sources, already distilled into `docs/`.
6. Find code with `rg`/`glob`; read package `index.ts` barrels before internals.
7. Before ending a session: update `HANDOFF.md` (overwrite, ≤40 lines) and tick task boxes.

## Skills & rules (auto, cheap)

- Skills (`.claude/skills/`, loaded only when invoked): `/start` · `/handoff` · `/verify` · `/engine-change` ·
  `/ui-feature` · `/copilot-tool` · `/scene-3d` · `/designer-3d` · `/perf-audit` · `/design-dispatch` · `/design-check` ·
  `/review-pr` · `/format` · `/shape-3d` · `/shape-loop` · `/vr-immersion` (Meta VR: MCP first, docs before code).
- Rules (`.claude/rules/`, loaded only when matching files are touched): engine · web-ui · three · copilot · tests.
  `maintenance` is always on: new useful command → Makefile target; feature change → update its doc (same commit).
  `format` is always on: Prettier is the only formatter, auto-run by hooks (Claude edit hook, git pre-commit, CI).
  `review` is always on: rebase onto latest `main` (`make rebase-main`) before any review, fix or merge.
  `test-scenarios` is always on: every visible change adds/updates its manual scenario in `test-scenarios/` (gitignored).
  Don't restate them here; this file stays global-only.
- Other agents (Codex, opencode, Gemini, Cursor… via `AGENTS.md` / `GEMINI.md`): rules and skills are plain Markdown.
  Read the always-on rules yourself; "run `/x`" = follow `.claude/skills/x/SKILL.md`. Run `make format-changed` before committing.

## Doc map

| Need                                           | File                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| Folder layout, data flow, who owns what        | `docs/architecture.md`                                    |
| Types, Zod schemas, tool I/O (source of truth) | `docs/contracts.md`                                       |
| Energy model, strategies, default numbers      | `docs/engine-spec.md`                                     |
| LLM provider, tools, prompts, fallback         | `docs/copilot.md`                                         |
| Code rules, naming, tests, commits             | `docs/conventions.md`                                     |
| Fluidity budgets & perf techniques             | `docs/performance.md`                                     |
| Photo → 3D method, Muse skill cards            | `docs/vision-to-3d-methodology.md` → `-muse-skills.md`    |
| UI tokens, components, screens, Stitch         | `docs/design/README.md` → one file                        |
| Which mockup belongs to which screen           | `docs/design/stitch-map.md` (exports in `design/stitch/`) |
| Phase plan / tasks                             | `docs/tasks/README.md`                                    |

## Stack

pnpm workspace + Turborepo · Next.js 15 App Router · React 19 · TS strict · Tailwind 4 (`@theme`) ·
shadcn/ui (restyled) · Zustand · Zod · R3F + Drei · Recharts · next-intl · Vitest · Playwright · Meta Model API (Muse Spark).

## Non-negotiable rules

- Numbers come **only** from `@mitsinjo/engine`. UI, 3D and LLM never compute or invent energy values.
- Engine is pure TS: no React, no DOM, no network, no `Math.random` without seed.
- Actions need human approval (`propose_change` → Approve/Reject), **except** fire isolation and the **AI autonomous
  dispatch mode** (PA): there the engine-chosen action applies alone and is logged. Still hard rules in that mode:
  village constitution, never re-energise a burning sector, one-tap "take back control", every action undoable.
- Zero static text & Multi-language (i18n): All UI surfaces must be multi-lingual via official `next-intl` (EN default, FR, MG). Zero hardcoded/static user-visible strings in JSX/TSX. All text must use `useTranslations()` with 100% key parity across `en.json`, `fr.json`, and `mg.json` (enforced in CI and PR validation via `make check-i18n`).
- **Responsive Mobile First-Class (Always):** All UI features, layouts, cards, and viewports must be fully responsive from 320px mobile screens up to 4K desktop. Mobile bottom navigation (`MobileNav`), touch targets $\ge 44\text{px}$, single-column reflow, zero horizontal scroll, and `pb-20 md:pb-6` bottom padding are mandatory.
- **Dual Theming (Dark & Light always):** All UI components must support both dark (default) and light themes seamlessly via Tailwind 4 `@theme` semantic tokens (`bg-canvas`, `bg-surface`, `text-text-primary`, `border-border`, etc.). Zero raw hex/hardcoded colors in JSX/TSX. WCAG AA contrast required in both modes; `ThemeSwitcher` accessible in header and sidebar.
- `app/**/page.tsx` = import + render a feature page. No logic.
- Feature code lives in `apps/web/src/features/<name>/{ui,hooks,utils,__tests__}`; export via `index.ts`.
- Every engine function and hook ships with a Vitest test in the same commit.
- **No code duplication, reuse first:** search (`rg`) for an existing helper, hook, component or i18n key before writing
  one. Logic or markup needed twice → extract it once into a reusable, tested unit and call it from both places.
  Details: `docs/conventions.md` § Reuse.
- Server-only code (LLM key, tools) lives in `apps/web/src/server/` and imports `server-only`.
- **Design gate:** every frontend change (route, layout, component, 3D) goes through `/design-check`:
  spec + Stitch mockup before coding, screenshot comparison after. Contracts > design rules > mockup.
- Every screen shows a `SIMULATED DATA` label; AI text is visually distinct from computed metrics.
- No secrets in repo; env vars via `apps/web/src/lib/env.ts` (Zod-validated).
- Conventional commits: `feat(engine): ...`, `fix(copilot): ...`.

## Commands

Use the Makefile (`make help` lists everything). Most used:

```bash
make install && make dev    # web on :$PORT from .env (default 3000; make port) (make dev-mock = offline LLM)
make check                  # typecheck + lint + test — before handoff
make test-engine            # engine only (cheapest)
make e2e                    # playwright demo path
make shots                  # screenshots of all routes → design/shots/ (design gate)
make status | make todo     # current state / unchecked tasks (cheaper than reading files)
```
