# Crosscheck — State of the Build

**Date:** August 2026  
**Version:** 0.1.0  
**Status:** Working end-to-end. First real run completed.

---

## What it is

A CLI tool that wraps any coding agent command, captures the git diff it produced, then independently verifies those changes through four isolated stages using separate LLM calls.

The premise: the system that writes code should not be the only system deciding whether it's safe to ship.

---

## How it actually works

```
crosscheck run -- claude -p "add password reset"
```

1. **Before** — snapshots the git state: HEAD commit, staged diff, unstaged diff, untracked files, content hashes of changed files. This is the baseline.

2. **Runs the command** — transparent subprocess. stdin inherited, signals forwarded, colors preserved. The agent has no idea Crosscheck exists.

3. **After** — snapshots again. Computes the *attributable diff*: what changed specifically because of this command, minus anything that was already dirty before it ran. This is the hardest correctness problem.

4. **Pipeline runs:**
   - **Scout** (LLM) — reads the diff, produces structured risk assessment, affected areas, what the Reviewer should focus on. Recommends verification goals in plain English only — never produces shell commands.
   - **Builder** (deterministic, no LLM) — detects project type, picks allowlisted commands, runs your actual build/test/lint, captures bounded logs.
   - **Reviewer** (LLM) — reads Scout output, Builder evidence, the diff, and historical findings from memory. Produces structured findings with file paths, line numbers, confidence scores.
   - **Judge** (LLM) — reads all prior outputs. Makes final verdict: `pass`, `warn`, `block`, or `inconclusive`. Can dismiss Reviewer findings it considers unsupported.
   - **Policy engine** (deterministic) — applies configured thresholds to the verdict, determines exit code.

5. **Saves everything** — JSON, Markdown, and HTML reports under `.crosscheck/runs/<id>/`. Stores findings in memory for future runs.

---

## Source layout

```
src/
  cli/
    commands/         run, dry-run, init, doctor, status, runs, report,
                      explain, verify, inspect, override, demo, config
    output/           terminal.ts, progress.ts, fake-data.ts

  core/
    run/              run-orchestrator, run-state, run-context, run-pruner
    repository/       git-repository, repository-snapshot, diff-capture,
                      file-selection, repo-fingerprint
    execution/        command-runner, signal-forwarding, terminal-bridge,
                      output-capture
    context/          context-selector, context-budget, file-slicer,
                      source-redaction
    pipeline/         verification-pipeline, stage
    policy/           policy-engine, policy-schema, override-engine
    memory/           memory-store, memory-schema, memory-engine
    cache/            verification-cache
    reports/          report-builder, report-renderer, report-renderer-html,
                      report-store, evidence-store

  stages/
    scout/            scout-stage, scout-prompt, scout-schema
    builder/          builder-stage, project-detector, command-planner,
                      command-executor, log-sanitizer, command-allowlist
    reviewer/         reviewer-stage, reviewer-prompt, reviewer-schema
                      deterministic-rules/ (secret-leak, env-file, eval-usage,
                      disabled-tests, empty-catch, db-migration, lockfile-changed)
    judge/            judge-stage, judge-prompt, judge-schema

  inference/          llm-provider, anthropic-provider, fake-provider,
                      provider-factory

  config/             config-loader, config-schema, defaults
  storage/            local-run-store, paths
  shared/             errors, logger, schemas, hashing, redaction, tokens

datasets/
  escaped-incidents/  real incidents where verdict passed but caused prod issues
  rule-training/      labeled diff examples for tuning deterministic rules
  evaluation/         end-to-end fixtures with expected verdicts

scripts/
  install.sh          curl installer for macOS/Linux
  pkg-build.mjs       builds standalone binaries for all platforms

.github/
  workflows/
    crosscheck.yml    use Crosscheck in CI on PRs
    release.yml       build binaries + publish to npm on version tags
```

---

## All CLI commands

