# Product Strategy

**Status:** working position, not settled. Written 9 August 2026.

This is the commercial counterpart to [STATE.md](../STATE.md), which covers
engineering state. Same rule applies: mark what is decided, and mark what is a
guess. Most of this is a guess until the product is validated — see §6.

---

## 1. The motion: bottom-up B2B

Individual developer installs it → likes it → brings it to the team → the org
buys. Product-led growth, the same path Slack, Figma, Linear, Postman and
Datadog took.

This is **not** B2C. B2C is someone spending their own money on personal use. A
developer running Crosscheck against work they do for an employer is B2B, just
entered from the bottom.

The distinction matters because **the user and the buyer are different people**:

| | Who | What they want |
|---|---|---|
| **User** | The individual developer | Fast, accurate, doesn't nag, doesn't get in the way |
| **Buyer** | Eng manager, platform or security lead | Control, enforcement, evidence, auditability |

Build for both. They are not the same product surface, and the buyer's features
are worthless without the user's adoption first.

---

## 2. The free/paid boundary: local vs shared state

**This is the core commercial insight. Everything else follows from it.**

Crosscheck today is entirely local — your machine, your API key, `.crosscheck/`
on your disk, `memory.json` inside your repo. That architecture already draws the
line.

### Free — anything that works alone

Local CLI, your own API key, unlimited runs, all four pipeline stages, every
deterministic rule, local JSON/Markdown/HTML reports. **Genuinely uncrippled.**
A solo developer should be able to use this forever without paying and without
feeling like they are using a demo.

### Paid — anything that requires shared state

The moment findings, memory, policy or overrides need to be shared *across
people*, you need a backend — and that is a real product, not a paywall on
something artificially removed:

- **Shared memory** — "this file had a broken auth pattern three times before",
  across the whole team, not just your clone.
- **Org-wide policy** — blocking thresholds enforced centrally, instead of a
  per-repo `policy.json` that anyone can edit.
- **Audit trail** — a record of verdicts and overrides: who suppressed what, and
  why.
- **CI seats, SSO/SAML, approval workflows** for overrides.

### Why this boundary is the right one

It is honest. You are charging for infrastructure that genuinely has to exist —
servers, identity, retention — not for withholding a feature that costs you
nothing to give away. Users can tell the difference, and developer audiences
punish the other kind.

It also means the free tier never has to be sabotaged to protect revenue, which
is the failure mode that kills most open-core products.

### Architectural implication

**The memory engine is the seed of the commercial product.**
`src/core/memory/` is local today. Making it team-shared *is* the paid product.
Keep that in mind when changing it — it is the highest-leverage code in the repo
commercially, not just technically.

---

## 3. Distribution

### The content unit

> **"An AI wrote this code. Here's what it missed."**

Screenshot-able, repeatable, inherently interesting, and it demonstrates the
product rather than describing it. Every real run that catches something real is
a post. The terminal output was redesigned partly for this reason.

### `datasets/escaped-incidents/` is a content engine, not just calibration data

Real cases where AI-generated code shipped and broke production is a series
nobody else is writing. It builds the audience and the calibration dataset with
the same work. Exploit that overlap — it is rare.

### Where the audience already is

Crosscheck wraps other people's tools (`crosscheck run -- claude -p "..."`), so
the distribution channel is those tools' communities: Claude Code, Cursor, aider,
Codex users. Their Discords, subreddits and issue threads are full of people who
already have this problem.

### Sequence

1. **5–10 design partners first.** Teams running it on real diffs. Produces the
   labelled data, the testimonials, and the traction narrative in one move. Ten
   teams using it seriously beats a thousand GitHub stars on every axis.
2. **Build in public** — post the interesting catches, not the milestones.
   "Found a token reuse bug the agent introduced" beats "v0.2 released."
3. **Then Show HN**, once the demo is undeniable.

### What not to do

Do not run a hype/controversy playbook. The product's core claim is "trust me
with your entire source code"; attention bought by overclaiming is the wrong
currency for a trust purchase, and developer audiences have good detectors and
long memories.

**You get one Show HN.** Attention is a one-shot resource for a small team.
Spending it on a pipeline validated on one repository, once, means a launch-day
false positive on someone's real diff becomes the lasting impression.

---

## 4. Licence and open source

**Applied: Apache-2.0** (`LICENSE` + `NOTICE`, `license` field in
`package.json`). Repo stays private for now; open it once validated.

- **Apache-2.0 over MIT** — it explicitly reserves trademarks (MIT is silent) and
  carries a patent grant that enterprise legal teams look for.
- **Trademark, not copyright, is the anti-clone protection.** Anyone can fork the
  code under any permissive licence; what stops them shipping *Crosscheck* is
  owning the mark. Worth registering early — but note "crosscheck" is a common
  English word and will be harder to defend than an invented one. Lawyer
  territory.
- **Not BUSL/Elastic-style, yet.** Those are what companies adopt *after* they
  are big enough for a competitor to resell them. Pre-launch it buys protection
  against a threat you do not have and costs the adoption you critically do.
- **Private → public is reversible; public → private is not.** Holding the option
  costs nothing. Opening a repo nobody stars is a negative signal, not a neutral
  one.
- **The strongest eventual argument for opening it is trust**, and it is specific
  to this product: Crosscheck reads an entire diff and ships it to a third-party
  API. An auditable redaction layer is a feature, possibly the one that gets you
  through security review.

**Do this now, structurally:** keep any hosted/team/platform code in a
**separate private repo** from day one. If the open-core boundary is structural
from the start you never have to untangle it later. It is free to do now and
expensive to retrofit.

---

## 5. Pricing shape

Not decided. The reference point is the tiering common to this category —
free solo tier, per-seat team tier, higher tier with more seats and retention,
custom enterprise with self-hosting/VPC. Model the tiers on **seats and shared
state**, which is what actually costs you money to serve, rather than on run
counts, which punishes the usage you want to encourage.

Defer real numbers until design partners tell you what they would pay for.

---

## 6. The constraint that gates all of the above

**Nobody has measured whether the verdicts are good.** One real run, on one
repository. Every test uses `FakeProvider`, which throws.

Bottom-up adoption raises the bar here rather than lowering it: there is no
salesperson in the room to explain away a bad verdict. The product has to be good
*unattended*, on a stranger's real diff, on their first try. A bad verdict does
not lose you a deal — it loses you the user silently, and they do not come back.

The licence question, the open-source question, and the launch question all
resolve to the same prerequisite: **do the labelled-diffs exercise in
[STATE.md](../STATE.md) §8 first.**
