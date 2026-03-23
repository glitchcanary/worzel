/**
 * InkRouter — Three-tier utterance classification for voice-navigated Ink stories.
 *
 * Classifies spoken text into one of:
 * - choice_match:    User's words match an Ink choice → advance story
 * - discussion:      User is asking about the world → LLM responds in-character
 * - meta_query:      User wants to know their options → LLM describes choices
 * - skip_ahead:      User wants to skip narration → brief choice summary
 * - freeform_input:  Story is waiting for raw text input → pass through
 * - no_match:        Nothing matched → LLM redirects gently
 */

import type { InkSessionState } from './ink-session.js';
import type { LLMProvider, ChatMessage } from '../providers/interface.js';

export type ClassificationType =
  | 'choice_match'
  | 'discussion'
  | 'meta_query'
  | 'skip_ahead'
  | 'freeform_input'
  | 'no_match';

export interface Classification {
  type: ClassificationType;
  choiceIndex?: number;
  confidence: number;
  residualText?: string;
}

/** IVR sentinel choice texts that should be excluded from voice matching. */
const IVR_SENTINELS = new Set(['noinput', 'nomatch']);

/** Words that signal the user wants to know their options. */
const META_KEYWORDS = new Set([
  'options', 'choices', 'help', 'what can i do', 'what are my options',
  'where am i', 'what now', 'what next', 'what should i do',
  'tell me my options', 'what do i do',
]);

