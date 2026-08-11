# datasets/escaped-incidents/

Real incidents where a Verik verdict passed (or was overridden) but the change
caused a production issue.

Each entry records:
- The original run ID and verdict
- What the Reviewer and Judge said at the time
- What actually happened in production
- Which finding (if any) was present but dismissed or missed

Format: JSON files named `<incident-id>.json`

These are the ground truth for evaluating whether the pipeline is too lenient.
They feed directly into `rule-training/` and inform confidence calibration.

## Schema

```json
{
  "incidentId": "inc_...",
  "runId": "vk_...",
  "repositoryRemote": "https://github.com/...",
  "occurredAt": "2026-01-15T00:00:00Z",
  "verdict": "pass",
  "overridden": false,
  "productionImpact": "Password reset tokens remained valid after use.",
  "rootCause": "Reviewer finding was present but Judge dismissed it as low confidence.",
  "findingId": "finding-...",
  "findingTitle": "Reset tokens can be reused",
  "findingSeverity": "high",
  "findingConfidence": 0.71,
  "judgeDisposed": "dismissed",
  "dismissReason": "Not sufficiently supported by the diff.",
  "lesson": "Token lifecycle issues should have higher blocking confidence.",
  "tags": ["auth", "token-lifecycle"]
}
```
