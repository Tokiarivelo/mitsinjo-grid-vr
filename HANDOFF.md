# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t27-face-chat-lemur-bot` (pushed; stacked
on `fix/vs-t25-studio-text-pot-highlights`, which has no PR yet). Tasks VS-T27, VS-T28 in
`docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Open the PRs: VS-T25/T26 branch first, then this one (after `make rebase-main`); play V434–V443 by hand.
2. Headset: Quest Browser voice = system keyboard dictation (no Web Speech API there): check it.

## Done this session

- **VS-T27 / VS-T28** (earlier commit): views AI chat + maki bot, village hologram table in the lab.
- **`make dev-mock` was never offline:** turbo 2 strict env dropped `LLM_PROVIDER` from the `dev` task, so
  `port.mjs` read `meta` from `.env`. Fix: `LLM_PROVIDER` in `turbo.json` `dev.passThroughEnv`.
- **Floating Menu button over a panel:** in the emulator the Menu button floats (lazy follow) and could sit on
  « Cancel »; `aimAt` tested it first, so Cancel was unreachable and the question stayed open (it then broke
  the probe's walk steps). Now a panel wins over the _floating_ button; a worn wrist button keeps priority.
  Test `ui/xr/__tests__/aim-at.test.ts`.
- **Probe:** « wrist menu closed on entry » expected a worn button; in the emulator it floats by design
  (`eefd12e`). Check now asserts closed + floating.
- `make vr-probe` with `make dev-mock`: 37/37 PASS (lab, village table, Cancel, walks included);
  `make vr-sim-probe`: 19/19 PASS (slow: load ≈ 16, software GL stalls; allow > 15 min).
- `scripts/iwer-bridge-stop.sh` (orphaned bridges) committed (`33a4e74`).

## Decisions

- Bot replies are the drawing's status (i18n), never generated text. One request at a time.
- No Neon migration, no HF dataset change.

## Open

- `make check`: green except the `recon` time-budget test under full-suite load (passes alone).
