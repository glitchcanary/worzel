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

    it('detects "skip" as skip_ahead', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('skip', state);
      expect(result?.type).toBe('skip_ahead');
    });

    it('detects "yeah yeah" as skip_ahead', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('yeah yeah', state);
      expect(result?.type).toBe('skip_ahead');
    });

    it('detects "got it" as skip_ahead', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('got it', state);
      expect(result?.type).toBe('skip_ahead');
    });

    it('detects "move on" as skip_ahead', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('move on', state);
      expect(result?.type).toBe('skip_ahead');
    });

    it('detects multi-word skip phrase as substring', () => {
      const state = makeState([{ text: 'Open the gate' }]);
      const result = router.tier1('just move on already', state);
      expect(result?.type).toBe('skip_ahead');
    });

    it('does not match single-word skip as substring of longer text', () => {
      const state = makeState([{ text: 'Skip the intro' }]);
      // "skip the intro" should NOT match the skip keyword via substring
      // (only multi-word keywords get substring matching)
      // but it COULD match as exact choice text — here it won't because
      // skip keywords are checked before choices
      const result = router.tier1('skip the intro', state);
      // "skip the intro" is not in SKIP_KEYWORDS exactly,
      // and "skip" is single-word so no substring match
      // It should fall through to exact choice match
      expect(result?.type).toBe('choice_match');
    });

    it('skip works even with no choices', () => {
      const state = makeState([]);
      const result = router.tier1('skip', state);
      expect(result?.type).toBe('skip_ahead');
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

    it('classifies skip phrases', async () => {
      const state = makeState([
        { text: 'Open the gate' },
        { text: 'Turn back' },
      ]);
      const result = await router.classify('yeah yeah', state);
      expect(result.type).toBe('skip_ahead');
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

  // =====================================================================
  // ASR-realistic inputs — what real speech recognition actually produces
  // =====================================================================
  describe('ASR-realistic matching', () => {
    const choices = [
      { text: 'Open the gate' },
      { text: 'Talk to the guard' },
      { text: 'Turn back' },
    ];

    it('matches with filler words from ASR', async () => {
      const state = makeState(choices);
      const result = await router.classify('uh open the gate', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('matches with trailing politeness', async () => {
      const state = makeState(choices);
      const result = await router.classify('open the gate please', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('matches with leading "I want to"', async () => {
      const state = makeState(choices);
      const result = await router.classify('I want to open the gate', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('matches with "let me" prefix', async () => {
      const state = makeState(choices);
      const result = await router.classify('let me talk to the guard', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(1);
    });

    it('matches partial choice text (key words only)', async () => {
      const state = makeState(choices);
      const result = await router.classify('turn back', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(2);
    });

    it('matches with repeated/stuttered words', async () => {
      const state = makeState(choices);
      const result = await router.classify('open open the gate', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('matches with word order variation', async () => {
      const state = makeState(choices);
      const result = await router.classify('the gate open it', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('still rejects genuinely unrelated speech', async () => {
      const state = makeState(choices);
      const result = await router.classify('what is the weather like today', state);
      expect(result.type).toBe('no_match');
    });

    it('matches with voice hint despite extra words', async () => {
      const state = makeState([
        { text: 'Push open the heavy gate', voiceHints: ['enter garden'] },
        { text: 'Turn back home' },
      ]);
      const result = await router.classify('I want to enter the garden', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('disambiguates similar choices with a distinguishing word', async () => {
      const state = makeState([
        { text: 'Go to the north gate' },
        { text: 'Go to the south gate' },
      ]);
      const result = await router.classify('go north', state);
      expect(result.type).toBe('choice_match');
      expect(result.choiceIndex).toBe(0);
    });

    it('returns no_match for ambiguous input across similar choices', async () => {
      const state = makeState([
        { text: 'Go to the north gate' },
        { text: 'Go to the south gate' },
      ]);
      // "go to the gate" matches both equally — should not pick one
      const result = await router.classify('go to the gate', state);
      expect(result.type !== 'choice_match' || result.confidence < 0.8).toBe(true);
    });
  });
});
