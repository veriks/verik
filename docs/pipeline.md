# Pipeline

## Stage order

```
Scout → Builder → Reviewer → Judge → Policy Engine
```

Each stage receives typed input, produces typed output, and validates with Zod.

## Scout

Reads: wrapped command, diff, changed files, repository metadata.
Produces: risk level, change type, affected areas, review focus, builder recommendations.

## Builder

Detects: project type, package manager, available scripts.
Runs: typecheck, test, lint, build (conservative allowlist).
Produces: per-command pass/fail/timeout, evidence items from failures.

## Reviewer

Reads: Scout output, Builder evidence, deterministic rule findings, diff, context files.
Produces: findings with severity/confidence/evidence, recommended verdict.

Deterministic rules run before the LLM:
- Secret leak detection
- `.env` file introduced
- `eval` / dangerous code execution
- Disabled/skipped tests
- Empty catch blocks
- Database migration added
- Dependency lockfile changed

## Judge

Reads: all stage outputs, policy configuration.
Produces: `pass` / `warn` / `block` / `inconclusive` verdict with confidence and reasons.
May dismiss Reviewer findings that lack concrete evidence.

## Policy Engine

Deterministic. Reads: Judge output + policy.json.
Produces: `allow` / `warn` / `deny` decision and exit code.
