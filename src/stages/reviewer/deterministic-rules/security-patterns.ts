import { defineLineRule } from './line-rule.js';
import { isSourcePath, isTestPath } from './file-kinds.js';

/**
 * Shortcuts that make code work by making it unsafe.
 *
 * These share a shape: each one is the fastest way past an obstacle. TLS
 * verification fails against a self-signed cert, so turn verification off. The
 * query needs a dynamic column, so interpolate it. The hash needs to be fast,
 * so use MD5. An agent optimising for "the command now exits zero" will take
 * these routes, and none of them show up as a test failure.
 */

/** Nothing else in this file is exploitable from the open internet by default. */
export const InsecureTransportRule = defineLineRule({
  id: 'insecure-transport',
  title: 'TLS certificate verification disabled',
  severity: 'critical',
  confidence: 0.9,
  patterns: [
    /rejectUnauthorized\s*:\s*false/,
    /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/,
    /\bverify\s*=\s*False\b/,
    /InsecureSkipVerify\s*:\s*true/,
    /ssl\._create_unverified_context\s*\(/,
    /CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)/i,
    /ServerCertificateValidationCallback\s*(?:\+)?=/,
    /\bcurl\b[^\n]*\s-{1,2}(?:k|insecure)\b/,
    /trustAllCerts|TrustAllCertificates|AllowAnyCertificate/i,
    /checkServerIdentity\s*:\s*\(\s*\)\s*=>/,
  ],
  message:
    'TLS certificate verification is disabled. Traffic on this connection can be intercepted and ' +
    'modified by anyone on the network path.',
  remediation:
    'Trust the specific CA or certificate you need instead of disabling verification. If this is ' +
    'local-only, gate it behind an explicit development check.',
  // Test suites legitimately talk to self-signed local servers.
  appliesTo: (p) => isSourcePath(p) && !isTestPath(p),
});

export const WeakCryptoRule = defineLineRule({
  id: 'weak-crypto',
  title: 'Weak or misused cryptography',
  severity: 'high',
  confidence: 0.8,
  patterns: [
    /createHash\s*\(\s*['"](?:md5|sha1)['"]/i,
    /hashlib\.(?:md5|sha1)\s*\(/,
    /MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/i,
    /Cipher\.getInstance\s*\(\s*"[^"]*\/ECB\//i,
    /\bAES\.MODE_ECB\b/,
    /\bDES(?:ede)?\b\s*\(/,
    /\bRC4\b/,
    // A predictable RNG used for anything that must be unguessable.
    /Math\.random\s*\(\s*\)[^\n]{0,60}\b(?:token|secret|key|password|nonce|salt|session)\b/i,
    /\b(?:token|secret|key|password|nonce|salt|session)\b[^\n]{0,60}Math\.random\s*\(\s*\)/i,
    /\brandom\.(?:random|randint|choice)\s*\([^\n]{0,60}\b(?:token|secret|key|password|salt)\b/i,
  ],
  exceptions: [
    // Python's own marker for "this digest is not security-relevant". Found on
    // requests' HTTPDigestAuth, where RFC 7616 mandates MD5 and the author had
    // already annotated exactly what this rule was asking about.
    /usedforsecurity\s*=\s*False/,
    // Same intent in other ecosystems.
    /nosec|#\s*noqa:\s*S324|lgtm\[py\/weak-sensitive-data-hashing\]/,
  ],
  message:
    'A broken or predictable cryptographic primitive was introduced. MD5 and SHA-1 are not ' +
    'collision-resistant, ECB leaks plaintext structure, and general-purpose RNGs are predictable.',
  remediation:
    'Use SHA-256 or better for digests, an authenticated mode such as GCM for ciphers, and a CSPRNG ' +
    '(crypto.randomUUID, secrets, crypto/rand) for anything secret.',
  appliesTo: (p) => isSourcePath(p) && !isTestPath(p),
});

/**
 * Requires both a SQL verb and an interpolation on the same line. Matching
 * either alone would flag every ORM call and every template string in the
 * codebase.
 */
export const SqlInjectionRule = defineLineRule({
  id: 'sql-injection',
  title: 'Query built by string interpolation',
  severity: 'high',
  confidence: 0.75,
  patterns: [
    /`[^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE)\b[^`]*\$\{/i,
    /f['"][^'"]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE)\b[^'"]*\{/i,
    /['"][^'"]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE)\b[^'"]*['"]\s*(?:\+|\.|%)\s*\w/i,
    /\.(?:query|execute|exec|raw)\s*\(\s*['"`][^'"`]*['"`]\s*\+/,
    /cursor\.execute\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*%)/,
  ],
  exceptions: [
    // Parameterised queries are the fix, not the problem.
    /\?\s*['"`]\s*,|\$\d+|:\w+\s*['"`]\s*,/,
  ],
  message:
    'A SQL statement is assembled from interpolated values. If any part reaches this from user ' +
    'input, the query can be rewritten by the caller.',
  remediation: 'Use parameterised queries or the ORM query builder rather than string assembly.',
  appliesTo: (p) => isSourcePath(p) && !isTestPath(p),
});

export const CommandInjectionRule = defineLineRule({
  id: 'command-injection',
  title: 'Shell invoked with interpolated input',
  severity: 'high',
  confidence: 0.8,
  patterns: [
    /subprocess\.(?:run|call|check_call|check_output|Popen)\s*\([^)]*shell\s*=\s*True/,
    /os\.system\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*[+%])/,
    /os\.popen\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*[+%])/,
    /\bexecSync\s*\(\s*`[^`]*\$\{/,
    /\bexec\s*\(\s*['"][^'"]*['"]\s*\+/,
    /Runtime\.getRuntime\s*\(\s*\)\.exec\s*\([^)]*\+/,
    /\bsystem\s*\(\s*"[^"]*"\s*\.\s*\$/,
    /\bshell_exec\s*\(\s*\$/,
  ],
  message:
    'A shell command is built from interpolated values. Any shell metacharacter in the ' +
    'interpolated part becomes executable.',
  remediation:
    'Pass the command and its arguments as an array without a shell, or escape the arguments ' +
    'explicitly.',
  appliesTo: (p) => isSourcePath(p) && !isTestPath(p),
});

export const PermissiveAccessRule = defineLineRule({
  id: 'permissive-access',
  title: 'Access control widened to allow all',
  severity: 'medium',
  confidence: 0.8,
  patterns: [
    /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*/i,
    /\borigin\s*:\s*['"]\*['"]/,
    /\bcors\s*\(\s*\)\s*[,)]/,
    /chmod\s+(?:-R\s+)?0?777\b/,
    /os\.chmod\s*\([^,]+,\s*0o?777/,
    /["']Principal["']\s*:\s*["']\*["']/,
    /["']Action["']\s*:\s*["']\*["']/,
    /\bAllowAnonymous\b/,
    /\bpermitAll\s*\(\s*\)/,
    /cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']/,
  ],
  message:
    'A permission boundary was widened to allow everything. Wildcard origins, world-writable ' +
    'files, and open CIDR ranges remove a control rather than satisfy it.',
  remediation: 'Enumerate the specific origins, principals, or ranges that actually need access.',
  appliesTo: (p) => isSourcePath(p) && !isTestPath(p),
});
