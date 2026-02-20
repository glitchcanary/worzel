import { type InboundMessage, InboundMessageSchema } from './types.js';
import { safeJsonParse, JsonSizeError, JsonParseError } from '../utils/safe-json.js';

export type ValidationResult =
  | { ok: true; message: InboundMessage }
  | { ok: false; error: string; code: string };

/**
 * Validate an inbound text message.
 * 1. Size check via safeJsonParse
 * 2. JSON parse
 * 3. Zod schema validation
 */
export function validateMessage(raw: string): ValidationResult {
  // Parse JSON with size limit
  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    if (err instanceof JsonSizeError) {
      return { ok: false, error: 'Message too large', code: 'SIZE_EXCEEDED' };
    }
    if (err instanceof JsonParseError) {
      return { ok: false, error: 'Invalid JSON', code: 'INVALID_JSON' };
    }
    return { ok: false, error: 'Parse error', code: 'PARSE_ERROR' };
  }

  // Validate against protocol schema
  const result = InboundMessageSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: `Invalid message: ${issues}`, code: 'SCHEMA_ERROR' };
  }

  return { ok: true, message: result.data };
}
