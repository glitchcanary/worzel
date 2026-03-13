/**
 * InkSession wraps an inkjs Story instance with:
 * - Tag parsing and character registry
 * - Voice hint extraction for choice matching
 * - State serialization/restoration
 * - External function binding for freeform input
 */

import { Story } from 'inkjs';
import type { Choice } from 'inkjs/engine/Choice';
import { parseTags, mergeTags, type ParsedTags } from './ink-tags.js';

export interface InkChoice {
  index: number;
  text: string;
  tags: ParsedTags;
  voiceHints: string[];
}

export interface CharacterInfo {
  name: string;
  ttsVoice?: string;
  mood?: string;
  foaf: Record<string, string>;
}

/** A segment of narration with speaker and voice info. */
export interface NarrationSegment {
  text: string;
  speaker: string;
  voice?: string;
  mood?: string;
  tags: ParsedTags;
}

export interface InkSessionState {
  storyId: string;
  narration: NarrationSegment[];
  choices: InkChoice[];
  canContinue: boolean;
  isEnded: boolean;
  waitingForExternalInput?: string;
  turnCount: number;
  variables: Record<string, unknown>;
}

export class InkSession {
  readonly storyId: string;
  private readonly story: Story;
  private characters = new Map<string, CharacterInfo>();
  private defaultSpeaker = 'narrator';
  private defaultVoice?: string;
  private _turnCount = 0;
  private _waitingForExternalInput?: string;
  private _lastNarration: NarrationSegment[] = [];

  constructor(storyId: string, storyJson: string, defaultVoice?: string) {
    this.storyId = storyId;
    this.story = new Story(storyJson);
    this.defaultVoice = defaultVoice;

    // Parse global tags for story-level metadata
    const globalTags = this.story.globalTags ?? [];
    const parsed = parseTags(globalTags);
    if (parsed.speaker) this.defaultSpeaker = parsed.speaker;
    if (parsed.voice) this.defaultVoice = parsed.voice;

    // Accumulate any FOAF data from global tags
    if (parsed.foaf && Object.keys(parsed.foaf).length > 0) {
      this.updateCharacter(this.defaultSpeaker, parsed);
    }
  }

  get turnCount(): number {
    return this._turnCount;
  }

  get waitingForExternalInput(): string | undefined {
    return this._waitingForExternalInput;
  }

  /**
   * Continue the story and return narration segments + available choices.
   * Each segment is tagged with speaker/voice info from Ink tags.
   */
  continue(): { narration: NarrationSegment[]; choices: InkChoice[] } {
    const narration: NarrationSegment[] = [];
    let pendingTags: ParsedTags | null = null;

    while (this.story.canContinue) {
      const text = this.story.Continue();
      const rawTags = this.story.currentTags ?? [];

      if (!text || !text.trim()) {
        // Empty text but may have tags — carry them forward
        if (rawTags.length > 0) {
          const emptyTags = parseTags(rawTags);
          pendingTags = pendingTags ? mergeTags(pendingTags, emptyTags) : emptyTags;
        }
        continue;
      }

      let tags = parseTags(rawTags);
      // Merge any tags carried forward from empty lines
      if (pendingTags) {
        tags = mergeTags(pendingTags, tags);
        pendingTags = null;
      }

      const speaker = tags.speaker ?? this.defaultSpeaker;

      // Update character registry from tags
      this.updateCharacter(speaker, tags);

      const character = this.characters.get(speaker);
      narration.push({
        text: text.trim(),
        speaker,
        voice: tags.voice ?? character?.ttsVoice ?? this.defaultVoice,
        mood: tags.mood ?? character?.mood,
        tags,
      });
    }

    // If there are leftover pending tags with no following text (e.g. FINK: link
    // before -> END), attach them to the last narration segment or create a
    // tag-only segment so they aren't lost.
    if (pendingTags) {
      if (narration.length > 0) {
        const last = narration[narration.length - 1]!;
        last.tags = mergeTags(last.tags, pendingTags);
      } else {
        narration.push({
          text: '',
          speaker: pendingTags.speaker ?? this.defaultSpeaker,
          tags: pendingTags,
        });
      }
    }

    const choices = this.parseChoices();
    this._lastNarration = narration;
    return { narration, choices };
  }

