# Crosscheck — State & Handoff

**Last verified:** 9 August 2026
**Branch:** `feat/verification-pipeline2` → `main`
**Remote:** https://github.com/crosscheck-sh/crosscheck (private)

This document is written for someone picking the project up cold, with their own
Claude. Everything below was verified by running it, not recalled. Where something
is unverified, it says so — please keep that property.

---

## 1. What it is

A CLI that wraps any coding-agent command, captures the git diff that command
produced, and independently verifies those changes through four isolated stages,
each a separate LLM call or deterministic pass.

```
crosscheck run -- claude -p "add password reset"
```

The premise: **the system that writes the code should not be the only system
deciding whether it is safe to ship.**

---

## 2. Status in one paragraph

The plumbing is built and green. Lint, typecheck, 41 tests and the build all
pass; the CLI runs end to end on fake data. **The product itself is unvalidated.**
No test exercises a real model response, and the pipeline has been run against a
live `ANTHROPIC_API_KEY` exactly once, on one repository. Nobody has measured
whether the verdicts are any good. That is the single most important open
question and everything in §7 is subordinate to it.

---

## 3. Run it right now

No API key needed:

```sh
pnpm install
pnpm build
node dist/index.js demo      # full fake run — no subprocess, no LLM, no network
node dist/index.js doctor    # validates git repo, config, policy, key, allowlist
node dist/index.js dry-run -- claude -p "add a feature"
node dist/index.js status
NO_COLOR=1 node dist/index.js demo   # what CI and piped output look like
```

With a key — this is the part that matters:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
node dist/index.js verify                    # verify the current uncommitted diff
node dist/index.js run -- claude -p "..."    # wrap an agent end to end
```

Checks:

```sh
pnpm check    # lint + typecheck + format:check
pnpm fix      # eslint --fix + prettier
pnpm test
```

---

## 4. How a run works

1. **Snapshot before** — HEAD sha, staged/unstaged diffs, untracked files, content
   hashes. This is the baseline.
2. **Run the wrapped command** — transparent subprocess; stdin inherited, signals
   forwarded, colours preserved. The agent has no idea Crosscheck exists.
3. **Snapshot after** — compute the *attributable diff*: what changed because of
   this command, minus anything already dirty beforehand. This is the hardest
   correctness problem in the codebase and the most defensible work in it.
4. **Pipeline:**
   - **Scout** (LLM) — scope, intent, risk level, what the Reviewer should focus
     on. Recommends verification goals in plain English only; never emits shell.
   - **Builder** (deterministic, no LLM) — detects project type, maps Scout's
     goals to *allowlisted* commands, runs your real build/test/lint, captures
     bounded logs.
   - **Reviewer** (LLM) — reads Scout output, Builder evidence, the diff, and
     historical findings from memory. Emits structured findings with paths, line
     numbers, confidence.
   - **Judge** (LLM) — reads everything prior, returns `pass` / `warn` / `block` /
     `inconclusive`, and may dismiss Reviewer findings it considers unsupported.
   - **Policy engine** (deterministic) — applies thresholds, determines exit code.
5. **Persist** — JSON, Markdown and HTML reports under `.crosscheck/runs/<id>/`;
   findings written to memory for future runs.

### Engineering invariants — do not violate

1. The verifier is independent of the generator.
2. Every finding references concrete evidence.
3. LLM output never reaches shell execution — Builder uses a deterministic
   allowlist only.
4. Deterministic evidence outranks model opinion.
5. Crosscheck never mutates the repository during verification.
6. A stage that did not execute is never reported as passed.
7. Pre-existing changes are never attributed to the wrapped command.
8. Secrets and excluded paths are redacted before any remote inference.
9. A failed or interrupted run still leaves a partial report.

---

## 5. Source layout

```
src/
  cli/
    commands/     run, dry-run, init, doctor, status, runs, report, explain,
                  verify, inspect, override, demo, config          (13 files)
    output/       terminal.ts, progress.ts, theme.ts, fake-data.ts
  core/
    run/          run-orchestrator, run-state, run-context, run-pruner
    repository/   git-repository, repository-snapshot, diff-capture,
                  file-selection, repo-fingerprint
    execution/    command-runner, signal-forwarding, terminal-bridge, output-capture
    context/      context-selector, context-budget, file-slicer, source-redaction
    pipeline/     verification-pipeline, stage
    policy/       policy-engine, policy-schema, override-engine
    memory/       memory-store, memory-schema, memory-engine
    cache/        verification-cache
    reports/      report-builder, report-renderer, report-renderer-html,
                  report-store, evidence-store
  stages/
    scout/        scout-stage, scout-prompt, scout-schema
    builder/      builder-stage, project-detector, command-planner,
                  command-executor, log-sanitizer, command-allowlist
    reviewer/     reviewer-stage, reviewer-prompt, reviewer-schema,
                  deterministic-rules/ (7 rules)
    judge/        judge-stage, judge-prompt, judge-schema
  inference/      llm-provider, anthropic-provider, fake-provider, provider-factory
  config/         config-loader, config-schema, defaults
  storage/        local-run-store, paths
  shared/         errors, logger, schemas, hashing, redaction, tokens

