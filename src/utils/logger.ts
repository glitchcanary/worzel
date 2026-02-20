import pino from 'pino';

/** Patterns that indicate a value should be redacted */
const SECRET_KEYS = new Set([
  'secret', 'password', 'apiKey', 'api_key', 'token',
  'authorization', 'cookie', 'x-api-key',
]);

/**
 * Redact sensitive values from log objects.
 * Replaces values for keys matching SECRET_KEYS with '[REDACTED]'.
 */
function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a logger instance with secret redaction.
 */
export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    formatters: {
      log(obj: Record<string, unknown>) {
        return redactSecrets(obj);
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      req(req: Record<string, unknown>) {
        return {
          method: req['method'],
          url: req['url'],
          remoteAddress: req['remoteAddress'],
        };
      },
    },
  });
}
