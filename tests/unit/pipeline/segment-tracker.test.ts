import { describe, it, expect } from 'vitest';
import { SegmentTracker } from '../../../src/pipeline/segment-tracker.js';

describe('SegmentTracker', () => {
  it('adds fast segments in pending state', () => {
    const tracker = new SegmentTracker();
    const idx = tracker.addFastSegment('Hello world.');
    expect(idx).toBe(0);
    expect(tracker.count).toBe(1);
    const segs = tracker.getAll();
    expect(segs[0]!.state).toBe('pending');
    expect(segs[0]!.fastText).toBe('Hello world.');
    expect(segs[0]!.source).toBe('fast');
  });

  it('assigns sequential indices', () => {
    const tracker = new SegmentTracker();
    expect(tracker.addFastSegment('one')).toBe(0);
    expect(tracker.addFastSegment('two')).toBe(1);
    expect(tracker.addFastSegment('three')).toBe(2);
    expect(tracker.count).toBe(3);
  });

  it('tryReplace succeeds on pending segments', () => {
    const tracker = new SegmentTracker();
    tracker.addFastSegment('Hello world.');
    const replaced = tracker.tryReplace(0, 'Hi there!');
    expect(replaced).toBe(true);
    expect(tracker.getEffectiveText(0)).toBe('Hi there!');
    expect(tracker.getSource(0)).toBe('smart');
  });

  it('tryReplace fails on non-pending segments', () => {
    const tracker = new SegmentTracker();
    tracker.addFastSegment('Hello world.');
    tracker.advance(0, 'tts_started');
    const replaced = tracker.tryReplace(0, 'Hi there!');
    expect(replaced).toBe(false);
    expect(tracker.getEffectiveText(0)).toBe('Hello world.');
    expect(tracker.getSource(0)).toBe('fast');
  });

  it('tryReplace fails on invalid index', () => {
    const tracker = new SegmentTracker();
    expect(tracker.tryReplace(99, 'nope')).toBe(false);
  });

  it('getEffectiveText returns fast text when no replacement', () => {
    const tracker = new SegmentTracker();
    tracker.addFastSegment('original');
    expect(tracker.getEffectiveText(0)).toBe('original');
  });

  it('getEffectiveText returns undefined for invalid index', () => {
    const tracker = new SegmentTracker();
    expect(tracker.getEffectiveText(5)).toBeUndefined();
  });

  it('advances through state transitions', () => {
    const tracker = new SegmentTracker();
    tracker.addFastSegment('test');
    expect(tracker.getAll()[0]!.state).toBe('pending');

    tracker.advance(0, 'tts_started');
    expect(tracker.getAll()[0]!.state).toBe('tts_started');

    tracker.advance(0, 'audio_sent');
    expect(tracker.getAll()[0]!.state).toBe('audio_sent');

    tracker.advance(0, 'committed');
    expect(tracker.getAll()[0]!.state).toBe('committed');
  });

  it('getCommittedDisagreements returns diffs for committed fast segments with smart text', () => {
    const tracker = new SegmentTracker();

    // Segment 0: replaced before TTS (source=smart, no disagreement)
    tracker.addFastSegment('fast text 0');
    tracker.tryReplace(0, 'smart text 0');
    tracker.advance(0, 'committed');

    // Segment 1: committed as fast, then smart text set externally (simulated)
    tracker.addFastSegment('fast text 1');
    tracker.advance(1, 'tts_started'); // too late to replace
    tracker.advance(1, 'committed');
    // Simulate: smart text assigned after commit (tracker won't do this normally,
    // but we test the disagreement detection)
    const seg1 = tracker.getAll()[1]!;
    (seg1 as { smartText: string }).smartText = 'different smart text';

    expect(tracker.getCommittedDisagreements()).toEqual(['different smart text']);
  });

  it('getCommittedDisagreements ignores matching smart text', () => {
    const tracker = new SegmentTracker();
    tracker.addFastSegment('same text');
    tracker.advance(0, 'committed');
    const seg = tracker.getAll()[0]!;
    (seg as { smartText: string }).smartText = 'same text';
    expect(tracker.getCommittedDisagreements()).toEqual([]);
  });
});
