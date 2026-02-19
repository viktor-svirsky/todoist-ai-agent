type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (key, value) => {
      // Handle circular references
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      return value;
    });
  } catch {
    return '[Unable to stringify]';
  }
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const levelStr = `[${level.toUpperCase()}]`;
  const contextStr = context ? ` ${safeStringify(context)}` : '';
  return `${timestamp} ${levelStr} ${message}${contextStr}`;
}

export const logger = {
  info(message: string, context?: LogContext): void {
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context));
  },

  debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG) {
      console.log(formatLog('debug', message, context));
    }
  }
};
