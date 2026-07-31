const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password|passwd|pwd|auth)[=:\s"']+[^\s"',;{}[\]]{8,}/gi,
  /(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_|xox[baprs]-)[a-z0-9_-]{10,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END/gi,
  /[A-Za-z0-9+/]{40,}={0,2}/g,
];

const REDACTION_PLACEHOLDER = '[REDACTED]';
const MIN_ENTROPY_CANDIDATE_LENGTH = 20;

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length < MIN_ENTROPY_CANDIDATE_LENGTH) return match;
      return REDACTION_PLACEHOLDER;
    });
  }
  return result;
}

export function redactEnvironmentValues(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value ? REDACTION_PLACEHOLDER : '';
  }
  return result;
}
