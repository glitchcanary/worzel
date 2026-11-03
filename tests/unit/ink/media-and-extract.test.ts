import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveMediaUrl } from '../../../src/ink/media-resolver.js';
import { extractInkFromFinkJs } from '../../../src/ink/fink-js-extractor.js';
import { InkSession } from '../../../src/ink/ink-session.js';
import { StoryManager } from '../../../src/ink/story-manager.js';

describe('resolveMediaUrl', () => {
  const story = 'https://danbri.github.io/glitchcan-minigam/inklet/bagend.fink.js';

  it('resolves BASEHREF relative to the story file', () => {
    expect(resolveMediaUrl('hobbit_pantry.svg', 'media/bagend/', story))
      .toBe('https://danbri.github.io/glitchcan-minigam/inklet/media/bagend/hobbit_pantry.svg');
    expect(resolveMediaUrl('../coverart/x.jpeg', 'media/bagend/', story))
      .toBe('https://danbri.github.io/glitchcan-minigam/inklet/media/coverart/x.jpeg');
  });

  it('accepts root-relative BASEHREF and escaped absolute URLs', () => {
    expect(resolveMediaUrl('a.jpg', '/glitchcan-minigam/inklet/media/', story))
      .toBe('https://danbri.github.io/glitchcan-minigam/inklet/media/a.jpg');
    expect(resolveMediaUrl('https:\\/\\/example.org\\/a.png', undefined, story))
      .toBe('https://example.org/a.png');
  });

  it('keeps local stories relative to the client page', () => {
    expect(resolveMediaUrl('cat.png', 'img/', 'stories/test-garden/story.fink.js'))
      .toBe('stories/test-garden/img/cat.png');
  });

  it('rejects non-http schemes', () => {
    expect(resolveMediaUrl('javascript:alert(1)', undefined, story)).toBeUndefined();
    expect(resolveMediaUrl('', undefined, story)).toBeUndefined();
  });
});

describe('extractInkFromFinkJs', () => {
  it('captures raw template text, so escaped URLs survive', async () => {
    const src = 'oooOO`\n# FINK: https:\\/\\/example.org\\/a.fink.js\nHello.\n`';
    const ink = await extractInkFromFinkJs(src);
    expect(ink).toContain('https:\\/\\/example.org\\/a.fink.js');
  });

  it('joins several blocks with a real newline and drops duplicates', async () => {
    const src = 'oooOO`A`\noooOO`B`\noooOO`A`\nOO("text/plain")`ignored`';
    expect(await extractInkFromFinkJs(src)).toBe('A\nB');
  });
});

describe('InkSession media', () => {
  it('keeps a global BASEHREF in force and resolves images', async () => {
    const inkjs = await import('inkjs/full');
    const ink = '# BASEHREF: media/shane/\nFirst line.\nSecond line. # IMAGE: desktop/manor.jpg\n-> END\n';
    const json = new inkjs.Compiler(ink).Compile().ToJson()!;
    const s = new InkSession('x', json, {
      id: 'x', title: 'x', mediaBase: 'https://danbri.github.io/glitchcan-minigam/inklet/shane-manor.fink.js',
    });
    const { narration } = s.continue();
    expect(narration.find(n => n.image)?.image)
      .toBe('https://danbri.github.io/glitchcan-minigam/inklet/media/shane/desktop/manor.jpg');
  });
});

describe('StoryManager catalogue', () => {
  it('lists catalogue entries and refuses them when external loading is off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fink-cat-'));
    const path = join(dir, 'catalog.json');
    await writeFile(path, JSON.stringify({ stories: [
      { id: 'glitch-x', title: 'X', group: 'Glitch Canary', url: 'https://danbri.github.io/x.fink.js' },
    ] }));
    const sm = new StoryManager();
    await sm.loadCatalog(path);
    const listed = sm.listStories();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'glitch-x', external: true, group: 'Glitch Canary' });
    expect(sm.externalEnabled).toBe(false);
    expect(await sm.resolveStoryId('glitch-x')).toBeNull();
    expect(await sm.resolveStoryId('nope')).toBeNull();
  });
});
