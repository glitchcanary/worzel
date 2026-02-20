/**
 * Safe JSON parsing with size limits.
 * Prevents DoS via large JSON payloads.
 */

/** Default maximum JSON string size: 1MB */
const DEFAULT_MAX_SIZE = 1_048_576;

export class JsonSizeError extends Error {
  constructor(size: number, maxSize: number) {
    super(`JSON payload too large: ${size} bytes (max: ${maxSize})`);
    this.name = 'JsonSizeError';
  }
}

export class JsonParseError extends Error {
  constructor(message: string) {
    super(`JSON parse error: ${message}`);
    this.name = 'JsonParseError';
  }
}

/**
 * Parse JSON with a size limit.
 * Returns the parsed value or throws JsonSizeError/JsonParseError.
 */
export function safeJsonParse(input: string, maxSize: number = DEFAULT_MAX_SIZE): unknown {
  if (input.length > maxSize) {
    throw new JsonSizeError(input.length, maxSize);
  }

  try {
    return JSON.parse(input);
  } catch (err) {
    throw new JsonParseError((err as Error).message);
  }
}
