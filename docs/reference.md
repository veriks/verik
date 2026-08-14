# Verik — Technical Reference

Complete reference for the CLI, the architecture, and the invariants that must
not be broken. Written to be enough for someone (or another agent) to pick the
project up cold.

Status as of this document: **222 tests green**, lint clean, builds. Not
published to npm. Branch `main`.

---

## 1. What this is

An independent verification runtime for AI-generated code. It answers one
question a passing CI run cannot: **which lines did the agent write, and are
they safe to ship?**

The differentiated part is not "AI code review" — it is _attribution_. Verik
can separate the agent's changes from the developer's own uncommitted work, in a
dirty repository, without mutating that repository. Everything else is built on
that.

### The four-stage pipeline

```
Scout      →  understand the change            (LLM)
Builder    →  run the project's own checks     (deterministic, no LLM)
Reviewer   →  find problems                    (LLM)
Judge      →  weigh findings, issue a verdict  (LLM)

           +  deterministic rules              (23, local regex, no network)
           +  policy engine                    (decides the exit code)
```

### Two modes

| Mode    | Runs                          | Needs an API key |
| ------- | ----------------------------- | ---------------- |
| `rules` | deterministic rules + Builder | **No**           |
| `full`  | all four stages + rules       | Yes              |

`rules` mode is the wedge: it is fast, free, offline, and strong enough to sit
in a pre-commit hook.

---

## 2. Commands

### Setup

```sh
verik init [--yes] [--mode rules|full] [--policy shadow|advisory|blocking] [--hook]
```

Creates `.verik/` with `config.json`, `policy.json`, `repo.json`. Interactive
arrow-key onboarding unless `--yes`: mode, provider, what should happen when
something is found, and whether to install the git hook. Re-running it merges
into what is already there rather than replacing it, so tuning survives. Works in a repository with an unborn HEAD
(`git init` with no commits) — that is a supported state, not an error.

```sh
verik doctor
```

Environment diagnostics: git version, node version, API key presence, config
validity.

### Verifying

```sh
verik run -- <command...>          # wrap an agent, attribute what it changed
verik run -- claude -p "add OAuth"
verik run -- codex
verik run -- aider
```

```sh
verik verify [options]             # verify the current uncommitted diff
  --json                                # machine-readable
  --quiet                               # suppress output
  --verbose                             # log stage errors and provider requests
  --intent <text>                       # what the change was meant to do
  --base <ref>                          # verify <ref>..HEAD instead (for CI)
  --mode rules|full                     # override the configured mode
```

```sh
verik dry-run -- <command...>      # preview: no subprocess, no LLM calls
```

### Agents that cannot be wrapped

Cursor, Copilot, the Claude or ChatGPT desktop apps — anything where code
arrives by paste and there is no process to wrap.

```sh
verik begin            # mark the current tree as the baseline
# ...let the agent work...
verik verify           # diffs against the checkpoint, not HEAD
verik begin --clear    # discard the checkpoint
```

A checkpoint is **stale** only when its commit is not an ancestor of HEAD —
that is, when history has moved sideways onto something unrelated. Commits made
*after* `begin` are included, because agents commit and discarding the baseline
the moment one does made the agent's work invisible. When it is genuinely stale,
`verify` says so and falls back to HEAD rather than reporting nonsense.

### Git hook

```sh
verik hook                 # status (does not mutate anything)
verik hook install         # add to pre-commit
  --mode rules|full             # default: rules
  --prepend                     # run before the existing hook rather than after
verik hook uninstall       # remove, restoring the file byte-for-byte
```

### Tuning

```sh
verik rules                                    # list all 23 + effective severity
verik rules --json
verik rules severity <id> <info|low|medium|high|critical>
verik rules disable <id> --reason "<text>"     # --reason is mandatory
verik rules enable <id>
```

```sh
verik policy                                   # show what is in force
verik policy --json
verik policy mode <shadow|advisory|blocking>
verik policy block-at <severity>
```

```sh
verik override add --rule <id> [--path <file>] [--title <regex>]
                        --reason <text> [--expires <ISO-date>]
verik override list [--json]
verik override remove <override-id>
```

