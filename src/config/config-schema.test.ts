import { describe, it, expect } from 'vitest';
import { CrosscheckConfigSchema, PolicyConfigSchema } from '../config/config-schema.js';

describe('CrosscheckConfigSchema', () => {
  it('parses minimal config', () => {
    const result = CrosscheckConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('anthropic');
      expect(result.data.builder.enabled).toBe(true);
    }
  });

  it('rejects invalid version', () => {
    const result = CrosscheckConfigSchema.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });
});

describe('PolicyConfigSchema', () => {
  it('parses minimal policy', () => {
    const result = PolicyConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('advisory');
      expect(result.data.blockAtSeverity).toBe('high');
    }
  });

  it('parses blocking mode', () => {
    const result = PolicyConfigSchema.safeParse({ version: 1, mode: 'blocking' });
    expect(result.success).toBe(true);
  });
});
