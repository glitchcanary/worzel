/**
 * StoryManager — loads, compiles, and indexes Ink stories from a directory.
 *
 * Story directory structure:
 *   stories/
 *     my-story/
 *       story.ink.json   (compiled, preferred)
 *       story.ink         (source, compiled at load time if no .json)
 *       metadata.json     (title, author, description, voices, fink data)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type pino from 'pino';

export interface StoryMetadata {
  id: string;
  title: string;
  author?: string;
  description?: string;
  defaultVoices?: Record<string, string>;
  finkData?: Record<string, unknown>;
}

export class StoryManager {
  private stories = new Map<string, { json: string; metadata: StoryMetadata }>();
  private readonly logger?: pino.Logger;

  constructor(options?: { logger?: pino.Logger }) {
    this.logger = options?.logger;
  }

  /**
   * Load all stories from a directory.
   * Each subdirectory is treated as a story with id = directory name.
   */
  async loadFromDirectory(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      this.logger?.warn({ dir, err }, 'Stories directory not found or not readable');
      return;
    }

    for (const entry of entries) {
      const storyDir = join(dir, entry);
      const stats = await stat(storyDir).catch(() => null);
      if (!stats?.isDirectory()) continue;

      try {
        await this.loadStory(entry, storyDir);
      } catch (err) {
        this.logger?.error({ storyId: entry, err }, 'Failed to load story');
      }
    }

    this.logger?.info({ count: this.stories.size, ids: [...this.stories.keys()] }, 'Stories loaded');
  }

  /**
   * Load a single story from a directory.
   */
  async loadStory(storyId: string, storyDir: string): Promise<void> {
    // Try compiled JSON first, then raw .ink source
    let json: string | null = null;

    const jsonPath = join(storyDir, 'story.ink.json');
    try {
      json = await readFile(jsonPath, 'utf-8');
      // Strip BOM (inklecate outputs BOM)
      json = json.replace(/^\uFEFF/, '');
    } catch {
      // No pre-compiled JSON — try runtime compilation
      const inkPath = join(storyDir, 'story.ink');
      try {
        const inkSource = await readFile(inkPath, 'utf-8');
        json = await this.compileInk(inkSource);
      } catch {
        throw new Error(`No story.ink.json or story.ink found in ${storyDir}`);
      }
    }

    // Load metadata
    const metadata = await this.loadMetadata(storyId, storyDir);

    this.stories.set(storyId, { json, metadata });
    this.logger?.info({ storyId, title: metadata.title }, 'Story loaded');
  }

  /**
   * Get compiled story JSON by ID.
   */
  getStoryJson(storyId: string): string | undefined {
    return this.stories.get(storyId)?.json;
  }

  /**
   * Get story metadata by ID.
   */
  getMetadata(storyId: string): StoryMetadata | undefined {
    return this.stories.get(storyId)?.metadata;
  }

  /**
   * List all available stories.
   */
  listStories(): StoryMetadata[] {
    return [...this.stories.values()].map(s => s.metadata);
  }

  /**
   * Check if a story exists.
   */
  hasStory(storyId: string): boolean {
    return this.stories.has(storyId);
  }

  private async loadMetadata(storyId: string, storyDir: string): Promise<StoryMetadata> {
    const metaPath = join(storyDir, 'metadata.json');
    try {
      const raw = await readFile(metaPath, 'utf-8');
      const data = JSON.parse(raw);
      return {
        id: storyId,
        title: data.title ?? storyId,
        author: data.author,
        description: data.description,
        defaultVoices: data.defaultVoices,
        finkData: data.finkData,
      };
    } catch {
      // No metadata file — use storyId as title
      return { id: storyId, title: storyId };
    }
  }

  private async compileInk(source: string): Promise<string> {
    // Dynamic import of the full inkjs module (includes compiler)
    // This is optional — only needed when .ink source files are used
    try {
      const inkjs = await import('inkjs/full');
      const compiler = new inkjs.Compiler(source);
      const story = compiler.Compile();
      return story.ToJson();
    } catch (err) {
      throw new Error(`Failed to compile Ink source: ${err}`);
    }
  }
}
