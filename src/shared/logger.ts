export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (verboseEnabled) {
      console.error(`[debug] ${message}`, ...args);
    }
  },
  info(message: string, ...args: unknown[]): void {
    if (verboseEnabled) {
      console.error(`[info] ${message}`, ...args);
    }
  },
  warn(message: string, ...args: unknown[]): void {
    console.error(`[warn] ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    console.error(`[error] ${message}`, ...args);
  },
};
