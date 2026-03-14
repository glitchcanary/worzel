import { describe, expect, it } from 'vitest';
import { VoiceResolver } from '../../../src/ink/voice-resolver.js';

describe('VoiceResolver', () => {
  it('prefers provider-specific tag overrides', () => {
    const resolver = new VoiceResolver({ provider: 'elevenlabs' });
    const resolved = resolver.resolve('munrab', { elevenlabs: 'Bill' }, {
      providers: { elevenlabs: 'Marcus' },
    });
    expect(resolved).toBe('Bill');
  });

  it('uses story voice profile mappings', () => {
    const resolver = new VoiceResolver({ provider: 'elevenlabs' });
    const resolved = resolver.resolve('munrab', undefined, {
      providers: { elevenlabs: 'Bill', openai: 'ballad' },
    });
    expect(resolved).toBe('Bill');
  });

  it('falls back to alias mapping for legacy voice ids', () => {
    const resolver = new VoiceResolver({
      provider: 'elevenlabs',
      aliases: { alloy: 'Marcus' },
    });
    const resolved = resolver.resolve('alloy');
    expect(resolved).toBe('Marcus');
  });

  it('falls back to the raw voice name when no mapping exists', () => {
    const resolver = new VoiceResolver({ provider: 'openai' });
    const resolved = resolver.resolve('ballad');
    expect(resolved).toBe('ballad');
  });
});
