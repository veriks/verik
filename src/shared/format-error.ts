import { VerikError } from './errors.js';

/**
 * The message a user should see for a thrown value.
 *
 * `String(err)` on an Error yields "ClassName: message", so the CLI's
 * `console.error('Error:', String(err))` rendered as
 * "Error: VerikError: Not a Git repository" — the class name is an
 * implementation detail and the doubled prefix reads like a bug.
 */
export function formatError(err: unknown): string {
  if (err instanceof VerikError) return err.message;
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Exit code carried by the error, or 1. */
export function exitCodeFor(err: unknown): number {
  return err instanceof VerikError ? err.exitCode : 1;
}
