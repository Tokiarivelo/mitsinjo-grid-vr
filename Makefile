# Mitsinjo Grid — useful commands. `make` or `make help` lists them.
# Rule: every new useful command gets a target here with a `## description` (see .claude/rules/maintenance.md).

SHELL := /bin/bash
.DEFAULT_GOAL := help
PNPM   ?= pnpm
WEB    := web
ENGINE := @mitsinjo/engine
PORT   ?= $(shell node apps/web/scripts/port.mjs)
COUNT  ?= 12
URL    ?= http://localhost:$(PORT)
ROUTES := overview simulation strategies scenarios copilot
SHOTS  := design/shots

# Guard: pnpm targets need the workspace created in P1.
define need_ws
	@test -f package.json || { echo "No package.json yet — do P1 (docs/tasks/P1-repo.md) first."; exit 1; }
endef

##@ Help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^##@/{printf "\n\033[1m%s\033[0m\n",substr($$0,5)} /^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

##@ Setup
install: ## Install all workspace dependencies
	$(need_ws)
	$(PNPM) install

env: ## Create apps/web/.env.local from .env.example (if missing)
	@test -f apps/web/.env.local && echo "apps/web/.env.local exists" || { cp .env.example apps/web/.env.local && echo "Created apps/web/.env.local"; }

browsers: ## Install Playwright browsers (for e2e + screenshots)
	$(need_ws)
	$(PNPM) --filter $(WEB) exec playwright install chromium

setup-claude: ## Install Claude Code settings + format hook (human, once)
	cp docs/setup/claude-settings.json .claude/settings.json
	mkdir -p .claude/hooks && cp docs/setup/format.sh .claude/hooks/format.sh && chmod +x .claude/hooks/format.sh
	@echo "Restart claude to apply."

##@ Develop
dev: ## Run the web app in dev mode (port from PORT in .env, default 3000)
	$(need_ws)
	$(PNPM) dev

port: ## Print the web app port (PORT from shell or .env, default 3000)
	@echo $(PORT)

dev-stop: ## Stop the dev server on $(PORT) for good (next dev respawns a killed next-server; this stops turbo/pnpm too)
	@bash scripts/dev-stop.sh $(PORT)

dev-mock: ## Run dev with the offline mock LLM provider
	$(need_ws)
	LLM_PROVIDER=mock $(PNPM) dev

build: ## Production build (all packages)
	$(need_ws)
	$(PNPM) build

start: build ## Build then serve the production app
	$(PNPM) --filter $(WEB) start

bridge: ## Scale-model bridge: MQTT broker + engine + WebSocket (BRIDGE_MODE=replay|twin; shell > .env)
	$(need_ws)
	$(PNPM) --filter bridge start

bridge-sim: ## Fake ESP32 for the bridge, no hardware needed (keys: c = cloud, q = quit)
	$(need_ws)
	$(PNPM) --filter bridge sim

##@ Quality
test: ## Run all unit tests
	$(need_ws)
	$(PNPM) test

test-engine: ## Run engine tests only
	$(need_ws)
	$(PNPM) --filter $(ENGINE) test

test-bridge: ## Run scale-model bridge tests only
	$(need_ws)
	$(PNPM) --filter bridge test

test-integration: ## Cross-package integration tests in tests/ (benchmarks/engine.json still matches the engine)
	$(need_ws)
	$(PNPM) --filter @mitsinjo/tests test

test-web: ## Run web unit tests only
	$(need_ws)
	$(PNPM) --filter $(WEB) test

test-shape: ## Run the 3D shape golden set (5 photos, IoU / colour / gables / 300 ms budget)
	$(need_ws)
	SHAPE_BUDGET_STRICT=1 $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/golden-shape.test.ts

shape-shots: ## Real 3D viewer shots of the shape-report recipes, dark + light (dev server must run; SHOT_WIDTH=320 phone, SHOT_LOG=1 console)
	$(need_ws)
	@$(PNPM) --filter $(WEB) exec node scripts/object-viewer-shot.mjs $(URL) $(CURDIR)/test-results/shape-report

