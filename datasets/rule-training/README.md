# datasets/rule-training/

Training examples for deterministic rules: diff excerpts with labeled ground truth.

Used to:
- Calibrate which patterns should trigger
- Tune confidence levels
- Regression-test rules after changes
- Add new rules from escaped incidents

Each subdirectory corresponds to one rule ID (e.g. `secret-leak/`, `eval-usage/`).

## Format

Each example is a pair of files:
- `<example-id>.diff`   — the raw diff excerpt
- `<example-id>.json`  — label and metadata

```json
{
  "exampleId": "ex_secret_001",
  "ruleId": "secret-leak",
  "label": "positive",
  "severity": "critical",
  "confidence": 0.95,
  "note": "Hardcoded API key in environment config.",
  "source": "synthetic",
  "tags": ["api-key", "environment"]
}
```

Labels: `positive` (should trigger), `negative` (should not trigger), `edge` (ambiguous, document reasoning).
Sources: `synthetic` | `escaped-incident` | `anonymized-production`
