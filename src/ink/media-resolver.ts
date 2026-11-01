/**
 * Resolve `# IMAGE:` (and other media) tag values to URLs the client can load.
 *
 * Layering follows the glitchcan-minigam story runner (`resolveMedia`):
 *   story file URL  →  `# BASEHREF:` (relative to the story file)  →  media path
 *
 * `storyBase` is the URL of the story file. It is absolute for external
 * stories ("https://danbri.github.io/.../bagend.fink.js") and relative to the
 * Fink client page for local stories ("stories/test-garden/story.fink.js").
 * A relative base gives a relative result, so the browser resolves it against
 * the page that shows it.
 */

const LOCAL_ORIGIN = 'http://fink.local/';

/** Undo ink's `\/` escaping and turn `example.com/x` into `https://example.com/x`. */
function normalise(value: string): string {
  const v = value.trim().replace(/\\\//g, '/');
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\//.test(v) && !v.startsWith('/')) {
    return `https://${v}`;
  }
  return v;
}

export function resolveMediaUrl(
  media: string | undefined,
  basehref: string | undefined,
  storyBase: string | undefined,
): string | undefined {
  if (!media || !media.trim()) return undefined;
  const target = normalise(media);
  if (/^(https?:|data:)/i.test(target)) return target;

  const absoluteBase = storyBase && /^https?:\/\//i.test(storyBase);
  try {
    let base = new URL(storyBase ?? '', LOCAL_ORIGIN);
    if (basehref && basehref.trim()) base = new URL(normalise(basehref), base);
    const url = new URL(target, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (absoluteBase || url.origin !== new URL(LOCAL_ORIGIN).origin) return url.toString();
    // Local story: return a path relative to the client page.
    return url.pathname.replace(/^\//, '') + url.search + url.hash;
  } catch {
    return undefined;
  }
}