| Command | What it does |
|---------|-------------|
| `crosscheck run -- <cmd>` | Wrap and verify any command |
| `crosscheck dry-run -- <cmd>` | Preview what would happen — no subprocess, no LLM |
| `crosscheck init` | Create `.crosscheck/` with config, policy, repo fingerprint |
| `crosscheck doctor` | Validate API key, config, policy, models, builder commands |
| `crosscheck verify` | Verify current uncommitted diff without wrapping a command |
| `crosscheck runs` | List recent runs with verdict, date, file count |
| `crosscheck report` | Print Markdown report for latest run |
| `crosscheck report --open` | Open HTML report in browser |
| `crosscheck explain` | Verdict in plain English |
| `crosscheck inspect` | Context sent, token usage, stage identity, evidence IDs |
| `crosscheck inspect --prompt` | Also show prompt hash and input hash |
| `crosscheck override add` | Suppress a finding pattern in future runs |
| `crosscheck override list` | List active overrides |
| `crosscheck override remove <id>` | Remove an override |
| `crosscheck status` | Repo state, API key presence, latest run |
| `crosscheck config` | Show current config file |
| `crosscheck demo` | Full fake run — no subprocess, no LLM, no network |

### `crosscheck run` flags

```
--json                 Machine-readable output
--quiet                Suppress terminal output
--verbose              Debug logging
--no-builder           Skip Builder stage
--intent <text>        Describe what the command was supposed to do (improves Scout)
--policy <path>        Override policy file path
--model-scout <model>  Override model for Scout stage
--model-reviewer       Override model for Reviewer stage
--model-judge          Override model for Judge stage
```

---

## Configuration

`.crosscheck/config.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "models": {
    "scout":    "claude-haiku-4-5",
    "reviewer": "claude-sonnet-5",
    "judge":    "claude-opus-5"
  },
  "builder": {
    "enabled": true,
    "timeoutMs": 600000,
    "maxLogBytes": 100000,
    "installDependencies": false,
    "commands": []
  },
  "verification": {
    "includeUntrackedFiles": true,
    "maxDiffBytes": 500000,
    "maxFileBytes": 150000
  },
  "privacy": {
    "redactEnvironmentValues": true,
    "excludePatterns": [".env", ".env.*", "**/*.pem", "**/*.key", "**/credentials.*"]
  },
  "inferenceTimeoutMs": 120000,
  "runsToKeep": 100
}
```

`.crosscheck/policy.json`:

```json
{
  "version": 1,
  "mode": "advisory",
  "blockAtSeverity": "high",
  "minimumBlockingConfidence": 0.8,
  "requireBuilderSuccess": false,
  "allowOverride": true
}
```

**Policy modes:**

| Mode | Behaviour |
|------|-----------|
| `shadow` | Record everything, always exit 0 |
| `advisory` | Show findings, never block (default) |
| `blocking` | Return exit code 2 when Judge verdict meets thresholds |

**Environment variables:**

```
ANTHROPIC_API_KEY
CROSSCHECK_MODEL_SCOUT
CROSSCHECK_MODEL_REVIEWER
CROSSCHECK_MODEL_JUDGE
```

Model resolution precedence: `CROSSCHECK_MODEL_<STAGE>` → `config.json` → per-stage
default in `src/config/defaults.ts`. Stages are tiered by how much capability each
needs: Scout triages (Haiku), Reviewer analyses (Sonnet), Judge decides (Opus).

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Pass / advisory mode |
| 1 | Internal error |
| 2 | Policy block |
| 3 | Inconclusive |
| 4 | Invalid configuration |
| 5 | Wrapped command could not start |

---

## What the runs directory looks like

```
.crosscheck/runs/ccr_<id>/
  metadata.json         run record, stage statuses, attributed paths
  diff.patch            the attributable diff
  scout.json            Scout output + stage metadata (model, promptHash, durationMs)
  builder.json          Builder output + stage metadata
  reviewer.json         Reviewer findings + stage metadata
  judge.json            Judge verdict + stage metadata
  evidence.json         stable evidence IDs referenced by findings
  report.json           full structured report
  report.md             markdown report
  report.html           standalone HTML report (Linear/Vercel-style dark theme)
  command.stdout.log    wrapped command stdout
  command.stderr.log    wrapped command stderr
```