datasets/         THREE EMPTY READMEs — see §7
scripts/          install.sh (curl installer), pkg-build.mjs (binaries)
.github/workflows/ ci.yml, crosscheck.yml, release.yml
```

---

## 6. Models & configuration

Stages are tiered by the capability each needs. Defaults live in
`src/config/defaults.ts`:

| Stage | Default model | Why |
|---|---|---|
| Scout | `claude-haiku-4-5` | Cheap triage of the diff |
| Reviewer | `claude-sonnet-5` | The analysis pass |
| Judge | `claude-opus-5` | The verdict is the product |

**Resolution precedence:** `CROSSCHECK_MODEL_<STAGE>` env var → `config.json` →
the default above. The string `configured-through-environment` is a legacy
placeholder written by older `crosscheck init` runs and is treated as "unset".

> **Trap:** Sonnet 5 and Opus 5 think by default, and `max_tokens` caps thinking
> *plus* response together. Reviewer and Judge are set to 16k for this reason.
> If you lower them, verdicts will truncate mid-sentence.

Policy (`.crosscheck/policy.json`): `shadow` (always exit 0), `advisory`
(default — show findings, never block), `blocking` (exit 2 on block).

Exit codes: `0` pass/advisory · `1` internal error · `2` policy block ·
`3` inconclusive · `4` invalid config · `5` wrapped command could not start.

---

## 7. What is NOT done — read this before planning

**The core is unvalidated.** All 41 tests use `FakeProvider`, which throws
immediately. They prove the pipeline degrades gracefully; they prove nothing
about output quality. One real run, on one repo, found four genuine issues. That
is n=1.

**`datasets/` is three empty READMEs.** The previous version of this document
described "end-to-end fixtures with expected verdicts" and implied only a test
runner was missing. That was wrong — there is nothing to run. Building this is
the highest-value work available, and the way to build it is by hand-labelling
real output (§8).

**Not published to npm.** `npm install -g crosscheck` does not resolve. The name
is free (verified: registry returns 404). Needs `NPM_TOKEN` in repo secrets and a
`v*` tag push to fire `release.yml`.

**Judge does not read memory.** Only the Reviewer queries it, so the traceability
chain the docs describe is half-wired.

**No evaluation harness.** Nothing executes `datasets/evaluation/`.

**Untested / unmeasured:**
- Cost and latency per run — `tokenUsage` is captured per stage and shown in
  `crosscheck inspect`, but never summed or priced. You cannot currently answer
  "what does a run cost?"
- The 60K-token context budget on very large diffs.
- `zodToJsonSchema` against every stage schema on real API responses.
- Whether the Judge actually dismisses anything — the skepticism is designed but
  unobserved.

**Known limitations:**
- Redaction has 3 shallow tests, and `excludePatterns` is a denylist, which fails
  open. This is load-bearing for the "we don't leak your secrets" claim.
- Binaries cannot be built on Windows — needs Linux CI. Use npm on Windows.
- `memory.json` writes use a file lock that times out after 10s with a warning,
  not a hard error.
- `explain`, `runs`, `inspect`, `status`, `doctor`, `dry-run` still render
  unthemed plain text.

---

## 8. Recommended next step

Do **not** build the eval harness first — you cannot automate a judgement you
have not made by hand yet.

Take 15–20 real agent-generated diffs. Run `crosscheck verify` on each with a
real key. Read every finding and label it true or false positive. That single
exercise yields three things at once: the precision number that decides whether
this is a product, the labelled ground truth that *becomes* `datasets/evaluation/`,
and direct evidence of which of the three prompts is weakest.

False positives are the retention question. A verifier that flags six things
where four are noise gets uninstalled after two runs — worse than nothing,
because the noise teaches people to ignore it.

---

## 9. Conventions in this repo

- **pnpm only.** There is no `package-lock.json`; `npm ci` will fail.
- **Husky + lint-staged** run eslint and prettier on staged files at commit.
- **`prepare` sets up the git hook; `prepack` builds.** Do not move the build back
  into `prepare` — it breaks any `--omit=dev` install (verified: exit 1 → 0).
- **The npm tarball ships 4 files**: `dist/index.js`, README, LICENSE,
  package.json. Sourcemaps are excluded via `!dist/**/*.map` in `files` — they
  embed the full original TypeScript via `sourcesContent`, and this repo is
  private while the package would be public. Do not re-add them.
- **Bundles are minified.** This shrinks output and stops casual reading, but the
  stage prompts remain readable strings in `dist/index.js`. Anything shipped to a
  user's machine can be read; do not treat minification as protection.
- **Terminal styling goes through `src/cli/output/theme.ts`**, which mirrors the
  HTML report's palette so a verdict is the same colour in both. When drawing
  boxes, compute padding on raw strings *before* applying colour — chalk's escape
  codes have no display width and will corrupt alignment.
- **Colour is never the only signal** — severity and verdicts are always spelled
  out as well as tinted, so output survives `NO_COLOR`, CI logs, and colour
  blindness.
- `.onecli/` is a reference copy of an unrelated project and is gitignored.

---

## 10. What landed most recently

Eleven commits on `feat/verification-pipeline2`, newest first:

| Commit | What |
|---|---|
| `85295ec` | Themed spinner with a live elapsed counter |
| `e5e9a3c` | Visual identity: shared theme, wordmark, brand rail |
| `c699504` | Split `prepare`/`prepack` so production installs don't fail |
| `9a7f47b` | Terminal redesign: stage rail, verdict box, inline findings |
| `92b977d` | Minify bundles; gitignore `.onecli` |
| `f6c14f6` | Exclude sourcemaps from the npm package |
| `be2fd66` | Release workflow uses pnpm, not `npm ci` |
| `5aa95f0` | Fix install paths, add LICENSE, modernise model defaults |
| `7958240` | CI workflow, git hooks, tooling; fix 11 lint errors + flaky test |
| `5d92080` | PR and issue templates |
| `414d729` | The verification pipeline itself |

Several of these were bugs that would have broken a real user: every install URL
pointed at a repo that doesn't exist, the release workflow would have failed on
its first step, and the npm package would have shipped the entire original
TypeScript source.

---

**This is an early verification system. It is not a guarantee of correctness or
security — and it has not yet been shown to be useful. Please keep this document
honest about that.**
