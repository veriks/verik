# datasets/evaluation/

End-to-end evaluation fixtures: complete synthetic repository changes with
expected Crosscheck verdicts.

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

Not yet implemented. Planned for Milestone 8.
