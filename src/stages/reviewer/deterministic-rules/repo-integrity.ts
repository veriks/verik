import type { DeterministicFinding, DeterministicRule, RuleContext } from './index.js';
import { defineLineRule } from './line-rule.js';
import { iterateAddedLines, iterateRemovedLines } from './patch-lines.js';
import { isCiPath, isTestPath } from './file-kinds.js';

/**
 * Changes to the machinery that judges the change.
 *
 * Everything else in this directory asks "is this code good". These ask a
 * different question: did the change edit the thing that decides whether it
 * passes? A weakened test, a relaxed CI gate and a deleted .gitignore entry are
 * all ways for a diff to make itself look better without getting better, and a
 * green pipeline is the expected result of all three.
 */

/**
 * A CI change is not wrong — but it is the one change that alters the standard
 * every later change is held to, so it should never pass silently. Includes
 * this tool's own policy file: a run that relaxes its own gate and then reports
 * a pass is worthless.
 */
export const CiWorkflowModifiedRule: DeterministicRule = {
  id: 'ci-workflow-modified',
  title: 'CI configuration changed',
  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    return ctx.diff.changedFiles
      .filter((f) => isCiPath(f.path))
      .slice(0, 10)
      .map((f) => ({
        ruleId: 'ci-workflow-modified',
        title: 'CI configuration changed',
        severity: f.changeType === 'deleted' ? ('high' as const) : ('medium' as const),
        confidence: 1.0,
        file: f.path,
        message:
          f.changeType === 'deleted'
            ? `A CI configuration file was deleted: ${f.path}. The checks it defined no longer run.`
            : `A CI configuration file was ${f.changeType}: ${f.path}. This changes the checks every ` +
              'future change is measured against.',
        excerpt: f.path,
        remediation:
          'Confirm the change to the pipeline was intended and is not loosening a gate to make ' +
          'this change pass.',
      }));
  },
};

const ASSERTION =
  /\b(?:expect|assert|assertEquals|assertTrue|assertFalse|assertThat|should|must|require)\s*[.(]|\bXCTAssert\w*\s*\(/;

/**
 * Two ways a suite gets quieter: the file goes, or the assertions inside it do.
 * `DisabledTestsRule` catches the third (skip markers). Deleting a failing test
 * is the single cheapest way to turn a red build green, which is exactly why it
 * needs to be visible.
 */
export const TestRemovalRule: DeterministicRule = {
  id: 'test-removal',
  title: 'Test coverage removed',
  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];

    for (const f of ctx.diff.changedFiles) {
      if (f.changeType !== 'deleted' || !isTestPath(f.path)) continue;
      findings.push({
        ruleId: 'test-removal',
        title: 'Test file deleted',
        severity: 'high',
        confidence: 0.95,
        file: f.path,
        message: `A test file was deleted: ${f.path}. Whatever it covered is now unverified.`,
        excerpt: f.path,
        remediation:
          'Restore the file, or confirm the code it covered was also removed and say so in the ' +
          'change description.',
      });
    }

    // Assertions removed from a test file that still exists.
    const perFile = new Map<
      string,
      { removed: number; added: number; line: number; excerpt: string }
    >();
    const entry = (path: string) => {
      let e = perFile.get(path);
      if (!e) perFile.set(path, (e = { removed: 0, added: 0, line: 0, excerpt: '' }));
      return e;
    };

    for (const line of iterateRemovedLines(ctx.patch)) {
      if (!isTestPath(line.path) || !ASSERTION.test(line.text)) continue;
      const e = entry(line.path);
      e.removed++;
      if (!e.excerpt) {
        e.line = line.line;
        e.excerpt = line.text.trim();
      }
    }
    // Rewriting an assertion removes a line and adds one. Only a net loss means
    // the suite actually checks less than it did — without this, every routine
    // refactor of a test file reports as lost coverage, and a rule that cries
    // wolf on ordinary work is one people learn to scroll past.
    for (const line of iterateAddedLines(ctx.patch)) {
      if (!isTestPath(line.path) || !ASSERTION.test(line.text)) continue;
      entry(line.path).added++;
    }

    // Reported per file rather than per line: removing a ten-line assertion
    // block is one act, and ten findings would drown the rest of the report.
    for (const [path, { removed, added, line, excerpt }] of [...perFile].slice(0, 10)) {
      const net = removed - added;
      if (net <= 0) continue;
      findings.push({
        ruleId: 'test-removal',
        title: 'Assertions removed from a test',
        severity: 'medium',
        confidence: 0.8,
        file: path,
        line,
        message:
          `${net} more assertion${net === 1 ? ' was' : 's were'} removed than added in ${path}, ` +
          'and the file still exists. The test can now pass without checking what it used to check.',
        excerpt: excerpt.slice(0, 120),
        remediation: 'Confirm the assertions were replaced by equivalent or stronger checks.',
      });
    }

    return findings;
  },
};

