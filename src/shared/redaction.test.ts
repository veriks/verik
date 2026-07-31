import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../shared/redaction.js';

describe('redactSecrets', () => {
  it('redacts API key patterns', () => {
    const text = 'api_key = "sk-abcdef1234567890abcdef1234567890"';
    const result = redactSecrets(text);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abcdef');
  });

  it('leaves short values alone', () => {
    const text = 'name = "alice"';
    expect(redactSecrets(text)).toBe(text);
  });

  it('passes through clean text', () => {
    const text = 'const x = 1 + 2;';
    expect(redactSecrets(text)).toBe(text);
  });
});
