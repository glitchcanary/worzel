/**
 * Tracks text segments through the TTS pipeline, enabling the smart LLM
 * to replace segments that haven't been spoken yet.
 *
 * State machine: pending → tts_started → audio_sent → committed
 * Only segments in 'pending' state can be replaced by the smart LLM.
 */

export type SegmentState = 'pending' | 'tts_started' | 'audio_sent' | 'committed';

export interface TrackedSegment {
  index: number;
  fastText: string;
  smartText?: string;
  state: SegmentState;
  source: 'fast' | 'smart';
}

export class SegmentTracker {
  private segments: TrackedSegment[] = [];

  /** Add a segment from the fast LLM. Returns its index. */
  addFastSegment(text: string): number {
    const index = this.segments.length;
    this.segments.push({
      index,
      fastText: text,
      state: 'pending',
      source: 'fast',
    });
    return index;
  }

  /**
   * Try to replace a segment with smart LLM text.
   * Only succeeds if the segment is still in 'pending' state.
   * Returns true if replaced.
   */
  tryReplace(index: number, smartText: string): boolean {
    const seg = this.segments[index];
    if (!seg || seg.state !== 'pending') return false;
    seg.smartText = smartText;
    seg.source = 'smart';
    return true;
  }

  /** Get the effective text for a segment (smart replacement if available, otherwise fast). */
  getEffectiveText(index: number): string | undefined {
    const seg = this.segments[index];
    if (!seg) return undefined;
    return seg.source === 'smart' && seg.smartText != null ? seg.smartText : seg.fastText;
  }

  /** Get the source ('fast' or 'smart') for a segment. */
  getSource(index: number): 'fast' | 'smart' | undefined {
    return this.segments[index]?.source;
  }

  /** Advance a segment's state. */
  advance(index: number, to: SegmentState): void {
    const seg = this.segments[index];
    if (seg) seg.state = to;
  }

  /** Get all segments. */
  getAll(): readonly TrackedSegment[] {
    return this.segments;
  }

  /** Number of tracked segments. */
  get count(): number {
    return this.segments.length;
  }

  /**
   * Find segments that were already spoken (committed) with fast text
   * but the smart LLM disagrees. Returns the smart texts for correction.
   */
  getCommittedDisagreements(): string[] {
    return this.segments
      .filter(s => s.state === 'committed' && s.smartText != null && s.smartText !== s.fastText && s.source === 'fast')
      .map(s => s.smartText!);
  }
}
