# CI Integration

Crosscheck works in any CI environment that supports Node.js 20+.

## GitHub Actions

Add `ANTHROPIC_API_KEY` as a repository secret, then add a workflow:

```yaml
name: Crosscheck
on:
  pull_request:
    branches: [main, master]

jobs:
  crosscheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm install -g crosscheck
      - run: crosscheck init

      - name: Verify changes
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: crosscheck verify --intent "PR ${{ github.event.pull_request.title }}"
```

The workflow file is also included at `.github/workflows/crosscheck.yml`.

## Exit codes

| Code | Meaning | Default behaviour |
|------|---------|-------------------|
| 0 | Pass / advisory mode | CI passes |
| 1 | Internal error | CI fails |
| 2 | Policy block | CI fails (blocking mode only) |
| 3 | Inconclusive | CI passes (configure as needed) |
| 4 | Invalid configuration | CI fails |
| 5 | Command could not start | CI fails |

By default, policy mode is `advisory` — Crosscheck reports findings but never returns exit code 2. Switch to `blocking` in `.crosscheck/policy.json` to fail CI on high-severity findings:

```json
{
  "version": 1,
  "mode": "blocking",
  "blockAtSeverity": "high",
  "minimumBlockingConfidence": 0.8
}
```

## Setting the API key

```sh
# GitHub — add as a repository secret
# Settings → Secrets and variables → Actions → New repository secret
# Name: ANTHROPIC_API_KEY

# GitLab
# Settings → CI/CD → Variables → Add variable
# Key: ANTHROPIC_API_KEY, Protected: yes, Masked: yes
```

## Wrapping a coding agent in CI

If you run a coding agent as part of your pipeline, wrap it with `crosscheck run`:

```yaml
- name: Run coding agent
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    crosscheck run -- your-agent --flag value
```

## `crosscheck verify` vs `crosscheck run`

- **`crosscheck verify`** — verifies the current uncommitted diff. Use this in PR workflows where code is already in the branch.
- **`crosscheck run -- <cmd>`** — wraps a command and verifies what it changed. Use this when a coding agent runs as part of the pipeline.