vr-probe: ## /village VR check in the IWER emulator: wrist menu, shoot objects in the fake-webcam video with controllers + hands (dev server must run; needs ffmpeg)
	$(need_ws)
	@$(PNPM) --filter $(WEB) exec node scripts/vr-village-probe.mjs $(URL) $(CURDIR)/test-results/vr-probe

improve-shot: ## Improvement chip shots (running + finalised), desktop + mobile, dark + light (dev server; stubbed API)
	$(need_ws)
	@$(PNPM) --filter $(WEB) exec node scripts/improve-chip-shot.mjs $(URL) $(CURDIR)/test-results/shape-report

shape-capture: ## Capture one live 3D run → offline fixtures (PHOTO=… ID=…, PR-0.4)
	$(need_ws)
	@test -n "$(PHOTO)" -a -n "$(ID)" || { echo "Usage: make shape-capture PHOTO=path/to/photo.jpg ID=car1"; exit 1; }
	eval "$$(make -s env-export)" && SHAPE_CAPTURE=1 SHAPE_CAPTURE_PHOTO="$(abspath $(PHOTO))" SHAPE_CAPTURE_ID="$(ID)" SHAPE_CAPTURE_DIR="$(CURDIR)/apps/web/src/server/perception/__fixtures__/shape/real" $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/shape-capture.test.ts -t "make shape-capture"

eval-shape: ## Kit eval on live Spark over the real captures (MODEL=…, PR-3.1, on demand, costs API calls)
	$(need_ws)
	eval "$$(make -s env-export)" && EVAL_SHAPE=1 EVAL_SHAPE_DIR="$(CURDIR)/apps/web/src/server/perception/__fixtures__/shape/real" $(if $(MODEL),META_VISION_MODEL="$(MODEL)") $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/eval-shape.test.ts -t "make eval-shape"
	@$(MAKE) -s eval-stages

eval-stages: ## Replay recorded stage loops offline (shape/real/*.stages.json from facade-e2e ID=…), no API cost
	$(need_ws)
	EVAL_STAGES_DIR="$(CURDIR)/apps/web/src/server/perception/__fixtures__/shape/real" $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/eval-stages.test.ts

facade-e2e: ## Facade → 3D end to end on live Meta, stage loop included (FRONT=view.png OUT=dir [ID=name → stage capture kept] [LABEL=… SCENERY=…] [PROMPT=…], costs API calls)
	$(need_ws)
	@test -n "$(FRONT)" -a -n "$(OUT)" || { echo "Usage: make facade-e2e FRONT=path/front.png OUT=dir [PROMPT='cottage with a red tin roof' to draw FRONT first]"; exit 1; }
	eval "$$(make -s env-export)" && FACADE_E2E_FRONT="$(abspath $(FRONT))" FACADE_E2E_OUT="$(abspath $(OUT))" $(if $(PROMPT),FACADE_E2E_FRONT_PROMPT="$(PROMPT)") $(if $(LABEL),FACADE_E2E_LABEL="$(LABEL)") $(if $(SCENERY),FACADE_E2E_SCENERY="$(SCENERY)") $(if $(ID),FACADE_E2E_ID="$(ID)" FACADE_E2E_CAPTURE_DIR="$(CURDIR)/apps/web/src/server/perception/__fixtures__/shape/real") $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/facade-e2e.test.ts

photo-audit: ## Every object of a real photo built the app way (2D view → 3D → stages) on live Meta: PHOTO=… TARGETS=targets.json OUT=dir [ONLY=det-1,det-3] (sheet.png + audit.md, costs API calls)
	$(need_ws)
	@test -n "$(PHOTO)" -a -n "$(TARGETS)" -a -n "$(OUT)" || { echo "Usage: make photo-audit PHOTO=photo.jpg TARGETS=targets.json (ShapeTarget[]) OUT=dir [ONLY=id,id]"; exit 1; }
	eval "$$(make -s env-export)" && PHOTO_AUDIT_PHOTO="$(abspath $(PHOTO))" PHOTO_AUDIT_TARGETS="$(abspath $(TARGETS))" PHOTO_AUDIT_OUT="$(abspath $(OUT))" $(if $(ONLY),PHOTO_AUDIT_ONLY="$(ONLY)") $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/photo-audit.test.ts

