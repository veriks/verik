# Verik

Verik is an independent verification runtime for AI-generated code.

> **Unlike traditional AI code review, Verik separates generation from verification. The system that writes code is never the same system that decides whether it should be trusted..**

## How it works

Verik wraps any coding agent or development command, captures the repository diff it produced, then independently verifies those changes through four isolated stages:

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

**Not yet published to npm.** Build from source — this takes about a minute:

```sh
git clone https://github.com/veriks/verik.git
cd verik && pnpm install && pnpm build && npm link
```

Then `verik --version` should print `0.1.0`.

Full walkthrough on a real repository: **[docs/quickstart.md](docs/quickstart.md)**

## Quick start

```sh
# 1. Initialize — `rules` mode needs no API key, no network
verik init --yes --mode rules

# 2. Wrap a coding agent or any command
verik run -- claude -p "Add OAuth login"
verik run -- codex
verik run -- aider
verik run -- amp
verik verify

# 3. Check the verdict
verik report
verik explain
```

Or stop having to remember it — verify on every commit:

```sh
verik hook install
```

Runs the deterministic rules (no API key, no network) before each `git commit`,
and blocks only when your policy says to. An existing hook — husky, lint-staged,
pre-commit — is preserved and still runs; `verik hook uninstall` puts it
back exactly as it was. A single commit can always skip it with
`git commit --no-verify`.

## Trying it on a real repo

Step-by-step walkthrough, no API key needed: **[docs/quickstart.md](docs/quickstart.md)**

## Commands

| Command | Description |
|---------|-------------|
| `verik init` | Create `.verik/` with config and policy files |
| `verik run -- <cmd>` | Wrap and verify a command |
| `verik verify` | Verify the current uncommitted diff (no command) |
| `verik begin` | Mark a baseline, for agents that can't be wrapped |
| `verik hook install` | Verify on every `git commit` |
| `verik rules` | List and tune the deterministic rules |
| `verik policy` | Show or change how strict verification is |
| `verik report [run-id]` | Print the latest (or specific) report |
| `verik explain [run-id]` | Explain the latest verdict in plain English |
| `verik status` | Show repository and Verik status |
| `verik config` | Show the current configuration |

## Tuning

A rule too noisy for your codebase has two levers, and they are not equivalent:

```sh
verik rules                                  # see all 23 and their severity
verik rules severity debug-artifact info     # keep it, stop it blocking
verik rules disable type-escape --reason "generated protobuf bindings"
verik policy mode advisory                   # report everything, block nothing
```

Reach for `severity` first — the finding stays in the report, it just stops
crossing the blocking threshold, so no information is lost. `disable` requires a
written reason, which is stored in `.verik/policy.json` and therefore shows
up in the pull request that turned the rule off.

Even a disabled rule still runs. Its findings are recorded in the run record as
suppressed, with the reason and who suppressed them, so switching a check off
can never hide something without leaving a trace.

## Configuration

`verik init` creates `.verik/config.json`:

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
export VERIK_MODEL_SCOUT=claude-haiku-4-5
export VERIK_MODEL_REVIEWER=claude-sonnet-5
export VERIK_MODEL_JUDGE=claude-opus-5
```

## Policy

`.verik/policy.json` controls how verdicts affect the exit code:

| Mode | Behavior |
|------|----------|
| `shadow` | Record everything, always exit 0 |
| `advisory` | Show findings, never block (default) |
| `blocking` | Use Judge verdict to return exit code 2 on block |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Passed, or the policy chose not to block |
| `1` | Verik itself failed |
| `2` | **Policy blocked** — do not ship |
| `3` | Blocking mode, but verification never reached a verdict |
| other | The wrapped command's own exit code, passed through |

## Verification stages

**Scout** — understands the scope, intent, and risk level of the change.

**Builder** — runs your project's build, test, typecheck, and lint commands. Produces deterministic runtime evidence.

**Reviewer** — deep evidence-based analysis. Every finding cites exact file paths and diff evidence.

**Judge** — aggregates all evidence. Skeptical of the Reviewer — can dismiss unsupported findings. Returns a final verdict: `pass`, `warn`, `block`, or `inconclusive`.

## Reports

Every run stores under `.verik/runs/<run-id>/`:

- `metadata.json` — run record
- `diff.patch` — the diff produced by the wrapped command
- `scout.json`, `builder.json`, `reviewer.json`, `judge.json` — stage outputs
- `report.json`, `report.md` — the full report
- `command.stdout.log`, `command.stderr.log` — command output

## Privacy

- Secrets are redacted from diffs and logs before any LLM call
- Environment variable values are never included in prompts
- Files matching `excludePatterns` (`.env`, `*.pem`, `*.key`) are excluded
- In `rules` mode nothing leaves the machine at all — no API key, no network

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Principles

Verik follows a few non-negotiable rules.

- The verifier is independent from the generator.
- Every finding references evidence.
- AI recommendations never execute shell commands.
- Deterministic evidence always takes precedence over model opinion.
- Verik never mutates your repository during verification.

---

**This is an early verification system. It is not a guarantee of correctness or security.**
