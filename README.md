# Crosscheck

Crosscheck is an independent verification runtime for AI-generated code.

> **The system writing code should not be the only system deciding whether that code is safe to ship.**

## How it works

Crosscheck wraps any coding agent or development command, captures the repository diff it produced, then independently verifies those changes through four isolated stages:

```
Wrapped command
      ↓
Repository delta
      ↓
   Scout
      ↓
   Builder
      ↓
  Reviewer
      ↓
   Judge
      ↓
Policy decision
      ↓
Terminal + report
```

## Install

```sh
pnpm install
pnpm build
```

Link the binary for local use:

```sh
node dist/index.js --version
# or link globally:
# pnpm link --global
```

## Quick start

```sh
# 1. Initialize in your repository
crosscheck init

# 2. Set your API key
export ANTHROPIC_API_KEY=your-key-here

# 3. Wrap a coding agent or any command
crosscheck run -- claude -p "Add password reset support"
crosscheck run -- codex
crosscheck run -- npm run generate
crosscheck run -- python script.py

# 4. Check the verdict
crosscheck report
crosscheck explain
```

## Commands

| Command | Description |
|---------|-------------|
| `crosscheck init` | Create `.crosscheck/` with config and policy files |
| `crosscheck run -- <cmd>` | Wrap and verify a command |
| `crosscheck verify` | Verify the current uncommitted diff (no command) |
| `crosscheck report [run-id]` | Print the latest (or specific) report |
| `crosscheck explain [run-id]` | Explain the latest verdict in plain English |
| `crosscheck status` | Show repository and Crosscheck status |
| `crosscheck config` | Show the current configuration |

## Configuration

`crosscheck init` creates `.crosscheck/config.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "builder": { "enabled": true, "timeoutMs": 600000 },
  "verification": { "maxDiffBytes": 500000 },
  "privacy": { "redactEnvironmentValues": true }
}
```

### Model environment variables

```sh
export ANTHROPIC_API_KEY=...
export CROSSCHECK_MODEL_SCOUT=claude-haiku-4-5
export CROSSCHECK_MODEL_REVIEWER=claude-sonnet-4-6
export CROSSCHECK_MODEL_JUDGE=claude-opus-4-8
```

## Policy

`.crosscheck/policy.json` controls how verdicts affect the exit code:

| Mode | Behavior |
|------|----------|
| `shadow` | Record everything, always exit 0 |
| `advisory` | Show findings, never block (default) |
| `blocking` | Use Judge verdict to return exit code 2 on block |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Allowed / pass |
| 1 | Internal Crosscheck error |
| 2 | Policy denied / block |
| 3 | Verification inconclusive |
| 4 | Invalid configuration |
| 5 | Wrapped command could not start |

## Verification stages

**Scout** — understands the scope, intent, and risk level of the change.

**Builder** — runs your project's build, test, typecheck, and lint commands. Produces concrete pass/fail evidence.

**Reviewer** — deep evidence-based analysis. Every finding cites exact file paths and diff evidence.

**Judge** — aggregates all evidence. Skeptical of the Reviewer — can dismiss unsupported findings. Returns a final verdict: `pass`, `warn`, `block`, or `inconclusive`.

## Reports

Every run stores under `.crosscheck/runs/<run-id>/`:

- `metadata.json` — run record
- `diff.patch` — the diff produced by the wrapped command
- `scout.json`, `builder.json`, `reviewer.json`, `judge.json` — stage outputs
- `report.json`, `report.md` — the full report
- `command.stdout.log`, `command.stderr.log` — command output

## Privacy

- Secrets are redacted from diffs and logs before any LLM call
- Environment variable values are never included in prompts
- Files matching `excludePatterns` (`.env`, `*.pem`, `*.key`) are excluded
- No code is uploaded unless ANTHROPIC_API_KEY is set

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

---

**This is an early verification system. It is not a guarantee of correctness or security.**
