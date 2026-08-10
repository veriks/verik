import { defineLineRule } from './line-rule.js';
import { isProductionSourcePath } from './file-kinds.js';

/**
 * These rules all describe shipped-code hygiene, so none of them read test
 * files. A suite that verifies "we detect a stubbed function" has to contain a
 * stubbed function, and a fixture is not a defect. The test-file failure modes
 * have their own rules — `disabled-tests` and `test-removal` — which do the
 * opposite and look only there.
 */
const PRODUCTION_ONLY = isProductionSourcePath;

/**
 * The failure modes that are specific to an agent rather than a person.
 *
 * A human who cannot get a check to pass usually says so. An agent under
 * instruction to make the build green has a shorter path available: silence the
 * checker, stub the function, swallow the error. Each of these leaves the
 * build green and the work undone, which is exactly the state this tool exists
 * to catch — and exactly the state a passing CI run cannot distinguish from
 * success.
 */

/**
 * Suppression comments are the highest-signal tell in the set. The agent hit a
 * real diagnostic and chose to hide it. The suppression is evidence that a
 * checker already found a problem here.
 */
export const SuppressionAddedRule = defineLineRule({
  id: 'suppression-added',
  title: 'Static-analysis suppression added',
  severity: 'medium',
  confidence: 0.9,
  patterns: [
    /eslint-disable(?:-next-line|-line)?\b/,
    /@ts-(?:ignore|nocheck)\b/,
    /#\s*noqa\b/,
    /#\s*type:\s*ignore\b/,
    /#\s*pylint:\s*disable\b/,
    /#\s*rubocop:disable\b/,
    /\/\/\s*nolint\b/,
    /@SuppressWarnings\s*\(/,
    /#pragma\s+warning\s+disable\b/,
    /\/\/\s*swiftlint:disable\b/,
    /\[SuppressMessage\b/,
  ],
  exceptions: [
    // Formatting only — carries no correctness or safety signal.
    /prettier-ignore/,
    // Turning a suppression back on is the opposite of the concern.
    /eslint-enable|rubocop:enable|swiftlint:enable|warning\s+restore/,
  ],
  // A suppression pragma is always a comment, so comment-skipping cannot apply.
  skipComments: false,
  appliesTo: PRODUCTION_ONLY,
  message:
    'A static-analysis suppression was added. A checker reported a problem on this line and the ' +
    'suppression hides it rather than resolving it.',
  remediation:
    'Fix the underlying diagnostic. If the suppression is genuinely correct, keep it and add a ' +
    'comment saying why.',
});

/**
 * Deliberately narrow. A bare `// TODO` is ordinary and flagging it would bury
 * every real finding under hundreds of pre-existing ones, so this matches only
 * constructs that mean "this code path does not work yet".
 */
export const StubImplementationRule = defineLineRule({
  id: 'stub-implementation',
  title: 'Unimplemented code path added',
  severity: 'high',
  confidence: 0.85,
  patterns: [
    /throw\s+new\s+\w*Error\s*\(\s*['"`](?:not implemented|unimplemented|todo|fixme)/i,
    /\braise\s+NotImplementedError\b/,
    /\bunimplemented!\s*\(/,
    /\btodo!\s*\(/,
    /\bpanic\s*\(\s*"(?:not implemented|unimplemented|todo)/i,
    /\bNotImplementedException\b/,
    /\bTODO\b[^\n]{0,24}\bimplement\b/i,
    /\bfatalError\s*\(\s*"(?:not implemented|unimplemented)/i,
  ],
  // One of the patterns is a TODO marker, which only ever appears in a comment.
  skipComments: false,
  appliesTo: PRODUCTION_ONLY,
  message:
    'An unimplemented code path was added. The change reports as complete but this branch will ' +
    'fail if it is ever reached.',
  remediation: 'Implement the path, or make the caller and the task description reflect the gap.',
});

/**
 * Single-line error swallowing. `EmptyCatchRule` covers the two-line brace
 * form; these are the idioms that fit on one line and would otherwise slip
 * past it.
 */
export const SwallowedErrorRule = defineLineRule({
  id: 'swallowed-error',
  title: 'Error silently discarded',
  severity: 'medium',
  confidence: 0.8,
  patterns: [
    /except[^:]*:\s*pass\s*$/,
    /except[^:]*:\s*continue\s*$/,
    /catch\s*\([^)]*\)\s*\{\s*\}/,
    /catch\s*\{\s*\}/,
    /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/,
    /\.catch\s*\(\s*function\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\)/,
    /rescue\s*(?:=>\s*\w+\s*)?;?\s*end\s*$/,
    /if\s+err\s*!=\s*nil\s*\{\s*\}/,
    /^\s*_\s*=\s*err\s*$/,
  ],
  message:
    'An error is caught and discarded without being handled or logged. Failures on this path will ' +
    'be invisible at runtime.',
  remediation: 'Log the error, re-throw it, or add a comment explaining why it is safe to ignore.',
  appliesTo: PRODUCTION_ONLY,
});

/**
 * Debug output left behind. Low severity by design — this is untidy rather than
 * dangerous — but it is a reliable marker of code that was iterated on until it
 * worked and never read back. Restricted to production source: a `print` in a
 * script or a test is doing its job.
 */
export const DebugArtifactRule = defineLineRule({
  id: 'debug-artifact',
  title: 'Debug statement left in source',
  severity: 'low',
  confidence: 0.75,
  patterns: [
    /\bconsole\.(?:log|debug|dir|trace)\s*\(/,
    /\bdebugger\s*;?\s*$/,
    /\bpdb\.set_trace\s*\(/,
    /\bbreakpoint\s*\(\s*\)/,
    /\bbinding\.pry\b/,
    /\bvar_dump\s*\(/,
    /\bdd\s*\(/,
    /\bdump\s*\(\s*\$/,
    /\bfmt\.Print(?:ln|f)?\s*\(/,
    /\bSystem\.out\.print(?:ln)?\s*\(/,
  ],
  exceptions: [
    // A logger is the correct way to emit output; only ad-hoc debugging counts.
    /\b(?:logger|log)\.(?:info|warn|error|debug)\b/,
    /eslint-disable.*no-console/,
  ],
  message: 'A debug statement was left in non-test source.',
  remediation: 'Remove it, or route the output through the project logger.',
  // Also skips scripts and examples, where printing to stdout is the point.
  appliesTo: (p) =>
    PRODUCTION_ONLY(p) && !/(^|\/)(scripts?|tools?|bin|examples?|cmd)(\/|$)/.test(p),
  maxFindings: 8,
});

/**
 * Escaping the type system. Distinct from a suppression comment: this does not
 * silence a checker, it removes the checker's ability to see the code at all.
 */
export const TypeEscapeRule = defineLineRule({
  id: 'type-escape',
  title: 'Type safety bypassed',
  severity: 'low',
  confidence: 0.7,
  patterns: [
    /\bas\s+unknown\s+as\b/,
    /\bas\s+any\b/,
    /:\s*any\s*(?:[;,)=]|$)/,
    /@ts-expect-error\b/,
    /\bObject\s*\)\s*as\b/,
    /\bcast\s*\(\s*Any\b/,
    /\binterface\{\}\s*\)\s*\./,
  ],
  message: 'A type assertion or `any` was introduced, removing compiler checking at this point.',
  remediation: 'Narrow the type properly, or document why the assertion is sound.',
  // `as any` in a test double is ordinary; in shipped code it is a gap.
  appliesTo: PRODUCTION_ONLY,
  maxFindings: 8,
});
