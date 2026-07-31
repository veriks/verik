/**
 * Terminal bridge: passes through TTY capabilities (colors, interactive mode)
 * from the parent process to the child subprocess.
 */
export function isTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function isColorSupported(): boolean {
  return isTty() && !process.env['NO_COLOR'];
}

export function getTerminalColumns(): number {
  return process.stdout.columns ?? 80;
}
