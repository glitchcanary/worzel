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
    const jail = context.global;

    // Set up a capture variable and the oooOO tag function inside the isolate.
    // Tagged template functions receive (strings[], ...values) — we reassemble
    // them with String.raw semantics.
    await jail.set('__captured', '');
    await context.eval(`
      function oooOO(strings) {
        var result = strings[0];
        for (var i = 1; i < arguments.length; i++) {
          result += String(arguments[i]) + strings[i];
        }
        __captured = result;
      }
    `);

    // Execute the .fink.js content inside the sandbox
    await context.eval(content, { timeout: 5000 });

    // Retrieve the captured Ink source
    const result = await jail.get('__captured', { copy: true });
    if (typeof result !== 'string' || !result.trim()) {
      throw new Error('No oooOO tagged template found in .fink.js content');
    }
    return result;
  } finally {
    isolate.dispose();
  }
}
