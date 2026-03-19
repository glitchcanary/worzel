// FinkSandbox — Sandboxed .fink.js loader
//
// Loads .fink.js files inside a sandboxed iframe (allow-scripts only,
// no same-origin). The .fink.js
// format wraps Ink source in a JS tagged template literal:
//
//   oooOO`
//   ...pure Ink source...
//   `
//
// The parent sends the URL to a sandboxed srcdoc iframe that boots a tiny
// worker script. The iframe injects a <script src="..."> tag, lets the
// browser evaluate the .fink.js file in the sandbox, captures the oooOO
// tagged template contents, and posts the extracted Ink back.
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

  return executeSandboxed(url);
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
 * Load a .fink.js URL inside a sandboxed iframe and capture the resulting Ink.
 * @param {string} scriptUrl
 * @returns {Promise<string>}
 */
function executeSandboxed(scriptUrl) {
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
            type: 'load-fink-script',
            url: scriptUrl,
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
