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
steps — `json_schema`, then `json_object`, then extracting JSON from plain text
— so hosts that only implement part of the spec still work.

Not sure what your setup needs? `verik doctor` names the exact variable for your
configured provider and checks the endpoint answers.

**And none of this is required.** `rules` mode runs 23 deterministic checks with
no key, no network and no provider at all.

## Quick start

Not on npm yet. Building from source takes about a minute:

```sh
git clone https://github.com/veriks/verik.git
cd verik && pnpm install && pnpm build && npm link
```

Then, in any repository:

```sh
verik init --yes --mode rules
verik run -- claude -p "add rate limiting"
```

`rules` mode needs no API key and makes no network calls.

If your agent runs somewhere Verik can't wrap it, like Cursor, Copilot or a
desktop app, mark the baseline yourself instead:

```sh
verik begin        # then let the agent work
verik verify
```

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
| `pnpm test`      | Vitest, 206 tests               |
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
