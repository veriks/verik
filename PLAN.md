# Crosscheck — Implementation Plan

## What we are building

Crosscheck is a local-first CLI verification runtime. It wraps any coding agent or
development command, captures the repository diff it produced, then independently
verifies those changes through four isolated stages:

    Wrapped command
          ↓
    Repository delta (attributable diff — not the full dirty tree)
          ↓
       Scout          ← AI reasoning
          ↓
       Builder        ← deterministic execution only
          ↓
      Reviewer        ← AI reasoning
          ↓
       Judge          ← AI reasoning
          ↓
    Policy decision
          ↓
    Terminal + report

Scout, Reviewer, and Judge use AI reasoning.
Builder does not. It detects the project, selects allowlisted commands, runs them,
captures bounded logs, and produces structured evidence. No LLM involvement.

## The hardest part of `crosscheck run -- <command>`

The hardest correctness problem is not running the agent. It is:

> Which changes were already present, and which were introduced by this command?

Crosscheck must:
1. Capture baseline staged, unstaged, and untracked state **before** execution.
2. Execute the wrapped command.
3. Capture final state **after** execution.
4. Compute a delta: only what changed *during* the command — not pre-existing work.

Pre-existing changes must never be attributed to the wrapped command. This is a
first-class correctness invariant, not an implementation detail.

## Scout → Builder command boundary

Scout identifies risk and recommends **verification goals** (e.g., "TypeScript should
be checked", "tests should run"). It never produces shell commands.

A deterministic command planner maps those goals to allowlisted commands:

    Scout recommends goals
          ↓
    Deterministic command planner maps goals → allowlisted commands
          ↓
    Builder executes

Builder never executes anything not in its allowlist. LLM output never reaches
the shell directly. This is a security invariant.

## Technology

- TypeScript (strict), Node.js ≥20, pnpm, ESM
- Commander (CLI), Zod (schemas), execa (subprocess), simple-git (Git)
- Vitest (tests), ESLint + Prettier, tsup (build)

## Source layout

```
src/
  cli/commands/   run · verify · report · explain · status · init · config
  cli/output/     terminal renderer (colors, spinners, plain-text fallback)

  core/run/       orchestrator · run-state · run-context
  core/repository/ git-repository · snapshot · diff-capture · file-selection
  core/execution/ command-runner · terminal-bridge · signal-forwarding · output-capture
  core/context/   context-selector · context-budget · source-redaction · file-slicer
  core/pipeline/  verification-pipeline · stage interface
  core/policy/    policy-engine · policy-schema
  core/reports/   report-builder · report-store · report-renderer · evidence-store

  stages/scout/     scout-stage · scout-prompt · scout-schema
  stages/builder/   builder-stage · project-detector · command-planner · executor · log-sanitizer
  stages/reviewer/  reviewer-stage · reviewer-prompt · reviewer-schema
                    deterministic-rules/
  stages/judge/     judge-stage · judge-prompt · judge-schema

  inference/      llm-provider · anthropic-provider · fake-provider · provider-factory
  config/         config-loader · config-schema · defaults
  storage/        local-run-store · paths
  shared/         errors · logger · schemas · hashing · redaction · tokens

  core/memory/    memory-store · memory-schema · memory-engine

datasets/
  escaped-incidents/   real incidents where a verdict passed but the change caused production issues
  rule-training/       labeled diff examples for tuning deterministic rules
  evaluation/          end-to-end fixtures with expected verdicts (pipeline regression testing)
```

## Run lifecycle statuses

Every stage and the overall run uses these statuses:

- `pending`
- `running`
- `completed`
- `failed`
- `skipped`
- `inconclusive`
- `cancelled`

A stage that did not execute can never be reported as `completed`.

## Evidence model

Findings reference stable evidence IDs rather than embedding data repeatedly:

    evidence/
      ev_builder_test_01       ← Builder command failure
      ev_diff_auth_02          ← Diff excerpt
      ev_rule_cc_003           ← Deterministic rule match

    finding → evidence IDs
    judge reason → finding → evidence ID → exact file/log/command

This traceability is the product's core value.

## Memory

Every completed run is persisted to a local memory store (`.crosscheck/memory.json`).
The store records run summaries, confirmed findings, dismissed findings, and user overrides.

The memory module is live now — `saveFinding()`, `saveRun()`, `saveOverride()`.
The Reviewer does not yet query it. When it does, the shape will be:

    Reviewer
          ↓
    Memory
          ↓
    "This file had a broken auth pattern three times before."

That surface is the point. The module exists so that integration costs nothing.

## Datasets

Three dataset directories exist from day one:

- `datasets/escaped-incidents/` — real incidents where a verdict passed but caused production issues
- `datasets/rule-training/` — labeled diff examples for tuning deterministic rules
- `datasets/evaluation/` — end-to-end fixtures with expected verdicts

These become part of the product. Escaped incidents are the ground truth for calibration.
Rule training feeds accuracy improvements. Evaluation fixtures prevent regressions.

## Inference (formerly providers/)

All LLM calls go through `src/inference/`. The name reflects what the module does
rather than what vendors it currently wraps. Adding OpenAI, Ollama, Azure, or Vertex
means adding a new file in `inference/` — nothing else changes.

## Milestones

| # | Scope |
|---|-------|
| 1 | Scaffold + CLI + init + config + run storage + transparent execution + baseline snapshot + **attributable diff** |
| 2 | Stage contracts + fake provider + reports + terminal renderer |
| 3 | Scout + context selection module |
| 4 | Builder + deterministic command planner + allowlist + bounded logs + evidence |
| 5 | Deterministic rules + Reviewer |
| 6 | Judge + policy engine + exit codes |
| 7 | Anthropic provider + token accounting + structured-output repair |
| 8 | Integration tests + security hardening + docs + packaging |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Allowed / pass |
| 1 | Internal Crosscheck error |
| 2 | Policy denied / block |
| 3 | Verification inconclusive |
| 4 | Invalid configuration |
| 5 | Wrapped command could not start |

## Engineering invariants

These are non-negotiable. They may never be violated for convenience.

- Crosscheck never mutates or reverts user code during verification.
- Crosscheck never executes commands generated freely by an LLM.
- Pre-existing repository changes are never attributed to the wrapped command.
- A stage that did not execute can never be reported as passed.
- Every finding must reference concrete evidence.
- The Judge may dismiss Reviewer findings.
- A malformed AI response becomes inconclusive, never silently valid.
- Sensitive paths and secret-like values are excluded or redacted before remote inference.
- A failed or interrupted run must still leave a partial report.
