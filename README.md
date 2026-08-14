<p align="center">
  <img src="assets/logo.png" alt="Verik" width="320">
</p>

<p align="center">
  <strong>Your agent says it's done. Verik tells you what it actually did.</strong><br>
  Not an AI code reviewer. An independent check on code you didn't write.
</p>

<p align="center">
  <a href="docs/quickstart.md">Quickstart</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="docs/ci.md">CI</a>
</p>

## What is Verik?

Verik is an open-source CLI that checks what your AI coding agent actually
changed. It separates the agent's edits from your own uncommitted work, runs
your project's build and tests, applies 23 deterministic checks, and returns an
exit code CI can act on.

**Why we built it:** a green build tells you the tests passed. It does not tell
you the agent disabled TLS verification to make them pass, deleted the failing
test, or replaced an assertion with `expect(true).toBe(true)`. As agents write
more of the code, "CI is green" stops meaning "this is safe to ship."

**How it works:** Verik snapshots your working tree into a real git tree object,
runs the agent, snapshots again, and diffs the two. Anything you had already
half-finished is baked into the first snapshot, so it reads as context rather
than as the agent's work. Your repository is never staged, stashed, committed or
checked out.

## Works with any model

Verik is not tied to one vendor. Pick a provider at `verik init`, or set the
environment variable and go.

| Provider        | Environment variable                      |
| --------------- | ----------------------------------------- |
| Anthropic       | `ANTHROPIC_API_KEY`                       |
| OpenAI          | `OPENAI_API_KEY`                          |
| Google (Gemini) | `GEMINI_API_KEY`                          |
| Mistral         | `MISTRAL_API_KEY`                         |
| DeepSeek        | `DEEPSEEK_API_KEY`                        |
| Groq            | `GROQ_API_KEY`                            |
| OpenRouter      | `OPENROUTER_API_KEY`                      |
| Together AI     | `TOGETHER_API_KEY`                        |
| Fireworks AI    | `FIREWORKS_API_KEY`                       |
| Hugging Face    | `HF_TOKEN`                                |
| Ollama          | none — local, nothing leaves your machine |

Each ships sensible default models. Override any stage individually:

```sh
export VERIK_MODEL_SCOUT=gpt-4o-mini      # cheap, runs first
export VERIK_MODEL_REVIEWER=gpt-4o
export VERIK_MODEL_JUDGE=gpt-4o
```

### Anything else that speaks OpenAI

If it exposes `/chat/completions`, Verik can use it — point it anywhere:

```sh
export VERIK_BASE_URL=http://localhost:4000/v1
export VERIK_API_KEY=your-key
```

That covers LiteLLM, vLLM, LM Studio, self-hosted gateways, corporate proxies
and anything behind a company firewall. Structured output degrades in three
steps, `json_schema`, then `json_object`, then extracting JSON from plain text, so hosts that only implement part of the spec still work.

Or put it in a `.env` file at the repository root, which avoids shell syntax
differences entirely:

```sh
OPENAI_API_KEY=sk-...
```

Shell variables always win over the file. `.env` is gitignored by default and is
in `privacy.excludePatterns`, so the file Verik reads the key from is the same
one it refuses to send to a model.

Not sure what your setup needs? `verik doctor` names the exact variable for your
configured provider and checks the endpoint answers.

**And none of this is required.** `rules` mode runs 23 deterministic checks with
no key, no network and no provider at all.

## Quick start

### 1. Install

Not on npm yet, so build from source. Needs Node 20+, git and pnpm.

```sh
git clone https://github.com/veriks/verik.git
cd verik && pnpm install && pnpm build && npm link
```

### 2. Set it up in your project

```sh
cd ~/your-project
verik init
```

Four questions: how much you want it to do, which provider (only if you chose
the LLM stages), what should happen when it finds something, and whether to
check every commit automatically. Say yes to the last two and setup is done.

Every `git commit` then runs 23 deterministic checks first, and a finding at
`high` or above stops it. No API key, no network, silent when your code is
clean. Any hook you already have — husky, lint-staged — keeps working, and
`verik hook uninstall` removes it exactly.

Scripting it instead:

```sh
verik init --yes --mode rules --policy blocking --hook
```

`--yes` alone stays safe for CI: advisory, no hook, nothing gated you did not
ask for.

### 3. Using it with an AI agent

Most agents edit your files directly: Cursor, Copilot, the Claude or ChatGPT
desktop app, or code you pasted in. Mark the line before you start, then check
what changed:

