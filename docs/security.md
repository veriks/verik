# Security

## Privacy model

- Secrets are redacted from diffs and logs before any content reaches the LLM.
- Environment variable values are never included in prompts (keys only).
- Files matching `privacy.excludePatterns` (`.env`, `*.pem`, `*.key`, `credentials.*`) are excluded.
- The `.git` directory is never uploaded.
- Dependency directories and build artifacts are excluded.

## Safe defaults

- Builder only runs commands from a conservative allowlist — never arbitrary scripts.
- LLM-suggested commands are never executed; Builder commands come from deterministic detection.
- Scout and Reviewer cannot invent shell commands that get executed.
- Source files are never mutated during verification.
- Changes produced by the wrapped command are never automatically reverted.
- Path traversal is prevented in local report storage.
- Logs and diffs are bounded to configurable byte limits.
- Symlinks outside the repository root are not followed when collecting context.

## LLM input boundaries

Only the following content is sent to the configured LLM provider:

- The diff produced by the wrapped command (bounded by `maxDiffBytes`)
- Selected context files (changed files, nearby code, manifests, README)
- Repository metadata (branch, commit, file paths)
- Stage outputs from prior stages (structured JSON)

**Never sent:**

- `.env` files or matched exclusion patterns
- Secret values (only key names)
- Full environment variables
- Dependency directories

## Threat model

Crosscheck is a local tool. It does not:

- Run a server or expose a network endpoint
- Persist data outside `.crosscheck/` in the repository
- Send telemetry
- Execute code suggested by an LLM

It relies on trust in the configured LLM provider.
