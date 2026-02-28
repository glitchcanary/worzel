/**
 * Resolve FINK: link values to absolute URLs.
 *
 * FINK: links can be:
 * - Local story IDs:     "test-garden"
 * - Absolute URLs:       "https://example.com/story.fink.js"
 * - Escaped URLs:        "https:\/\/example.com\/story.fink.js" (Ink convention)
 * - Root-relative:       "/path/to/story.fink.js"
 * - Relative filenames:  "hub.fink.js" or "../other/story.fink.js"
 */

/**
 * Resolve a FINK: link value to an absolute URL.
 *
 * Returns null if the value is a local story ID (no dots, no slashes).
 * For relative paths, a baseUrl is required.
 */
export function resolveFinkUrl(
  linkValue: string,
  baseUrl?: string,
): string | null {
  // Unescape Ink's backslash-escaped slashes: \/ → /
  const unescaped = linkValue.replace(/\\\//g, '/');

  // Absolute URL
  if (unescaped.startsWith('http://') || unescaped.startsWith('https://')) {
    return unescaped;
  }

  // Local story ID — no dots, no slashes (e.g. "test-garden", "menu")
  if (!unescaped.includes('/') && !unescaped.includes('.')) {
    return null;
  }

  // Relative or root-relative — need a base URL to resolve against
  if (!baseUrl) return null;

  try {
    return new URL(unescaped, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Extract the base URL (directory) from a full story URL.
 *
 * Used so that relative FINK: links within a story resolve correctly.
 * e.g. "https://example.com/path/to/story.fink.js" → "https://example.com/path/to/"
 */
export function getBaseUrl(storyUrl: string): string {
  const lastSlash = storyUrl.lastIndexOf('/');
  return lastSlash >= 0 ? storyUrl.slice(0, lastSlash + 1) : storyUrl;
}
