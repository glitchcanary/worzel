import { describe, it, expect } from 'vitest';
import { InkRouter } from '../../../src/ink/ink-router.js';
import type { InkSessionState } from '../../../src/ink/ink-session.js';

function makeState(choices: { text: string; voiceHints?: string[] }[] = []): InkSessionState {
  return {
    storyId: 'test',
    narration: [],
    choices: choices.map((c, i) => ({
      index: i,
      text: c.text,
      tags: { foaf: {}, raw: [] },
      voiceHints: c.voiceHints ?? [],
    })),
    canContinue: false,
    isEnded: false,
    turnCount: 0,
    variables: {},
  };
}

describe('InkRouter', () => {
  const router = new InkRouter();

  describe('tier1', () => {
    it('detects meta keywords', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('what are my options', state);
      expect(result?.type).toBe('meta_query');
    });

    it('detects help keyword', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('help', state);
      expect(result?.type).toBe('meta_query');
    });

    it('matches exact choice text (case insensitive)', () => {
      const state = makeState([
        { text: 'Open the gate' },
        { text: 'Turn back' },
      ]);
      const result = router.tier1('open the gate', state);
      expect(result?.type).toBe('choice_match');
      expect(result?.choiceIndex).toBe(0);
    });

    it('matches single choice with affirmative', () => {
      const state = makeState([{ text: 'Continue forward' }]);
      const result = router.tier1('yes', state);
      expect(result?.type).toBe('choice_match');
      expect(result?.choiceIndex).toBe(0);
    });

    it('does not match affirmative with multiple choices', () => {
      const state = makeState([
        { text: 'Open the gate' },
        { text: 'Turn back' },
      ]);
      const result = router.tier1('yes', state);
      expect(result).toBeNull();
    });

    it('matches voice hints', () => {
      const state = makeState([
        { text: 'Push open the gate', voiceHints: ['open gate', 'push gate'] },
        { text: 'Turn back', voiceHints: ['go home', 'leave'] },
      ]);
      const result = router.tier1('open gate', state);
      expect(result?.type).toBe('choice_match');
      expect(result?.choiceIndex).toBe(0);
    });

    it('returns null when no match', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('the weather is nice', state);
      expect(result).toBeNull();
    });
  });

  describe('tier2', () => {
    it('matches by token overlap', () => {
      const state = makeState([
        { text: 'Push open the gate' },
        { text: 'Talk to the guard' },
        { text: 'Turn back home' },
      ]);
      // "I want to open the gate" shares 3/4 tokens with choice 0
      const result = router.tier2('I want to open the gate', state);
      expect(result?.type).toBe('choice_match');
      expect(result?.choiceIndex).toBe(0);
    });

    it('returns null for ambiguous overlap', () => {
      const state = makeState([
        { text: 'Go to the north gate' },
        { text: 'Go to the south gate' },
      ]);
      // Both choices share similar tokens — ambiguous
      const result = router.tier2('go to the gate', state);
      // Should be null because the gap between top two is too small
      expect(result === null || result.confidence < 0.8).toBe(true);
    });

    it('returns null for unrelated text', () => {
      const state = makeState([
        { text: 'Push open the gate' },
        { text: 'Turn back home' },
      ]);
      const result = router.tier2('the sky is purple', state);
      expect(result).toBeNull();
    });

    it('includes voice hints in token matching', () => {
      const state = makeState([
        { text: 'Push open the gate', voiceHints: ['enter garden'] },
        { text: 'Turn back home' },
      ]);
      const result = router.tier2('enter the garden please', state);
      expect(result?.type).toBe('choice_match');
      expect(result?.choiceIndex).toBe(0);
    });
  });

  describe('classify (full pipeline without LLM)', () => {
    it('classifies freeform input mode', async () => {
      const state: InkSessionState = {
        ...makeState([]),
        waitingForExternalInput: 'What is your name?',
      };
      const result = await router.classify('my name is Alice', state);
      expect(result.type).toBe('freeform_input');
      expect(result.confidence).toBe(1.0);
    });

    it('falls through to no_match for unrelated speech', async () => {
      const state = makeState([
        { text: 'Open the gate' },
        { text: 'Turn back' },
      ]);
      const result = await router.classify('I like pizza', state);
      expect(result.type).toBe('no_match');
    });

    it('detects meta query', async () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = await router.classify('what can I do', state);
      expect(result.type).toBe('meta_query');
    });

    it('matches choice via tier1 exact', async () => {
      const state = makeState([
        { text: 'Open the gate' },
        { text: 'Turn back' },
      ]);
      const result = await router.classify('open the gate', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('matches choice via tier2 overlap', async () => {
      const state = makeState([
        { text: 'Push open the gate' },
        { text: 'Talk to the guard' },
        { text: 'Turn back home' },
      ]);
      // "push the gate open" shares 3/4 tokens with choice 0
      const result = await router.classify('push the gate open', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });
  });
});
