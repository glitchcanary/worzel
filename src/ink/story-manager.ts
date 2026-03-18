/**
 * StoryManager — loads, compiles, and indexes Ink stories from a directory.
 *
 * Story directory structure:
 *   stories/
 *     my-story/
 *       story.fink.js    (runtime story source)
 *       metadata.json     (title, author, description, voices, fink data)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type pino from 'pino';
import { extractInkFromFinkJs } from './fink-js-extractor.js';
import { resolveFinkUrl, getBaseUrl } from './fink-url-resolver.js';
import type { ExternalStoryLoader } from './external-story-loader.js';

export interface StoryMetadata {
  id: string;
  title: string;
  author?: string;
  description?: string;
  defaultVoices?: Record<string, string>;
  characters?: Record<string, StoryCharacterMetadata>;
  voices?: Record<string, StoryVoiceProfile>;
  finkData?: Record<string, unknown>;
}

export interface StoryCharacterMetadata {
  name?: string;
  voice?: string;
  mood?: string;
  voiceDirectives?: Record<string, string>;
  foaf?: Record<string, string>;
}

export interface StoryVoiceProfile {
  description?: string;
  traits?: string[];
  style?: Record<string, string>;
  providers?: Record<string, string>;
}

export class StoryManager {
  private stories = new Map<string, { json: string; metadata: StoryMetadata }>();
  private readonly logger?: pino.Logger;

  /** Base URLs for external stories (for resolving relative FINK: links within them). */
  private externalBaseUrls = new Map<string, string>();

  /** External story loader (null if external loading is disabled). */
  private externalLoader: ExternalStoryLoader | null = null;

  constructor(options?: { logger?: pino.Logger }) {
    this.logger = options?.logger;
  }

  /** Enable external .fink.js story loading. */
  setExternalLoader(loader: ExternalStoryLoader): void {
    this.externalLoader = loader;
  }

  /**
   * Get the base URL for an external story (for resolving relative links).
   */
  getBaseUrl(storyId: string): string | undefined {
    return this.externalBaseUrls.get(storyId);
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
    const finkPath = join(storyDir, 'story.fink.js');
    const finkContent = await readFile(finkPath, 'utf-8');
    const inkSource = await extractInkFromFinkJs(finkContent);
    const json = await this.compileInk(inkSource);

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

  /**
   * Resolve a FINK: link value to a story ID.
   *
   * Tries local stories first, then resolves as an external URL,
   * fetches the .fink.js file, extracts Ink via isolated-vm, compiles,
   * and caches the result.
   *
   * @param linkValue - Raw FINK: tag value (local ID or URL)
   * @param currentStoryId - The story containing the link (for base URL resolution)
   * @returns Story ID usable with getStoryJson(), or null if resolution failed
   */
  async resolveExternalLink(
    linkValue: string,
    currentStoryId: string,
  ): Promise<string | null> {
    // 1. Try local lookup first
    if (this.hasStory(linkValue)) {
      return linkValue;
    }

    // 2. Resolve to URL
    const currentBaseUrl = this.externalBaseUrls.get(currentStoryId);
    const resolvedUrl = resolveFinkUrl(linkValue, currentBaseUrl);
    if (!resolvedUrl) {
      this.logger?.warn({ linkValue, currentStoryId }, 'Cannot resolve FINK: link as URL');
      return null;
    }

    // 3. Check cache (URL as story ID)
    if (this.hasStory(resolvedUrl)) {
      return resolvedUrl;
    }

    // 4. Fetch and compile
    if (!this.externalLoader) {
      this.logger?.warn(
        { url: resolvedUrl },
        'External story loading disabled (no FINK_EXTERNAL_HOSTS configured)',
      );
      return null;
    }

    try {
      const rawContent = await this.externalLoader.fetch(resolvedUrl);
      const inkSource = await extractInkFromFinkJs(rawContent);
      const json = await this.compileInk(inkSource);

      const metadata: StoryMetadata = {
        id: resolvedUrl,
        title: this.extractTitleFromInk(inkSource) ?? resolvedUrl,
        finkData: { sourceUrl: resolvedUrl, external: true },
      };

      this.stories.set(resolvedUrl, { json, metadata });
      this.externalBaseUrls.set(resolvedUrl, getBaseUrl(resolvedUrl));

      this.logger?.info({ url: resolvedUrl, title: metadata.title }, 'External story loaded');
      return resolvedUrl;
    } catch (err) {
      this.logger?.error({ err, url: resolvedUrl }, 'Failed to load external story');
      return null;
    }
  }

  /** Extract a title from Ink source (first meaningful comment or heading). */
  private extractTitleFromInk(inkSource: string): string | null {
    for (const line of inkSource.split('\n').slice(0, 20)) {
      const trimmed = line.trim();
      // Look for // Title-like comments
      if (trimmed.startsWith('//') && trimmed.length > 4) {
        const title = trimmed.replace(/^\/\/\s*=*\s*/, '').replace(/\s*=*\s*$/, '').trim();
        if (title.length > 2 && title.length < 80) return title;
      }
    }
    return null;
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
        characters: data.characters,
        voices: data.voices,
        finkData: data.finkData,
      };
    } catch {
      // No metadata file — use storyId as title
      return { id: storyId, title: storyId };
    }
  }

  /**
   * Inject platform-provided knots (e.g. _inventory) if not defined in the source.
   * See CLAUDE.md "Fink platform-provided knots" for design notes.
   */
  private injectPlatformKnots(source: string): string {
    const knots: string[] = [];

    // _inventory — stub until real inventory tracking is implemented
    if (!source.includes('=== _inventory') && source.includes('_inventory')) {
      knots.push(`
=== _inventory ===
You take stock of your journey so far. You're traveling light — nothing to speak of yet.
+ [Continue] -> DONE
`);
      this.logger?.info('Injected platform _inventory knot');
    }

    return knots.length > 0 ? source + '\n' + knots.join('\n') : source;
  }

  private async compileInk(source: string): Promise<string> {
    // Dynamic import of the full inkjs module (includes compiler)
    // This is optional — only needed when .ink source files are used
    const patched = this.injectPlatformKnots(source);
    try {
      const inkjs = await import('inkjs/full');
      const compiler = new inkjs.Compiler(patched);
      const story = compiler.Compile();
      return story.ToJson();
    } catch (err) {
      throw new Error(`Failed to compile Ink source: ${err}`);
    }
  }
}