**Which lever to use:**

| Want                              | Use                                      |
| --------------------------------- | ---------------------------------------- |
| This rule matters less here       | `rules severity <id> <lower>`            |
| This rule does not apply at all   | `rules disable <id> --reason`            |
| This _specific_ finding is fine   | `override add --rule <id> --path <file>` |
| Nothing should block, just report | `policy mode advisory`                   |

Reach for `severity` first — the finding stays in the report and only stops
crossing the blocking threshold, so no information is lost.

### Reading results

```sh
verik report [run-id]      # full report
verik explain [run-id]     # the verdict in plain English
verik runs [--limit n] [--verdict pass|warn|block|inconclusive] [--json]
verik inspect [run-id] [--prompt] [--json]   # context, tokens, stage identity
verik status
verik config
verik demo                 # exercises the whole pipeline, no network
```

---

## 3. Exit codes

This contract is load-bearing. `src/core/run/exit-code.ts`.

| Code  | Meaning                                                 |
| ----- | ------------------------------------------------------- |
| `0`   | Passed, or the policy chose not to block                |
| `1`   | Verik itself failed (bad config, not a git repo, crash) |
| `2`   | **Policy blocked.** Do not ship this.                   |
| `3`   | Blocking mode, but verification never reached a verdict |
| other | The wrapped command's own exit code, passed through     |

Two false-green traps this design exists to prevent:

- A policy verdict must **not** discard the wrapped command's exit code.
  `verik run -- npm test` with failing tests must not exit 0.
- With no API key every LLM stage fails, so there is no policy at all. The old
  fallback returned 0 and recorded the run as `completed` — reporting success
  for verification that never happened. Now it records `inconclusive`.

`rules` mode has no Judge by design, so the absence of a verdict is success —
but a blocking deterministic finding still returns 2.

---

## 4. The attribution engine

`src/core/repository/worktree-tree.ts` — the most important file in the project.

It builds **real git tree objects** from the working tree using a temporary
index and a scratch object store, then diffs tree-to-tree. This is what makes
attribution work in a dirty repository.

```
GIT_INDEX_FILE                    → scratch index, not .git/index
GIT_OBJECT_DIRECTORY              → scratch object store
GIT_ALTERNATE_OBJECT_DIRECTORIES  → real store + checkpoint store, readable
GIT_OPTIONAL_LOCKS=0              → never take a lock in the user's repo
GIT_TERMINAL_PROMPT=0             → never block waiting for input
```

**Invariants — do not break these:**

1. **The user's repository is never mutated.** No staging, no stashing, no
   checkout, no lock. Verified by a test that snapshots `git status` and `HEAD`
   before and after.
2. **The entire `GIT_*` namespace is stripped from the inherited environment.**
   Inside a git hook, `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` are all set and
   would retarget the plumbing at the hook's repository.
3. **Alternates are joined with `path.delimiter`** — `;` on Windows, `:` on
   POSIX. Hardcoding either silently makes the second store unreadable on the
   other platform.
4. **An unborn HEAD is supported**, via `read-tree --empty`. Every file reads as
   added against an empty baseline, which is correct before the first commit.

### How a run works

```
captureSnapshot(baseline)   → tree A
   run the wrapped command
captureSnapshot(final)      → tree B
computeDiff(A, B)           → attributable diff
```

Anything already dirty is baked into tree A, so it appears as **context** in the
patch, not as an addition. A file the developer edited _and_ the agent then
edited further is attributed correctly at line granularity — the developer's
line is context, the agent's is `+`.

`.verik/` output is always excluded from attribution.

---

## 5. Privacy seam

Branded types make it a compile error to send the wrong patch to a model.

```ts
RawPatch; // real content, never leaves the machine
SafePatch; // redacted + truncated, this is what goes to an LLM
```

- **Redact, then truncate.** The other order can slice a secret in half and let
  the tail through.
- **Deterministic rules read the RAW patch, deliberately.** `SecretLeakRule`
  cannot detect a secret that has already been replaced with `[REDACTED]`.
  Rules run in-process and emit nothing to the network.