shape-report: ## 3D shape report: scores + contact sheet → test-results/shape-report/ (/shape-loop)
	$(need_ws)
	SHAPE_REPORT=1 SHAPE_REPORT_DIR=$(CURDIR)/test-results/shape-report $(PNPM) --filter $(WEB) exec vitest run src/server/perception/__tests__/shape-report.test.ts -t "make shape-report"

test-watch: ## Run engine tests in watch mode
	$(need_ws)
	$(PNPM) --filter $(ENGINE) exec vitest

coverage: ## Unit tests with coverage
	$(need_ws)
	$(PNPM) test -- --coverage

e2e: ## Playwright demo-path e2e (mock LLM)
	$(need_ws)
	LLM_PROVIDER=mock $(PNPM) --filter $(WEB) test:e2e

typecheck: ## TypeScript check (all packages)
	$(need_ws)
	$(PNPM) typecheck

lint: ## Lint all packages
	$(need_ws)
	$(PNPM) lint

format: ## Format the whole repo with Prettier (only formatter, .claude/rules/format.md)
	$(need_ws)
	$(PNPM) format

format-check: ## Fail if any file is not Prettier-formatted (same as CI)
	$(need_ws)
	$(PNPM) format:check

format-changed: ## Format only files changed vs HEAD + untracked (what /format runs)
	$(need_ws)
	@{ git diff --name-only --diff-filter=d HEAD; git ls-files --others --exclude-standard; } | sort -u | \
	  xargs -r $(PNPM) exec prettier --write --ignore-unknown --log-level warn

git-hooks: ## Install the git pre-commit hook (Prettier on staged files; also runs on pnpm install)
	$(need_ws)
	$(PNPM) exec simple-git-hooks

check-i18n: ## Verify i18n key parity and completeness across locales
	$(need_ws)
	$(PNPM) --filter $(WEB) test i18n-parity

check: typecheck lint test check-i18n ## typecheck + lint + test + i18n check (run before handoff)

ci: check e2e build ## Everything CI runs

##@ Design
shots: ## Screenshot all routes at 1440x900 into design/shots/ (dev server must run)
	$(need_ws)
	@mkdir -p $(SHOTS)
	@for r in $(ROUTES); do \
	  $(PNPM) --filter $(WEB) exec playwright screenshot --viewport-size=1440,900 $(URL)/$$r $(CURDIR)/$(SHOTS)/$$r.png >/dev/null && echo "✓ $(SHOTS)/$$r.png"; \
	done