---

## Memory

Every completed run is persisted to `.crosscheck/memory.json`:

- **Run summaries** — verdict, confidence, finding count, builder status
- **Findings** — what the Reviewer found, what the Judge confirmed vs dismissed
- **Overrides** — user-created suppressions with optional expiry

The Reviewer queries memory before producing findings. If the same file had a broken auth pattern in previous runs, that context is injected into the Reviewer's prompt.

Memory writes use an exclusive file lock (`memory.lock`) so concurrent runs on the same repo don't clobber each other.

---

## Safety invariants

These are non-negotiable and enforced in code:

- Crosscheck never mutates or reverts user code during verification
- LLM output never reaches shell execution — Builder uses a deterministic allowlist only
- Pre-existing repository changes are never attributed to the wrapped command
- A stage that did not execute is never reported as passed
- Every finding references concrete evidence
- The Judge may dismiss Reviewer findings
- Malformed LLM output becomes `inconclusive`, never silently valid
- Secrets and excluded paths are redacted before any LLM call
- A failed or interrupted run still produces a partial report
- Builder's extra configured commands are validated at config load time — shell operators rejected with a clear error

---

## Inference

All LLM calls go through `src/inference/`:

- `LlmProvider` interface — `generateStructured<T>(request)` returns validated output plus `promptHash`, `inputHash`, `model`, `provider`, `tokenUsage`, `durationMs`
- `AnthropicProvider` — uses tool_use for structured JSON output. Retries on rate limits, server errors, network errors (up to 3 attempts with exponential backoff). Per-call timeout via AbortController. Catches auth errors and surfaces human-readable messages.
- `FakeProvider` — throws immediately. Used when no API key is set and in tests.
- `zod-to-json-schema` converts stage Zod schemas to JSON Schema for the tool definition

Every stage output includes: `promptVersion`, `promptHash`, `inputHash`, `model`, `provider`. Visible in `crosscheck inspect --prompt`.

---

## Builder

Fully deterministic — no LLM.

1. Detects project type (Node.js, Python, generic) from filesystem markers
2. Identifies package manager from lockfiles
3. Maps Scout's plain-English verification goals to allowlisted commands via `command-planner.ts`
4. Runs commands with configurable timeout (default 10 minutes)
5. Captures bounded logs (default 100KB)
6. Redacts secrets from output before storage

Results are cached by `SHA256(repoId + diffHash + commandList)` with a 24-hour TTL. If the diff hasn't changed and the commands haven't changed, Builder skips re-running.

---

## Deterministic rules

Run before the LLM Reviewer. Findings are injected into the Reviewer's prompt as known facts:

| Rule | Severity |
|------|----------|
| Secret leak in diff | critical |
| `.env` file added | high |
| `eval` / dangerous code execution | high |
| Tests disabled or skipped | medium |
| Empty catch blocks | low |
| Database migration added | medium |
| Dependency lockfile changed | info |

---

## Datasets

Three directories that grow over time and become part of the product:

- `datasets/escaped-incidents/` — real incidents where the pipeline passed something that caused a production issue. Ground truth for calibration.
- `datasets/rule-training/` — labeled diff examples (positive/negative/edge) for each deterministic rule.
- `datasets/evaluation/` — end-to-end fixtures with expected verdicts. Pipeline regression tests (not yet implemented as a test runner).

---

## Tests

**41 tests across 7 test files:**

- Config schema validation
- Policy engine (5 cases: shadow/advisory/blocking modes, confidence thresholds)
- Secret redaction
- Builder command allowlist (10 cases: valid commands, shell operators, empty commands)
- Builder project detection (4 cases: Node/pnpm, npm, Python, generic)
- Builder command planner (4 cases: script selection, package manager prefix, dedup, empty)
- Attributable diff integration (7 cases: new files attributed, pre-existing not attributed, untracked, empty diff, renamed)
- Git repository info (3 cases: detection, throws on non-git, dirty state)
- Full pipeline integration (4 cases: report files created, no-op command, non-zero exit code with changes, pre-existing isolation)