- `privacy.excludePatterns` withholds file _content_ but attribution still
  reports the file was touched — withholding is not the same as pretending
  nothing happened.
- A secret is **never echoed into a finding excerpt**, because excerpts reach
  reports and memory, and memory becomes team-shared.

---

## 6. The 23 deterministic rules

Chosen for what an _agent_ does wrong, not what a person does — that is the part
a general-purpose linter does not cover. An agent told to make the build pass has
short paths available that a person would mention out loud.

| Rule ID                   | Severity | Catches                                          |
| ------------------------- | -------- | ------------------------------------------------ |
| `secret-leak`             | critical | Credential added to the diff                     |
| `insecure-transport`      | critical | TLS verification disabled                        |
| `env-file-added`          | high     | `.env` committed                                 |
| `weak-crypto`             | high     | MD5/SHA-1, ECB, predictable RNG used as a secret |
| `sql-injection`           | high     | Query built by interpolation                     |
| `command-injection`       | high     | Shell invoked with interpolated input            |
| `eval-usage`              | high     | `eval`, `new Function`, dynamic execution        |
| `stub-implementation`     | high     | `NotImplementedError`, `todo!()`, stubbed path   |
| `test-removal`            | high     | Test file deleted, or net assertions lost        |
| `tautological-assertion`  | high     | `expect(true).toBe(true)` — cannot fail          |
| `auth-check-removed`      | high     | Authorisation check deleted                      |
| `risky-dependency-source` | high     | Install hook, or git/URL dependency              |
| `permissive-access`       | medium   | CORS `*`, `chmod 777`, open CIDR                 |
| `suppression-added`       | medium   | `eslint-disable`, `@ts-ignore`, `# noqa`         |
| `swallowed-error`         | medium   | `except: pass`, `catch {}`                       |
| `disabled-tests`          | medium   | `.skip`, `xit`, `@Ignore`, `.only`               |
| `ci-workflow-modified`    | medium   | CI config or `.verik/policy.json` changed        |
| `gitignore-weakened`      | medium   | Ignore entry removed                             |
| `db-migration`            | medium   | Migration added or modified                      |
| `empty-catch`             | low      | Empty catch block                                |
| `type-escape`             | low      | `as any`, `@ts-expect-error`                     |
| `debug-artifact`          | low      | `console.log`, `debugger`, `pdb.set_trace`       |
| `lockfile-changed`        | info     | Lockfile modified                                |

### Rule infrastructure

`src/stages/reviewer/deterministic-rules/`

- **`line-rule.ts` — `defineLineRule()`.** Most rules are declared, not
  implemented. It owns the single scan loop.
  - **Rejects `/g` and `/y` regexes at construction.** A global regex driven by
    `.test()` carries `lastIndex` between calls and silently matches every
    _second_ occurrence. This was a real bug in `secret-leak`; it is now
    structurally impossible.
  - `LITERAL_ONLY` — a line that is only a regex or string literal is a pattern
    table or a test fixture, not logic. Without this, every security scanner,
    linter config and parser test suite reports its own source as vulnerable.
  - `COMMENT_ONLY` — prose describing a hazard is not the hazard. Opt out with
    `skipComments: false` for rules whose subject _is_ a comment.
  - `maxFindings` (default 10) per rule; `MAX_TOTAL_FINDINGS = 40` overall,
    sorted by severity before truncation.

- **`patch-lines.ts`** — `iteratePatchLines()` walks a unified diff tracking
  both sides' line numbers; `iterateAddedLines()` and `iterateRemovedLines()`
  are filters over it. `looksLikePlaceholder()` stops `password = "changeme"`
  in a fixture from blocking a build.

- **`file-kinds.ts`** — `isTestPath`, `isVendoredPath`, `isDocPath`, `isCiPath`,
  `isSourcePath`, `isProductionSourcePath`. Shipped-code hygiene rules do not
  read test files: a suite proving "we detect a stub" must contain a stub.

**Regression benchmark:** running the rules against this repository's own diff
produced **19 false positives and 0 real defects** before the three guards, and
**0** after. Re-run it after touching any rule.

