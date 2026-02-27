import { describe, it, expect } from 'vitest';
import { parseTags, mergeTags } from '../../../src/ink/ink-tags.js';

describe('parseTags', () => {
  it('parses speaker tag', () => {
    const result = parseTags(['speaker:narrator']);
    expect(result.speaker).toBe('narrator');
  });

  it('parses voice tag', () => {
    const result = parseTags(['voice:alloy']);
    expect(result.voice).toBe('alloy');
  });

  it('parses mood tag', () => {
    const result = parseTags(['mood:mysterious']);
    expect(result.mood).toBe('mysterious');
  });

  it('parses voice hints into array', () => {
    const result = parseTags(['voice_hint:open gate, push gate, go through']);
    expect(result.voiceHints).toEqual(['open gate', 'push gate', 'go through']);
  });

  it('parses foaf tags', () => {
    const result = parseTags(['foaf:name:The Keeper', 'foaf:knows:protagonist']);
    expect(result.foaf['name']).toBe('The Keeper');
    expect(result.foaf['knows']).toBe('protagonist');
  });

  it('parses input mode', () => {
    const result = parseTags(['input:freeform']);
    expect(result.inputMode).toBe('freeform');
  });

  it('parses pause duration', () => {
    const result = parseTags(['pause:2000']);
    expect(result.pauseMs).toBe(2000);
  });

  it('handles mixed tags', () => {
    const result = parseTags([
      'speaker:cat',
      'voice:shimmer',
      'mood:curious',
      'foaf:name:Mr Whiskers',
      'voice_hint:hello cat, greet',
    ]);
    expect(result.speaker).toBe('cat');
    expect(result.voice).toBe('shimmer');
    expect(result.mood).toBe('curious');
    expect(result.foaf['name']).toBe('Mr Whiskers');
    expect(result.voiceHints).toEqual(['hello cat', 'greet']);
  });

  it('handles empty tags array', () => {
    const result = parseTags([]);
    expect(result.speaker).toBeUndefined();
    expect(result.foaf).toEqual({});
    expect(result.raw).toEqual([]);
  });

  it('skips tags without colons', () => {
    const result = parseTags(['just a plain tag']);
    expect(result.speaker).toBeUndefined();
    expect(result.raw).toEqual(['just a plain tag']);
  });

  it('is case-insensitive for keys', () => {
    const result = parseTags(['Speaker:Bob', 'VOICE:echo']);
    expect(result.speaker).toBe('Bob');
    expect(result.voice).toBe('echo');
  });

  it('preserves raw tags', () => {
    const tags = ['speaker:narrator', 'unknown:tag', 'foaf:name:Test'];
    const result = parseTags(tags);
    expect(result.raw).toEqual(tags);
  });
});

describe('mergeTags', () => {
  it('overrides with incoming values', () => {
    const a = parseTags(['speaker:narrator', 'voice:alloy']);
    const b = parseTags(['speaker:cat', 'mood:curious']);
    const merged = mergeTags(a, b);
    expect(merged.speaker).toBe('cat');
    expect(merged.voice).toBe('alloy');  // retained from a
    expect(merged.mood).toBe('curious');  // new from b
  });

  it('merges foaf data', () => {
    const a = parseTags(['foaf:name:Test']);
    const b = parseTags(['foaf:knows:other']);
    const merged = mergeTags(a, b);
    expect(merged.foaf['name']).toBe('Test');
    expect(merged.foaf['knows']).toBe('other');
  });
});
