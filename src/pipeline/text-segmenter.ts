/**
 * Text segmenter for streaming TTS.
 *
 * Strategy from original codebase:
 * - First sentence: split at commas for low latency (get TTS started ASAP)
 * - Subsequent sentences: split at sentence-end punctuation
 * - Strip <think>...</think> tags from reasoning models
 */

export interface TextSegmenterOptions {
  /** Minimum characters before flushing a segment */
  minLength?: number;
  /** Maximum characters before forcing a flush */
  maxLength?: number;
}

export class TextSegmenter {
  private buffer = '';
  private segmentCount = 0;
  private readonly minLength: number;
  private readonly maxLength: number;

  constructor(options?: TextSegmenterOptions) {
    this.minLength = options?.minLength ?? 10;
    this.maxLength = options?.maxLength ?? 200;
  }

  /**
   * Feed text into the segmenter.
   * Returns any complete segments ready for TTS.
   */
  push(text: string): string[] {
    if (!text) return [];

    this.buffer += text;
    const segments: string[] = [];

    while (this.buffer.length > 0) {
      const segment = this.extractSegment();
      if (!segment) break;
      segments.push(segment);
      this.segmentCount++;
    }

    return segments;
  }

  /**
   * Flush any remaining buffered text as a final segment.
   */
  flush(): string | null {
    const text = this.buffer.trim();
    this.buffer = '';
    return text.length > 0 ? text : null;
  }

  /** Reset state for a new utterance */
  reset(): void {
    this.buffer = '';
    this.segmentCount = 0;
  }

  private extractSegment(): string | null {
    // For the first segment, split at commas for low latency
    const splitChars = this.segmentCount === 0
      ? /[,，;；:：。.!！?？\n]/
      : /[。.!！?？\n]/;

    const match = splitChars.exec(this.buffer);

    if (match && match.index !== undefined) {
      const endIdx = match.index + match[0].length;
      const segment = this.buffer.slice(0, endIdx).trimStart();
      this.buffer = this.buffer.slice(endIdx);

      // Only return segments that meet minimum length
      if (segment.length >= this.minLength) {
        return segment;
      }
      // Too short — put it back and wait for more
      this.buffer = segment + this.buffer;
      return null;
    }

    // Force flush if buffer exceeds max length
    if (this.buffer.length >= this.maxLength) {
      // Try to split at a word boundary
      const spaceIdx = this.buffer.lastIndexOf(' ', this.maxLength);
      const splitAt = spaceIdx > this.minLength ? spaceIdx + 1 : this.maxLength;
      const segment = this.buffer.slice(0, splitAt).trimStart();
      this.buffer = this.buffer.slice(splitAt);
      return segment;
    }

    return null;
  }
}