---

## 7. Policy

`.verik/policy.json` — committed, so policy changes appear in pull requests.

```json
{
  "version": 1,
  "mode": "advisory",
  "blockAtSeverity": "high",
  "minimumBlockingConfidence": 0.8,
  "requireBuilderSuccess": false,
  "allowOverride": true,
  "rules": {
    "severity": { "debug-artifact": "info" },
    "disabled": [
      { "id": "type-escape", "reason": "generated protobuf bindings", "at": "2026-08-10" }
    ]
  }
}
```

| Mode       | Effect                                         |
| ---------- | ---------------------------------------------- |
| `shadow`   | Records a verdict, never changes the exit code |
| `advisory` | Reports findings, always exits 0               |
| `blocking` | Exits 2 when a finding meets the threshold     |

**Deterministic findings are evaluated before and independently of the Judge,
and are deliberately not gated on `minimumBlockingConfidence`.** That threshold
exists for model opinion. A regex that matched a private key did not "probably"
match it.

### Suppression leaves a trace

A disabled rule **still runs**. Its findings are recorded as suppressed rather
than dropped, so turning a check off can never hide something silently:

- terminal prints `N finding(s) suppressed — N by policy`
- `report.json` carries `suppressedFindings[]` with title, reason, and
  `source: "policy" | "override"`

`--reason` is mandatory and schema-enforced (`z.string().min(1)`).

---

## 8. The git hook

`src/core/hooks/git-hooks.ts`

Installs a marker-delimited block into `pre-commit`:

```sh
# >>> verik >>>
# <<< verik <<<
```

**Three properties that matter more than the feature:**

1. **Never destroys an existing hook.** Appended after it by default, so it sees
   any formatting that hook applied. Backed up to `pre-commit.verik-backup`
   on first install. Reinstalling replaces the block in place — install twice ≠
   installed twice.
2. **Exactly reversible.** Uninstall rewrites the file byte-for-byte, and
   deletes it entirely if only our block was in it.
3. **Never blocks a commit because verik broke.** Exit codes are mapped,
   not passed through: `2|3` → block, anything else → warn and allow. If
   `verik` is not on `PATH` the hook is a no-op.

**Two traps that fail silently, both handled:**

- `core.hooksPath` — husky sets it, and writing to `.git/hooks` then produces a
  file git never runs. Resolved via `git config --get core.hooksPath`, falling
  back to `git rev-parse --git-path hooks` (correct in worktrees and submodules).
- An existing hook ending in an unconditional `exit` would strand an appended
  block. Detected; installs _before_ it instead and says so.

The hook runs `verik verify --mode rules` — full mode would call the API on
every commit.

Escape hatch: `git commit --no-verify`.

---

## 9. Providers

12 providers behind one OpenAI-compatible implementation
(`src/inference/openai-compatible-provider.ts`), plus Anthropic native.

Direct: Anthropic, OpenAI, Google Gemini, Mistral, DeepSeek, xAI, Groq, Cohere.
Aggregators: OpenRouter, Together, Fireworks, Hugging Face.

**Structured output degrades in three steps**, because not every provider
supports every mode:

```
response_format: json_schema  →  json_object  →  extract JSON from text
```

Model precedence: `VERIK_MODEL_{SCOUT,REVIEWER,JUDGE}` env vars override
`config.models.*`.

---

## 10. File layout

```
.verik/
  config.json      # provider, models, builder, privacy, verification  (committed)
  policy.json      # mode, thresholds, per-rule tuning                 (committed)
  repo.json        # repo fingerprint / repoId                         (committed)
  memory.json      # overrides, finding history                        (committed)
  objects/         # durable checkpoint object store                   (committed)
  runs/            # per-run records                                   (ignored)
  cache/           # verification cache                                (ignored)
```

`.verik/.gitignore` ignores `runs/` and `cache/` only.

### A run record

```
runs/vk_<id>/
  metadata.json       # run id, repo, branch, baseline commit, status
  report.json         # the full report, incl. suppressedFindings
  report.md
  evidence.json
  deterministic.json  # rule findings
  scout.json  builder.json  reviewer.json  judge.json
```

