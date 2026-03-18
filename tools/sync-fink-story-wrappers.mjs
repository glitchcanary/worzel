#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? new URL('../stories/', import.meta.url);
const storiesDir = typeof root === 'string' ? root : root.pathname;

for (const entry of await readdir(storiesDir)) {
  const storyDir = join(storiesDir, entry);
  const info = await stat(storyDir).catch(() => null);
  if (!info?.isDirectory()) continue;

  const inkPath = join(storyDir, 'story.ink');
  const finkPath = join(storyDir, 'story.fink.js');
  const inkSource = await readFile(inkPath, 'utf8').catch(() => null);
  if (!inkSource) continue;

  const escaped = inkSource
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');

  const content = `oooOO\`\n${escaped}${escaped.endsWith('\n') ? '' : '\n'}\`;\n`;
  await writeFile(finkPath, content, 'utf8');
  console.log(`wrote ${finkPath}`);
}
