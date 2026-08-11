# Trying Verik on a real repository

Verik tells you **which lines your AI agent wrote, and whether they're safe
to ship** — separately from your own uncommitted work, without touching your
repository.

This walkthrough takes about ten minutes on a repo you already have. No API key,
no account, no network calls.

**Heads up before you start:** this is pre-release. It is not on npm yet, so
step 1 is building from source. Everything below has been tested, but you are
early.

---

## 1. Install

You need **Node 20 or newer**, **git**, and **pnpm**. Check:

```sh
node --version    # must be v20+
git --version
pnpm --version    # if missing: npm install -g pnpm
```

```sh
git clone https://github.com/veriks/verik.git
cd verik
pnpm install
pnpm build
npm link
```

Check it worked:

```sh
verik --version
```

You should see `0.1.0`. If `verik` isn't found, your npm global bin isn't on
`PATH` — you can skip `npm link` and use `node /path/to/verik/dist/index.js`
anywhere you'd type `verik` below.

> No pnpm? `npm install -g pnpm`, or use `npm install && npm run build` instead.

---

## 2. Set it up on your repo

Go to a real project. A messy one with uncommitted work is _better_ — that's the
case this tool exists for.

```sh
cd ~/code/your-project
verik init --yes --mode rules
```

`--mode rules` runs the 23 deterministic checks only: local regex passes, no LLM,
no API key, no network. That's the mode worth trying first.

It prints what it detected:

```
✓ project     node
✓ commands    npm run test · npm run lint
```

**Check that line.** Those are the commands it will run to see whether your
project still builds. If it guessed wrong, fix it in `.verik/config.json`
under `builder.commands`.

It creates a `.verik/` directory. Nothing else in your repo is touched.

---

## 3. See it work

Pick whichever matches how you actually use AI.

### A. Your agent runs in the terminal

Claude Code, Codex, Aider, Amp — anything you launch as a command:

```sh
verik run -- claude -p "add rate limiting to the API"
```

Verik snapshots your repo, runs the agent, snapshots again, and reports on
**only what the agent changed** — even if you had uncommitted work in the same
files when you started.

### B. Your agent doesn't run in the terminal

Cursor, Copilot, the Claude or ChatGPT desktop app, or code you pasted in. There's
no process to wrap, so mark the line yourself:

```sh
verik begin
```

Now let the agent work. When it's done:

```sh
verik verify
```

`begin` records where you were. `verify` compares against that point, not against
your last commit — which is what lets it ignore the work _you'd_ already done.

### What you'll see

```
│  Builder   ✓ test  ✓ lint

RULES
▊ CRITICAL TLS certificate verification disabled
▊          src/http.ts:14 · insecure-transport
▊ HIGH     Assertion that cannot fail
▊          src/auth.test.ts:22 · tautological-assertion
```

Note the top line. Your tests **passed**. That's the whole point — a green build
can't tell you the agent disabled certificate checking and replaced a real
assertion with `expect(true).toBe(true)`.

---

## 4. Important: nothing blocks by default

Out of the box the policy is **advisory** — it reports everything and always
exits 0. If you were expecting it to stop something, that's why.

When you're ready for it to actually gate:

```sh
verik policy mode blocking
```

Now a finding at `high` or above exits **2**. Check the current setting any time
with `verik policy`.

---

## 5. Make it automatic

Verification you have to remember isn't verification.

```sh
verik hook install
```

Every `git commit` now runs the deterministic rules first. Specifically:

- It's **silent when clean** — no noise on a normal commit.
- It **preserves any hook you already have.** husky, lint-staged, pre-commit —
  all keep working, and a backup is saved.
- It **can't break your git.** If verik itself fails or isn't installed, your
  commit goes through with a warning. Only a real policy decision stops you.
- Escape hatch for a single commit: `git commit --no-verify`.

Remove it completely at any time — this restores your original hook byte-for-byte:

```sh
verik hook uninstall
```

---

## 6. When it flags something it shouldn't

It will. This is the part we most want to hear about.

See everything it checks:

```sh
verik rules
```

Then pick a lever. **Prefer the first one** — the finding stays visible in your
report and only stops blocking, so you lose no information:

```sh
verik rules severity debug-artifact info
```

If a rule genuinely doesn't apply to your project:

```sh
verik rules disable type-escape --reason "generated protobuf bindings"
```

`--reason` is required on purpose. It's written into `.verik/policy.json`,
which is committed — so turning a check off shows up in your next pull request
instead of quietly happening.

Even disabled, the rule still runs and its findings are recorded as _suppressed_
in the run record. Switching something off never hides it without a trace.

To silence one specific finding rather than a whole rule:

```sh
verik override add --rule secret-leak --path tests/fixtures.ts --reason "test data"
```

---

## 7. Reading the results

```sh
verik report        # the full report
verik explain       # the verdict in plain English
verik runs          # every run so far
verik inspect       # what was sent, what was excluded, token usage
```

Reports live in `.verik/runs/<run-id>/`, which is gitignored.

---

## 8. In CI

Your CI checkout is clean, so point it at a commit range instead:

```sh
verik verify --base origin/main
```

Exit codes:

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `0`  | Passed, or the policy chose not to block                 |
| `1`  | Verik itself failed                                      |
| `2`  | **Policy blocked** — do not ship                         |
| `3`  | Blocking mode, but verification couldn't reach a verdict |

See [ci.md](ci.md) for a full GitHub Actions example.

---

## 9. Backing out

```sh
verik hook uninstall     # restores your original hook exactly
rm -rf .verik            # removes all config and history
npm unlink -g verik      # removes the binary
```

Your repository is otherwise untouched — Verik never stages, stashes,
commits, or checks anything out. That's a design invariant, not a promise.

---

## What we'd like to know

The single most useful thing you can tell us:

> **How many findings did it report, and how many were actually worth fixing?**

The rules have only ever been tuned against one codebase. On a large, old, messy
project the false-positive rate is genuinely unknown — and that number decides
whether this is useful or annoying. A noisy result is a _useful_ result; please
send it.

Also worth reporting:

- `verik init` guessing your build commands wrong
- Anything that felt slow
- Any case where it blocked something it shouldn't have, or missed something obvious

Open an issue at
[github.com/veriks/verik/issues](https://github.com/veriks/verik/issues),
or just paste the output of `verik report`.