/** Words that signal the user wants to skip narration and hear choices briefly. */
const SKIP_KEYWORDS = new Set([
  'skip', 'next', 'move on', 'got it', 'yeah yeah', 'yep yep',
  'okay okay', 'ok ok', 'i get it', 'enough', 'stop',
  'get on with it', 'hurry up', 'come on', 'cut to the chase',
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

function compactNormalize(text: string): string {
  return normalize(text).replace(/\s+/g, '');
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  return /^(who|what|when|where|why|how|is|are|do|does|did|can|could|would|should|will)\b/.test(trimmed);
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

    // Filter out IVR sentinel choices (noinput/nomatch) before classification
    const filtered = {
      ...state,
      choices: state.choices.filter(c => !IVR_SENTINELS.has(normalize(c.text))),
    };

    // --- Tier 1: Instant keyword/exact matching ---
    const tier1 = this.tier1(asrText, filtered);
    if (tier1) return this.attachResidualText(asrText, filtered, tier1, signal);

    // --- Tier 2: Token overlap scoring ---
    const tier2 = this.tier2(asrText, filtered);
    if (tier2) return this.attachResidualText(asrText, filtered, tier2, signal);

    // --- Tier 3: LLM-based classification ---
    if (this.llm && filtered.choices.length > 0) {
      const tier3 = await this.tier3(asrText, filtered, signal);
      if (tier3) return this.attachResidualText(asrText, filtered, tier3, signal);
    }

    return { type: 'no_match', confidence: 0 };
  }

  /**
   * Tier 1: Instant matching — meta keywords, exact match, single-choice affirmative, voice hints.
   */
  tier1(asrText: string, state: InkSessionState): Classification | null {
    const normalized = normalize(asrText);
    const compact = compactNormalize(asrText);

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

    // Skip/interrupt — exact match
    if (SKIP_KEYWORDS.has(normalized)) {
      return { type: 'skip_ahead', confidence: 1.0 };
    }
    // Multi-word skip phrase as substring (e.g. "yeah yeah just skip it")
    for (const keyword of SKIP_KEYWORDS) {
      if (keyword.includes(' ') && normalized.includes(keyword)) {
        return { type: 'skip_ahead', confidence: 0.9 };
      }
    }

    if (state.choices.length === 0) return null;

    // Single choice + affirmative
    if (state.choices.length === 1 && AFFIRMATIVES.has(normalized)) {
      return { type: 'choice_match', choiceIndex: state.choices[0]!.index, confidence: 1.0 };
    }

    // Exact text match (case-insensitive, punctuation-stripped)
    for (const choice of state.choices) {
      if (normalize(choice.text) === normalized || compactNormalize(choice.text) === compact) {
        return { type: 'choice_match', choiceIndex: choice.index, confidence: 1.0 };
      }
    }

    // Voice hint match
    for (const choice of state.choices) {
      for (const hint of choice.voiceHints) {
        if (
          normalized.includes(hint)
          || hint.includes(normalized)
          || compact.includes(compactNormalize(hint))
          || compactNormalize(hint).includes(compact)
        ) {
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

      // Score 2: token overlap with each voice hint phrase (bidirectional, like text)
      let hintScore = 0;
      for (const hint of choice.voiceHints) {
        const hintTokens = new Set(tokenize(hint));
        const hintOverlap = [...hintTokens].filter(t => userTokens.has(t)).length;
        const recall = hintTokens.size > 0 ? hintOverlap / hintTokens.size : 0;
        const precision = userTokens.size > 0 ? hintOverlap / userTokens.size : 0;
        hintScore = Math.max(hintScore, Math.max(recall, precision));
      }

      return { index: choice.index, score: Math.max(textScore, hintScore) };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0]!;
    const runnerUp = scores[1];

    if (best.score >= 0.4) {
      const gap = runnerUp ? best.score - runnerUp.score : best.score;
      if (gap > 0.1 || !runnerUp) {
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
      .map((c, i) => `${i + 1}. "${c.text}"${c.voiceHints.length ? ` (voice hints: ${c.voiceHints.join(', ')})` : ''}`)
      .join('\n');
    const sceneText = state.narration.map(n => n.text).join('\n');
    const allowDiscussion = isLikelyQuestion(asrText);

    const messages: ChatMessage[] = [{
      role: 'user',
      content: `You are classifying a player's spoken input in an interactive story.

Current scene:
${sceneText || '(no scene text)'}

Available choices:
${choiceList}

The player said: "${asrText}"

Classify the player's intent:
- If they clearly want one of the listed choices, respond: CHOICE:N (the choice number)
- If they are describing an ACTION, destination, object, cue, or intention that IMPLIEDLY maps to one listed choice, still respond: CHOICE:N
- Prefer CHOICE over NONE whenever one listed option is the clearly best semantic fit for what they mean
- Only respond DISCUSSION for a genuine question about the story world or a character${allowDiscussion ? '' : ' (this utterance does not look like a question, so DISCUSSION is strongly disfavored)'}
- If they are asking what they can do or want help (e.g. "what are my options?"), respond: META
- If they seem impatient and want to skip narration or hear choices quickly (e.g. "yeah yeah", "skip", "get on with it"), respond: SKIP
- If they are trying to perform an ACTION that is not one of the listed choices (e.g. "pet the cat", "eat it", "fly away", "open the door"), respond: NONE
- If nothing matches, respond: NONE

IMPORTANT:
- Only use DISCUSSION for genuine questions.
- Imperatives, short action phrases, and destination phrases usually mean CHOICE or NONE, not DISCUSSION.
- Never invent a new option. Pick the closest listed choice or return NONE.
- If the player says something like "follow the smell" and one choice is "go to the animals", that should be CHOICE, not NONE, because the intent clearly points to that destination.
- Interpret idioms, cultural references, and indirect speech. E.g. "make like Columbo" means "ask one more question"; "let's bounce" means "leave"; "take the red pill" means "learn the truth". Match the underlying INTENT to the closest choice.

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
    if (trimmed === 'SKIP') return { type: 'skip_ahead', confidence: 0.8 };
    if (trimmed === 'NONE') return { type: 'no_match', confidence: 0.5 };

    return null;
  }

  private async attachResidualText(
    asrText: string,
    state: InkSessionState,
    classification: Classification,
    signal?: AbortSignal,
  ): Promise<Classification> {
    if (classification.type !== 'choice_match' || classification.choiceIndex === undefined) {
      return classification;
    }

    const matchedChoice = state.choices.find(choice => choice.index === classification.choiceIndex);
    if (!matchedChoice) {
      return classification;
    }

    const residualText = await this.extractChoiceResidual(asrText, matchedChoice, signal);
    return residualText
      ? { ...classification, residualText }
      : classification;
  }

  private async extractChoiceResidual(
    asrText: string,
    choice: InkSessionState['choices'][number],
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const heuristicResidual = extractResidualByPrefixOrSuffix(asrText, [
      choice.text,
      ...choice.voiceHints,
    ]);
    if (heuristicResidual) {
      return heuristicResidual;
    }

    if (!this.llm) return undefined;

    const asrTokens = tokenize(asrText);
    if (asrTokens.length <= 3) return undefined;

    let response = '';
    try {
      for await (const chunk of this.llm.chat([{
        role: 'user',
        content: buildCarryoverPrompt(asrText, choice.text, choice.voiceHints),
      }], {
        maxTokens: 60,
        temperature: 0,
        signal,
      })) {
        response += chunk.text;
        if (chunk.done) break;
      }
    } catch {
      return undefined;
    }

    const trimmed = response.trim();
    if (!trimmed || /^NONE$/i.test(trimmed)) return undefined;

    const match = trimmed.match(/^FOLLOWUP:\s*(.+)$/is);
    const residualText = (match?.[1] ?? '').trim();
    return residualText || undefined;
  }
}

function buildCarryoverPrompt(asrText: string, choiceText: string, voiceHints: string[]): string {
  const hintsLine = voiceHints.length > 0 ? `\nVoice hints: ${voiceHints.join(', ')}` : '';
  return `You are extracting any follow-up text that should carry into the NEXT turn of an interactive story.

Player utterance: "${asrText}"
Matched current choice: "${choiceText}"${hintsLine}

Return exactly one of:
- NONE
- FOLLOWUP: <verbatim leftover text>

Use FOLLOWUP only when the utterance contains both:
1. a clear selection of the matched current choice, and
2. extra words that should be applied immediately after that choice succeeds

Rules:
- Copy the extra words verbatim from the player utterance when possible.
- Exclude the matched choice words themselves.
- Ignore filler like "please", "okay", "yeah", "thanks", or hesitation noise.
- Do not paraphrase, explain, or invent.
- If there is no meaningful carryover text, return NONE.

Examples:
- Utterance: "ask one last question who can you trust here"
  Choice: "ask one last question"
  Result: FOLLOWUP: who can you trust here
- Utterance: "go to the shed"
  Choice: "go to the shed"
  Result: NONE
- Utterance: "yes do it"
  Choice: "open the door"
  Result: NONE`;
}

function extractResidualByPrefixOrSuffix(asrText: string, phrases: string[]): string | undefined {
  const originalTokens = asrText.trim().split(/\s+/).filter(Boolean);
  const asrTokens = originalTokens.map(token => normalize(token)).filter(Boolean);
  if (asrTokens.length === 0) return undefined;

  for (const phrase of phrases) {
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length === 0 || asrTokens.length <= phraseTokens.length) continue;

    if (startsWithTokens(asrTokens, phraseTokens)) {
      return cleanResidualText(originalTokens.slice(phraseTokens.length).join(' '));
    }
    if (endsWithTokens(asrTokens, phraseTokens)) {
      return cleanResidualText(originalTokens.slice(0, originalTokens.length - phraseTokens.length).join(' '));
    }
  }

  return undefined;
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
  return prefix.every((token, index) => tokens[index] === token);
}

function endsWithTokens(tokens: string[], suffix: string[]): boolean {
  const offset = tokens.length - suffix.length;
  return suffix.every((token, index) => tokens[offset + index] === token);
}

function cleanResidualText(text: string): string | undefined {
  const cleaned = text
    .replace(/^[,.:;!?-]+\s*/, '')
    .replace(/\s*[,.:;!?-]+$/, '')
    .trim();
  if (!cleaned) return undefined;
  if (/^(please|okay|ok|yeah|yep|thanks|thank you)$/i.test(cleaned)) return undefined;
  return cleaned;
}