---

## 11. Source map

```
src/
  cli/
    index.ts                        # command registration
    commands/                       # one file per command
    output/
      theme.ts                      # palette, box(), card(), stripAnsi(), banner()
      prompt.ts                     # select(), reveal(), checklist(), LiveRegion
      keypress.ts                   # withRawMode()
      terminal.ts                   # shared report renderer
  core/
    repository/
      worktree-tree.ts              # ← the attribution engine
      checkpoint.ts                 # verik begin
      diff-capture.ts
      git-repository.ts
    hooks/git-hooks.ts              # verik hook
    policy/
      policy-engine.ts
      rule-policy.ts                # per-rule severity + disable
      override-engine.ts
    run/exit-code.ts                # ← the exit-code contract
    pipeline/verification-pipeline.ts
  stages/
    scout/  builder/  reviewer/  judge/
    reviewer/deterministic-rules/   # ← the 23 rules
  inference/                        # providers
  config/                           # zod schemas + loader
```

### Terminal UI notes

- Padding must be computed on **raw** strings — ANSI escapes break `padEnd`.
  Use `stripAnsi()` for width, e.g. `MARK_RAW` alongside `mark()`.
- `LiveRegion` must count **rendered lines**, not array length, or the menu
  creeps up the screen one line per keypress.
- Every prompt returns a default in a non-TTY. Nothing may ever block CI.

---

## 12. Development

```sh
npm test          # vitest — 222 tests
npm run lint      # eslint
npm run build     # tsup → dist/index.js
npm run build:bin # standalone binaries
```

Husky + lint-staged run `eslint --fix` and `prettier --write` on commit.
`prepare` sets up the hook; `prepack` builds — do not merge them, `prepare` runs
during `--omit=dev` installs where the build cannot work.

`dist/**/*.map` is excluded from the npm package: sourcemaps embed the full
TypeScript via `sourcesContent`.

### How to verify a change to the rules

Do not trust reading. Run all three:

```sh
npm test
node dist/index.js verify                    # against this repo — expect 0 findings
# and a scratch repo where an agent commits offences — expect them all caught
```

---

## 13. Known gaps

**Naming — unresolved.** `verik` cannot be published unscoped: npm's
typosquat filter blocks it because the abandoned `cross-check` (last published 2017) exists. Worse, **`verik-cli` is an active, unrelated project** by
`fxspeiser` — ~3.3k downloads/month, publishing near-daily, and it installs the
same `verik` binary. `checkride` is also taken by an active AI coding tool.
Options: ship scoped as `@veriks/verik` (binary can still be
`verik`), or rename. Decision parked.

**Not published to npm.** Needs `NPM_TOKEN` in repo secrets and a version tag.
`release.yml` publishes any `v*` tag straight to `latest` — it does **not**
handle prerelease tags, so tagging `v0.1.0-alpha.0` today would put an
unfinished build in front of users. Fix before the first tag.

**LLM stages are unvalidated.** No labelled-diff benchmark exists. Deprioritised
deliberately; the non-LLM path is what works today.

**No tamper-evidence on the run record.** A run record can be edited after the
fact. This is a known gap.

**Interactive rule toggle UI not built.** The flag-based commands cover the need.

**Deliberately not built:** per-developer local policy (`policy.local.json`). It
lets people quietly opt out, and `git commit --no-verify` already covers "not
this one commit."

---

## 14. Invariants — the short list

If you change one of these, you have changed the product.

1. The user's repository is never mutated.
2. The entire `GIT_*` namespace is stripped before running git plumbing.
3. A missing verdict never reads as a pass.
4. A secret never reaches a report, an excerpt, or memory.
5. Deterministic rules read the raw patch; only `SafePatch` goes to a model.
6. Deterministic findings are not gated on model confidence.
7. Suppressing a finding always leaves a trace in the run record.
8. Nothing blocks in a non-TTY. Nothing prompts in CI.
9. A verik failure never costs the developer their commit.
10. No rule pattern may carry the `g` or `y` flag.
