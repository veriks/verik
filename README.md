# Crosscheck

Crosscheck is an independent verification runtime for AI-generated code.

> **Unlike traditional AI code review, Crosscheck separates generation from verification. The system that writes code is never the same system that decides whether it should be trusted..**

## How it works

Crosscheck wraps any coding agent or development command, captures the repository diff it produced, then independently verifies those changes through four isolated stages:

```
Wrapped command
      ↓
Attributed repository diff
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

**npm — works everywhere Node.js is installed**
```sh
npm install -g crosscheck
```

**curl — macOS and Linux, no Node.js required**
```sh
curl -fsSL https://raw.githubusercontent.com/crosscheck-sh/crosscheck/main/scripts/install.sh | sh
```

**PowerShell (Windows)**
```powershell
npm install -g crosscheck
```

**npx — one-off without installing**
```sh
npx crosscheck init
npx crosscheck run -- claude -p "your prompt"
```

## Quick start

```sh
# 1. Initialize in your repository
crosscheck init

# 2. Set your API key
export ANTHROPIC_API_KEY=your-key-here

# 3. Wrap a coding agent or any command
crosscheck run -- claude -p "Add OAuth login"
crosscheck run -- codex
crosscheck run -- aider
crosscheck run -- amp
crosscheck verify

# 4. Check the verdict
crosscheck report
crosscheck explain
```

Or stop having to remember it — verify on every commit:

```sh
crosscheck hook install
```

Runs the deterministic rules (no API key, no network) before each `git commit`,
and blocks only when your policy says to. An existing hook — husky, lint-staged,
pre-commit — is preserved and still runs; `crosscheck hook uninstall` puts it
back exactly as it was. A single commit can always skip it with
`git commit --no-verify`.

## Commands

| Command | Description |
|---------|-------------|
| `crosscheck init` | Create `.crosscheck/` with config and policy files |
| `crosscheck run -- <cmd>` | Wrap and verify a command |
| `crosscheck verify` | Verify the current uncommitted diff (no command) |
| `crosscheck begin` | Mark a baseline, for agents that can't be wrapped |
| `crosscheck hook install` | Verify on every `git commit` |
| `crosscheck rules` | List and tune the deterministic rules |
| `crosscheck policy` | Show or change how strict verification is |
| `crosscheck report [run-id]` | Print the latest (or specific) report |
| `crosscheck explain [run-id]` | Explain the latest verdict in plain English |
| `crosscheck status` | Show repository and Crosscheck status |
| `crosscheck config` | Show the current configuration |

## Tuning

A rule too noisy for your codebase has two levers, and they are not equivalent:

```sh
crosscheck rules                                  # see all 23 and their severity
crosscheck rules severity debug-artifact info     # keep it, stop it blocking
crosscheck rules disable type-escape --reason "generated protobuf bindings"
crosscheck policy mode advisory                   # report everything, block nothing
```

Reach for `severity` first — the finding stays in the report, it just stops
crossing the blocking threshold, so no information is lost. `disable` requires a
written reason, which is stored in `.crosscheck/policy.json` and therefore shows
up in the pull request that turned the rule off.

Even a disabled rule still runs. Its findings are recorded in the run record as
suppressed, with the reason and who suppressed them, so switching a check off
can never hide something without leaving a trace.

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

# Optional — override the per-stage defaults shown here.
export CROSSCHECK_MODEL_SCOUT=claude-haiku-4-5
export CROSSCHECK_MODEL_REVIEWER=claude-sonnet-5
export CROSSCHECK_MODEL_JUDGE=claude-opus-5
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

**Builder** — runs your project's build, test, typecheck, and lint commands. Produces deterministic runtime evidence.

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

## Principles

Crosscheck follows a few non-negotiable rules.

- The verifier is independent from the generator.
- Every finding references evidence.
- AI recommendations never execute shell commands.
- Deterministic evidence always takes precedence over model opinion.
- Crosscheck never mutates your repository during verification.

---

**This is an early verification system. It is not a guarantee of correctness or security.**