mockups: ## List Stitch mockup exports and their map status
	@ls -1 design/stitch/*.png 2>/dev/null || echo "No exports in design/stitch/"
	@grep -E '^\| (Live|Overview|Strategy|AI|Scenarios)' docs/design/stitch-map.md | awk -F'|' '{printf "  %-16s %s\n",$$2,$$7}'

scenarios-publish: ## Publish local test-scenarios/ as docs/test-scenarios/ (screenshots) + README banner
	$(need_ws)
	node scripts/publish-scenarios.mjs
	$(PNPM) exec prettier --write docs/test-scenarios >/dev/null && $(PNPM) exec prettier --write docs/test-scenarios >/dev/null  # 2nd pass: Prettier is not idempotent on these lists

##@ Performance
bench: ## Engine benchmark: latency + strategy A/B on every scenario → benchmarks/engine.json (RUNS=200)
	$(need_ws)
	BENCH_OUT=$(CURDIR)/benchmarks/engine.json BENCH_RUNS=$(or $(RUNS),200) $(PNPM) --filter $(ENGINE) exec vitest run src/__tests__/benchmark.test.ts

analyze: ## Bundle analysis build (needs @next/bundle-analyzer)
	$(need_ws)
	ANALYZE=true $(PNPM) --filter $(WEB) build

scene-audit: ## 3D scene per tier (low, high): draw calls + triangles vs budget, shots → design/shots/*-3d*.png (server must run)
	$(need_ws)
	@$(PNPM) --filter $(WEB) exec node scripts/scene-audit.mjs $(URL) $(CURDIR)/$(SHOTS)

scene-audit-gpu: ## Same audit on the real GPU (meaningful high-tier fps; needs a GPU + display drivers)
	$(need_ws)
	@SCENE_AUDIT_GL=gpu $(PNPM) --filter $(WEB) exec node scripts/scene-audit.mjs $(URL) $(CURDIR)/$(SHOTS)

lighthouse: ## Lighthouse perf score for /overview (prod server must run)
	npx -y lighthouse $(URL)/overview --preset=desktop --only-categories=performance --quiet --output=json \
	  | jq '{score: .categories.performance.score, lcp: .audits["largest-contentful-paint"].displayValue, tbt: .audits["total-blocking-time"].displayValue}'

##@ Agents & tooling
claude: ## Start Claude Code with root .env exported (STITCH_API_KEY for Stitch MCP)
	@test -f .env || { echo "No .env — cp .env.example .env and fill it."; exit 1; }
	@source scripts/env.sh && exec claude

env-export: ## Print .env as export lines — use: eval "$$(make -s env-export)"
	@bash scripts/env.sh --print

mcp: ## List MCP servers (checks Stitch connection)
	claude mcp list

rebase-main: ## Rebase the current branch onto the latest origin/main (do before review/merge)
	git fetch origin main && git rebase origin/main

status: ## Show current phase/next task from HANDOFF.md
	@sed -n '/^## State/,/^## Decisions/p' HANDOFF.md | sed '$$d'

todo: ## List unchecked tasks across all phases
	@grep -n -- '- \[ \]' docs/tasks/P*.md | sed 's/:- \[ \] / /' | cut -c1-140

gen-scenarios: ## Regenerate engine scenarios from deterministic templates (M12-T2, no key)
	$(need_ws)
	$(PNPM) --filter $(ENGINE) exec jiti scripts/gen-scenarios.ts

gen-scenarios-live: ## Regenerate engine scenarios with Spark 1.2 (M12-T2, needs META_API_KEY)
	$(need_ws)
	$(PNPM) --filter $(ENGINE) exec jiti scripts/gen-scenarios.ts --live

gen-evals: ## Regenerate synthetic copilot evals from templates (M12-T2, no key)
	$(need_ws)
	$(PNPM) --filter $(WEB) exec jiti scripts/gen-evals.ts

gen-evals-live: ## Regenerate N synthetic evals with Contributor (M12-T2, needs META_API_KEY; COUNT=12)
	$(need_ws)
	$(PNPM) --filter $(WEB) exec jiti scripts/gen-evals.ts --live --count $(COUNT)

db-migrate: ## Apply pending Neon migrations now (the app also does it on its first DB call)
	$(need_ws)
	$(PNPM) --filter $(WEB) exec jiti scripts/db-migrate.ts

##@ Data
HF_DIR ?= mitsinjo-grid-dispatch-benchmark
hf-dataset: ## Build the Hugging Face dataset folder (no token): scenarios + hourly results + copilot evals
	$(need_ws)
	$(PNPM) --filter $(ENGINE) exec jiti ../../scripts/export-hf-dataset.ts --out $(abspath $(HF_DIR))

hf-publish: hf-dataset ## Upload the dataset folder to Hugging Face (needs HF_TOKEN + HF_DATASET_REPO)
	@if [ -f .env ]; then eval "$$(make -s env-export)"; fi; HF_DATASET_DIR=$(abspath $(HF_DIR)) bash scripts/hf-publish.sh

##@ Deploy
# Only `main` is deployed: pushes to main auto-deploy (Vercel Git integration); other branches are skipped.
deploy-link: ## Link this clone to the Vercel project (once per machine)
	npx -y vercel@latest link --yes --project mitsinjo-grid

deploy: ## Manual production deploy (only from a clean main = origin/main)
	@scripts/deploy.sh

docker-up: ## Build + start the app with Docker Compose on :3000 (HOST_PORT=…; root .env optional, else mock)
	docker compose up -d --build
	@echo "→ http://localhost:$(or $(HOST_PORT),3000)  (make docker-logs · make docker-down)"

docker-down: ## Stop the Docker Compose app
	docker compose down

docker-logs: ## Follow the Docker Compose app logs
	docker compose logs -f web

##@ Video
# Demo video pipeline (video/VIDEO_PLAN.md). Capture needs `make dev` running, X11 :0 and ffmpeg + NVENC.
video-tts-setup: ## Install the local Kokoro TTS (venv + model, ~350 MB) used for the narration
	cd video && python3 -m venv .venv-tts && .venv-tts/bin/pip install -q kokoro-onnx soundfile && mkdir -p tts && cd tts && \
	  curl -sSLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
	  curl -sSLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

video-voice: ## Render the voice-over (plan § 5) with Kokoro, young male voice (VOICE=am_puck)
	cd video && .venv-tts/bin/python scripts/tts.py --voice $(or $(VOICE),am_puck)
	cd video && .venv-tts/bin/python scripts/tts.py --voice $(or $(VOICE),am_puck) --name mic-question \
		--say "If the sun drops by seventy percent for ten hours, who loses power first?"
	ffmpeg -loglevel error -y -i video/audio/voice/mic-question.wav -ac 2 video/audio/voice/mic-question-48k.wav

video-sfx: ## Generate click / whoosh / rise SFX with ffmpeg
	video/scripts/sfx.sh

video-capture: ## Record app shots on the real screen at 1920x1080, no lock while running (PART=a|b, ONLY=A1,A2; DRY=1)
	video/scripts/capture.sh --part $(or $(PART),a) $(if $(ONLY),--only $(ONLY)) $(if $(DRY),--dry)

video-canvas: ## Render the splash and outro canvas pages to PNG frames
	node video/scripts/render-canvas.cjs video/canvas/00-splash.html video/frames/00-splash
	node video/scripts/render-canvas.cjs video/canvas/10-outro.html video/frames/10-outro

video-build: ## Assemble video/output/mitsinjo-grid-demo-1080p.mp4 from video/edit.json (DRAFT=1 = NVENC)
	python3 video/scripts/build.py $(if $(DRAFT),--draft)

video-thumbnail: ## Render the YouTube thumbnail → video/output/thumbnail.png (SHOTS=1 re-grabs the 3D stills; app running)
	$(if $(SHOTS),node video/scripts/thumb-shots.cjs &&) node video/scripts/thumbnail.cjs

##@ Cleanup
clean: ## Remove build/test output (keeps node_modules)
	rm -rf apps/*/.next apps/*/out packages/*/dist .turbo apps/*/.turbo packages/*/.turbo coverage apps/*/coverage packages/*/coverage apps/*/playwright-report apps/*/test-results $(SHOTS)

clean-all: clean ## Also remove node_modules
	rm -rf node_modules apps/*/node_modules packages/*/node_modules

.PHONY: help install env setup-claude browsers dev port dev-mock build start test test-engine test-web test-shape shape-capture facade-e2e photo-audit eval-stages shape-report shape-shots improve-shot test-watch coverage e2e \
        typecheck lint bridge bridge-sim test-bridge format format-check format-changed git-hooks check ci shots mockups scenarios-publish analyze scene-audit scene-audit-gpu lighthouse claude env-export mcp status todo deploy-link deploy clean clean-all video-tts-setup video-voice video-sfx video-capture video-canvas video-build video-thumbnail hf-dataset hf-publish
