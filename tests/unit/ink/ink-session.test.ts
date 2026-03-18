import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InkSession } from '../../../src/ink/ink-session.js';
import * as inkjs from 'inkjs/full';
import { extractInkFromFinkJs } from '../../../src/ink/fink-js-extractor.js';

const STORY_PATH = join(__dirname, '../../../stories/test-garden/story.fink.js');

async function loadStory(): Promise<string> {
  const fink = readFileSync(STORY_PATH, 'utf-8');
  const source = await extractInkFromFinkJs(fink);
  return new inkjs.Compiler(source).Compile().ToJson();
}

describe('InkSession', () => {
  let storyJson: string;

  beforeEach(async () => {
    storyJson = await loadStory();
  });

  describe('continue', () => {
    it('returns initial narration and choices', () => {
      const session = new InkSession('test-garden', storyJson);
      const result = session.continue();

      expect(result.narration.length).toBeGreaterThan(0);
      expect(result.narration[0]!.text).toContain('Welcome to The Enchanted Garden');
      expect(result.choices.length).toBe(2);
    });

    it('extracts speaker from tags', () => {
      const session = new InkSession('test-garden', storyJson);
      const result = session.continue();

      expect(result.narration[0]!.speaker).toBe('narrator');
    });

    it('extracts voice hints from choice tags', () => {
      const session = new InkSession('test-garden', storyJson);
      const result = session.continue();

      const beginChoice = result.choices.find(c => c.text.includes('Begin the story'));
      expect(beginChoice).toBeDefined();
      expect(beginChoice!.voiceHints.length).toBeGreaterThan(0);
      expect(beginChoice!.voiceHints).toContain('start');
    });
  });

  describe('choose', () => {
    it('advances the story', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      // Choose "Push open the gate"
      const result = session.choose(0);
      expect(result.narration.length).toBeGreaterThan(0);
      // Should now be in the garden
      expect(result.narration.some(n => n.text.includes('garden') || n.text.includes('path'))).toBe(true);
    });

    it('increments turn count', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      expect(session.turnCount).toBe(0);
      session.choose(0);
      expect(session.turnCount).toBe(1);
    });

    it('throws on invalid choice index', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      expect(() => session.choose(99)).toThrow('Invalid choice index');
    });
  });

  describe('character registry', () => {
    it('accumulates characters from tags as story progresses', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      // Narrator should be registered from initial tags
      const narrator = session.getCharacter('narrator');
      expect(narrator).toBeDefined();
    });

    it('tracks cat character when we reach deep_garden', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      session.choose(0); // Begin the story -> start
      session.choose(0); // Push open the gate -> garden
      session.choose(1); // Follow the path deeper -> deep_garden

      const cat = session.getCharacter('cat');
      expect(cat).toBeDefined();
      expect(cat!.ttsVoice).toBe('shimmer');
      expect(cat!.foaf['name']).toBe('Mr Whiskers');
    });
  });

  describe('variables', () => {
    it('reads story variables', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      expect(session.getVariable('lantern_lit')).toBe(false);
      expect(session.getVariable('player_name')).toBe('stranger');
    });

    it('writes story variables', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      session.setVariable('player_name', 'Alice');
      expect(session.getVariable('player_name')).toBe('Alice');
    });

    it('tracks courage variable changes through choices', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      session.choose(0); // enter the actual story start knot

      expect(session.getVariable('courage')).toBe(1);
    });
  });

  describe('serialization', () => {
    it('round-trips state correctly', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      session.choose(0); // Enter garden

      // Serialize
      const savedState = session.serialize();
      expect(typeof savedState).toBe('string');

      // Restore into a fresh session
      const session2 = new InkSession('test-garden', storyJson);
      session2.restore(savedState);

      // Should be at the same place — garden choices
      const result = session2.continue();
      expect(result.choices.length).toBeGreaterThan(0);
    });

    it('preserves variables through serialization', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      session.setVariable('player_name', 'Bob');

      const savedState = session.serialize();
      const session2 = new InkSession('test-garden', storyJson);
      session2.restore(savedState);

      expect(session2.getVariable('player_name')).toBe('Bob');
    });
  });

  describe('isEnded', () => {
    it('returns false at start', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      expect(session.isEnded).toBe(false);
    });

    it('returns true at story end', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();
      session.choose(0); // Begin the story
      session.choose(2); // Turn back -> ending_leave
      session.choose(1); // Goodbye -> END

      expect(session.isEnded).toBe(true);
    });
  });

  describe('getState', () => {
    it('returns current state summary', () => {
      const session = new InkSession('test-garden', storyJson);
      session.continue();

      const state = session.getState();
      expect(state.storyId).toBe('test-garden');
      expect(state.choices.length).toBe(2);
      expect(state.isEnded).toBe(false);
      expect(state.turnCount).toBe(0);
    });
  });
});
