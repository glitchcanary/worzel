/**
 * Extract Ink source from a .fink.js file using isolated-vm.
 *
 * The .fink.js format wraps Ink source in a JS tagged template literal:
 *
 *   oooOO`
 *   ...pure Ink source...
 *   `
 *
 * We execute the JS in a real V8 isolate (memory-limited, time-limited,
 * no Node APIs) and capture the string passed to the oooOO tag function.
 */

import ivm from 'isolated-vm';

/**
 * Extract Ink source from .fink.js content.
 *
 * Runs the JS in an isolated V8 environment with:
 * - 32MB memory limit
 * - 5 second timeout
 * - No access to Node APIs, filesystem, or network
 */
export async function extractInkFromFinkJs(content: string): Promise<string> {
  const isolate = new ivm.Isolate({ memoryLimit: 32 });
  try {
    const context = await isolate.createContext();
    // Capture contract (same as @foafos/backticks in glitchcan-minigam):
    //   1. RAW capture (strings.raw), never cooked: authors write `\/\/` in
    //      ink tag URLs and only raw capture keeps the backslashes.
    //   2. Every `oooOO` block in document order, duplicates dropped,
    //      joined by a real newline (String.fromCharCode(10)).
    //   3. `OO(mediaType)` is accepted; only text/x-ink blocks are kept.
    await context.eval(`
      var __blocks = [];
      function __rawOf(strings) {
        if (strings && Array.isArray(strings.raw)) return strings.raw.join('');
        return strings == null ? '' : String(strings);
      }
      function __make(mediaType) {
        return function (strings) {
          var raw = __rawOf(strings);
          __blocks.push({ mediaType: mediaType, raw: raw });
          return raw;
        };
      }
      var oooOO = __make('text/x-ink');
      function OO(mediaType) { return __make(String(mediaType || 'text/plain')); }
      function __harvest() {
        var seen = {}, out = [];
        for (var i = 0; i < __blocks.length; i++) {
          var b = __blocks[i];
          if (b.mediaType !== 'text/x-ink') continue;
          if (Object.prototype.hasOwnProperty.call(seen, b.raw)) continue;
          seen[b.raw] = true;
          out.push(b.raw);
        }
        return out.join(String.fromCharCode(10));
      }
    `);

    // Execute the .fink.js content inside the sandbox
    await context.eval(content, { timeout: 5000 });

    const result = await context.eval('__harvest()', { timeout: 1000, copy: true });
    if (typeof result !== 'string' || !result.trim()) {
      throw new Error('No oooOO tagged template found in .fink.js content');
    }
    return result;
  } finally {
    isolate.dispose();
  }
}
