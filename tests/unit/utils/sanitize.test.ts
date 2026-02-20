import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  sanitizeDeviceId,
  stripThinkTags,
} from '../../../src/utils/sanitize.js';

describe('sanitizeText', () => {
  it('returns clean text unchanged', () => {
    expect(sanitizeText('Hello, world!')).toBe('Hello, world!');
  });

  it('normalizes Unicode to NFC', () => {
    // é as e + combining accent vs precomposed
    const decomposed = 'e\u0301'; // e + combining acute
    const composed = '\u00e9'; // precomposed é
    expect(sanitizeText(decomposed)).toBe(composed);
  });

  it('strips control characters', () => {
    expect(sanitizeText('hello\x00world')).toBe('helloworld');
    expect(sanitizeText('hello\x01\x02\x03world')).toBe('helloworld');
    expect(sanitizeText('hello\x7Fworld')).toBe('helloworld');
  });

  it('strips zero-width characters (prompt injection defense)', () => {
    // Zero-width space
    expect(sanitizeText('hello\u200Bworld')).toBe('helloworld');
    // Zero-width non-joiner
    expect(sanitizeText('hello\u200Cworld')).toBe('helloworld');
    // Zero-width joiner
    expect(sanitizeText('hello\u200Dworld')).toBe('helloworld');
    // BOM
    expect(sanitizeText('hello\uFEFFworld')).toBe('helloworld');
  });

  it('strips line/paragraph separators', () => {
    expect(sanitizeText('hello\u2028world')).toBe('helloworld');
    expect(sanitizeText('hello\u2029world')).toBe('helloworld');
  });

  it('preserves normal whitespace', () => {
    expect(sanitizeText('hello world')).toBe('hello world');
    expect(sanitizeText('hello\tworld')).toBe('hello\tworld');
    expect(sanitizeText('hello\nworld')).toBe('hello\nworld');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('enforces length limit', () => {
    const long = 'a'.repeat(20_000);
    const result = sanitizeText(long);
    expect(result.length).toBe(10_000);
  });

  it('respects custom length limit', () => {
    const result = sanitizeText('hello world', 5);
    expect(result).toBe('hello');
  });

  it('handles empty/non-string input', () => {
    expect(sanitizeText('')).toBe('');
    expect(sanitizeText(null as unknown as string)).toBe('');
    expect(sanitizeText(123 as unknown as string)).toBe('');
  });
});

describe('sanitizeDeviceId', () => {
  it('accepts valid device IDs', () => {
    expect(sanitizeDeviceId('device-001')).toBe('device-001');
    expect(sanitizeDeviceId('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
    expect(sanitizeDeviceId('esp32_board.v2')).toBe('esp32_board.v2');
  });

  it('rejects empty IDs', () => {
    expect(sanitizeDeviceId('')).toBeNull();
  });

  it('rejects IDs with special characters', () => {
    expect(sanitizeDeviceId('device<script>')).toBeNull();
    expect(sanitizeDeviceId('device;rm -rf /')).toBeNull();
    expect(sanitizeDeviceId('device\x00id')).toBeNull();
  });

  it('rejects overly long IDs', () => {
    expect(sanitizeDeviceId('a'.repeat(200))).toBeNull();
  });

  it('handles non-string input', () => {
    expect(sanitizeDeviceId(null as unknown as string)).toBeNull();
  });
});

describe('stripThinkTags', () => {
  it('strips think tags', () => {
    expect(stripThinkTags('<think>reasoning here</think>Hello!')).toBe('Hello!');
  });

  it('strips multiline think tags', () => {
    const input = '<think>\nStep 1: consider\nStep 2: decide\n</think>The answer is 42.';
    expect(stripThinkTags(input)).toBe('The answer is 42.');
  });

  it('strips multiple think tags', () => {
    const input = '<think>first</think>Hello <think>second</think>world';
    expect(stripThinkTags(input)).toBe('Hello world');
  });

  it('leaves text without think tags unchanged', () => {
    expect(stripThinkTags('No thinking here')).toBe('No thinking here');
  });
});
