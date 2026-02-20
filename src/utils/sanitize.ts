/**
 * Input sanitization utilities.
 *
 * Defends against prompt injection, control character attacks,
 * homoglyph attacks, and oversized inputs.
 */

/** Maximum allowed length for text messages */
const MAX_TEXT_LENGTH = 10_000;

/** Maximum allowed length for device IDs */
const MAX_DEVICE_ID_LENGTH = 128;

/**
 * Control characters to strip (C0/C1 except tab, newline, carriage return).
 * Includes zero-width characters used in prompt injection.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u2028-\u202F\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Normalize and sanitize text input.
 * - Unicode NFC normalization
 * - Strip control characters and zero-width characters
 * - Trim whitespace
 * - Enforce length limit
 */
export function sanitizeText(input: string, maxLength: number = MAX_TEXT_LENGTH): string {
  if (typeof input !== 'string') return '';

  // NFC normalize to canonical form
  let result = input.normalize('NFC');

  // Strip control characters
  result = result.replace(CONTROL_CHAR_REGEX, '');

  // Trim whitespace
  result = result.trim();

  // Enforce length limit
  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  return result;
}

/**
 * Sanitize and validate a device ID.
 * Only allows alphanumeric, hyphens, underscores, colons, and dots.
 */
export function sanitizeDeviceId(input: string): string | null {
  if (typeof input !== 'string') return null;

  const sanitized = input.normalize('NFC').trim();

  if (sanitized.length === 0 || sanitized.length > MAX_DEVICE_ID_LENGTH) return null;

  // Strict character allowlist for device IDs
  if (!/^[a-zA-Z0-9\-_:.]+$/.test(sanitized)) return null;

  return sanitized;
}

/**
 * Strip <think>...</think> tags from LLM output (used by reasoning models).
 * These should not be sent to TTS.
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '');
}
