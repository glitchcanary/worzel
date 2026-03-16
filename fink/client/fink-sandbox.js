// FinkSandbox — Sandboxed .fink.js loader
//
// Loads .fink.js files by fetching their content and executing it inside
// a sandboxed iframe (allow-scripts only, no same-origin). The .fink.js
// format wraps Ink source in a JS tagged template literal:
//
//   oooOO`
//   ...pure Ink source...
//   `
//
// The sandbox HTML (sandbox-frame.html + sandbox-worker.js) defines the
// oooOO tag function, captures the string, and posts it back via postMessage.
// This avoids needing CORS headers on .fink.js hosts — content is fetched
// as text, then executed in isolation.
//
// Uses a served HTML file (not srcdoc) so all scripts satisfy CSP script-src 'self'.

const SANDBOX_TIMEOUT_MS = 10000;
const DEDUP_WINDOW_MS = 5000;

/** @type {Map<string, number>} */
const recentLoads = new Map();

/**
 * Load a .fink.js file via sandboxed iframe execution.
 * @param {string} url - URL of the .fink.js file
 * @returns {Promise<string|null>} Extracted Ink source, or null if skipped
 */
export async function loadFinkJs(url) {
  // Duplicate detection
  const now = Date.now();
  const lastLoad = recentLoads.get(url);
  if (lastLoad && (now - lastLoad) < DEDUP_WINDOW_MS) {
    console.warn('[fink-sandbox] Skipping duplicate load:', url);
    return null;
  }
  recentLoads.set(url, now);

  // Fetch the script content in the parent context
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  const scriptContent = await resp.text();

  // Execute in sandboxed iframe
  return executeSandboxed(scriptContent);
}

/**
 * Clear the duplicate load record for a URL (for intentional re-navigation).
 * @param {string} url
 */
export function clearLoadRecord(url) {
  recentLoads.delete(url);
}

/**
 * Resolve the sandbox frame URL relative to the current page.
 * @returns {string}
 */
function sandboxFrameUrl() {
  // sandbox-frame.html is served alongside finkapp.html
  const base = new URL('.', window.location.href).href;
  return base + 'sandbox-frame.html';
}

/**
 * Execute script content in a sandboxed iframe and extract finkData.
 * @param {string} scriptContent
 * @returns {Promise<string>}
 */
function executeSandboxed(scriptContent) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let iframe = null;
    let messageHandler = null;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (messageHandler) window.removeEventListener('message', messageHandler);
      if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    timeoutId = setTimeout(() => {
      settle(() => reject(new Error('Sandbox timeout')));
    }, SANDBOX_TIMEOUT_MS);

    messageHandler = (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'sandbox-ready':
          // Send the script content to the sandbox for execution
          iframe.contentWindow.postMessage({
            type: 'exec-finkjs',
            code: scriptContent,
          }, '*');
          break;

        case 'fink-loaded':
          if (msg.data) {
            settle(() => resolve(msg.data));
          } else {
            settle(() => reject(new Error('No oooOO tagged template found in .fink.js')));
          }
          break;

        case 'fink-error':
          settle(() => reject(new Error(`Sandbox error: ${msg.error}`)));
          break;
      }
    };

    window.addEventListener('message', messageHandler);

    // Create sandboxed iframe using a served HTML file (CSP-compliant)
    iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.style.display = 'none';
    iframe.src = sandboxFrameUrl();
    document.body.appendChild(iframe);
  });
}
