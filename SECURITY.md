# Security Policy

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/veriks/verik/security/advisories/new),
not as a public issue.

We aim to acknowledge within 3 working days.

## Why this matters more than for most CLIs

Verik reads the full diff of the repository it runs in and sends part of it
to a third-party inference API. A bug in the privacy seam is a data-disclosure
bug, not a correctness bug. The following are in scope and treated as high
severity:

- Any path by which an excluded file (`.env`, `*.pem`, `*.key`, anything matched
  by `privacy.excludePatterns`) reaches an outbound prompt.
- Any path by which a secret survives redaction into an outbound prompt.
- Reading files outside the repository root — for example through a symlink
  committed to the repository.
- Any route by which model output reaches shell execution. The Builder runs a
  fixed allowlist precisely so that it cannot.

## Design invariants

These are enforced in code and covered by tests. A change that breaks one is a
security regression:

1. Only the sanitised patch (`DiffResult.safePatch`) may leave the machine. The
   raw patch is a distinct type so it cannot be passed somewhere outbound by
   accident.
2. Exclusion and redaction happen where the canonical diff is produced, so every
   downstream consumer inherits them.
3. Deterministic rules and cache keys read the raw patch deliberately — they run
   in-process and emit nothing to the network. Redacting their input would blind
   the secret-leak rule.
4. File reads are resolved with `realpath` and confined to the repository root.
5. Verik never mutates the repository under verification. Tree building
   redirects the index and object store to a temp directory.

## Scope

The `.verik/` directory holds unredacted local forensic artifacts,
including `diff.patch`. This is intentional — a redacted forensic record is
useless when triaging a leak — and `.verik/runs/` is gitignored by default.
Do not attach it to a public CI job or issue.

## Supported versions

Pre-1.0: only the latest release receives fixes.
