# Configuration Reference

## `.crosscheck/config.json`

```json
{
  "version": 1,
  "provider": "anthropic",
  "models": {
    "scout": "configured-through-environment",
    "reviewer": "configured-through-environment",
    "judge": "configured-through-environment"
  },
  "builder": {
    "enabled": true,
    "timeoutMs": 600000,
    "maxLogBytes": 100000,
    "installDependencies": false,
    "commands": []
  },
  "verification": {
    "includeUntrackedFiles": true,
    "maxDiffBytes": 500000,
    "maxFileBytes": 150000
  },
  "privacy": {
    "redactEnvironmentValues": true,
    "excludePatterns": [".env", ".env.*", "**/*.pem", "**/*.key", "**/credentials.*"]
  }
}
```

## `.crosscheck/policy.json`

```json
{
  "version": 1,
  "mode": "advisory",
  "blockAtSeverity": "high",
  "minimumBlockingConfidence": 0.8,
  "requireBuilderSuccess": false,
  "allowOverride": true
}
```

### Policy modes

| Mode | Behavior |
|------|----------|
| `shadow` | Record, always exit 0 |
| `advisory` | Show findings, never block |
| `blocking` | Block on Judge verdict meeting thresholds |

## Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `CROSSCHECK_MODEL_SCOUT` | Model for Scout stage |
| `CROSSCHECK_MODEL_REVIEWER` | Model for Reviewer stage |
| `CROSSCHECK_MODEL_JUDGE` | Model for Judge stage |
| `NO_COLOR` | Disable terminal colors |

## `crosscheck run` flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable output |
| `--quiet` | Suppress terminal output |
| `--verbose` | Enable debug logging |
| `--no-builder` | Skip Builder stage |
| `--policy <path>` | Override policy file path |
| `--intent <text>` | User intent description |
| `--model-scout <model>` | Override Scout model |
| `--model-reviewer <model>` | Override Reviewer model |
| `--model-judge <model>` | Override Judge model |
