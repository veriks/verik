# Release checklist

Everything between "it works on my machine" and "a stranger uses it."

Verik has only ever run on Windows. That is the single biggest unknown in the
project, and the first section exists because of it.

---

## 1. Before anything else: one blocker

**`release.yml` publishes any `v*` tag straight to `latest`.**

Tag `v0.1.0-alpha.0` meaning "prerelease" and it ships as the real thing, over
the placeholder, permanently — npm versions are immutable. Fix this before you
type your first `git tag`.

The workflow needs to read the tag, and pass `--tag` accordingly:

```yaml
- name: Resolve npm dist-tag
  id: disttag
  env:
    TAG: ${{ github.ref_name }}
  run: |
    version="${TAG#v}"
    if [ "$version" = "${version#*-}" ]; then
      echo "tag=latest"       >> "$GITHUB_OUTPUT"
      echo "prerelease=false" >> "$GITHUB_OUTPUT"
    else
      channel="${version#*-}"; channel="${channel%%.*}"
      echo "tag=${channel}"   >> "$GITHUB_OUTPUT"
      echo "prerelease=true"  >> "$GITHUB_OUTPUT"
    fi

- name: Publish to npm
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
    DIST_TAG: ${{ steps.disttag.outputs.tag }}
  run: npm publish --provenance --access public --tag "$DIST_TAG"
```

Also confirm the tag in `package.json` matches the git tag. A mismatch publishes
a version nobody asked for.

---

## 2. Platform testing

CI covers `ubuntu-latest`, `windows-latest`, `macos-latest` on Node 20, plus
Ubuntu on Node 22. **It has never run.** Making the repo visible and pushing is
the fastest way to learn more than any local testing will tell you.

These are the places where the code is genuinely platform-dependent, in rough
order of how badly they fail if wrong.

### The attribution engine — `core/repository/worktree-tree.ts`

The riskiest code in the project. It drives git plumbing through environment
variables, and both of these are silent when wrong.

- [ ] **Alternate object stores resolve.** Multiple alternates are joined with
      `path.delimiter` — `;` on Windows, `:` on POSIX. Hardcoding either makes
      the second store unreadable on the other platform, and the symptom is a
      checkpoint diff that quietly comes back empty.
      Test: `verik begin`, edit a file, `verik verify`. The edit must appear.
- [ ] **The user's repo is untouched.** `git status` and `HEAD` identical before
      and after a run, on each platform.
- [ ] **Unborn HEAD.** `git init` then `verik init` then `verik verify` in a repo
      with no commits.

### The git hook — `core/hooks/git-hooks.ts`

- [ ] **The executable bit.** `chmod 0o755` is a no-op on Windows and load-bearing
      everywhere else. Git silently ignores a non-executable hook, so a failed
      `chmod` looks exactly like a working install.
      Test: `verik hook install`, then `ls -l .git/hooks/pre-commit` shows `x`.
- [ ] **The hook actually fires.** Commit something with a secret in it. The
      commit must be blocked.
- [ ] **Line endings.** The generated hook is POSIX shell. CRLF gives
      `\r: command not found`. `.gitattributes` pins LF, but verify on a real
      checkout.
- [ ] **`core.hooksPath`.** Install into a repo using husky.
- [ ] **Uninstall restores byte-for-byte.** `md5sum` before and after.

### Filesystem differences

- [ ] **Case sensitivity.** Linux distinguishes `src/App.ts` from `src/app.ts`;
      macOS and Windows usually do not. Anything comparing paths as strings can
      diverge. Rules with path matching (`file-kinds.ts`) are the exposure.
- [ ] **Symlink containment.** `paths-safe.test.ts` has a symlink-escape test
      skipped on Windows (needs Developer Mode). Linux and macOS are the only
      places it actually runs — confirm it does.
- [ ] **Temp directories.** `/tmp` vs `%TEMP%`, and macOS returning
      `/var/folders/...` symlinked to `/private/var/...`, which breaks naive
      `realpath` comparisons.

### Builder — `stages/builder/`

- [ ] **Executable lookup.** `executable-lookup.ts` and `command-planner.ts` both
      branch on platform: `.cmd` wrappers on Windows, plain binaries elsewhere.
      Test on a repo with `./gradlew` or `./mvnw`.
- [ ] **Every planned command still passes the allowlist** on each platform.

### Binaries

- [ ] **`pnpm build:bin` cross-compiles.** Targets: linux-x64, linux-arm64,
      macos-x64, macos-arm64, win-x64. This **cannot** be tested on Windows —
      pkg refuses and says so. CI on Ubuntu is the only place it runs.
- [ ] **Each binary starts.** `./verik-linux-x64 --version` and `verik demo`.
- [ ] **The curl installer works.** `scripts/install.sh` picks OS/arch and pulls
      from GitHub releases. It 404s until a release exists, so this is
      necessarily tested last.