```sh
verik begin
```

```sh
verik verify
```

`begin` records where you were, so your own half-finished work is not blamed on
the agent. It survives the agent committing.

If your agent is a terminal command, wrap it and skip `begin` entirely:

```sh
verik run -- claude -p "add rate limiting"
verik run -- codex exec "fix the failing test"
verik run -- aider --message "..."
```

Anything after `--` runs verbatim, so whatever you normally type works.

### 4. Optional — add a model

Everything above is deterministic and free. To also get the Scout, Reviewer and
Judge stages, put your key in a `.env` file at your project root:

```sh
OPENAI_API_KEY=sk-...
```

```sh
verik doctor                  # confirms the key and the models, without billing
verik verify --mode full
```

A `.env` file avoids shell syntax differences entirely, and is gitignored. See
[Works with any model](#works-with-any-model) for other providers.

## What you see

```
│  Builder   ✓ test  ✓ lint

RULES
▊ CRITICAL TLS certificate verification disabled
▊          src/http.ts:14 · insecure-transport
▊ HIGH     Assertion that cannot fail
▊          src/auth.test.ts:22 · tautological-assertion
```

The tests passed. That is the point.

## Making it block

**Nothing blocks by default.** Out of the box the policy is `advisory`: Verik
reports everything and always exits 0. If you expected it to stop something and
it did not, this is why.

There are two gates and they stop different things.

### Local — stops the commit

```sh
verik policy mode blocking     # findings at high+ now exit 2
verik hook install             # run the rules before every commit
```

Now `git commit` fails when a finding meets the threshold. Fast feedback while
you work — but `git commit --no-verify` skips it, and a pre-commit hook cannot
stop a `git push`. Treat this as a convenience, not enforcement.

### CI — stops the merge

This is the gate that actually holds, because nobody can bypass it.

```yaml
- name: Verify
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}   # only for `full` mode
    BASE_REF: ${{ github.event.pull_request.base.ref }}
  run: verik verify --base "origin/$BASE_REF"
```

Exit 2 fails the job. Then make it required:

**Settings → Branches → Add rule → Require status checks to pass**, and select
that job.

A pull request with a blocking finding can no longer be merged, whatever the
author has configured locally.

See [docs/ci.md](docs/ci.md) for the full workflow, including why the PR title
must be passed through `env:` rather than interpolated into `run:`.

### Three modes

| Mode | Effect |
|------|--------|
| `shadow` | Records a verdict, never changes the exit code |
| `advisory` | Reports findings, always exits 0 — the default |
| `blocking` | Exits 2 when a finding meets the threshold |

```sh
verik policy                      # what is in force right now
verik policy mode blocking
verik policy block-at critical    # raise the bar
```

`rules` mode blocks on deterministic findings alone, so this works with no API
key and no network.

## Day to day

```sh
verik begin                       # before the agent starts
# ...let it work...
verik verify                      # what did it change, and is it safe
verik explain                     # the verdict in plain English
```

Or wrap it directly and skip `begin`:

```sh
verik run -- claude -p "add rate limiting"
verik run -- codex exec "fix the failing test"
```

Or install the hook once and stop thinking about it.

## Architecture

**Attribution engine.** Builds real git tree objects through a scratch index and
object store, then diffs tree to tree. This is what makes attribution work in a
dirty repository without touching it.

**Deterministic rules.** 23 local checks, no LLM, no network. They target what
agents specifically get wrong: suppression comments, stubbed functions,
swallowed errors, deleted tests, disabled TLS, interpolated SQL.

**Builder.** Runs your project's own test, lint and build commands and reports
what they said.

**Policy engine.** Turns findings into an exit code. Advisory by default.

**Scout, Reviewer, Judge.** Three LLM stages, only in `full` mode. The system
that writes the code is never the one that decides whether to trust it.

## Two modes

| Mode    | Runs                          | API key |
| ------- | ----------------------------- | ------- |
| `rules` | deterministic rules + Builder | No      |
| `full`  | all four stages + rules       | Yes     |

`rules` is fast, free and offline. Start there.

## Commands

| Command              | Description                                      |
| -------------------- | ------------------------------------------------ |
| `verik init`         | Create `.verik/` with config and policy          |
| `verik run -- <cmd>` | Wrap a command, attribute what it changed        |
| `verik verify`       | Verify the current uncommitted diff              |
| `verik begin`        | Mark a baseline for agents that can't be wrapped |
| `verik hook install` | Verify on every `git commit`                     |
| `verik rules`        | List and tune the 23 checks                      |
| `verik policy`       | Show or change how strict verification is        |
| `verik report`       | Print the latest report                          |
| `verik explain`      | The verdict in plain English                     |
| `verik runs`         | Every run so far                                 |
| `verik inspect`      | Context sent, files excluded, token usage        |
| `verik doctor`       | Environment diagnostics                          |

## Git hook

```sh
verik hook install
```

Runs the deterministic rules before each commit. It is silent when clean,
preserves any hook you already have (husky, lint-staged, pre-commit), and cannot
break your git: if Verik fails or is missing, the commit goes through with a
warning. Only a policy decision stops you.

`git commit --no-verify` skips it once. `verik hook uninstall` restores your
original hook byte for byte.

## Tuning

A rule too noisy for your codebase has two levers:

```sh
verik rules severity debug-artifact info
verik rules disable type-escape --reason "generated protobuf bindings"
```

Reach for `severity` first. The finding stays in the report and only stops
blocking, so nothing is lost. `disable` requires a reason, which is stored in
`.verik/policy.json` and shows up in the pull request that turned the rule off.

Disabled rules still run. Their findings are recorded as suppressed, with the
reason and who suppressed them, so switching a check off never hides anything
silently.

## Exit codes

| Code  | Meaning                                            |
| ----- | -------------------------------------------------- |
| `0`   | Passed, or the policy chose not to block           |
| `1`   | Verik itself failed                                |
| `2`   | Policy blocked. Do not ship.                       |
| `3`   | Blocking mode, but verification reached no verdict |
| other | The wrapped command's own exit code                |

## In CI

Your CI checkout is clean, so point Verik at a commit range:

```sh
verik verify --base origin/main
```

See [docs/ci.md](docs/ci.md) for a GitHub Actions example.

## Project structure

```
src/
  cli/commands/                          17 commands
  cli/output/                            terminal renderer, prompts, theme
  core/repository/                       attribution engine, checkpoints
  core/hooks/                            git hook installer
  core/policy/                           policy engine, rule tuning, overrides
  core/pipeline/                         stage orchestration
  stages/reviewer/deterministic-rules/   the 23 checks
  inference/                             11 providers + custom endpoints
  config/                                schemas and loader
```

## Local development

```sh
pnpm install
pnpm build
pnpm test
```

| Command          | Description                     |
| ---------------- | ------------------------------- |
| `pnpm build`     | Bundle to `dist/`               |
| `pnpm build:bin` | Standalone binaries             |
| `pnpm test`      | Vitest, 222 tests               |
| `pnpm lint`      | ESLint                          |
| `pnpm typecheck` | tsc, no emit                    |
| `pnpm check`     | Lint, types and format together |

## Configuration

`verik init` writes `.verik/config.json`:

```json
{
  "version": 1,
  "provider": "anthropic",
  "builder": { "enabled": true, "timeoutMs": 600000 },
  "verification": { "maxDiffBytes": 500000 },
  "privacy": { "redactEnvironmentValues": true }
}
```

| Variable               | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `VERIK_API_KEY`        | Key for any provider, overriding the provider-specific one |
| `VERIK_BASE_URL`       | Endpoint override — point at any OpenAI-compatible host    |
| `VERIK_MODEL_SCOUT`    | Override the Scout model                                   |
| `VERIK_MODEL_REVIEWER` | Override the Reviewer model                                |
| `VERIK_MODEL_JUDGE`    | Override the Judge model                                   |
| `VERIK_BASE_URL`       | Endpoint override for any OpenAI-compatible host            |

Or the provider's own key — see [Works with any model](#works-with-any-model).
`rules` mode needs none of them.

## Privacy

Secrets are redacted from diffs before any model call. Environment variable
values are never sent, only keys. Files matching `excludePatterns` (`.env`,
`*.pem`, `*.key`) are withheld. In `rules` mode nothing leaves the machine.

## Principles

- The verifier is independent from the generator.
- Every finding cites evidence.
- Deterministic evidence outranks model opinion.
- Verik never mutates your repository.
- A missing verdict never reads as a pass.

## Releasing

Platform testing, release steps and launch sequencing:
**[docs/release-checklist.md](docs/release-checklist.md)**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

Apache-2.0

---

**This is an early verification system. It is not a guarantee of correctness or
security.**
