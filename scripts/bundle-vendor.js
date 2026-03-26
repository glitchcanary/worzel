#!/usr/bin/env node
// Bundle third-party client dependencies into fink/client/vendor/ using esbuild.
// Run as part of `npm run build`. Output files are gitignored (generated).
//
// Security note: bundling from node_modules (npm-audited, lockfile-pinned) is
// safer than loading from a CDN at runtime, which bypasses CSP and npm audit.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../fink/client/vendor');

await build({
  entryPoints: ['@supabase/supabase-js'],
  bundle: true,
  format: 'esm',
  outfile: join(outDir, 'supabase.js'),
  minify: true,
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Write a SHA-256 integrity hash alongside the bundle so it can be verified.
const bundle = readFileSync(join(outDir, 'supabase.js'));
const hash = createHash('sha256').update(bundle).digest('base64');
writeFileSync(join(outDir, 'supabase.js.sha256'), `sha256-${hash}\n`);

console.log(`bundled supabase → fink/client/vendor/supabase.js (sha256-${hash.slice(0, 16)}...)`);
