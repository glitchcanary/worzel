/**
 * InkRouter — Three-tier utterance classification for voice-navigated Ink stories.
 *
 * Classifies spoken text into one of:
 * - choice_match:    User's words match an Ink choice → advance story
 * - discussion:      User is asking about the world → LLM responds in-character
 * - meta_query:      User wants to know their options → LLM describes choices
 * - freeform_input:  Story is waiting for raw text input → pass through
 * - no_match:        Nothing matched → LLM redirects gently
 */

import type { InkSessionState } from './ink-session.js';
import type { LLMProvider, ChatMessage } from '../providers/interface.js';

export type ClassificationType =
  | 'choice_match'
  | 'discussion'
  | 'meta_query'
  | 'freeform_input'
  | 'no_match';

export interface Classification {
  type: ClassificationType;
  choiceIndex?: number;
  confidence: number;
}

/** Words that signal the user wants to know their options. */
const META_KEYWORDS = new Set([
  'options', 'choices', 'help', 'what can i do', 'what are my options',
  'where am i', 'what now', 'what next', 'what should i do',
  'tell me my options', 'what do i do',
]);

/** Affirmative responses that match a single available choice. */
const AFFIRMATIVES = new Set([
  'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'do it', 'go ahead',
  'alright', 'right', 'fine', 'absolutely', 'definitely', "let's do it",
  "let's go", 'go for it',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

export class InkRouter {
  private readonly llm?: LLMProvider;

  constructor(options?: { llm?: LLMProvider }) {
    this.llm = options?.llm;
  }

  /**
   * Classify an ASR utterance against the current story state.
   * Runs tiers 1 → 2 → 3 in order, returning on first confident match.
   */
  async classify(
    asrText: string,
    state: InkSessionState,
    signal?: AbortSignal,
  ): Promise<Classification> {
    // --- Tier 0: Freeform mode ---
    if (state.waitingForExternalInput) {
      return { type: 'freeform_input', confidence: 1.0 };
    }

    // --- Tier 1: Instant keyword/exact matching ---
    const tier1 = this.tier1(asrText, state);
    if (tier1) return tier1;

    // --- Tier 2: Token overlap scoring ---
    const tier2 = this.tier2(asrText, state);
    if (tier2) return tier2;

    // --- Tier 3: LLM-based classification ---
    if (this.llm && state.choices.length > 0) {
      const tier3 = await this.tier3(asrText, state, signal);
      if (tier3) return tier3;
    }

    return { type: 'no_match', confidence: 0 };
  }

  /**
   * Tier 1: Instant matching — meta keywords, exact match, single-choice affirmative, voice hints.
   */
  tier1(asrText: string, state: InkSessionState): Classification | null {
    const normalized = normalize(asrText);

    // Meta keywords
    if (META_KEYWORDS.has(normalized)) {
      return { type: 'meta_query', confidence: 1.0 };
    }
    // Partial meta keyword match (e.g. "what are my options please")
    for (const keyword of META_KEYWORDS) {
      if (normalized.includes(keyword)) {
        return { type: 'meta_query', confidence: 0.9 };
      }
    }

    if (state.choices.length === 0) return null;

    // Single choice + affirmative
    if (state.choices.length === 1 && AFFIRMATIVES.has(normalized)) {
      return { type: 'choice_match', choiceIndex: state.choices[0]!.index, confidence: 1.0 };
    }

    // Exact text match (case-insensitive, punctuation-stripped)
    for (const choice of state.choices) {
      if (normalize(choice.text) === normalized) {
        return { type: 'choice_match', choiceIndex: choice.index, confidence: 1.0 };
      }
    }

    // Voice hint match
    for (const choice of state.choices) {
      for (const hint of choice.voiceHints) {
        if (normalized.includes(hint) || hint.includes(normalized)) {
          return { type: 'choice_match', choiceIndex: choice.index, confidence: 0.95 };
        }
      }
    }

    return null;
  }

  /**
   * Tier 2: Token overlap scoring.
   * Scores choice text and voice hints separately, takes the best.
   * Accepts if one choice scores > 0.5 and has > 0.2 gap over runner-up.
   */
  tier2(asrText: string, state: InkSessionState): Classification | null {
    if (state.choices.length === 0) return null;

    const userTokens = new Set(tokenize(asrText));
    if (userTokens.size === 0) return null;

    const scores = state.choices.map(choice => {
      // Score 1: token overlap with choice text (bidirectional — take the better direction)
      const choiceTokens = new Set(tokenize(choice.text));
      const choiceOverlap = [...choiceTokens].filter(t => userTokens.has(t)).length;
      const choiceRecall = choiceTokens.size > 0 ? choiceOverlap / choiceTokens.size : 0;
      const choicePrecision = userTokens.size > 0 ? choiceOverlap / userTokens.size : 0;
      const textScore = Math.max(choiceRecall, choicePrecision);

      // Score 2: token overlap with each voice hint phrase (scored individually)
      let hintScore = 0;
      for (const hint of choice.voiceHints) {
        const hintTokens = new Set(tokenize(hint));
        const hintOverlap = [...hintTokens].filter(t => userTokens.has(t)).length;
        const recall = hintTokens.size > 0 ? hintOverlap / hintTokens.size : 0;
        hintScore = Math.max(hintScore, recall);
      }

      return { index: choice.index, score: Math.max(textScore, hintScore) };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0]!;
    const runnerUp = scores[1];

    if (best.score > 0.5) {
      const gap = runnerUp ? best.score - runnerUp.score : best.score;
      if (gap > 0.2 || !runnerUp) {
        return { type: 'choice_match', choiceIndex: best.index, confidence: best.score };
      }
    }

    return null;
  }

  /**
   * Tier 3: LLM-based classification using a fast model.
   */
  async tier3(
    asrText: string,
    state: InkSessionState,
    signal?: AbortSignal,
  ): Promise<Classification | null> {
    if (!this.llm) return null;

    const choiceList = state.choices
      .map((c, i) => `${i + 1}. "${c.text}"`)
      .join('\n');

    const messages: ChatMessage[] = [{
      role: 'user',
      content: `You are classifying a player's spoken input in an interactive story.

Available choices:
${choiceList}

The player said: "${asrText}"

Classify the player's intent:
- If they want to pick a choice, respond: CHOICE:N (where N is the choice number from the list above)
- If they're asking about the story world or a character, respond: DISCUSSION
- If they're asking what they can do or want help, respond: META
- If nothing matches, respond: NONE

Respond with ONLY the classification word/code, nothing else.`,
    }];

    let response = '';
    try {
      for await (const chunk of this.llm.chat(messages, {
        maxTokens: 20,
        temperature: 0,
        signal,
      })) {
        response += chunk.text;
        if (chunk.done) break;
      }
    } catch {
      return null;
    }

    const trimmed = response.trim().toUpperCase();

    if (trimmed.startsWith('CHOICE:')) {
      const num = parseInt(trimmed.slice(7), 10);
      if (num >= 1 && num <= state.choices.length) {
        return {
          type: 'choice_match',
          choiceIndex: state.choices[num - 1]!.index,
          confidence: 0.8,
        };
      }
    }

    if (trimmed === 'DISCUSSION') return { type: 'discussion', confidence: 0.8 };
    if (trimmed === 'META') return { type: 'meta_query', confidence: 0.8 };
    if (trimmed === 'NONE') return { type: 'no_match', confidence: 0.5 };

    return null;
  }
}
