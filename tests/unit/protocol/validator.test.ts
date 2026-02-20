import { describe, it, expect } from 'vitest';
import { validateMessage } from '../../../src/protocol/validator.js';

describe('validateMessage', () => {
  // --- Valid messages ---

  it('validates a hello message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'hello',
      version: 1,
      transport: 'websocket',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
      features: ['tts', 'stt'],
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('hello');
    }
  });

  it('validates a minimal hello message', () => {
    const result = validateMessage(JSON.stringify({ type: 'hello' }));
    expect(result.ok).toBe(true);
  });

  it('validates a listen start message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'listen',
      state: 'start',
      mode: 'manual',
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('listen');
    }
  });

  it('validates a listen stop message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'listen',
      state: 'stop',
    }));
    expect(result.ok).toBe(true);
  });

  it('validates a listen detect message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'listen',
      state: 'detect',
    }));
    expect(result.ok).toBe(true);
  });

  it('validates an abort message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'abort',
      reason: 'user_interrupt',
    }));
    expect(result.ok).toBe(true);
  });

  it('validates a ping message', () => {
    const result = validateMessage(JSON.stringify({ type: 'ping' }));
    expect(result.ok).toBe(true);
  });

  it('validates a goodbye message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'goodbye',
      reason: 'user_disconnect',
    }));
    expect(result.ok).toBe(true);
  });

  it('validates an IoT message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'iot',
      descriptors: [{
        name: 'light',
        description: 'Living room light',
        properties: { brightness: 100 },
        methods: [{ name: 'toggle', description: 'Toggle light on/off' }],
      }],
    }));
    expect(result.ok).toBe(true);
  });

  it('validates an MCP message', () => {
    const result = validateMessage(JSON.stringify({
      type: 'mcp',
      method: 'tools/list',
      id: 1,
      params: {},
    }));
    expect(result.ok).toBe(true);
  });

  // --- Invalid messages ---

  it('rejects invalid JSON', () => {
    const result = validateMessage('not json at all{{{');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_JSON');
    }
  });

  it('rejects unknown message type', () => {
    const result = validateMessage(JSON.stringify({ type: 'unknown_type' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SCHEMA_ERROR');
    }
  });

  it('rejects message without type', () => {
    const result = validateMessage(JSON.stringify({ data: 'no type field' }));
    expect(result.ok).toBe(false);
  });

  it('rejects listen with invalid state', () => {
    const result = validateMessage(JSON.stringify({
      type: 'listen',
      state: 'invalid_state',
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects hello with invalid transport', () => {
    const result = validateMessage(JSON.stringify({
      type: 'hello',
      transport: 'tcp',
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects oversized messages', () => {
    const huge = JSON.stringify({ type: 'ping', data: 'x'.repeat(2_000_000) });
    const result = validateMessage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SIZE_EXCEEDED');
    }
  });

  it('rejects empty string', () => {
    const result = validateMessage('');
    expect(result.ok).toBe(false);
  });

  it('rejects null/array JSON', () => {
    const result = validateMessage('null');
    expect(result.ok).toBe(false);

    const result2 = validateMessage('[]');
    expect(result2.ok).toBe(false);
  });
});