All tests use real git repos in temp directories. No mocked LLM calls — FakeProvider throws and the pipeline handles it gracefully.

---

## Distribution

### npm (all platforms)

```sh
npm install -g crosscheck
```

### curl (macOS / Linux, no Node.js required)

```sh
curl -fsSL https://raw.githubusercontent.com/eamonn/crosscheck/main/scripts/install.sh | sh
```

### Standalone binaries

Built by GitHub Actions on every version tag push. Released as:

```
crosscheck-linux-x64
crosscheck-linux-arm64
crosscheck-macos-x64
crosscheck-macos-arm64
crosscheck-win-x64.exe
checksums.txt
```

Binary build: tsup compiles everything to a single 1.7MB CJS bundle, then `@yao-pkg/pkg` wraps it with a Node.js 20 runtime. No Node.js required on the user's machine.

### To publish a release

```sh
# 1. Add NPM_TOKEN to GitHub repo secrets
# 2. Tag and push
git tag v0.1.0
git push --tags
# GitHub Actions builds binaries, publishes to npm, creates GitHub release
```

---

## Supported coding agents

CLI agents — wrap directly:

```sh
crosscheck run -- claude -p "prompt"
crosscheck run -- codex "prompt"
crosscheck run -- opencode "prompt"
crosscheck run -- openclaw "prompt"
crosscheck run -- hermes "prompt"
crosscheck run -- aider
crosscheck run -- <any command that changes files>
```

IDE agents (Cursor, Copilot, etc.) — verify after:

```sh
crosscheck verify
# or install a git hook:
crosscheck hook install   # not yet implemented — adds pre-push hook
```

---

## What is not done

### Missing features

- **`crosscheck hook`** — git pre-push/pre-commit hook installer for IDE agent workflows (Cursor etc.)
- **`crosscheck dashboard`** — static HTML aggregating all runs: verdict timeline, most common findings, files with most history
- **Memory read in Judge** — Judge doesn't query memory yet (Reviewer does). Full traceability chain not wired.
- **Evaluation harness** — `datasets/evaluation/` has fixtures but no test runner to execute them
- **HTML report verified by a human** — rewritten three times; whether it actually looks good is unconfirmed

### Known limitations

- Binary builds cannot run locally on Windows — requires Linux (GitHub Actions). Use `npm install -g crosscheck` on Windows.
- The `zodToJsonSchema` used for tool_use structured output has not been battle-tested against every edge case in the stage schemas on real API calls.
- Concurrent writes to `memory.json` use a file lock that times out after 10 seconds with a warning, not a hard error.
- Context selector defaults to a 60K token budget per LLM call — untested on very large diffs.

### What needs a real API key to validate

- Whether Scout/Reviewer/Judge prompts produce accurate, useful output on real diffs
- Whether token budgets are correctly sized
- Whether the Anthropic provider's retry logic handles all failure modes correctly
- Whether the structured output schemas survive all model responses without repair

---

## The run that proved it works

First real run on the ECUKBot repository found:

- Suspicious external endpoint in config
- Hardcoded machine-specific path that would break CI
- Duplicated path segment indicating a setup error
- Policy misconfiguration

Verdict: WARN · 82% confidence. Advisory mode, exit 0.

Nobody told it what to look for. It found those from the diff.

---

## Engineering invariants (never violate these)

1. The verifier is independent from the generator
2. Every finding references evidence
3. LLM output never executes shell commands
4. Deterministic evidence always takes precedence over model opinion
5. Crosscheck never mutates your repository during verification
6. A stage that did not execute is never reported as passed
7. Pre-existing changes are never attributed to the wrapped command
8. Sensitive paths and secrets are excluded or redacted before remote inference
9. A failed run must still leave a partial report
