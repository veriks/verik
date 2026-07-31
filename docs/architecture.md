# Architecture

## Repository structure

```
src/
  cli/commands/   run · verify · report · explain · status · init · config
  cli/output/     terminal renderer (colors, plain-text fallback)

  core/run/       run-orchestrator · run-state · run-context
  core/repository/ git-repository · repository-snapshot · diff-capture · file-selection
  core/process/   command-runner · signal-forwarding
  core/pipeline/  verification-pipeline · stage interface
  core/policy/    policy-engine · policy-schema
  core/reports/   report-builder · report-renderer · report-store

  stages/scout/     scout-stage · scout-prompt · scout-schema
  stages/builder/   builder-stage · project-detector · command-planner · executor · log-sanitizer
  stages/reviewer/  reviewer-stage · reviewer-prompt · reviewer-schema
                    deterministic-rules/ (secret-leak, env-file, eval, tests, catch, migration, lockfile)
  stages/judge/     judge-stage · judge-prompt · judge-schema

  providers/    llm-provider interface · anthropic-provider · fake-provider · provider-factory
  config/       config-loader · config-schema · defaults
  storage/      local-run-store · paths
  shared/       errors · logger · schemas · hashing · redaction · tokens
```

## Key design decisions

**Transparent subprocess wrapping.** `crosscheck run` inherits stdin and passes through signals, colors, and exit codes. The wrapped command has no knowledge of Crosscheck.

**Baseline snapshot before, final snapshot after.** Crosscheck captures the Git state before and after the wrapped command to attribute only changes introduced by it — not pre-existing dirty state.

**Provider abstraction.** All LLM calls go through `LlmProvider`. The Anthropic provider uses tool_use for structured JSON output. A `FakeProvider` is used in tests and when no API key is set.

**Stage contract.** Every stage has a typed input schema, typed output schema, Zod validation, and safe failure semantics. A failed stage produces partial results rather than crashing the pipeline.

**Deterministic rules before LLM.** The deterministic rule engine runs before the Reviewer, feeding concrete findings (secret leaks, disabled tests, migrations) into the LLM context.

**Evidence-backed findings.** Every finding must cite file paths and diff evidence. The Judge can dismiss Reviewer findings it considers unsupported.

**Local-first storage.** Runs are stored as JSON files under `.crosscheck/runs/<run-id>/`. No database required.
