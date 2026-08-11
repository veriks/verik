/**
 * Which files a rule should look at.
 *
 * With one or two rules a false positive is an annoyance. With twenty it is the
 * reason the tool gets uninstalled, and the cheapest way to avoid one is to not
 * look at files where the pattern is legitimate: `console.log` in a script is
 * fine, `Math.random()` in a test is fine, and a "secret" in a vendored bundle
 * is not the agent's doing. Every rule declares its own scope from these.
 */

const basename = (p: string) => p.split('/').at(-1) ?? '';

const TEST_DIR = /(^|\/)(tests?|__tests__|specs?|e2e|fixtures?|testdata|__mocks__|mocks?)(\/|$)/i;
const TEST_FILE =
  /\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb|ts|js)$|^test_.+\.py$|Test\.java$|Tests?\.cs$|_spec\.rb$/;

/** Test and fixture code, where deliberately unsafe or fake values are normal. */
export function isTestPath(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(basename(path));
}

const VENDORED_DIR =
  /(^|\/)(node_modules|vendor|third_party|thirdparty|dist|build|out|target|coverage|\.next|\.nuxt|\.venv|venv|site-packages|Pods|Carthage)(\/|$)/;
const GENERATED_FILE = /\.(min\.js|min\.css|bundle\.js|map|snap|pb\.go|generated\.[a-z]+)$/;
const LOCKFILE =
  /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|Pipfile\.lock|poetry\.lock)$/;

/**
 * Code nobody wrote by hand. An agent that runs `npm install` rewrites a
 * lockfile with thousands of lines; scanning them for patterns produces noise
 * proportional to the dependency tree and signal proportional to nothing.
 */
export function isVendoredPath(path: string): boolean {
  return VENDORED_DIR.test(path) || GENERATED_FILE.test(path) || LOCKFILE.test(basename(path));
}

const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc|html?)$/i;

/** Prose. A README showing `password = "hunter2"` is documentation, not a leak. */
export function isDocPath(path: string): boolean {
  return DOC_FILE.test(path);
}

const CI_FILE =
  /(^|\/)(\.github\/workflows\/.+\.ya?ml|\.gitlab-ci\.yml|azure-pipelines\.yml|Jenkinsfile|\.circleci\/config\.yml|\.travis\.yml|buildkite\.ya?ml)$/;

/**
 * The gates a change has to pass through.
 *
 * This used to include `.verik/policy.json`, on the reasoning that a run which
 * relaxes its own gate and then reports a pass is worthless. That check could
 * never fire: the attribution engine excludes `.verik/` from every tree it
 * builds, so the file cannot appear in a diff for a rule to see.
 *
 * Policy changes are still reviewable, through the mechanism that actually
 * works — policy.json is committed, so weakening it shows up in the pull
 * request, which is why `rules disable` demands a written reason.
 */
export function isCiPath(path: string): boolean {
  return CI_FILE.test(path);
}

/**
 * The default scope: hand-written source. Excludes vendored output and prose,
 * but keeps tests — a rule that cares about tests opts in with `isTestPath`,
 * and one that does not opts out explicitly, so the choice is always visible at
 * the rule.
 */
export function isSourcePath(path: string): boolean {
  return path.length > 0 && !isVendoredPath(path) && !isDocPath(path);
}

/** Hand-written source excluding tests — the scope for most hygiene rules. */
export function isProductionSourcePath(path: string): boolean {
  return isSourcePath(path) && !isTestPath(path);
}