  /**
   * Make a choice by index and continue the story.
   */
  choose(choiceIndex: number): { narration: NarrationSegment[]; choices: InkChoice[] } {
    const choices = this.story.currentChoices;
    if (choiceIndex < 0 || choiceIndex >= choices.length) {
      throw new Error(`Invalid choice index ${choiceIndex} (${choices.length} choices available)`);
    }
    this.story.ChooseChoiceIndex(choiceIndex);
    this._turnCount++;
    return this.continue();
  }

  /**
   * Get the current state without advancing.
   */
  getState(): InkSessionState {
    return {
      storyId: this.storyId,
      narration: this._lastNarration,
      choices: this.parseChoices(),
      canContinue: this.story.canContinue,
      isEnded: !this.story.canContinue && this.story.currentChoices.length === 0,
      waitingForExternalInput: this._waitingForExternalInput,
      turnCount: this._turnCount,
      variables: this.getVariables(),
    };
  }

  /**
   * Get current choices with parsed tags and voice hints.
   */
  getChoices(): InkChoice[] {
    return this.parseChoices();
  }

  /**
   * Serialize story state for persistence.
   */
  serialize(): string {
    return this.story.state.toJson();
  }

  /**
   * Restore story state from serialized JSON.
   */
  restore(stateJson: string): void {
    this.story.state.LoadJson(stateJson);
  }

  /**
   * Get a character's info from the accumulated registry.
   */
  getCharacter(name: string): CharacterInfo | undefined {
    return this.characters.get(name);
  }

  /**
   * Get all known characters.
   */
  getAllCharacters(): Map<string, CharacterInfo> {
    return new Map(this.characters);
  }

  /**
   * Read a story variable.
   */
  getVariable(name: string): unknown {
    return this.story.variablesState[name];
  }

  /**
   * Write a story variable.
   */
  setVariable(name: string, value: string | number | boolean): void {
    this.story.variablesState[name] = value;
  }

  /**
   * Get all global variables as a plain object.
   */
  getVariables(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    // inkjs variablesState is a proxy; iterate via keys
    const state = this.story.variablesState;
    // The variablesState uses a Proxy in modern inkjs, but we can
    // enumerate by accessing the internal _globalVariables map
    // For safety, we'll just return an empty object if enumeration fails
    try {
      const keys = Object.keys(state);
      for (const key of keys) {
        if (key.startsWith('_') || typeof key === 'symbol') continue;
        const val = state[key];
        if (val !== undefined && typeof val !== 'function') {
          vars[key] = val;
        }
      }
    } catch {
      // variablesState enumeration not supported in this inkjs version
    }
    return vars;
  }

  /**
   * Bind an external function that the Ink story can call.
   */
  bindExternalFunction(
    name: string,
    fn: (...args: unknown[]) => unknown,
    lookaheadSafe = false,
  ): void {
    this.story.BindExternalFunction(name, fn, lookaheadSafe);
  }

  /**
   * Navigate to a specific knot/stitch path.
   */
  goTo(path: string): { narration: NarrationSegment[]; choices: InkChoice[] } {
    this.story.ChoosePathString(path);
    return this.continue();
  }

  /**
   * Check if the story has ended.
   */
  get isEnded(): boolean {
    return !this.story.canContinue && this.story.currentChoices.length === 0;
  }

  private parseChoices(): InkChoice[] {
    return this.story.currentChoices.map((choice: Choice) => {
      const tags = parseTags(choice.tags ?? []);
      return {
        index: choice.index,
        text: choice.text,
        tags,
        voiceHints: tags.voiceHints ?? [],
      };
    });
  }

  private updateCharacter(speaker: string, tags: ParsedTags): void {
    const existing = this.characters.get(speaker);
    const character: CharacterInfo = {
      name: tags.foaf['name'] ?? existing?.name ?? speaker,
      ttsVoice: tags.voice ?? existing?.ttsVoice,
      mood: tags.mood ?? existing?.mood,
      foaf: { ...(existing?.foaf ?? {}), ...tags.foaf },
    };
    this.characters.set(speaker, character);
  }
}
