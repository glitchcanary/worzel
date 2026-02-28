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
- Do NOT advance the story or make choices for the player.
- Do NOT use lists, numbered items, markdown, or formatting — this will be spoken aloud.
- You may discuss the world, hint at what's possible, but never explicitly list the choices.
- If the player seems confused, gently guide them back toward the story.
- CRITICAL: You CANNOT take actions. You cannot file reports, transfer calls, connect to departments, look anything up, or do anything. Only the story system can perform actions — and it only does so when the player selects a specific choice. Never say you have done something or will do something. You can only talk.`;
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
- If the user has described a problem or situation, identify which options are most relevant to their situation and explain why. For example, if they describe a smell, explain which services handle odour complaints vs sewage emergencies.
- Do NOT number them or sound robotic.
- Keep it to 2-3 spoken sentences. This is a voice interface.
- Do NOT use lists, markdown, or formatting.
- CRITICAL: You CANNOT take actions. You cannot file reports, transfer calls, or do anything. Only the system can act — and it only does so when the user selects a specific choice. Never claim to have done something or promise to do something.`;
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

AVAILABLE CHOICES:
${choicesList}

USER SAID: "${ctx.asrText}"

RULES:
- Analyse what the user is describing and identify which available choices are most relevant to their situation.
- Actively triage: if their description could map to one or more choices, explain the distinction and suggest the best fit. For example, if they describe a bad smell, explain that "water and sewer" handles sewage issues while "garbage and recycling" handles waste collection.
- Be specific and helpful, not vague. Connect their words to the actual options.
- 2-3 spoken sentences maximum. This is a voice interface.
- Do NOT use lists, markdown, or formatting.
- CRITICAL: You CANNOT take actions, file reports, transfer calls, or do anything. Only the system acts when the user selects a specific choice. Never claim to have done something. You can only help them choose.`;
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
