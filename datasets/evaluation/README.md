# datasets/evaluation/

End-to-end evaluation fixtures: complete synthetic repository changes with
expected Verik verdicts.

Used to:
- Measure pipeline accuracy across model versions
- Catch regressions when prompts or schemas change
- Benchmark confidence calibration
- Compare provider outputs

## Structure

```
evaluation/
  fixtures/
    <fixture-id>/
      before/      ← repository state before the command
      after/       ← repository state after the command
      expected.json
  results/
    <run-date>-<model>.jsonl   ← one result per fixture per evaluation run
```

## expected.json schema

```json
{
  "fixtureId": "fix_auth_reset_reuse",
  "description": "Password reset token remains valid after use.",
  "expectedVerdict": "block",
  "expectedFindings": [
    {
      "titleContains": "reuse",
      "minSeverity": "high",
      "minConfidence": 0.8
    }
  ],
  "shouldNotMiss": ["token lifecycle", "replay attack"],
  "tags": ["auth", "security"]
}
```

## Running evaluations

```sh
pnpm build
pnpm eval                      # rules mode — no API key, no network
pnpm eval --filter secret      # only fixtures whose id contains "secret"
pnpm eval --mode full          # scores Judge verdicts; needs ANTHROPIC_API_KEY
```

`rules` is the default because it costs nothing and can gate every push. Only
`--mode full` requires a key.

## expectedRules schema

For deterministic fixtures, assert the rules that must fire:

```json
{
  "fixtureId": "secret-and-tls",
  "description": "Agent hardcodes a credential and disables certificate verification.",
  "expectedRules": [
    { "ruleId": "secret-leak", "file": "src/client.ts", "minSeverity": "critical" }
  ],
  "tags": ["security"]
}
```

Or assert silence, which is the more valuable kind:

```json
{ "fixtureId": "clean-refactor", "expectNoFindings": true }
```

Two of the seven fixtures expect nothing at all. A rule becoming noisy is how
this tool gets uninstalled, and those are the only fixtures that catch it.

Each fixture is materialised as a throwaway git repository — `before/` is
committed to form the baseline, `after/` is laid over it uncommitted — so a run
exercises the same attribution path a user gets rather than a shortcut. Results
are appended to `results/<timestamp>.jsonl`; the process exits non-zero if any
fixture fails, so it can gate a prompt change in CI.

The harness refuses to run without an API key. Without one every LLM stage
fails and every verdict is inconclusive, which measures nothing.

## There are deliberately no fixtures yet

**Do not write fixtures by hand from imagination.** This directory is the
calibration ground truth for the whole product: if the expected verdicts are
invented, every accuracy number computed against them is fiction, and prompt
changes get tuned toward a fantasy.

Fixtures should be derived from real runs:

1. Run Verik against real agent-generated diffs with a real key.
2. Read every finding and label it true or false positive yourself.
3. Turn the labelled cases — especially the ones it got *wrong* — into fixtures.

That exercise produces the precision number, the ground truth, and evidence of
which prompt is weakest, all at once. It is the recommended next step in
exactly this reason.
