/**
 * Audio rate controller for TTS output.
 *
 * Strategy from original codebase:
 * - First 5 packets sent immediately (fill the buffer for smooth start)
 * - Subsequent packets spaced at 60ms intervals
 */

export class AudioRateController {
  private packetCount = 0;
  private readonly immediateCount: number;
  private readonly intervalMs: number;

  constructor(options?: { immediateCount?: number; intervalMs?: number }) {
    this.immediateCount = options?.immediateCount ?? 5;
    this.intervalMs = options?.intervalMs ?? 60;
  }

  /**
   * Returns the delay (ms) before sending the next packet.
   * 0 means send immediately.
   */
  getDelay(): number {
    this.packetCount++;
    if (this.packetCount <= this.immediateCount) {
      return 0;
    }
    return this.intervalMs;
  }

  /** Reset for a new TTS response */
  reset(): void {
    this.packetCount = 0;
  }

  /**
   * Schedule sending packets with appropriate delays.
   * Yields each packet with the correct timing.
   */
  async *pacePackets<T>(packets: AsyncIterable<T>, signal?: AbortSignal): AsyncIterable<T> {
    for await (const packet of packets) {
      if (signal?.aborted) break;
      const delay = this.getDelay();
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      yield packet;
    }
  }
}
