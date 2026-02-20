import { describe, it, expect } from 'vitest';
import { TextSegmenter } from '../../../src/pipeline/text-segmenter.js';

describe('TextSegmenter', () => {
  it('segments at commas for first segment (low latency)', () => {
    const seg = new TextSegmenter({ minLength: 5 });
    const result = seg.push('Hello there, how are you doing today?');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe('Hello there,');
  });

  it('segments at sentence boundaries for subsequent segments', () => {
    const seg = new TextSegmenter({ minLength: 5 });
    // First segment uses commas
    seg.push('First part, ');
    // Subsequent segments use sentence punctuation
    const result = seg.push('second part. Third part.');
    expect(result.some(s => s.includes('.'))).toBe(true);
  });

  it('handles period-terminated sentences', () => {
    const seg = new TextSegmenter({ minLength: 5 });
    seg.push('First, '); // flush first segment
    const result = seg.push('This is a sentence. This is another.');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles question marks and exclamation marks', () => {
    const seg = new TextSegmenter({ minLength: 5 });
    seg.push('Hello, '); // flush first
    const result = seg.push('How are you? I am fine!');
    expect(result.length).toBeGreaterThan(0);
  });

  it('flushes remaining text', () => {
    const seg = new TextSegmenter();
    seg.push('incomplete');
    const remaining = seg.flush();
    expect(remaining).toBe('incomplete');
  });

  it('returns null for empty flush', () => {
    const seg = new TextSegmenter();
    expect(seg.flush()).toBeNull();
  });

  it('passes through text as-is (think-tag stripping is done upstream in pipeline)', () => {
    const seg = new TextSegmenter({ minLength: 3 });
    // Segmenter no longer strips think tags — the pipeline calls stripThinkTags before push()
    const result = seg.push('Hello, world.');
    const flushed = seg.flush();
    const allText = [...result, flushed].filter(Boolean).join('');
    expect(allText).toContain('Hello');
  });

  it('handles empty/whitespace input', () => {
    const seg = new TextSegmenter();
    expect(seg.push('')).toEqual([]);
    expect(seg.push('   ')).toEqual([]);
  });

  it('respects minimum length', () => {
    const seg = new TextSegmenter({ minLength: 20 });
    const result = seg.push('Hi, world.');
    // Short text should not be segmented
    expect(result).toEqual([]);
    // But flush should return it
    expect(seg.flush()).toBe('Hi, world.');
  });

  it('forces split at max length', () => {
    const seg = new TextSegmenter({ minLength: 5, maxLength: 50 });
    const longText = 'a '.repeat(40); // 80 chars, no punctuation
    const result = seg.push(longText);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(s => {
      expect(s.length).toBeLessThanOrEqual(50);
    });
  });

  it('resets state correctly', () => {
    const seg = new TextSegmenter({ minLength: 3 });
    seg.push('Some text, here.');
    seg.reset();
    expect(seg.flush()).toBeNull();
    // After reset, first segment should split at commas again
    const result = seg.push('New text, after reset.');
    expect(result.some(s => s.includes(','))).toBe(true);
  });
});
