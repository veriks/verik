# Verik — Positioning

**Status:** working position. Written 10 August 2026.
Companion to [product-strategy.md](product-strategy.md) (how it monetises) and
[STATE.md](../STATE.md) (what is actually built). Same honesty rule as those:
§6 lists what is not yet true.

---

## 1. In one line

Verik is the trust layer for AI-written code: it proves what an agent
changed, what was checked, what evidence supports the result, and whether policy
permits it to ship.

Not "an AI that reviews your code." A system of record for machine-authored
changes.

---

## 2. The problem

A developer runs `claude -p "add password reset"`. Ninety seconds later the
working tree has changed. Three questions have no good answer today:

1. **What did the agent actually change?** Not "what does `git diff` show" —
   the tree was already dirty. What changed *because of that command*?
2. **What was actually checked?** The agent says it's done. Did anything run?
   Did the tests pass before, and do they pass now?
3. **Is it allowed to ship?** Who decided, on what evidence, and can that
   decision be shown to someone else later?

Every answer today is either "read the diff yourself" or "the agent said it was
fine." The first does not scale with agent throughput. The second is the
generator grading its own work.

This gets worse, not better, as agents improve — volume rises, human review time
does not, and the fraction of code no human read before merge goes up.

---

## 3. What Verik does

Four claims, in the order they matter.

### Provenance — what the agent touched

Verik snapshots the repository as a git tree before the agent works and
again after, then diffs the two trees. The result is the **attributable diff**:
the agent's contribution, isolated from work that was already in progress, down
to the hunk. A file you had half-edited before the agent touched it yields only
the agent's delta — your line appears as context, not as an addition.

This is the hardest engineering in the product and the least replaceable. It is
pure git plumbing — no model involved, nothing to be wrong about.

**How the baseline is obtained depends on how the agent runs:**

| Agent | Command | Baseline |
|---|---|---|
| One-shot CLI (`claude -p`, `codex exec`, `aider --message`) | `verik run -- <cmd>` | Taken automatically around the command |
| Interactive CLI session (`claude`, `aider`) | `verik run -- claude` | Around the whole session — coarser, still exact |
| IDE agents (Cursor, Copilot, Windsurf) | `verik begin` … `verik verify` | Explicit checkpoint |
| Desktop and web apps, pasted code | `verik begin` … `verik verify` | Explicit checkpoint |
| CI, on a pull request | `verik verify --base <ref>` | The merge base |

The checkpoint matters more than it looks: without it, an unwrappable agent
degrades to "everything uncommitted", which cannot separate the agent's work
from the developer's — and IDE agents are plausibly the largest segment. The
checkpoint tree is a real git tree in Verik's own object store, so
attribution is identical in kind to the wrapped path. The repository is never
written to.

### Evidence — what was checked

- **Builder** runs the project's real build, test, typecheck and lint commands,
  chosen from a deterministic allowlist. Model output never reaches a shell.
- **Deterministic rules** run as code: secrets in the diff, `.env` added, `eval`
  usage, disabled tests, migrations, lockfile changes.
- Every finding carries a file path, a line, and an excerpt.
- Every stage records model, provider, prompt hash, input hash, token usage and
  duration.

### Judgement — what it means

Scout, Reviewer and Judge are three separate inference calls with separate
prompts and separate context. The Judge is explicitly sceptical of the Reviewer
and may dismiss findings it considers unsupported — false positives are the
failure mode that gets a verification tool uninstalled.

### Policy — whether it ships

A deterministic policy engine turns the verdict into an exit code, under a mode
the buyer chooses: `shadow` (record only), `advisory` (report, never block),
`blocking` (fail the build). Suppressions are explicit, reasoned and recorded.

**Three of these four are not model-dependent.** That matters for §5.

---

## 4. Why the labs will not do this

They could. The question is whether they will, and the answer is structural
rather than a capability gap.

### A vendor cannot be an independent check on itself

The product claim is: *the system that writes the code is not the system that
decides whether it is safe to ship.* If Anthropic ships a verifier for Claude
Code's output, that claim evaporates — it is marking its own homework. This is
the same reason a firm cannot audit its own accounts. Not incompetence;
structure.

A lab can absolutely make its own agent more careful. It cannot be an
independent verifier of itself, because independence is the property being sold.

### The buyer is multi-vendor; the labs are not

Real engineering organisations run Claude Code *and* Cursor *and* Copilot *and*
aider, often in the same week. They need one trust surface across all of them,
with one policy and one audit trail.

