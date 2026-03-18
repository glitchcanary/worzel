// sandbox-worker.js — runs inside the sandboxed iframe
// Defines the oooOO tagged template function and executes .fink.js content
// sent from the parent via postMessage.

window.finkData = [];
window.finkPort = null;

function oooOO(strings) {
  var result = strings[0];
  for (var i = 1; i < arguments.length; i++) {
    result += String(arguments[i]) + strings[i];
  }
  window.finkData.push(result);
}

function attachPort(port) {
  window.finkPort = port;
  port.onmessage = function(e) {
    if (e.data && e.data.type === 'exec-finkjs') {
      try {
        window.finkData = [];
        (new Function(e.data.code))();
        port.postMessage({
          type: 'fink-loaded',
          data: window.finkData[0] || null
        });
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
