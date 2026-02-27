/**
 * InkStateStore — file-based persistence for Ink story state.
 *
 * Saves/restores inkjs story state to JSON files, keyed by device ID and story ID.
 * Migrates to SQLite in Phase 6.
 *
 * Directory structure:
 *   data/ink-saves/
 *     {deviceId}/
 *       {storyId}.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type pino from 'pino';

export interface SavedInkState {
  storyId: string;
  inkState: string;
  savedAt: string;
  turnCount: number;
  lastChoice?: string;
  variables: Record<string, unknown>;
  characterVoices: Record<string, string>;
}

export class InkStateStore {
  private readonly basePath: string;
  private readonly logger?: pino.Logger;

  constructor(basePath: string, options?: { logger?: pino.Logger }) {
    this.basePath = basePath;
    this.logger = options?.logger;
  }

  /**
   * Save story state for a device.
   */
  async save(
    deviceId: string,
    storyId: string,
    inkState: string,
    extra?: {
      turnCount?: number;
      lastChoice?: string;
      variables?: Record<string, unknown>;
      characterVoices?: Record<string, string>;
    },
  ): Promise<void> {
    const dir = join(this.basePath, this.sanitizeId(deviceId));
    await mkdir(dir, { recursive: true });

    const data: SavedInkState = {
      storyId,
      inkState,
      savedAt: new Date().toISOString(),
      turnCount: extra?.turnCount ?? 0,
      lastChoice: extra?.lastChoice,
      variables: extra?.variables ?? {},
      characterVoices: extra?.characterVoices ?? {},
    };

    const filePath = join(dir, `${this.sanitizeId(storyId)}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    this.logger?.debug({ deviceId, storyId, filePath }, 'Ink state saved');
  }

  /**
   * Load saved story state for a device.
   * Returns null if no save exists.
   */
  async load(deviceId: string, storyId: string): Promise<SavedInkState | null> {
    const filePath = join(
      this.basePath,
      this.sanitizeId(deviceId),
      `${this.sanitizeId(storyId)}.json`,
    );

    try {
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as SavedInkState;
      this.logger?.debug({ deviceId, storyId, savedAt: data.savedAt }, 'Ink state loaded');
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Check if a save exists for a device + story.
   */
  async hasSave(deviceId: string, storyId: string): Promise<boolean> {
    const saved = await this.load(deviceId, storyId);
    return saved !== null;
  }

  /**
   * Sanitize IDs for safe filesystem paths — allow only alphanumeric, dash, underscore.
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
