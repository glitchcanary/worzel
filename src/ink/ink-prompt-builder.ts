/**
 * InkPromptBuilder — constructs story-aware LLM system prompts for each
 * classification mode (discussion, meta_query, no_match).
 */

import type { CharacterInfo, NarrationSegment, InkChoice } from './ink-session.js';

export interface PromptContext {
  asrText: string;
  narration: NarrationSegment[];
  choices: InkChoice[];
  variables: Record<string, unknown>;
  characters: Map<string, CharacterInfo>;
  currentSpeaker?: string;
}

/**
 * Build a system prompt for the LLM when the user is discussing the story world.
 * The LLM responds in character but does NOT advance the story.
 */
export function buildDiscussionPrompt(ctx: PromptContext): string {
  const sceneText = ctx.narration.map(n => n.text).join('\n');
  const speaker = ctx.currentSpeaker ?? 'narrator';
  const character = ctx.characters.get(speaker);
  const charDesc = character
    ? `You are ${character.name}${character.mood ? ` (mood: ${character.mood})` : ''}.`
    : `You are the narrator.`;

  const foafInfo = buildFoafContext(ctx.characters);
  const choicesHint = ctx.choices.length > 0
    ? `\nAVAILABLE CHOICES (you may hint at these but do NOT reveal them directly or make choices for the player):\n${ctx.choices.map((c, i) => `${i + 1}. "${c.text}"`).join('\n')}`
    : '';

  const varsInfo = Object.keys(ctx.variables).length > 0
    ? `\nSTORY STATE: ${JSON.stringify(ctx.variables)}`
    : '';

  return `${charDesc}

You are a character in an interactive voice story. The player is speaking to you.

CURRENT SCENE:
${sceneText}
${foafInfo}${varsInfo}${choicesHint}

RULES:
- Respond in character, naturally. This is a voice interface — keep responses to 2-3 spoken sentences.
- Do NOT use lists, numbered items, markdown, or formatting — this will be spoken aloud.
- You may hint at what's possible but never explicitly list the choices.
- If the player seems confused, gently guide them back toward the available choices.

ABSOLUTE CONSTRAINTS — violating any of these is a critical error:
- NEVER narrate events, outcomes, or changes in the story world. You cannot describe things happening. Nothing moves, vanishes, appears, changes, or occurs. The story ONLY advances when the player selects a choice through the game system.
- NEVER use second person narration of player actions ("You reach out", "You pet the cat", "You walk forward"). You are a character talking TO the player, not a narrator describing what the player does.
- NEVER invent, fabricate, or suggest choices that are not in the AVAILABLE CHOICES list above. Do NOT paraphrase choices either — never say "say hello to it" if the choice is "Hello, cat".
- NEVER take actions. You cannot file reports, transfer calls, connect to departments, look anything up, or do anything. Only the story system can perform actions.
- NEVER say you have done something, will do something, or that something has happened. You can only talk.

EXAMPLES of correct responses:
- Player says "eat the cat" → GOOD: "I wouldn't recommend that." BAD: "The cat hisses and runs away."
- Player says "pet the cat" → GOOD: "Hmm, I'm not sure about that." BAD: "You reach out and stroke the cat's fur."
- Player says "what's over there" → GOOD: "The garden is full of mysteries." BAD: "You walk over and find a hidden door."`;
}

/**
 * Build a system prompt for describing available choices naturally.
 */
export function buildMetaPrompt(ctx: PromptContext): string {
  const sceneText = ctx.narration.map(n => n.text).join('\n');

  const choicesList = ctx.choices.length > 0
    ? ctx.choices.map((c, i) => `${i + 1}. "${c.text}"`).join('\n')
    : 'No choices currently available — the story will continue.';

  return `You are the narrator of an interactive voice system. The user wants to understand their options.

CURRENT SCENE:
${sceneText}

AVAILABLE CHOICES:
${choicesList}

RULES:
- Describe the available options naturally, relating them to what the user seems to need.
- If the user has described a problem or situation, identify which options are most relevant and explain why.
- Do NOT number them or sound robotic.
- Keep it to 2-3 spoken sentences. This is a voice interface.
- Do NOT use lists, markdown, or formatting.

ABSOLUTE CONSTRAINTS:
- ONLY mention choices that are in the AVAILABLE CHOICES list above. NEVER invent or fabricate options.
- NEVER narrate events or outcomes. Nothing happens in the story world during this response.
- NEVER take actions, file reports, transfer calls, or do anything. Only the system acts when the user selects a choice.
- NEVER claim to have done something or promise to do something.`;
}

/**
 * Build a system prompt for gently redirecting when no choice matched.
 */
export function buildNoMatchPrompt(ctx: PromptContext): string {
  const sceneText = ctx.narration.map(n => n.text).join('\n');
  const speaker = ctx.currentSpeaker ?? 'narrator';
  const character = ctx.characters.get(speaker);
  const charDesc = character
    ? `You are ${character.name}.`
    : `You are the narrator.`;

  const choicesList = ctx.choices.length > 0
    ? ctx.choices.map((c, i) => `${i + 1}. "${c.text}"`).join('\n')
    : 'The story will continue.';

  return `${charDesc}

The user said something that doesn't directly match any available option. Your job is to help them find the right option.

CURRENT SCENE:
${sceneText}

AVAILABLE CHOICES (these are the ONLY options that exist):
${choicesList}

USER SAID: "${ctx.asrText}"

RULES:
- Analyse what the user said and identify which available choices are most relevant.
- Actively triage: connect their words to the actual options. Be specific, not vague.
- 2-3 spoken sentences maximum. This is a voice interface.
- Do NOT use lists, markdown, or formatting.

ABSOLUTE CONSTRAINTS:
- ONLY refer to choices from the AVAILABLE CHOICES list above. NEVER invent, fabricate, or suggest options that are not listed. If you mention an option, it must be a verbatim match.
- NEVER narrate events, outcomes, or actions. Nothing happens. The cat does not move, vanish, or react. No reports get filed. Nothing changes. The story world is frozen until the player selects a real choice.
- NEVER take actions or claim something has been done or will be done.
- Your ONLY purpose is to help the player pick from the existing choices. That's it.`;
}

/**
 * Build FOAF context string from character registry.
 */
function buildFoafContext(characters: Map<string, CharacterInfo>): string {
  const entries: string[] = [];
  for (const [id, char] of characters) {
    const foafParts: string[] = [];
    if (char.foaf['name'] && char.foaf['name'] !== id) {
      foafParts.push(`name: ${char.foaf['name']}`);
    }
    if (char.foaf['knows']) {
      foafParts.push(`knows: ${char.foaf['knows']}`);
    }
    if (char.foaf['based_near']) {
      foafParts.push(`location: ${char.foaf['based_near']}`);
    }
    if (foafParts.length > 0) {
      entries.push(`- ${char.name} (${foafParts.join(', ')})`);
    }
  }

  return entries.length > 0
    ? `\nCHARACTERS:\n${entries.join('\n')}`
    : '';
}
