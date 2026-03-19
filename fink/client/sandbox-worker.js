// sandbox-worker.js — runs inside the sandboxed iframe
// Defines oooOO, injects the requested .fink.js as <script src=...>,
// and returns the captured Ink source.
window.finkPort = null;
window.finkData = [];

function oooOO(strings) {
  var content = (typeof strings === 'object' && strings.raw)
    ? strings.raw.join('')
    : String(strings);
  window.finkData.push(content);
  return content;
}

function attachPort(port) {
  window.finkPort = port;
  port.onmessage = function(e) {
    if (e.data && e.data.type === 'load-fink-script') {
      try {
        window.finkData = [];

        var prior = document.getElementById('fink-script');
        if (prior && prior.parentNode) {
          prior.parentNode.removeChild(prior);
        }

        var script = document.createElement('script');
        script.id = 'fink-script';
        script.src = String(e.data.url || '');
        script.onload = function() {
          port.postMessage({
            type: 'fink-loaded',
            data: window.finkData[0] || null
          });
        };
        script.onerror = function() {
          port.postMessage({
            type: 'fink-error',
            error: 'Failed to load script in sandbox'
          });
        };
        document.body.appendChild(script);
      } catch (err) {
        port.postMessage({
          type: 'fink-error',
          error: err.message
        });
      }
    }
  };
  if (typeof port.start === 'function') port.start();
  port.postMessage({ type: 'sandbox-ready' });
}

window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'init-port' && e.ports && e.ports[0]) {
    attachPort(e.ports[0]);
  }
});