Anthropic has no reason to build first-class verification of Codex output.
OpenAI has no reason to verify Claude's. Whoever owns this layer has to be
neutral, and neutrality is not a feature a lab can add later — it is a thing you
either are or are not.

This is why Verik wraps *any* command and runs against *any* provider,
including local models. It is a strategic requirement, not a nice-to-have.

### The incentives point the other way

A lab's product metric is task completion — the agent shipped your feature. A
verifier's job is sometimes to say *no, not this one*. Those incentives are not
opposed in principle, but they are not aligned either, and organisations build
what their metrics reward. Language vendors do not build the CI systems that
gate their users' releases, for the same reason.

### It is systems work, not model work

The difficult parts are attributable diff correctness, a privacy seam that
guarantees excluded files never reach an API, deterministic evidence
outranking model opinion, policy evaluation, and an audit record. None of it is
model capability. All of it is unglamorous infrastructure that has to be exactly
right, and it is not what a frontier lab is organised to ship.

### Control belongs to the buyer

The threshold at which a change is blocked is a policy decision belonging to the
engineering organisation, not to the vendor whose output is being judged. The
same applies to the audit trail. Enterprises will not accept that both live
inside the company that generated the code.

---

## 5. Why this is not another AI code reviewer

AI code review is a commodity: GitHub ships one, every IDE ships one, and the
differentiator is model quality — which none of those products control and
neither would we. Competing there is a race we would lose.

Verik answers a different question.

| | AI code reviewer | Verik |
|---|---|---|
| Input | A pull request diff | The change *one agent run* produced |
| Question | "Any comments on this code?" | "What changed, what was checked, may it ship?" |
| Evidence | Model opinion | Real command output + rules, with model opinion ranked below both |
| Output | Comments | A verdict, an exit code, and a record |
| Without an API key | Nothing | Rules and Builder still run |
| Wrong answer costs | A noisy comment | A blocked build — so false positives are a first-class design concern |

Three differences are structural rather than positional:

**It is scoped to an agent run, not a PR.** Nobody else can isolate what a
specific agent command changed from what was already in the working tree. That
is what makes "an agent touched this" a provable statement rather than a vibe.

**Deterministic evidence outranks model opinion.** Rules and real test output are
facts; the LLM stages are the interpretation layer on top. A reviewer that is
pure model opinion has nothing to fall back on when the model is wrong.

**It produces a record, not a conversation.** Exit codes, policy decisions,
evidence IDs, prompt and input hashes per stage. Comments are for humans reading
now; a record is for the person who asks in six months why this shipped.

---

## 6. What is not true yet

A positioning document that only lists strengths is a pitch deck. These are the
gaps between the claims above and the code today.

- **The verdicts are unvalidated.** The pipeline has been run against a live API
  key on one repository, once. Nobody has measured precision or recall. Every
  claim in §3 under *Judgement* is architectural, not empirical. This is the
  single most important open item.
- ~~Policy cannot act on the strongest evidence.~~ **Closed.** Deterministic
  findings are now evaluated independently of, and before, the Judge — a rule at
  or above the severity threshold blocks in blocking mode with no model in the
  loop, and rules mode gets a real policy decision. Verified end to end: a
  critical secret-leak with no Judge at all exits 2.
- **The record is not tamper-evident.** Provenance is captured per stage, but the
  run directory is plain files anyone can edit. Adequate for "help me trust this
  change"; not yet adequate for "show the auditor."
- **Judge does not read memory,** so the traceability chain across runs is
  half-wired.
- **No calibration data.** `datasets/` is deliberately empty — inventing ground
  truth would make every accuracy number fiction — but that means there is no
  regression signal on prompt changes yet.

The first two are the ones that would embarrass us in a technical conversation.
Both are fixable, and neither is a design flaw.

---

## 7. What would falsify this

Honest failure conditions, worth revisiting quarterly:

- **The labs ship neutral, multi-vendor verification.** Unlikely for the
  structural reasons in §4, but it is the direct threat.
- **Precision turns out to be poor and unfixable.** If the LLM stages cannot
  reach usable false-positive rates, the product is the deterministic half —
  a smaller, real, but different business.
- **Agents get reliable enough that nobody wants the friction.** The counter is
  that regulated and high-consequence engineering will still need the record,
  independent of whether the code is good.
- **Buyers want this inside their existing CI vendor**, not as a separate tool.
  Plausible; the answer is to be the layer those vendors integrate rather than a
  destination.
