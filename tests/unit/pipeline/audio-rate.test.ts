import { describe, it, expect } from 'vitest';
import { AudioRateController } from '../../../src/pipeline/audio-rate-controller.js';

describe('AudioRateController', () => {
  it('sends first 5 packets immediately (delay = 0)', () => {
    const controller = new AudioRateController();
    for (let i = 0; i < 5; i++) {
      expect(controller.getDelay()).toBe(0);
    }
  });

  it('delays subsequent packets by 60ms', () => {
    const controller = new AudioRateController();
    // Burn through the immediate ones
    for (let i = 0; i < 5; i++) controller.getDelay();
    // Now should be 60ms
    expect(controller.getDelay()).toBe(60);
    expect(controller.getDelay()).toBe(60);
  });

  it('respects custom immediate count and interval', () => {
    const controller = new AudioRateController({ immediateCount: 3, intervalMs: 100 });
    expect(controller.getDelay()).toBe(0);
    expect(controller.getDelay()).toBe(0);
    expect(controller.getDelay()).toBe(0);
    expect(controller.getDelay()).toBe(100);
  });

  it('resets for new TTS response', () => {
    const controller = new AudioRateController();
    for (let i = 0; i < 10; i++) controller.getDelay();
    controller.reset();
    // Should be back to immediate
    expect(controller.getDelay()).toBe(0);
  });

  it('pacePackets yields with correct timing', async () => {
    const controller = new AudioRateController({ immediateCount: 2, intervalMs: 10 });
    const packets = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];

    async function* generate() {
      for (const p of packets) yield p;
    }

    const results: Buffer[] = [];
    const start = Date.now();
    for await (const packet of controller.pacePackets(generate())) {
      results.push(packet);
    }
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(3);
    // First 2 are immediate, third has 10ms delay
    expect(elapsed).toBeGreaterThanOrEqual(5); // At least some delay
  });

  it('pacePackets respects abort signal', async () => {
    const controller = new AudioRateController({ immediateCount: 1, intervalMs: 1000 });
    const abortController = new AbortController();

    async function* generate() {
      yield Buffer.from('a');
      yield Buffer.from('b'); // This should be yielded but then abort during delay for 'c'
      yield Buffer.from('c');
    }

    const results: Buffer[] = [];

    // Abort after a short delay
    setTimeout(() => abortController.abort(), 50);

    try {
      for await (const packet of controller.pacePackets(generate(), abortController.signal)) {
        results.push(packet);
      }
    } catch {
      // AbortError expected
    }

    // Should have gotten at least the first packet
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThan(3);
  });
});
