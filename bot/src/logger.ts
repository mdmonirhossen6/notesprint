import type { LogLevel } from './config.js';

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>, error?: unknown): void;
  error(event: string, fields?: Record<string, unknown>, error?: unknown): void;
}

function stringifyError(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  function write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (WEIGHT[level] < WEIGHT[minLevel]) return;
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
    if (level === 'error') console.error(record);
    else if (level === 'warn') console.warn(record);
    else console.log(record);
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields, error) => write('warn', event, { ...fields, error: stringifyError(error) }),
    error: (event, fields, error) => write('error', event, { ...fields, error: stringifyError(error) }),
  };
}
