/**
 * Ink tag parsing utilities.
 *
 * Ink tags are freeform strings after `#` on any line. We use a colon-delimited
 * convention for structured metadata:
 *
 *   # speaker:narrator
 *   # voice:alloy
 *   # mood:mysterious
 *   # foaf:name:The Keeper
 *   # foaf:knows:protagonist
 *   # voice_hint:open the gate, push the gate
 *   # input:freeform
 *   # pause:2000
 *   # FINK:story-id          (link to another story)
 */

export interface ParsedTags {
  speaker?: string;
  voice?: string;
  voiceDirectives?: Record<string, string>;
  mood?: string;
  voiceHints?: string[];
  inputMode?: 'freeform';
  pauseMs?: number;
  finkLink?: string;
  image?: string;
  basehref?: string;
  foaf: Record<string, string>;
  raw: string[];
}

/**
 * Parse an array of Ink tag strings into structured metadata.
 * Each tag is a freeform string (the text after `#`, trimmed by inkjs).
 */
export function parseTags(tags: string[]): ParsedTags {
  const result: ParsedTags = { foaf: {}, raw: tags };

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    // foaf: prefix gets special multi-part handling (foaf:name:The Keeper)
    if (trimmed.startsWith('foaf:')) {
      const rest = trimmed.slice(5);
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.slice(0, colonIdx).trim();
        const value = rest.slice(colonIdx + 1).trim();
        result.foaf[key] = value;
      }
      continue;
    }

    // Standard key:value tags
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key.startsWith('voice.')) {
      result.voiceDirectives ??= {};
      result.voiceDirectives[key.slice('voice.'.length)] = value;
      continue;
    }

    switch (key) {
      case 'speaker':
        result.speaker = value;
        break;
      case 'voice':
        result.voice = value;
        break;
      case 'mood':
        result.mood = value;
        break;
      case 'voice_hint':
        result.voiceHints = value.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
        break;
      case 'input':
        if (value === 'freeform') result.inputMode = 'freeform';
        break;
      case 'pause':
        result.pauseMs = parseInt(value, 10) || undefined;
        break;
      case 'fink':
        result.finkLink = value;
        break;
      case 'image':
        result.image = value;
        break;
      case 'basehref':
        result.basehref = value;
        break;
    }
  }

  return result;
}

/**
 * Merge new tags into an existing tag set (for accumulating character info).
 * Later values override earlier ones for speaker/voice/mood.
 */
export function mergeTags(existing: ParsedTags, incoming: ParsedTags): ParsedTags {
  return {
    speaker: incoming.speaker ?? existing.speaker,
    voice: incoming.voice ?? existing.voice,
    voiceDirectives: { ...(existing.voiceDirectives ?? {}), ...(incoming.voiceDirectives ?? {}) },
    mood: incoming.mood ?? existing.mood,
    voiceHints: incoming.voiceHints ?? existing.voiceHints,
    inputMode: incoming.inputMode ?? existing.inputMode,
    pauseMs: incoming.pauseMs ?? existing.pauseMs,
    finkLink: incoming.finkLink ?? existing.finkLink,
    image: incoming.image ?? existing.image,
    basehref: incoming.basehref ?? existing.basehref,
    foaf: { ...existing.foaf, ...incoming.foaf },
    raw: [...existing.raw, ...incoming.raw],
  };
}