### Smoke test, per platform

```sh
git clone <repo> && cd verik
pnpm install && pnpm build && npm link
verik --version
verik demo                                    # whole pipeline, no network
cd /path/to/a/real/repo
verik init --yes --mode rules
verik begin
echo 'const o = { rejectUnauthorized: false };' >> src/anything.ts
verik verify                                  # must report insecure-transport
verik hook install && verik hook uninstall    # must restore cleanly
```

---

## 3. Releasing

### Once, before the first release

- [ ] `NPM_TOKEN` in repo secrets — an automation token, not a login one.
- [ ] Repo made visible, if the release is public.
- [ ] `release.yml` prerelease handling fixed (section 1).
- [ ] Green CI on all three platforms.

### Every release

- [ ] `pnpm check` — lint, types, format together.
- [ ] `pnpm test` and `pnpm eval` green.
- [ ] Version bumped in `package.json`.
- [ ] `docs/reference.md` test count and command list still accurate.
- [ ] `README.md` install instructions match what actually ships.

Then:

```sh
git tag v0.1.0-alpha.0 && git push origin v0.1.0-alpha.0   # prerelease
git tag v0.1.0         && git push origin v0.1.0           # real
```

### Immediately after

- [ ] `npm view verik dist-tags` — confirm the tag landed where intended.
- [ ] `npm install -g verik` on a clean machine.
- [ ] `verik --version` and `verik demo`.
- [ ] Download one binary from the GitHub release and run it.

### Rollback

npm versions are immutable and cannot be replaced. You can:

- `npm deprecate verik@0.1.0 "broken, use 0.1.1"` — the honest fix.
- `npm unpublish` — only within 72 hours, and it takes the whole package if it
  is the only version.
- Move `latest` back: `npm dist-tag add verik@0.0.9 latest`.

---

## 4. Getting the first users

Sequencing matters more than tactics. **Do not launch loudly before five people
have used it and told you what they hate.** A launch converts attention into
users exactly once; spending it on a version with an unknown false-positive rate
wastes the only free attention you get.

### Phase 0 — five people (now)

The goal is one number: **how many findings, and how many were worth fixing.**

- [ ] Make the repo visible, or add five people as collaborators.
- [ ] Send `docs/quickstart.md` and ask for that number.
- [ ] Watch someone run it, in person or on a call. You will learn more from
      thirty seconds of watching than from any written feedback.
- [ ] Fix the top three complaints before anyone else sees it.

### Phase 1 — the assets that do the work

One artefact carries this product better than any copy:

> a terminal showing `✓ test ✓ lint` **above** a CRITICAL finding.

- [ ] A GIF, under 15 seconds: agent writes code → tests pass → Verik blocks it.
      No narration. No logo intro. Start on the terminal.
- [ ] A one-paragraph story with real numbers from a real repo.
- [ ] The `pattern-table` and `clean-refactor` fixtures are your credibility
      proof — "we measured our own false-positive rate and it is zero on these."

### Phase 2 — where to actually post

Ordered by what works for developer tools with no budget.

- [ ] **Answer, don't announce.** Search "how do I know what Cursor changed",
      "reviewing AI generated code", "claude code committed something weird" on
      Reddit, HN and X. Reply with a useful answer that happens to mention the
      tool. Ten of these beat one launch post.
- [ ] **Show HN.** Title should state the problem, not the product: "Show HN:
      Verik — see exactly which lines your AI agent changed". Post Tuesday to
      Thursday, early morning US Pacific. Be in the comments all day.
- [ ] **r/ExperiencedDevs** and **r/devtools** — they are hostile to marketing
      and receptive to "here is a thing I built because X annoyed me."
- [ ] **A writeup, not a pitch.** "We ran our own rules against our own codebase
      and got 19 false positives" is a post people share. "Introducing Verik" is
      not.
- [ ] **Lobste.rs** if you can get an invite — small, but high-signal readers.
- [ ] **Product Hunt** last, and only if you have a landing page. It sends
      curious non-users; the others send developers.

### Phase 3 — the durable part

- [ ] Every real repo Verik runs on teaches you a false positive to kill. That
      corpus is the only moat here; the code is a weekend to copy and the rules
      are not.
- [ ] The `--reason` strings from `rules disable` are a written record of where
      the tool was wrong on real code. Collect them.
- [ ] `verik feedback` when there are enough users that asking individually
      stops scaling — around twenty to fifty, not before.

### What not to do

- Do not buy ads. Nobody searches for a category that does not exist yet.
- Do not build a landing page before Phase 0. The GitHub README is the landing
  page for a developer tool.
- Do not describe it as "AI code review". That category contains CodeRabbit,
  Greptile and Graphite, and it is a comparison you lose. The claim is
  attribution: which lines the agent wrote, provably.