/**
 * An assertion that cannot fail.
 *
 * This is the companion to the net-count check above. Swapping
 * `expect(user.isAdmin).toBe(false)` for `expect(true).toBe(true)` removes one
 * assertion and adds one, so the count is unchanged and the suite still passes
 * — while checking nothing at all. Counting cannot see that; shape can. It is
 * the single most direct way to make a failing test green without fixing the
 * cause, which is precisely the move this tool exists to make visible.
 */
export const TautologicalAssertionRule = defineLineRule({
  id: 'tautological-assertion',
  title: 'Assertion that cannot fail',
  severity: 'high',
  confidence: 0.9,
  patterns: [
    // Same expression on both sides: expect(true).toBe(true), expect(x).toBe(x).
    /expect\s*\(\s*(.+?)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
    /expect\s*\(\s*true\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)/,
    /expect\s*\(\s*(?:false|null|undefined|0)\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)/,
    /\bassert\s+True\s*$/,
    /\bassertTrue\s*\(\s*true\s*\)/i,
    /\bassert(?:\.ok)?\s*\(\s*true\s*\)/,
    /\bXCTAssertTrue\s*\(\s*true\s*\)/,
    /\bassert\s*\(\s*(\w+)\s*==\s*\1\s*\)/,
  ],
  message:
    'An assertion was added that is true regardless of the code under test. The test will pass ' +
    'even if the behaviour it names is completely broken.',
  remediation: 'Assert against the actual result, or delete the test rather than neutering it.',
  appliesTo: isTestPath,
});

/**
 * Removed .gitignore entries. A dropped `.env` or `*.pem` line means the next
 * commit can carry a file that was previously impossible to add by accident.
 */
export const GitignoreWeakenedRule = defineLineRule({
  id: 'gitignore-weakened',
  title: 'Ignore rule removed',
  severity: 'medium',
  confidence: 0.85,
  side: 'removed',
  patterns: [/^\s*[^#\s]/],
  message:
    'An entry was removed from an ignore file. Files matching it can now be committed, including ' +
    'ones that were previously protected from accidental staging.',
  remediation: 'Confirm the entry is genuinely obsolete and no sensitive path relied on it.',
  appliesTo: (p) => /(^|\/)\.(?:git|npm|docker)ignore$/.test(p),
  maxFindings: 6,
});

/**
 * Removed authorisation checks. Confidence is deliberately moderate — a
 * rename or a refactor produces the same diff shape as a deletion — but the
 * cost of missing a genuinely removed permission check is high enough that
 * surfacing it for a human to glance at is worth the occasional false alarm.
 */
export const AuthCheckRemovedRule = defineLineRule({
  id: 'auth-check-removed',
  title: 'Authorisation check removed',
  severity: 'high',
  confidence: 0.6,
  side: 'removed',
  patterns: [
    /\b(?:isAuthenticated|isAuthorized|requireAuth|requiresAuth|checkPermission|hasPermission|hasRole|verifyToken|validateToken|ensureLoggedIn|authenticate|authorize)\b/,
    /@(?:PreAuthorize|RolesAllowed|Secured|Authorize)\b/,
    /\b(?:login_required|permission_required|user_passes_test)\b/,
    /\bcurrent_user\b[^\n]{0,40}\b(?:admin|owner|permission)\b/i,
  ],
  message:
    'A line performing an authorisation check was removed. If it was not replaced, this path is ' +
    'now reachable without the permission it used to require.',
  remediation:
    'Confirm the check moved rather than disappeared — middleware, a decorator, or a guard ' +
    'elsewhere in the same change.',
  appliesTo: (p) => !isTestPath(p),
  maxFindings: 8,
});

/**
 * Supply-chain shapes that a version bump does not have: a dependency resolved
 * from somewhere other than the registry, and lifecycle scripts that execute on
 * install. Both run code on every machine that installs the project.
 */
export const RiskyDependencySourceRule = defineLineRule({
  id: 'risky-dependency-source',
  title: 'Dependency from a non-registry source or install hook added',
  severity: 'high',
  confidence: 0.85,
  patterns: [
    /"(?:pre|post)install"\s*:/,
    /"[\w@/.-]+"\s*:\s*"(?:git(?:\+\w+)?:|https?:\/\/|file:|github:|link:)/,
    /^\s*[\w.-]+\s*@\s*git\+/,
    /\bgit\+(?:https?|ssh):\/\//,
    /^\s*[\w.-]+\s*=\s*\{\s*git\s*=/,
  ],
  message:
    'A dependency is resolved from outside the package registry, or a lifecycle script that runs ' +
    'automatically on install was added. Both execute code on every machine that installs this ' +
    'project.',
  remediation:
    'Prefer a pinned registry version. If a direct source is required, pin it to a commit hash ' +
    'rather than a branch.',
  appliesTo: (p) =>
    /(^|\/)(package\.json|requirements[\w.-]*\.txt|Pipfile|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/.test(
      p,
    ),
});
