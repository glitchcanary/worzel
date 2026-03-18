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
// The parent fetches source, then injects it into a sandboxed srcdoc iframe
// that boots a tiny worker script. That worker defines oooOO, captures the
// tagged template contents, and posts the extracted Ink back to the parent.
// This avoids needing CORS headers on .fink.js hosts — content is fetched
// as text, then executed in isolation.
//
// The iframe shell uses srcdoc, but loads only same-origin script files.

const SANDBOX_TIMEOUT_MS = 10000;
const DEDUP_WINDOW_MS = 5000;
const SETUP_TIMEOUT_MS = 5000;

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
 * Resolve the sandbox worker URL relative to the current page.
 * @returns {string}
 */
function sandboxWorkerUrl() {
  const base = new URL('.', window.location.href).href;
  return base + 'sandbox-worker.js';
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
    let executionTimeoutId = null;
    let setupTimeoutId = null;
    let loadHandler = null;
    let sandboxPort = null;

    const cleanup = () => {
      if (executionTimeoutId) clearTimeout(executionTimeoutId);
      if (setupTimeoutId) clearTimeout(setupTimeoutId);
      if (loadHandler && iframe) iframe.removeEventListener('load', loadHandler);
      if (sandboxPort) {
        sandboxPort.onmessage = null;
        sandboxPort.close();
      }
      if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    setupTimeoutId = setTimeout(() => {
      settle(() => reject(new Error('Sandbox setup timeout')));
    }, SETUP_TIMEOUT_MS);

    const startExecutionTimeout = () => {
      if (executionTimeoutId) clearTimeout(executionTimeoutId);
      executionTimeoutId = setTimeout(() => {
        settle(() => reject(new Error('Sandbox timeout')));
      }, SANDBOX_TIMEOUT_MS);
    };

    const channel = new MessageChannel();
    sandboxPort = channel.port1;
    sandboxPort.onmessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'sandbox-ready':
          if (setupTimeoutId) {
            clearTimeout(setupTimeoutId);
            setupTimeoutId = null;
          }
          startExecutionTimeout();
          sandboxPort.postMessage({
            type: 'exec-finkjs',
            code: scriptContent,
          });
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

    const workerUrl = sandboxWorkerUrl();
    const sandboxHtml =
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      `<script src="${workerUrl}"></script>` +
      '</head><body></body></html>';

    iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.style.display = 'none';
    iframe.srcdoc = sandboxHtml;
    loadHandler = () => {
      iframe?.contentWindow?.postMessage({ type: 'init-port' }, '*', [channel.port2]);
    };
    iframe.addEventListener('load', loadHandler, { once: true });
    document.body.appendChild(iframe);
  });
}
